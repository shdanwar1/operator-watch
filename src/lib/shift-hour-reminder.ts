import { normalizeUsername } from "@/domain/operator-identity";
import { berlinClock, berlinInstant } from "./push-time";
import { shiftHourReminderKey } from "./push-keys";

type Shift = {
  id: string;
  assigned_operator: string | null;
  specific_date: string;
  start_time: string;
  status: string;
};

/** Same early tolerance and retry window as the other shift reminders. */
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
    const at = new Date(start.getTime() - 60 * 60_000);
    const delta = now.getTime() - at.getTime();
    if (delta < -60_000 || delta > 15 * 60_000) return [];
    return [{
      operatorId,
      key: shiftHourReminderKey(shift.id, start),
      at,
      shiftStartMs: start.getTime(),
      title: "Shift starts in one hour",
      body: `Your shift starts at ${berlinClock(start)} — one hour from now.`,
    }];
  });
}