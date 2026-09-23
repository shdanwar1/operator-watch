import { createFileRoute } from "@tanstack/react-router";
import { berlinClock, berlinInstant } from "@/lib/push-time";
import { NOTIFICATION_TYPES, startCheckInKey, startReminderKey } from "@/lib/push-keys";
import { normalizeUsername } from "@/domain/operator-identity";

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
// The shift-start reminder has a 15-minute lead.
const SHIFT_START_LEAD_MIN = 15;

type Prefs = { notifyShiftStart?: boolean };

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
        const { activeShiftStartSet } = await import("@/lib/notifications.server");

        const now = Date.now();

        const { data: operators, error: opErr } = await supabaseAdmin
          .from("operators")
          .select("id, username, prefs")
          .eq("is_active", true);
        if (opErr) return Response.json({ error: opErr.message }, { status: 500 });

        const byId = new Map<string, { username: string; prefs: Prefs }>();
        const byName = new Map<string, string>();
        for (const row of (operators ?? []) as { id: string; username: string; prefs: Prefs }[]) {
          byId.set(row.id, { username: row.username, prefs: row.prefs ?? {} });
          byName.set(normalizeUsername(row.username), row.id);
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
          /** Where tapping the notification takes the operator. */
          url?: string;
          /** Shift the tap should check the operator into, if any. */
          scheduledShiftId?: string;
        };

        const jobs: Job[] = [];

        // --- Shift start: a reminder 15 minutes before, and a separate
        // "starting now" notification at the exact start that checks the
        // operator in when tapped. Both are governed by notifyShiftStart. ---
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
          const operatorId = byName.get(normalizeUsername(shift.assigned_operator));
          if (!operatorId) continue;
          const op = byId.get(operatorId);
          if (!op || op.prefs.notifyShiftStart === false) continue;

          const start = berlinInstant(shift.specific_date, shift.start_time);
          if (!start) continue;

          const remindAt = new Date(start.getTime() - SHIFT_START_LEAD_MIN * 60_000);
          if (due(remindAt, now)) {
            jobs.push({
              operatorId,
              // Key carries the shift's current start instant, so a calendar
              // retime invalidates the previously scheduled reminder.
              key: startReminderKey(shift.id, start),
              type: NOTIFICATION_TYPES.shiftStartReminder,
              at: remindAt,
              shiftStartMs: start.getTime(),
              title: "Shift starts soon",
              body: `Your shift starts at ${berlinClock(start)} — ${SHIFT_START_LEAD_MIN} minutes from now.`,
            });
          }

          if (due(start, now)) {
            jobs.push({
              operatorId,
              key: startCheckInKey(shift.id, start),
              type: NOTIFICATION_TYPES.shiftStartCheckIn,
              at: start,
              shiftStartMs: start.getTime(),
              title: "Shift starting now",
              body: "Tap to check in",
              // Identifies the shift only; the server decides everything else.
              url: `/?autoCheckIn=${shift.id}`,
              scheduledShiftId: shift.id,
            });
          }
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
          cancelled: 0,
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
              url: job.url ?? "/",
              type: job.type,
              ...(job.scheduledShiftId ? { scheduledShiftId: job.scheduledShiftId } : {}),
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
