/**
 * Delivery identity keys for shift notifications.
 *
 * Each notification purpose has its own prefix, so the reminder and the
 * exact-start check-in can never claim the same delivery row, and one
 * failing does not suppress the other.
 */

export const NOTIFICATION_TYPES = {
  shiftStartReminder: "shift_start",
  shiftStartCheckIn: "shift_start_check_in",
} as const;

/** "Shift starts in 15 minutes". */
export function startReminderKey(shiftId: string, shiftStart: Date): string {
  return `start:${shiftId}@${shiftStart.toISOString()}`;
}

/** "Shift starting now — tap to check in". */
export function startCheckInKey(shiftId: string, shiftStart: Date): string {
  return `checkin:${shiftId}@${shiftStart.toISOString()}`;
}

/** How long after the scheduled start an automatic check-in stays valid. */
export const AUTO_CHECKIN_WINDOW_MS = 10 * 60 * 1000;

/** Small tolerance for a notification that is tapped a moment early. */
const AUTO_CHECKIN_EARLY_MS = 60 * 1000;

/**
 * Whether an automatic check-in may run right now.
 *
 * Inclusive upper boundary: exactly 10:00 after the start still succeeds,
 * 10:01 does not.
 */
export function withinAutoCheckInWindow(shiftStart: Date, now: Date): boolean {
  const delta = now.getTime() - shiftStart.getTime();
  return delta >= -AUTO_CHECKIN_EARLY_MS && delta <= AUTO_CHECKIN_WINDOW_MS;
}
