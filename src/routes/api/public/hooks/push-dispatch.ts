import { createFileRoute } from "@tanstack/react-router";
import { berlinClock, berlinInstant } from "@/lib/push-time";
import {
  NOTIFICATION_TYPES,
  leaveHomeKey,
  startCheckInKey,
  startReminderKey,
} from "@/lib/push-keys";
import { LEAVE_NOTIFY_LEAD_MIN, leaveNotificationAt } from "@/lib/time-to-leave";
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
// A failed Time to Leave lookup is retried at most every 10 minutes.
const TTL_RETRY_BACKOFF_MS = 10 * 60 * 1000;
/** Time to Leave is calculated for the next shift once it is within this horizon. */
const TTL_CALC_HORIZON_MS = 24 * 60 * 60 * 1000;

function due(at: Date, now: number): boolean {
  const t = at.getTime();
  return t <= now + LOOKAHEAD_MS && t >= now - LOOKBACK_MS;
}

export const Route = createFileRoute("/api/public/hooks/push-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret") ?? "";
        if (!provided || provided.length > 200) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: allowed } = await supabaseAdmin.rpc(
          "verify_cron_secret" as never,
          { _provided: provided } as never,
        );
        if (allowed !== true) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { loadActiveSubscriptions, sendToLoadedSubscriptions } = await import(
          "@/lib/push.server"
        );

        const now = Date.now();

        const { data: operators, error: opErr } = await supabaseAdmin
          .from("operators")
          .select("id, username")
          .eq("is_active", true);
        if (opErr) return Response.json({ error: opErr.message }, { status: 500 });

        type OpRow = {
          id: string;
          username: string;
        };
        const byId = new Map<string, OpRow>();
        const byName = new Map<string, string>();
        for (const row of (operators ?? []) as OpRow[]) {
          byId.set(row.id, row);
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
        // operator in when tapped. Always sent for every assigned, non-cancelled shift. ---
        const todayKeys = [-1, 0, 1].map((offset) => {
          const d = new Date(now + offset * 24 * 60 * 60 * 1000);
          return d.toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
        });

        const { data: shifts } = await supabaseAdmin
          .from("scheduled_shifts")
          .select(
            "id, assigned_operator, specific_date, start_time, status, time_to_leave, time_to_leave_attempted_at, created_at",
          )
          .in("specific_date", todayKeys);

        type ShiftSnap = {
          id: string;
          assigned_operator: string | null;
          specific_date: string;
          start_time: string;
          status: string;
          time_to_leave: string | null;
          time_to_leave_attempted_at: string | null;
          created_at: string | null;
        };
        // ONE scheduled_shifts read serves all four notification types.
        const shiftRows = (shifts ?? []) as ShiftSnap[];

        // Time to Leave is only calculated for each operator's NEXT shift.
        const nextShiftByOp = new Map<string, { id: string; at: number }>();
        for (const s of shiftRows) {
          if (!s.assigned_operator || s.status === "cancelled") continue;
          const opId = byName.get(normalizeUsername(s.assigned_operator));
          const at = berlinInstant(s.specific_date, s.start_time)?.getTime();
          if (!opId || at == null || at <= now) continue;
          const cur = nextShiftByOp.get(opId);
          if (!cur || at < cur.at) nextShiftByOp.set(opId, { id: s.id, at });
        }

        for (const shift of shiftRows) {
          if (!shift.assigned_operator || shift.status === "cancelled") continue;
          const operatorId = byName.get(normalizeUsername(shift.assigned_operator));
          if (!operatorId) continue;
          const op = byId.get(operatorId);
          if (!op || !op) continue;

          const start = berlinInstant(shift.specific_date, shift.start_time);
          if (!start) continue;

          // --- Leave home: reads scheduled_shifts.time_to_leave, the same
          // stored value the Dashboard shows. While it is still null and this
          // is the operator's next shift (within 24h), calculate and save it
          // once; failures back off 10 minutes. No-op once saved. ---
          let timeToLeave = shift.time_to_leave;
          const untilStart = start.getTime() - now;
          const lastTry = shift.time_to_leave_attempted_at
            ? Date.parse(shift.time_to_leave_attempted_at)
            : 0;
          if (
            !timeToLeave &&
            untilStart > 0 &&
            untilStart <= TTL_CALC_HORIZON_MS &&
            nextShiftByOp.get(operatorId)?.id === shift.id &&
            now - lastTry >= TTL_RETRY_BACKOFF_MS
          ) {
            const { resolveTimeToLeave } = await import("@/lib/time-to-leave.server");
            const r = await resolveTimeToLeave({ operatorId }, start).catch(() => null);
            if (r?.ok && r.source !== "fallback") {
              timeToLeave = r.leave_iso;
            } else {
              // Failed: back off instead of calling VBB again next minute.
              await supabaseAdmin
                .from("scheduled_shifts")
                .update({ time_to_leave_attempted_at: new Date(now).toISOString() } as never)
                .eq("id", shift.id)
                .is("time_to_leave", null);
            }
          }
          if (timeToLeave) {
            const leaveAt = new Date(timeToLeave);
            const notifyAt = leaveNotificationAt(leaveAt, now);
            if (notifyAt && due(notifyAt, now)) {
              jobs.push({
                operatorId,
                // One key per shift instance: a recalculated leave time moves
                // the timing but can never produce a second notification.
                key: leaveHomeKey(shift.id, start),
                type: NOTIFICATION_TYPES.leaveHome,
                at: notifyAt,
                shiftStartMs: start.getTime(),
                title: "Time to leave soon",
                body: `Leave home by ${berlinClock(leaveAt)} — within the next ${LEAVE_NOTIFY_LEAD_MIN} minutes.`,
              });
            }
          }

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

        // --- Daily 09:00 Berlin reminder: one per operator per Berlin day. ---
        {
          const { planDailyReminders, DAILY_REMINDER_TYPE } = await import("@/lib/daily-reminder");
          const todayShifts = shiftRows.filter((s) => s.specific_date === todayKeys[1]);
          for (const d of planDailyReminders(new Date(now), byName, todayShifts)) {
            jobs.push({
              operatorId: d.operatorId,
              key: d.key,
              type: DAILY_REMINDER_TYPE,
              at: d.at,
              shiftStartMs: d.firstStart.getTime(),
              title: d.title,
              body: d.body,
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

        const claimedJobs: Job[] = [];
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
          claimedJobs.push(job);
        }

        // Final state check, after the claims and immediately before sending:
        // a shift cancelled, retimed or reassigned in the meantime must not
        // notify. One batch read instead of one query per job.
        const liveStarts = new Map<string, Set<number>>();
        if (claimedJobs.length) {
          const { data: fresh } = await supabaseAdmin
            .from("scheduled_shifts")
            .select("assigned_operator, specific_date, start_time, status")
            .in("specific_date", todayKeys);
          for (const s of (fresh ?? []) as ShiftSnap[]) {
            if (s.status === "cancelled" || !s.assigned_operator) continue;
            const opId = byName.get(normalizeUsername(s.assigned_operator));
            const st = berlinInstant(s.specific_date, s.start_time);
            if (!opId || !st) continue;
            const set = liveStarts.get(opId) ?? new Set<number>();
            set.add(st.getTime());
            liveStarts.set(opId, set);
          }
        }
        const subsByOp = await loadActiveSubscriptions(claimedJobs.map((j) => j.operatorId));

        for (const job of claimedJobs) {
          if (!liveStarts.get(job.operatorId)?.has(job.shiftStartMs)) {
            stats.cancelled += 1;
            await supabaseAdmin
              .from("push_notification_deliveries")
              .update({ status: "cancelled", locked_at: null } as never)
              .eq("operator_id", job.operatorId)
              .eq("notification_key", job.key);
            continue;
          }

          let result: Awaited<ReturnType<typeof sendToLoadedSubscriptions>>;
          try {
            if (!subsByOp.has(job.operatorId)) subsByOp.set(job.operatorId, []);
            result = await sendToLoadedSubscriptions(job.operatorId, subsByOp.get(job.operatorId)!, {
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

        // Expired-row cleanup runs once a day (push_daily_maintenance); the
        // claim already refuses expired rows, so nothing is needed here.

        return Response.json({ ok: true, ...stats });
      },
    },
  },
});
