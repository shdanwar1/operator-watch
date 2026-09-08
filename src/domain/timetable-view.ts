/**
 * Live Timetable presentation model (Operation 5).
 *
 * Pure functions only — no database, no React, no `Date` parsing of the
 * recurring schedule. The weekly timetable is Europe/Berlin wall-clock data,
 * so all time arithmetic here is plain minute arithmetic on HH:MM strings.
 */
import type {
  DmcClassDefinition,
  DmcInstructorDefinition,
  DmcTimetableSlot,
  DmcWeekday,
} from "./timetable";

/** Monday-first display order expressed in source `dayLocal` values. */
export const WEEK_ORDER: DmcWeekday[] = [1, 2, 3, 4, 5, 6, 0];

export const WEEKDAY_LABEL: Record<DmcWeekday, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

/** Minutes since local midnight, for ordering only. */
export function minutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Wall-clock addition. A class that runs past midnight keeps its source
 * weekday and is flagged so the UI can say so; nothing is shifted a day.
 */
export function addMinutesLocal(
  start: string,
  minutes: number,
): { time: string; nextDay: boolean } {
  const total = minutesOfDay(start) + minutes;
  const nextDay = total >= 24 * 60;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const mm = String(wrapped % 60).padStart(2, "0");
  return { time: `${hh}:${mm}`, nextDay };
}

export type TimetableCard = {
  sourceSlotId: string;
  className: string;
  category: string | null;
  /** Presentation-only operational classification: Workout, Ballet, or the raw category. */
  displayCategory: string | null;
  level: string | null;
  instructorName: string;
  instructorInitials: string;
  instructorImageUrl: string | null;
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  durationMinutes: number;
  active: boolean;
  resumesOn: string | null;
};

/**
 * Map the raw DMC API category to the two operational classes the Studio
 * Operator Suite cares about: Workout and Ballet. Stretching folds into
 * Workout. This is a display classification only — the stored category is
 * untouched.
 */
export function toDisplayCategory(category: string | null): string | null {
  if (!category) return null;
  const c = category.toLowerCase().trim();
  if (c === "workout" || c === "stretching") return "Workout";
  if (c === "ballet class" || c === "ballet") return "Ballet";
  // Unknown future categories render as-is rather than being hidden.
  return category;
}

export type TimetableDay = {
  dayLocal: DmcWeekday;
  label: string;
  cards: TimetableCard[];
};

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
 * Resolve slots against classes and instructors once, then group by weekday.
 * Lookup maps are built a single time — no per-card searching.
 */
export function buildTimetableWeek(input: {
  slots: DmcTimetableSlot[];
  classes: DmcClassDefinition[];
  instructors: DmcInstructorDefinition[];
}): TimetableDay[] {
  const classById = new Map(input.classes.map((c) => [c.sourceClassId, c]));
  const instructorById = new Map(input.instructors.map((i) => [i.sourceInstructorId, i]));

  const byDay = new Map<DmcWeekday, TimetableCard[]>();
  for (const day of WEEK_ORDER) byDay.set(day, []);

  for (const slot of input.slots) {
    const cls = classById.get(slot.sourceClassId);
    const instructor = instructorById.get(slot.sourceInstructorId);
    const end = addMinutesLocal(slot.startTimeLocal, slot.durationMinutes);
    const name = instructorName(instructor);
    byDay.get(slot.dayLocal)?.push({
      sourceSlotId: slot.sourceSlotId,
      className: cls?.className ?? "Unknown class",
      category: cls?.category ?? null,
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
      active: slot.active,
      resumesOn: slot.resumesOn,
    });
  }

  return WEEK_ORDER.map((day) => ({
    dayLocal: day,
    label: WEEKDAY_LABEL[day],
    cards: (byDay.get(day) ?? []).sort(
      (a, b) =>
        minutesOfDay(a.startTime) - minutesOfDay(b.startTime) ||
        a.className.localeCompare(b.className),
    ),
  }));
}

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

/** "2026-09-20" → "Back on 20 September". Never compared with today. */
export function resumesOnLabel(resumesOn: string | null): string | null {
  if (!resumesOn) return null;
  const [, m, d] = resumesOn.split("-");
  const month = MONTHS[Number(m) - 1];
  if (!month) return `Back on ${resumesOn}`;
  return `Back on ${Number(d)} ${month}`;
}

/** Berlin-local rendering of the last successful refresh. */
export function formatBerlinTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
