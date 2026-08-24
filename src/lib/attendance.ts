// Attendance & payroll-hour classification.
//
// Splits every worked minute into one of three payroll categories:
//   - night    → 00:00–06:00 any day (Purple)
//   - weekend  → Saturday/Sunday outside night window (Green)
//   - day      → weekday 06:00–24:00 (Blue)
//
// Night takes precedence over weekend when both apply (e.g. a Saturday
// shift that runs into the next morning's 00:00–06:00 window).

import type { ShiftRow, ScheduledShiftRow, ShiftClass } from "@/lib/shifts.functions";

export type HourCategory = "day" | "night" | "weekend";

export type AttendanceRow = {
  id: string;
  operator_name: string;
  date: Date;
  checkIn: Date;
  checkOut: Date;
  workedMin: number;
  dayMin: number;
  nightMin: number;
  weekendMin: number;
  primary: HourCategory;
  /** Every category with worked minutes, ordered Day → Night → Weekend. Display only. */
  categories: HourCategory[];
  // Scheduled shift (if linked)
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  scheduledMin: number | null;
  diffMin: number | null; // worked - scheduled
  // Per-shift detail shown when a row is expanded.
  classes: ShiftClass[];
  notes: string | null;
  scheduled_shift_id: string | null;
};

export type AttendanceSummary = {
  monthKey: string; // YYYY-MM
  monthLabel: string;
  rows: AttendanceRow[];
  workedMin: number;
  scheduledMin: number;
  dayMin: number;
  nightMin: number;
  weekendMin: number;
};

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function classifyMinute(d: Date): HourCategory {
  const h = d.getHours();
  if (h < 6) return "night";
  const dow = d.getDay(); // 0 Sun, 6 Sat
  if (dow === 0 || dow === 6) return "weekend";
  return "day";
}

function classifyRange(startISO: string, endISO: string) {
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  const totalMin = Math.max(0, Math.round((end - start) / 60000));
  let day = 0, night = 0, weekend = 0;
  for (let i = 0; i < totalMin; i++) {
    const t = new Date(start + i * 60000 + 30000); // midpoint
    const c = classifyMinute(t);
    if (c === "night") night++;
    else if (c === "weekend") weekend++;
    else day++;
  }
  return { totalMin, day, night, weekend };
}

/**
 * Resolve the wall-clock scheduled start/end for a linked scheduled shift,
 * anchored to the attendance check-in date.
 */
function resolveScheduledTimes(
  ss: ScheduledShiftRow | undefined,
  checkIn: Date,
): { start: Date; end: Date } | null {
  if (!ss) return null;
  const [sh, sm] = ss.start_time.split(":").map((n) => parseInt(n, 10));
  const [eh, em] = ss.end_time.split(":").map((n) => parseInt(n, 10));
  const base = ss.specific_date
    ? new Date(`${ss.specific_date}T00:00:00`)
    : new Date(checkIn.getFullYear(), checkIn.getMonth(), checkIn.getDate());
  const start = new Date(base);
  start.setHours(sh, sm, 0, 0);
  const end = new Date(base);
  end.setHours(eh, em, 0, 0);
  if (end <= start) end.setDate(end.getDate() + 1); // overnight
  return { start, end };
}

