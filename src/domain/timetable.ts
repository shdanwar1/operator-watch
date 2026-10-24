/**
 * DMC Live Timetable domain model (Operation 5).
 *
 * Pure types only. This is the *internal* representation of the studio's
 * weekly class timetable; the raw DMC API shape never leaves the provider.
 *
 * Scheduling authority:
 *   weekday  = dayLocal        (0 = Sunday … 6 = Saturday)
 *   time     = scheduleKey     (3 weekday letters + HHMM, Europe/Berlin)
 *   duration = durationMinutes
 *
 * `sourceSlotId` is a frozen booking/reference identifier from the source. It
 * is preserved for traceability and used as the upsert key, but it is NEVER
 * parsed for weekday or time.
 */

import type { DmcScheduleOverride } from "./schedule-overrides";

/** Stable catalogue information about a class. No scheduling state here. */
export type DmcClassDefinition = {
  sourceClassId: string;
  className: string;
  category: string | null;
  level: string | null;
  description: string | null;
  trailerId: string | null;
};

export type DmcInstructorDefinition = {
  sourceInstructorId: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  bioInfo: string | null;
  imageUrl: string | null;
};

/** 0 = Sunday … 6 = Saturday, matching the source's `dayLocal`. */
export type DmcWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** One recurring weekly slot. `active` is slot-level, never class-level. */
export type DmcTimetableSlot = {
  sourceSlotId: string;
  sourceClassId: string;
  sourceInstructorId: string;
  dayLocal: DmcWeekday;
  scheduleKey: string;
  /** HH:MM, Europe/Berlin wall clock. Never converted to UTC. */
  startTimeLocal: string;
  durationMinutes: number;
  active: boolean;
  /** Informational only — never triggers automatic reactivation. */
  resumesOn: string | null;
};

export type DmcTimetableSnapshot = {
  classes: DmcClassDefinition[];
  instructors: DmcInstructorDefinition[];
  slots: DmcTimetableSlot[];
  /** Per-date exceptions; empty when the source publishes none. */
  overrides?: DmcScheduleOverride[];
  fetchedAt: string;
};

/** A slot that could not be trusted and was therefore excluded. */
export type DmcTimetableAnomaly = {
  sourceSlotId: string | null;
  reason: string;
};

export const DMC_WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export const DMC_WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function weekdayName(day: DmcWeekday): string {
  return DMC_WEEKDAY_NAMES[day];
}
