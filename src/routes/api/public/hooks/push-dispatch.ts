import { createFileRoute } from "@tanstack/react-router";
import { berlinClock, berlinInstant } from "@/lib/push-time";

/**
 * Scheduled push dispatcher.
 *
 * Runs every minute (pg_cron). It looks for reminders that are due right now
 * and sends them once — the delivery table's unique key makes a repeat run a
 * no-op, so overlapping cron ticks cannot double-notify.
 */

// A late scheduler tick must still deliver, but an hours-old reminder must
// never surface. 15 minutes is the maximum lateness we accept.
const LOOKBACK_MS = 15 * 60 * 1000;
const LOOKAHEAD_MS = 60 * 1000; // "due within this tick"
const SHIFT_START_LEAD_MIN = 15;

type Prefs = { notifyTimeToLeave?: boolean; notifyShiftStart?: boolean };

function due(at: Date, now: number): boolean {
  const t = at.getTime();
  return t <= now + LOOKAHEAD_MS && t >= now - LOOKBACK_MS;
}


export const Route = createFileRoute("/api/public/hooks/push-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected =
          process.env["SUPABASE_ANON_KEY"] ?? process.env["SUPABASE_PUBLISHABLE_KEY"];
        const provided =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (!expected || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendToOperator } = await import("@/lib/push.server");

        const now = Date.now();
        const fromIso = new Date(now - LOOKBACK_MS).toISOString();
        const toIso = new Date(now + LOOKAHEAD_MS).toISOString();

        const { data: operators, error: opErr } = await supabaseAdmin
          .from("operators")
          .select("id, username, prefs")
          .eq("is_active", true);
        if (opErr) return Response.json({ error: opErr.message }, { status: 500 });

        const byId = new Map<string, { username: string; prefs: Prefs }>();
        const byName = new Map<string, string>();
        for (const row of (operators ?? []) as { id: string; username: string; prefs: Prefs }[]) {
          byId.set(row.id, { username: row.username, prefs: row.prefs ?? {} });
          byName.set(row.username.toLowerCase(), row.id);
        }

        type Job = {
          operatorId: string;
          key: string;
          type: string;
          at: Date;
          title: string;
          body: string;
          /** Start instant of the shift this reminder belongs to. */
          shiftStartMs: number;
        };
        const jobs: Job[] = [];

        // --- Time to leave (from the server-side travel plans) ---
        const { data: plans } = await supabaseAdmin
          .from("operator_travel_plans")
          .select("operator_id, shift_start_at, departure_at, travel_minutes, route_label")
          .gte("departure_at", fromIso)
          .lte("departure_at", toIso);

        for (const plan of (plans ?? []) as {
          operator_id: string;
          shift_start_at: string;
          departure_at: string;
          travel_minutes: number;
          route_label: string | null;
        }[]) {
          const op = byId.get(plan.operator_id);
          if (!op || op.prefs.notifyTimeToLeave === false) continue;
          const at = new Date(plan.departure_at);
          if (!due(at, now)) continue;
          const shiftStart = new Date(plan.shift_start_at);
          jobs.push({
            operatorId: plan.operator_id,
            // Canonical instant in the key: a retimed shift produces a new key,
            // so the old reminder can never be reused.
            key: `leave:${shiftStart.toISOString()}`,
            type: "time_to_leave",
            at,
            shiftStartMs: shiftStart.getTime(),
            title: "Time to leave",
            body: `Leave now — about ${plan.travel_minutes} min to the studio for your ${berlinClock(
              new Date(plan.shift_start_at),
            )} shift.`,
          });
        }

        // --- Shift start (15 minutes before) ---
        const todayKeys = [-1, 0, 1].map((offset) => {
          const d = new Date(now + offset * 24 * 60 * 60 * 1000);
          return d.toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
        });

        const { data: shifts } = await supabaseAdmin
          .from("scheduled_shifts")
          .select("id, assigned_operator, specific_date, start_time, status")
          .in("specific_date", todayKeys);

        for (const shift of (shifts ?? []) as {
          id: string;
          assigned_operator: string | null;
          specific_date: string;
          start_time: string;
          status: string;
        }[]) {
          if (!shift.assigned_operator || shift.status === "cancelled") continue;
          const operatorId = byName.get(shift.assigned_operator.toLowerCase());
          if (!operatorId) continue;
          const op = byId.get(operatorId);
          if (!op || op.prefs.notifyShiftStart === false) continue;

          const start = berlinInstant(shift.specific_date, shift.start_time);
          if (!start) continue;
          const at = new Date(start.getTime() - SHIFT_START_LEAD_MIN * 60_000);
          if (!due(at, now)) continue;

          jobs.push({
            operatorId,
            // Key carries the shift's current start instant, so a calendar
            // retime invalidates the previously scheduled reminder.
            key: `start:${shift.id}@${start.toISOString()}`,
            type: "shift_start",
            at,
            shiftStartMs: start.getTime(),
            title: "Shift starts soon",
            body: `Your shift starts at ${berlinClock(start)} — ${SHIFT_START_LEAD_MIN} minutes from now.`,
          });
        }

        const stats = {
          candidates: jobs.length,
          claimed: 0,
          skipped: 0,
          sent: 0,
          delivered: 0,
          partial: 0,
          failed: 0,
          no_subscription: 0,
        };

        for (const job of jobs) {
          // Atomic claim: inserts a fresh row, or takes over a row that
          // failed / was left "sending" by a crashed run. Anything already
          // sent, expired, out of attempts, or held by a concurrent run
          // returns nothing — so the same logical notification is never
          // sent twice, and a transient failure is not permanent.
          const expiresAt = new Date(job.at.getTime() + LOOKBACK_MS).toISOString();
          const { data: claim, error: claimErr } = await supabaseAdmin.rpc("claim_push_delivery", {
            p_operator_id: job.operatorId,
            p_key: job.key,
            p_type: job.type,
            p_scheduled_at: job.at.toISOString(),
            p_expires_at: expiresAt,
          } as never);
          const claimed = Array.isArray(claim) ? claim[0] : claim;
          if (claimErr || !claimed) {
            stats.skipped += 1;
            continue;
          }
          stats.claimed += 1;

          // Final state check, after the claim and immediately before sending:
          // a shift cancelled or retimed in the meantime must not notify.
          const liveStarts = await activeShiftStartSet(job.operatorId);
          if (!liveStarts.has(job.shiftStartMs)) {
            stats.cancelled += 1;
            await supabaseAdmin
              .from("push_notification_deliveries")
              .update({ status: "cancelled", locked_at: null } as never)
              .eq("operator_id", job.operatorId)
              .eq("notification_key", job.key);
            continue;
          }

          let result: Awaited<ReturnType<typeof sendToOperator>>;
          try {
            result = await sendToOperator(job.operatorId, {
              title: job.title,
              body: job.body,
              tag: job.key,
              url: "/",
            });
          } catch (err) {
            result = {
              sent: 0,
              failed: 1,
              gone: 0,
              total: 1,
              error: err instanceof Error ? err.message : "send failed",
            };
          }

          // no device at all -> terminal (retrying cannot help)
          // every live device failed -> retryable
          // some succeeded -> delivered (partial), not retried
          const status =
            result.total === 0
              ? "no_subscription"
              : result.sent > 0
                ? result.failed > 0
                  ? "partial"
                  : "sent"
                : "failed";

          stats.sent += result.sent;
          if (status === "sent") stats.delivered += 1;
          else if (status === "partial") stats.partial += 1;
          else if (status === "failed") stats.failed += 1;
          else stats.no_subscription += 1;

          await supabaseAdmin
            .from("push_notification_deliveries")
            .update({
              status,
              sent_at: result.sent > 0 ? new Date().toISOString() : null,
              devices_sent: result.sent,
              devices_failed: result.failed,
              last_error: result.error ?? null,
              locked_at: null,
            } as never)
            .eq("operator_id", job.operatorId)
            .eq("notification_key", job.key);
        }

        // Reminders whose lateness window has passed can never fire again.
        await supabaseAdmin
          .from("push_notification_deliveries")
          .update({ status: "expired", locked_at: null } as never)
          .in("status", ["pending", "failed"])
          .lt("expires_at", new Date(now).toISOString());

        return Response.json({ ok: true, ...stats });

      },
    },
  },
});