export function buildAttendanceRows(
  shifts: ShiftRow[],
  scheduled: ScheduledShiftRow[],
): AttendanceRow[] {
  const schedById = new Map(scheduled.map((s) => [s.id, s]));
  return shifts
    .filter((s) => s.check_out_at)
    .map((s) => {
      const checkIn = new Date(s.check_in_at);
      const checkOut = new Date(s.check_out_at!);
      const { totalMin, day, night, weekend } = classifyRange(s.check_in_at, s.check_out_at!);
      const primary: HourCategory =
        night >= weekend && night >= day ? "night" : weekend >= day ? "weekend" : "day";
      const sched = resolveScheduledTimes(
        s.scheduled_shift_id ? schedById.get(s.scheduled_shift_id) : undefined,
        checkIn,
      );
      const scheduledMin = sched
        ? Math.round((sched.end.getTime() - sched.start.getTime()) / 60000)
        : null;
      return {
        id: s.id,
        operator_name: s.operator_name,
        date: checkIn,
        checkIn,
        checkOut,
        workedMin: totalMin,
        dayMin: day,
        nightMin: night,
        weekendMin: weekend,
        primary,
        categories: (["day", "night", "weekend"] as HourCategory[]).filter(
          (c) => (c === "day" ? day : c === "night" ? night : weekend) > 0,
        ),
        scheduledStart: sched?.start ?? null,
        scheduledEnd: sched?.end ?? null,
        scheduledMin,
        diffMin: scheduledMin != null ? totalMin - scheduledMin : null,
      };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function summarizeMonth(
  shifts: ShiftRow[],
  scheduled: ScheduledShiftRow[],
  month: Date,
): AttendanceSummary {
  const key = monthKey(month);
  const rows = buildAttendanceRows(shifts, scheduled).filter(
    (r) => monthKey(r.date) === key,
  );
  let workedMin = 0, dayMin = 0, nightMin = 0, weekendMin = 0;
  for (const r of rows) {
    workedMin += r.workedMin;
    dayMin += r.dayMin;
    nightMin += r.nightMin;
    weekendMin += r.weekendMin;
  }
  const scheduledMin = scheduledMinutesInMonth(scheduled, month);
  return {
    monthKey: key,
    monthLabel: month.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    rows,
    workedMin,
    scheduledMin,
    dayMin,
    nightMin,
    weekendMin,
  };
}

/**
 * Sum scheduled minutes for a given calendar month.
 * Counts every scheduled_shift row whose specific_date falls in the month.
 * Recurring (specific_date == null) rows are expanded across the month,
 * skipping days that have a specific_date override.
 */
export function scheduledMinutesInMonth(
  scheduled: ScheduledShiftRow[],
  month: Date,
): number {
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const key = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`;
  const overrides = new Set<string>();
  for (const s of scheduled) if (s.specific_date) overrides.add(s.specific_date);

  const minutesOf = (start: string, end: string) => {
    const [sh, sm] = start.split(":").map((n) => parseInt(n, 10));
    const [eh, em] = end.split(":").map((n) => parseInt(n, 10));
    let mins = eh * 60 + em - (sh * 60 + sm);
    if (mins < 0) mins += 24 * 60;
    return mins;
  };

  let total = 0;

  // Explicit dates in month.
  for (const s of scheduled) {
    if (!s.specific_date) continue;
    if (!s.specific_date.startsWith(key)) continue;
    total += minutesOf(s.start_time, s.end_time);
  }

  // Recurring templates across every day of month, skipping overridden days.
  for (let d = new Date(monthStart); d < monthEnd; d.setDate(d.getDate() + 1)) {
    const dk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (overrides.has(dk)) continue;
    const dow = d.getDay();
    for (const s of scheduled) {
      if (s.specific_date) continue;
      if (s.day_of_week !== dow) continue;
      total += minutesOf(s.start_time, s.end_time);
    }
  }

  return total;
}

export function formatHM(mins: number): string {
  const sign = mins < 0 ? "−" : "";
  const abs = Math.abs(Math.round(mins));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h ${String(m).padStart(2, "0")}m`;
}

export function formatDiff(mins: number): string {
  const rounded = Math.round(mins);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  if (abs < 60) return `${sign}${abs}m`;
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h ${String(m).padStart(2, "0")}m`;
}


export const CATEGORY_LABEL: Record<HourCategory, string> = {
  day: "Day",
  night: "Night",
  weekend: "Weekend",
};

export const CATEGORY_COLOR: Record<HourCategory, string> = {
  day: "#3B82F6", // Blue
  night: "#8B5CF6", // Purple
  weekend: "#10B981", // Green
};

export const CATEGORY_EMOJI: Record<HourCategory, string> = {
  day: "🟦",
  night: "🟪",
  weekend: "🟩",
};
