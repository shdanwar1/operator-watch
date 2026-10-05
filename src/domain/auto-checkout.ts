/**
 * Auto check-out rules — pure, no database.
 *
 * - End Shift checklist incomplete (or switch off) → never.
 * - Completed at/before the scheduled end → check out AT the scheduled end.
 * - Completed after the scheduled end → check out 10 minutes after completion.
 */
import { isShiftChecklists } from "./checklists";

export const AUTO_CHECKOUT_GRACE_MS = 10 * 60 * 1000;

/** Operator preference; a missing value means ON. */
export function autoCheckoutEnabled(prefs: unknown): boolean {
  if (!prefs || typeof prefs !== "object") return true;
  return (prefs as { autoCheckout?: unknown }).autoCheckout !== false;
}

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
export function endChecklistCompletedAt(checklists: unknown): Date | null {
  if (!isShiftChecklists(checklists)) return null;
  const items = checklists.end.items;
  if (items.length === 0 || !items.every((i) => i.completed)) return null;
  let latest = 0;
  for (const i of items) {
    const t = i.completedAt ? new Date(i.completedAt).getTime() : NaN;
    if (Number.isNaN(t)) return null;
    latest = Math.max(latest, t);
  }
  return new Date(latest);
}

/**
 * The instant the shift should be auto checked out, or null when it must
 * stay open. The caller acts only once `now >= result`.
 */
export function autoCheckoutAt(input: {
  checkOutAt: string | null;
  checklists: unknown;
  scheduledEnd: Date;
  enabled: boolean;
}): Date | null {
  if (input.checkOutAt || !input.enabled) return null;
  const done = endChecklistCompletedAt(input.checklists);
  if (!done) return null;
  if (done.getTime() <= input.scheduledEnd.getTime()) return input.scheduledEnd;
  return new Date(done.getTime() + AUTO_CHECKOUT_GRACE_MS);
}
