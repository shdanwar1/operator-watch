/**
 * Auto check-out rules — pure, no database.
 *
 * At each shift's scheduled end: if the End Shift checklist is complete,
 * check out at the scheduled end. Otherwise leave it open (manual check-out).
 */
import { isShiftChecklists } from "./checklists";

/** Catch-up window after the scheduled end, so a delayed timer tick is not missed. */
export const AUTO_CHECKOUT_WINDOW_MS = 5 * 60 * 1000;

/** Convert a Berlin wall-clock date + time to a UTC instant (DST-safe). */
export function berlinToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm || 0, ss || 0);
  const offsetAt = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Berlin",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(t));
    const g = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t);
}

/** Scheduled end instant; rolls to the next day for overnight shifts. */
export function scheduledEndAt(s: {
  specific_date: string;
  start_time: string;
  end_time: string;
}): Date {
  const overnight = s.end_time.slice(0, 5) <= s.start_time.slice(0, 5);
  let date = s.specific_date;
  if (overnight) {
    const n = new Date(`${s.specific_date}T12:00:00Z`);
    n.setUTCDate(n.getUTCDate() + 1);
    date = n.toISOString().slice(0, 10);
  }
  return berlinToUtc(date, s.end_time);
}

/** When the End Shift checklist became fully complete, or null if it isn't. */
/**
 * True when every End Shift item is ticked. Completion times are stored as
 * "HH:MM" display strings, so they are not used for eligibility.
 */
export function endChecklistComplete(checklists: unknown): boolean {
  if (!isShiftChecklists(checklists)) return false;
  const items = checklists.end.items;
  return items.length > 0 && items.every((i) => i.completed === true);
}

/**
 * Check-out instant (= scheduled end) when the shift must be auto checked
 * out now, else null. Only acts within the window right after the end;
 * older shifts are never revisited.
 */
export function autoCheckoutAt(input: {
  checkOutAt: string | null;
  checklists: unknown;
  scheduledEnd: Date;
  now: Date;
}): Date | null {
  if (input.checkOutAt) return null;
  const end = input.scheduledEnd.getTime();
  const now = input.now.getTime();
  if (now < end || now >= end + AUTO_CHECKOUT_WINDOW_MS) return null;
  if (!endChecklistComplete(input.checklists)) return null;
  return input.scheduledEnd;
}
