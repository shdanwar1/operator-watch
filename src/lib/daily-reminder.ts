/**
 * Daily 09:00 Europe/Berlin shift reminder.
 *
 * One notification per operator per Berlin calendar day, sent when that
 * operator has at least one assigned, non-cancelled shift on that day. It is
 * independent of the three per-shift notifications.
 */
import { berlinClock, berlinInstant } from "./push-time";
import { normalizeUsername } from "@/domain/operator-identity";

export const DAILY_REMINDER_TYPE = "daily_shift_reminder";
export const DAILY_REMINDER_TIME = "09:00";
/** Maximum lateness accepted for the 09:00 check (matches the dispatcher). */
export const DAILY_REMINDER_WINDOW_MS = 15 * 60 * 1000;

export function berlinDateKey(at: Date): string {
  return at.toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
}

export function dailyReminderKey(operatorId: string, berlinDate: string): string {
  return `${DAILY_REMINDER_TYPE}:${operatorId}:${berlinDate}`;
}

export type DailyShift = {
  id: string;
  assigned_operator: string | null;
  specific_date: string;
  start_time: string;
  status: string;
  created_at?: string | null;
};

export type DailyReminderJob = {
  operatorId: string;
  key: string;
  at: Date;
  firstStart: Date;
  count: number;
  title: string;
  body: string;
};

export function dailyReminderBody(count: number, firstStart: Date): string {
  const t = berlinClock(firstStart);
  return count === 1
    ? `Good morning — you have a shift today at ${t}.`
    : `Good morning — you have ${count} shifts today. Your first shift starts at ${t}.`;
}

/**
 * Jobs due at `now`. Empty outside 09:00–09:15 Berlin. Shifts created after
 * 09:00 are ignored so nothing is sent retroactively.
 */
export function planDailyReminders(
  now: Date,
  operatorIdByName: Map<string, string>,
  shifts: DailyShift[],
): DailyReminderJob[] {
  const today = berlinDateKey(now);
  const at = berlinInstant(today, DAILY_REMINDER_TIME);
  if (!at) return [];
  const delta = now.getTime() - at.getTime();
  if (delta < -60_000 || delta > DAILY_REMINDER_WINDOW_MS) return [];

  const byOp = new Map<string, Date[]>();
  for (const s of shifts) {
    if (s.specific_date !== today || s.status === "cancelled" || !s.assigned_operator) continue;
    if (s.created_at && Date.parse(s.created_at) > at.getTime()) continue;
    const opId = operatorIdByName.get(normalizeUsername(s.assigned_operator));
    if (!opId) continue;
    const start = berlinInstant(s.specific_date, s.start_time);
    if (!start) continue;
    const list = byOp.get(opId) ?? [];
    list.push(start);
    byOp.set(opId, list);
  }

  const jobs: DailyReminderJob[] = [];
  for (const [operatorId, starts] of byOp) {
    starts.sort((a, b) => a.getTime() - b.getTime());
    jobs.push({
      operatorId,
      key: dailyReminderKey(operatorId, today),
      at,
      firstStart: starts[0],
      count: starts.length,
      title: "Shift today",
      body: dailyReminderBody(starts.length, starts[0]),
    });
  }
  return jobs;
}
