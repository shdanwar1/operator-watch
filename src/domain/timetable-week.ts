/**
 * Current-week operator board model — pure, no database, no React.
 *
 * Merges the authoritative DMC weekly timetable with the dated operational
 * rows in `calendar_classes`, and resolves who is currently operating each
 * class. Matching is by date + DMC class id + start time only: never by class
 * title, instructor name or any fuzzy text.
 */
import type {
  DmcClassDefinition,
  DmcInstructorDefinition,
  DmcTimetableSlot,
  DmcWeekday,
} from "./timetable";
import { normalizeUsername } from "./operator-identity";
import { isTimetableSlotOperationalOnDate } from "./timetable-resolver";
import {
  addMinutesLocal,
  minutesOfDay,
  toDisplayCategory,
  WEEKDAY_LABEL,
  type TimetableCard,
} from "./timetable-view";

/** One dated class occurrence, as stored in `calendar_classes`. */
export type ClassOccurrence = {
  id: string;
  specificDate: string;
  startTime: string;
  endTime: string;
  dmcClassId: string | null;
  dmcInstructorId: string | null;
  status: string;
  scheduledShiftId: string | null;
  operator: string | null;
};

/** Only what the board needs from a scheduled shift. */
export type ShiftAssignmentRow = {
  id: string;
  assignedOperator: string | null;
};

export type BoardCard = TimetableCard & {
  /** Berlin calendar date of this occurrence, YYYY-MM-DD. */
  date: string;
  /** Current operator, or null when nobody is assigned. */
  operatorName: string | null;
  assigned: boolean;
};

export type BoardDay = {
  date: string;
  dayLocal: DmcWeekday;
  /** "Monday" */
  weekday: string;
  /** "15 September" */
  dateLabel: string;
  cards: BoardCard[];
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Today's Berlin calendar date as YYYY-MM-DD. */
export function berlinDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
}

/** Weekday of a YYYY-MM-DD date, 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): DmcWeekday {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as DmcWeekday;
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** The Monday of the Monday→Sunday week containing a date. */
export function weekStartOf(date: string): string {
  return shiftDate(date, -((weekdayOf(date) + 6) % 7));
}

/** The seven dates of the Monday→Sunday week containing a date. */
export function weekDatesFrom(date: string): string[] {
  const monday = weekStartOf(date);
  return Array.from({ length: 7 }, (_, i) => shiftDate(monday, i));
}

/** The seven Berlin dates of the current Monday→Sunday week. */
export function currentBerlinWeek(now: Date = new Date()): string[] {
  return weekDatesFrom(berlinDate(now));
}

/** The Monday→Sunday week `offset` full weeks away from the week containing `date`. */
export function weekDatesAtOffset(date: string, offset: number): string[] {
  return weekDatesFrom(shiftDate(weekStartOf(date), offset * 7));
}

/** "31 Aug – 6 Sep" (month shown once when the week stays inside one month). */
export function weekRangeCompactLabel(dates: string[]): string {
  if (dates.length === 0) return "";
  const [fy, fm, fd] = dates[0].split("-").map(Number);
  const [ly, lm, ld] = dates[dates.length - 1].split("-").map(Number);
  const short = (m: number) => MONTHS[m - 1]?.slice(0, 3) ?? String(m);
  if (fy === ly && fm === lm) return `${fd}–${ld} ${short(fm)}`;
  return `${fd} ${short(fm)} – ${ld} ${short(lm)}`;
}

/** "September 2026" or "September / October 2026" for a displayed week. */
export function weekMonthTitle(dates: string[]): string {
  if (dates.length === 0) return "";
  const [fy, fm] = dates[0].split("-").map(Number);
  const [ly, lm] = dates[dates.length - 1].split("-").map(Number);
  if (fy === ly && fm === lm) return `${MONTHS[fm - 1]} ${fy}`;
  if (fy === ly) return `${MONTHS[fm - 1]} / ${MONTHS[lm - 1]} ${fy}`;
  return `${MONTHS[fm - 1]} ${fy} / ${MONTHS[lm - 1]} ${ly}`;
}

/** "2026-09" for a YYYY-MM-DD date. */
export function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

/** The current Berlin calendar month as { year, month } (month is 1-12). */
export function currentBerlinMonth(now: Date = new Date()): { year: number; month: number } {
  const [y, m] = berlinDate(now).split("-").map(Number);
  return { year: y, month: m };
}

/** Number of days in a calendar month. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Every Berlin date of the given month, YYYY-MM-DD. */
export function monthDates(year: number, month: number): string[] {
  const total = daysInMonth(year, month);
  const mm = String(month).padStart(2, "0");
  return Array.from({ length: total }, (_, i) => `${year}-${mm}-${String(i + 1).padStart(2, "0")}`);
}

/**
 * Exactly four fixed ranges per month: 1–7, 8–14, 15–21, 22–last day.
 * Never ISO weeks, never a fifth week.
 */
export function monthWeekRanges(year: number, month: number): string[][] {
  const all = monthDates(year, month);
  return [all.slice(0, 7), all.slice(7, 14), all.slice(14, 21), all.slice(21)];
}

/** Index (0-3) of the fixed month week containing a YYYY-MM-DD date. */
export function weekIndexForDate(date: string): number {
  const day = Number(date.split("-")[2]);
  if (day <= 7) return 0;
  if (day <= 14) return 1;
  if (day <= 21) return 2;
  return 3;
}

