/**
 * Overnight-aware date/time helpers shared by the operator calendar shift
 * overview. Classes and shifts are stored as a date plus clock times, so an
 * interval that ends on the following calendar day is expressed by an end
 * clock time that is not after the start. Every comparison here works on full
 * date+time values, never on isolated clock portions.
 */

export function toDate(dateKey: string, time: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
}

export function addDayKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

/** True when the clock times imply the interval runs past midnight. */
export function crossesMidnight(startTime: string, endTime: string): boolean {
  return endTime.slice(0, 5) <= startTime.slice(0, 5);
}

/** Full start/end timestamps for an interval stored as one date + two times. */
export function intervalOf(dateKey: string, startTime: string, endTime: string) {
  const startAt = toDate(dateKey, startTime);
  const endDateKey = crossesMidnight(startTime, endTime) ? addDayKey(dateKey, 1) : dateKey;
  return { startAt, endAt: toDate(endDateKey, endTime), startDateKey: dateKey, endDateKey };
}

/**
 * Validates an interval the operator typed. `overnight` is the operator's
 * explicit statement that the end belongs to the next calendar day, so a
 * 23:00 → 00:30 class is accepted while 14:00 → 13:00 on the same day is not.
 */
export function validateInterval(
  startTime: string,
  endTime: string,
  overnight: boolean,
): string | null {
  if (!/^\d{2}:\d{2}/.test(startTime) || !/^\d{2}:\d{2}/.test(endTime)) {
    return "Start and end times are required";
  }
  const s = startTime.slice(0, 5);
  const e = endTime.slice(0, 5);
  if (overnight) {
    if (e > s) return "An overnight end time must fall on the next day";
    return null;
  }
  if (e <= s) return "End time must be after start time";
  return null;
}

export function fmtClock(t: string): string {
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export function fmtDayShort(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}
