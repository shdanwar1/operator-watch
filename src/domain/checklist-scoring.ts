/**
 * Admin operator scorecard (pure, no database).
 *
 * Scores historical shifts from their stored `shifts.checklists` snapshots.
 * Each scored shift contributes one Start unit, one unit per non-cancelled
 * class, and one End unit. Completeness asks whether every item of a unit is
 * ticked; punctuality additionally asks whether every tick happened before
 * that unit's deadline.
 *
 * Snapshots store Berlin wall-clock "HH:MM" tick times, so all comparisons
 * happen in "minutes since check-in" space: the shift date's wall clock is
 * projected onto the real timeline anchored at the absolute check-in instant,
 * which keeps overnight shifts (a 00:30 class after a 22:00 check-in) correct.
 */
import type {
  ChecklistSnapshotItem,
  ShiftChecklists,
  ChecklistClassSnapshot,
} from "./checklists";

export type ScorePeriod = "30d" | "all";

export type ScoreShiftInput = {
  operator_name: string;
  check_in_at: string;
  check_out_at: string | null;
  checklists: ShiftChecklists | null;
};

export type OperatorScore = {
  operator: string;
  shifts: number;
  /** 0–100, rounded. */
  completenessPct: number;
  /** 0–100, rounded. */
  punctualityPct: number;
  /** Units that were fully completed but ticked after their deadline. */
  lateUnits: number;
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM" -> minutes after midnight, or null for missing/legacy values. */
export function parseClockMinutes(value: string | null | undefined): number | null {
  if (!value || !HHMM.test(value)) return null;
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/** Berlin wall-clock minutes after midnight for an absolute instant. */
export function berlinMinutes(at: Date): number {
  const clock = at.toLocaleTimeString("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return parseClockMinutes(clock) ?? 0;
}

/**
 * Projects a wall-clock time onto the shift's real timeline, in minutes since
 * check-in. Times more than 12h "before" the check-in wall clock are treated
 * as belonging to the next day (overnight shifts).
 */
export function minutesSinceCheckIn(checkIn: Date, clock: string | null | undefined): number | null {
  const clockMin = parseClockMinutes(clock);
  if (clockMin === null) return null;
  const anchor = berlinMinutes(checkIn);
  let delta = clockMin - anchor;
  if (delta <= -720) delta += 1440;
  return delta;
}

type Unit = {
  /** Deadline in minutes since check-in; null = deadline unknown. */
  deadline: number | null;
  items: ChecklistSnapshotItem[];
  /** Set for class units: per-heading deadlines apply instead of `deadline`. */
  cls?: ChecklistClassSnapshot;
};

/** Deadline per class-checklist heading, in minutes relative to class start S. */
function classHeadingDeadline(heading: string | undefined, start: number, end: number): number {
  switch (heading) {
    case "10 Minutes Before Class":
      return start - 5;
    case "5 Minutes Before Class":
      return start;
    case "Class Starts":
      return start + 2;
    case "During the Class":
      return end;
    // "End of Class" / "After the Class" / unknown: ticked during or after the class.
    default:
      return Math.max(0, end);
  }
}

function shiftUnits(shift: ScoreShiftInput): Unit[] {
  const snapshot = shift.checklists;
  if (!snapshot) return [];
  const checkIn = new Date(shift.check_in_at);
  const units: Unit[] = [];

  // Start Shift: due within 15 minutes of check-in.
  if (snapshot.start.items.length) {
    units.push({ deadline: 15, items: snapshot.start.items });
  }

  for (const cls of snapshot.classes) {
    if (cls.status === "cancelled" || !cls.items.length) continue;
    const start = minutesSinceCheckIn(checkIn, cls.startTime);
    const end = minutesSinceCheckIn(checkIn, cls.endTime);
    if (start === null || end === null) continue;
    units.push({ deadline: null, items: cls.items, cls });
  }

  // End Shift: due by check-out. Unknown check-out -> deadline unknown.
  if (snapshot.end.items.length) {
    const out = shift.check_out_at ? new Date(shift.check_out_at) : null;
    units.push({
      deadline: out ? Math.round((out.getTime() - checkIn.getTime()) / 60000) : null,
      items: snapshot.end.items,
    });
  }

  return units;
}

function unitComplete(unit: Unit): boolean {
  return unit.items.length > 0 && unit.items.every((i) => i.completed);
}

/** Every tick at or before the deadline. Missing tick times count as late. */
function unitPunctual(unit: Unit, checkIn: Date): boolean {
  if (!unitComplete(unit)) return false;
  if (unit.cls) {
    const start = minutesSinceCheckIn(checkIn, unit.cls.startTime);
    const end = minutesSinceCheckIn(checkIn, unit.cls.endTime);
    if (start === null || end === null) return false;
    return unit.items.every((item) => {
      const ticked = minutesSinceCheckIn(checkIn, item.completedAt);
      if (ticked === null) return false;
      return ticked <= classHeadingDeadline(item.heading, start, end);
    });
  }
  if (unit.deadline === null) return false;
  const deadline = unit.deadline;
  return unit.items.every((item) => {
    const ticked = minutesSinceCheckIn(checkIn, item.completedAt);
    return ticked !== null && ticked <= deadline;
  });
}

type Totals = { shifts: number; units: number; complete: number; punctual: number; late: number };

const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));

/**
 * Aggregates per-operator scores. Only closed shifts (check-out recorded)
 * with a snapshot are scored; operators with zero scored shifts are omitted.
 * Sorted by completeness, then punctuality, then name.
 */
export function scoreOperators(shifts: ScoreShiftInput[]): OperatorScore[] {
  const byOperator = new Map<string, Totals>();
  for (const shift of shifts) {
    if (!shift.check_out_at || !shift.checklists) continue;
    const name = shift.operator_name;
    const totals =
      byOperator.get(name) ?? { shifts: 0, units: 0, complete: 0, punctual: 0, late: 0 };
    totals.shifts += 1;
    for (const unit of shiftUnits(shift)) {
      totals.units += 1;
      if (!unitComplete(unit)) continue;
      totals.complete += 1;
      if (unitPunctual(unit, new Date(shift.check_in_at))) totals.punctual += 1;
      else totals.late += 1;
    }
    byOperator.set(name, totals);
  }
  return Array.from(byOperator.entries())
    .map(([operator, t]) => ({
      operator,
      shifts: t.shifts,
      completenessPct: pct(t.complete, t.units),
      punctualityPct: pct(t.punctual, t.units),
      lateUnits: t.late,
    }))
    .sort(
      (a, b) =>
        b.completenessPct - a.completenessPct ||
        b.punctualityPct - a.punctualityPct ||
        a.operator.localeCompare(b.operator),
    );
}

/** Bar color bucket for a percentage. */
export function scoreTone(pctValue: number): "done" | "warn" | "destructive" {
  if (pctValue >= 90) return "done";
  if (pctValue >= 75) return "warn";
  return "destructive";
}
