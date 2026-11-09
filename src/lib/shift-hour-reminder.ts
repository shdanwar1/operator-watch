import { normalizeUsername } from "@/domain/operator-identity";
import { berlinClock, berlinInstant } from "./push-time";
import { shiftHourReminderKey } from "./push-keys";

type Shift = {
  id: string;
  assigned_operator: string | null;
  specific_date: string;
  start_time: string;
  status: string;
  /** Stored Time to Leave; the reminder fires one hour before it. */
  time_to_leave?: string | null;
};

/**
 * One hour before Time to Leave. Without a saved Time to Leave it falls back
 * to one hour before the shift start, so the operator is never left un-reminded.
 */
export function planShiftHourReminders(
  now: Date,
  operatorIdByName: Map<string, string>,
  shifts: Shift[],
) {
  return shifts.flatMap((shift) => {
    if (shift.status === "cancelled" || !shift.assigned_operator) return [];
    const operatorId = operatorIdByName.get(normalizeUsername(shift.assigned_operator));
    const start = berlinInstant(shift.specific_date, shift.start_time);
    if (!operatorId || !start) return [];
    const leaveMs = shift.time_to_leave ? Date.parse(shift.time_to_leave) : NaN;
    const leave = Number.isFinite(leaveMs) ? new Date(leaveMs) : null;
    const anchor = leave ?? start;
    const at = new Date(anchor.getTime() - 60 * 60_000);
    const delta = now.getTime() - at.getTime();
    if (delta < -60_000 || delta > 15 * 60_000) return [];
    return [{
      operatorId,
      key: shiftHourReminderKey(shift.id, start),
      at,
      shiftStartMs: start.getTime(),
      title: "Upcoming shift",
      body: leave
        ? `You have a shift at ${berlinClock(start)}. Leave at ${berlinClock(leave)}.`
        : `You have a shift at ${berlinClock(start)}.`,
    }];
  });
}