/** "1–7 Sep" */
export function weekRangeShortLabel(dates: string[]): string {
  if (dates.length === 0) return "";
  const first = Number(dates[0].split("-")[2]);
  const last = Number(dates[dates.length - 1].split("-")[2]);
  const month = MONTHS[Number(dates[0].split("-")[1]) - 1]?.slice(0, 3) ?? "";
  return `${first}–${last} ${month}`;
}

/** "14–20 September 2026" */
export function weekRangeLabel(dates: string[]): string {
  if (dates.length === 0) return "";
  const first = dates[0].split("-").map(Number);
  const last = dates[dates.length - 1].split("-").map(Number);
  const startLabel =
    first[0] === last[0] && first[1] === last[1]
      ? `${first[2]}`
      : `${first[2]} ${MONTHS[first[1] - 1]}${first[0] === last[0] ? "" : ` ${first[0]}`}`;
  return `${startLabel}–${last[2]} ${MONTHS[last[1] - 1]} ${last[0]}`;
}

/** "15 September" */
export function dayDateLabel(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1] ?? m}`;
}

/** HH:MM:SS → HH:MM. Already-short values pass through. */
export function hhmm(time: string): string {
  return (time ?? "").slice(0, 5);
}

/**
 * The current operator for a dated occurrence.
 *
 * The scheduled shift wins, because an admin can reassign it after the class
 * row was created. A missing shift falls back to the stored operator; nothing
 * is ever invented.
 */
export function resolveOperator(
  occurrence: ClassOccurrence | null,
  shiftsById: Map<string, ShiftAssignmentRow>,
): string | null {
  if (!occurrence) return null;
  if (occurrence.scheduledShiftId) {
    const shift = shiftsById.get(occurrence.scheduledShiftId);
    if (shift) return shift.assignedOperator?.trim() || null;
  }
  return occurrence.operator?.trim() || null;
}

function initialsOf(first: string | null, last: string | null, fallback: string): string {
  const letters = `${first?.[0] ?? ""}${last?.[0] ?? ""}`.trim();
  return (letters || fallback.slice(0, 2) || "?").toUpperCase();
}

function instructorName(i: DmcInstructorDefinition | undefined): string {
  if (!i) return "Unknown instructor";
  const name = [i.firstName, i.lastName].filter(Boolean).join(" ").trim();
  return name || "Unknown instructor";
}

/**
 * Build the seven-day board. Lookup maps are built once — there is no
 * per-class searching and, by construction, no per-class data access.
 */
export function buildOperatorBoard(input: {
  weekDates: string[];
  slots: DmcTimetableSlot[];
  classes: DmcClassDefinition[];
  instructors: DmcInstructorDefinition[];
  occurrences: ClassOccurrence[];
  shifts: ShiftAssignmentRow[];
  /** DMC source class id → `dmc_classes.id`, as referenced by occurrences. */
  classIdBySource: Record<string, string>;
}): BoardDay[] {
  const classBySource = new Map(input.classes.map((c) => [c.sourceClassId, c]));
  const instructorBySource = new Map(input.instructors.map((i) => [i.sourceInstructorId, i]));
  const shiftsById = new Map(input.shifts.map((s) => [s.id, s]));

  // date | dmc class id | HH:MM → occurrence
  const occurrenceByKey = new Map<string, ClassOccurrence>();
  for (const o of input.occurrences) {
    if (!o.dmcClassId) continue;
    occurrenceByKey.set(`${o.specificDate}|${o.dmcClassId}|${hhmm(o.startTime)}`, o);
  }

  const slotsByDay = new Map<DmcWeekday, DmcTimetableSlot[]>();
  for (const slot of input.slots) {
    const list = slotsByDay.get(slot.dayLocal) ?? [];
    list.push(slot);
    slotsByDay.set(slot.dayLocal, list);
  }

  return input.weekDates.map((date) => {
    const dayLocal = weekdayOf(date);
    const cards: BoardCard[] = (slotsByDay.get(dayLocal) ?? []).map((slot) => {
      const cls = classBySource.get(slot.sourceClassId);
      const instructor = instructorBySource.get(slot.sourceInstructorId);
      const end = addMinutesLocal(slot.startTimeLocal, slot.durationMinutes);
      const name = instructorName(instructor);
      const dmcClassId = input.classIdBySource[slot.sourceClassId];
      const occurrence = dmcClassId
        ? (occurrenceByKey.get(`${date}|${dmcClassId}|${slot.startTimeLocal}`) ?? null)
        : null;
      const operatorName = resolveOperator(occurrence, shiftsById);

      return {
        sourceSlotId: slot.sourceSlotId,
        className: cls?.className ?? "Unknown class",
        category: cls?.category ?? null,
        displayCategory: toDisplayCategory(cls?.category ?? null),
        level: cls?.level ?? null,
        instructorName: name,
        instructorInitials: initialsOf(
          instructor?.firstName ?? null,
          instructor?.lastName ?? null,
          name,
        ),
        instructorImageUrl: instructor?.imageUrl ?? null,
        startTime: slot.startTimeLocal,
        endTime: end.time,
        endsNextDay: end.nextDay,
        durationMinutes: slot.durationMinutes,
        active: isTimetableSlotOperationalOnDate(slot, date),
        resumesOn: slot.resumesOn,
        date,
        operatorName,
        assigned: normalizeUsername(operatorName) !== "",
      };
    });

    cards.sort(
      (a, b) =>
        minutesOfDay(a.startTime) - minutesOfDay(b.startTime) ||
        a.className.localeCompare(b.className),
    );

    return {
      date,
      dayLocal,
      weekday: WEEKDAY_LABEL[dayLocal],
      dateLabel: dayDateLabel(date),
      cards,
    };
  });
}
