import { createFileRoute } from "@tanstack/react-router";
import { berlinClock, berlinInstant } from "@/lib/push-time";

/**
 * Scheduled push dispatcher.
 *
 * Runs every minute (pg_cron). It looks for reminders that are due right now
 * and sends them once — the delivery table's unique key makes a repeat run a
 * no-op, so overlapping cron ticks cannot double-notify.
 */

const LOOKBACK_MS = 5 * 60 * 1000; // tolerate a few missed ticks
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
        const expected = process.env["SUPABASE_ANON_KEY"];
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

        type Job = { operatorId: string; key: string; type: string; at: Date; title: string; body: string };
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
          jobs.push({
            operatorId: plan.operator_id,
            key: `leave:${plan.shift_start_at}`,
            type: "time_to_leave",
            at,
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
            key: `start:${shift.id}`,
            type: "shift_start",
            at,
            title: "Shift starts soon",
            body: `Your shift starts at ${berlinClock(start)} — ${SHIFT_START_LEAD_MIN} minutes from now.`,
          });
        }

        let sent = 0;
        let skipped = 0;

        for (const job of jobs) {
          // The unique (operator_id, notification_key) claim is the lock.
          const { error: claimErr } = await supabaseAdmin.from("push_notification_deliveries").insert({
            operator_id: job.operatorId,
            notification_key: job.key,
            notification_type: job.type,
            scheduled_at: job.at.toISOString(),
            status: "sending",
          } as never);
          if (claimErr) {
            skipped += 1;
            continue;
          }

          const result = await sendToOperator(job.operatorId, {
            title: job.title,
            body: job.body,
            tag: job.key,
            url: "/",
          });
          sent += result.sent;

          await supabaseAdmin
            .from("push_notification_deliveries")
            .update({
              status: result.sent > 0 ? "sent" : "failed",
              sent_at: new Date().toISOString(),
            } as never)
            .eq("operator_id", job.operatorId)
            .eq("notification_key", job.key);
        }

        return Response.json({ ok: true, candidates: jobs.length, sent, skipped });
      },
    },
  },
});
