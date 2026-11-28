/** Pure helpers for phone-friendly "HH:MM" time entry (Europe/Berlin wall clock). */
const DAY = 24 * 60;

export function toMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]),
    min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export function fromMinutes(total: number): string {
  const t = ((total % DAY) + DAY) % DAY;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** Shift a clock time by delta minutes; wraps around midnight like a clock (overnight shifts exist). */
export function nudgeTime(hhmm: string, delta: number): string | null {
  const m = toMinutes(hhmm);
  return m === null ? null : fromMinutes(m + delta);
}

/** Minutes from start to end; an end at or before start is the next day. */
export function spanMinutes(start: string, end: string): number | null {
  const s = toMinutes(start),
    e = toMinutes(end);
  if (s === null || e === null) return null;
  return e > s ? e - s : e + DAY - s;
}

export function formatSpan(mins: number): string {
  const h = Math.floor(mins / 60),
    m = mins % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}

/** Parts of a local datetime-input value; incomplete edits stay visible. */
export function localDatePart(value: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

export function localTimePart(value: string): string {
  const time = value.includes("T") ? (value.split("T")[1] ?? "").slice(0, 5) : "";
  return toMinutes(time) === null ? "" : time;
}

export function joinLocalDateTime(date: string, time: string): string {
  return date || time ? `${date}T${time}` : "";
}

/** Nudge a complete local date-time, moving the calendar date across midnight. */
export function nudgeLocalDateTime(value: string, delta: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match || toMinutes(`${match[4]}:${match[5]}`) === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDay = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDay.getUTCFullYear() !== year ||
    calendarDay.getUTCMonth() !== month - 1 ||
    calendarDay.getUTCDate() !== day
  ) {
    return null;
  }

  const shifted = new Date(
    Date.UTC(year, month - 1, day, Number(match[4]), Number(match[5]) + delta),
  );
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  return joinLocalDateTime(date, `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`);
}
