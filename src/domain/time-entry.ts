/** Pure helpers for phone-friendly "HH:MM" time entry (Europe/Berlin wall clock). */
const DAY = 24 * 60;

export function toMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
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
  const s = toMinutes(start), e = toMinutes(end);
  if (s === null || e === null) return null;
  return e > s ? e - s : e + DAY - s;
}

export function formatSpan(mins: number): string {
  const h = Math.floor(mins / 60), m = mins % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}
