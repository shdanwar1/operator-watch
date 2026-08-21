// Display Shifts — UI-level merging of raw scheduled shift rows into the
// continuous operator shifts they actually represent.
//
// Raw `scheduled_shifts` rows are sometimes split at midnight (19:00–23:59 on
// one day, 00:00–02:00 on the next). Payroll and reporting keep using the raw
// rows; every operator-facing surface should use the merged shifts produced
// here so an overnight shift reads as one continuous block.

import type { ScheduledShiftRow } from "@/lib/shifts.functions";
import type { CalendarClassRow } from "@/lib/gcal.functions";

/** Segments closer together than this belong to the same continuous shift. */
export const MERGE_GAP_MIN = 60;

export type DisplayShift = {
  /** Id of the first raw segment — used as the check-in target. */
  id: string;
  segments: ScheduledShiftRow[];
  startAt: Date;
  endAt: Date;
};

export function dateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function overrideDates(all: { specific_date: string | null }[]) {
  return new Set(all.map((s) => s.specific_date).filter((v): v is string => !!v));
}

export function shiftAppliesOn(
  s: { day_of_week: number; specific_date: string | null },
  day: Date,
  overrides: Set<string>,
) {
  if (s.specific_date) return s.specific_date === dateKey(day);
  return day.getDay() === s.day_of_week && !overrides.has(dateKey(day));
}

/** Concrete start/end for one raw row on a given calendar day (overnight aware). */
export function segmentTimes(s: ScheduledShiftRow, day: Date) {
  const [sh, sm] = s.start_time.split(":").map((n) => parseInt(n, 10));
  const [eh, em] = s.end_time.split(":").map((n) => parseInt(n, 10));
  const startAt = new Date(day);
  startAt.setHours(sh, sm, 0, 0);
  const endAt = new Date(day);
  endAt.setHours(eh, em, 0, 0);
  if (endAt.getTime() <= startAt.getTime()) endAt.setDate(endAt.getDate() + 1);
  return { startAt, endAt };
}

/**
 * Expands scheduled rows into concrete instances over a date range and merges
 * consecutive segments into continuous shifts.
 */
export function buildDisplayShifts(
  scheduled: ScheduledShiftRow[],
  now: Date,
  { daysBack = 1, daysAhead = 28 }: { daysBack?: number; daysAhead?: number } = {},
): DisplayShift[] {
  const overrides = overrideDates(scheduled);
  const raw: { shift: ScheduledShiftRow; startAt: Date; endAt: Date }[] = [];

  for (let offset = -daysBack; offset <= daysAhead; offset++) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + offset);
    for (const s of scheduled) {
      if (!shiftAppliesOn(s, day, overrides)) continue;
      const { startAt, endAt } = segmentTimes(s, day);
      raw.push({ shift: s, startAt, endAt });
    }
  }

  raw.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const out: DisplayShift[] = [];
  for (const seg of raw) {
    const last = out[out.length - 1];
    if (
      last &&
      seg.startAt.getTime() - last.endAt.getTime() <= MERGE_GAP_MIN * 60_000 &&
      seg.startAt.getTime() >= last.startAt.getTime()
    ) {
      last.segments.push(seg.shift);
      if (seg.endAt.getTime() > last.endAt.getTime()) last.endAt = seg.endAt;
      continue;
    }
    out.push({
      id: seg.shift.id,
      segments: [seg.shift],
      startAt: seg.startAt,
      endAt: seg.endAt,
    });
  }
  return out;
}

/** Absolute timestamp of a calendar class row. */
export function classStartAt(c: CalendarClassRow) {
  const [y, mo, d] = c.specific_date.split("-").map(Number);
  const [h, mi] = c.start_time.split(":").map((n) => parseInt(n, 10));
  return new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
}

/**
 * Classes belonging to a display shift.
 *
 * Matching is timestamp-based first (so classes after midnight are included
 * even when their `scheduled_shift_id` points at a day-split segment), with the
 * segment ids as an additional source.
 */
export function classesForShift(
  classes: CalendarClassRow[],
  shift: DisplayShift,
  paddingMin = 45,
): CalendarClassRow[] {
  const ids = new Set(shift.segments.map((s) => s.id));
  const from = shift.startAt.getTime() - paddingMin * 60_000;
  const to = shift.endAt.getTime() + paddingMin * 60_000;
  const seen = new Set<string>();
  const rows = classes.filter((c) => {
    const t = classStartAt(c);
    const hit = (t >= from && t <= to) || (c.scheduled_shift_id != null && ids.has(c.scheduled_shift_id));
    if (!hit || seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  return rows.sort((a, b) => classStartAt(a) - classStartAt(b));
}

/** The shift currently running, or the next one that hasn't ended yet. */
export function currentOrNextShift(shifts: DisplayShift[], now: Date): DisplayShift | null {
  return shifts.find((s) => s.endAt.getTime() > now.getTime()) ?? null;
}

/** "Today 9:00 PM → Wed 2:30 AM" style label parts. */
export function formatShiftRange(shift: DisplayShift, now: Date) {
  const time = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const dayLabel = sameDay(shift.startAt, now)
    ? "Today"
    : sameDay(shift.startAt, tomorrow)
      ? "Tomorrow"
      : shift.startAt.toLocaleDateString(undefined, { weekday: "long" });

  const crosses = !sameDay(shift.startAt, shift.endAt);
  const endPrefix = crosses
    ? `${shift.endAt.toLocaleDateString(undefined, { weekday: "short" })} `
    : "";

  return {
    dayLabel,
    range: `${time(shift.startAt)} → ${endPrefix}${time(shift.endAt)}`,
    crosses,
  };
}

/** A next shift this close (or closer) becomes the check-in target. */
export const CHECK_IN_LEAD_MS = 2 * 60 * 60 * 1000;

/**
 * Resolves which shift the Check-In screen should target, from the clock alone.
 *
 * Order: the shift currently running (start <= now < end) wins; otherwise the
 * next shift, but only when it starts within `leadMs`. A shift whose end time
 * has passed is never a candidate — check-in and check-out history play no
 * part in this decision.
 */
export function resolveCheckInTarget(
  scheduled: ScheduledShiftRow[],
  now: Date,
  leadMs: number = CHECK_IN_LEAD_MS,
): DisplayShift | null {
  const t = now.getTime();
  const live = buildDisplayShifts(scheduled, now).filter((s) => s.endAt.getTime() > t);
  const active = live.find((s) => s.startAt.getTime() <= t);
  if (active) return active;
  const next = live[0];
  return next && next.startAt.getTime() - t <= leadMs ? next : null;
}
