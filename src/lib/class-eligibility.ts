/**
 * Google Calendar event → Dance Masterclass class validation.
 *
 * This module answers exactly one question:
 *
 *   "Is this Google Calendar event a Dance Masterclass live class?"
 *
 * It never groups, writes, or schedules anything — shift calculation
 * (`groupClassesIntoShifts`) runs *only* on the events that pass this filter.
 *
 * The hard rules, in order:
 *   1. Cancelled events are never classes.
 *   2. All-day events are NEVER classes — absolute, no override.
 *   3. The event duration must be EXACTLY 45 or 60 minutes.
 *        45 min → Workout
 *        60 min → Ballet
 *   4. A titled event must additionally show studio-class evidence (a class or
 *      teacher resolved from the Dance Masterclass directories / learned
 *      aliases). Untitled "Busy" blocks carry no counter-evidence, so the
 *      duration rule alone decides them.
 */

import type { ParsedEvent } from "./gcal-core";
import { isHiddenTitle } from "./gcal-core";

export type ClassType = "Workout" | "Ballet";

/** Duration → class type. The only two live-class shapes that exist. */
export const CLASS_DURATIONS: Record<number, ClassType> = {
  45: "Workout",
  60: "Ballet",
};

export type EligibilityEvent = Pick<
  ParsedEvent,
  "summary" | "specific_date" | "start_time" | "end_time" | "status"
> & { allDay?: boolean };

/** Evidence gathered by the existing title matcher — never re-parsed here. */
export type ClassEvidence = {
  /** A class row was resolved from the directory / a learned alias. */
  classId?: string | null;
  /** A teacher row was resolved from the directory / a learned alias. */
  teacherId?: string | null;
};

export type EligibilityVerdict =
  | { valid: true; classType: ClassType; durationMin: number; reason: string }
  | { valid: false; classType: null; durationMin: number; reason: string };

function minutesOfDay(hhmmss: string): number {
  const [h, m] = hhmmss.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Duration in whole minutes, derived from the event's own Berlin wall-clock
 * timestamps (the parser already resolved TZID / UTC / DST into them), with
 * midnight crossings handled: 23:30 → 00:15 is 45 minutes, not -1365.
 */
export function eventDurationMinutes(event: EligibilityEvent): number {
  const start = minutesOfDay(event.start_time);
  const end = minutesOfDay(event.end_time);
  const raw = end - start;
  return raw < 0 ? raw + 1440 : raw;
}

/** The single gate every calendar event must pass to become a studio class. */
export function isValidDanceMasterclassClass(
  event: EligibilityEvent,
  evidence: ClassEvidence = {},
): EligibilityVerdict {
  const durationMin = eventDurationMinutes(event);
  const reject = (reason: string): EligibilityVerdict => ({
    valid: false,
    classType: null,
    durationMin,
    reason,
  });

  if (event.status === "cancelled") return reject("cancelled in Google Calendar");
  if (event.allDay === true) return reject("all-day event");
  const classType = CLASS_DURATIONS[durationMin];
  if (!classType) return reject(`duration ${durationMin} minutes`);

  const titled = !isHiddenTitle(event.summary ?? "");
  const hasEvidence = Boolean(evidence.classId || evidence.teacherId);
  if (titled && !hasEvidence) return reject("not identified as a studio class");

  return {
    valid: true,
    classType,
    durationMin,
    reason: titled ? `${classType} (${durationMin} min)` : `${classType} (${durationMin} min, busy block)`,
  };
}
