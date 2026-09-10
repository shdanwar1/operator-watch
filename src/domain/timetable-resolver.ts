/**
 * Canonical DMC Live Timetable resolver (Operation 6).
 *
 * One question, one implementation:
 *
 *   "Does an active DMC timetable slot exist at this dated Berlin local time?"
 *
 * The DMC Live Timetable is the sole authority. Event titles, teacher names,
 * aliases and any kind of fuzzy matching are irrelevant here and must never be
 * reintroduced. The resolver creates no shifts, assigns no operators, writes
 * nothing and sends nothing — it only answers the question above.
 *
 * Authoritative slot fields: dayLocal, startTimeLocal (from scheduleKey),
 * durationMinutes, active. `sourceSlotId` is a reference identifier only and is
 * never parsed for schedule information.
 */
import type {
  DmcClassDefinition,
  DmcInstructorDefinition,
  DmcTimetableSlot,
  DmcWeekday,
} from "./timetable";

export type TimetableIndex = {
  /** `dayLocal|HH:MM|duration` → slots (active and suspended alike). */
  bySlotKey: Map<string, DmcTimetableSlot[]>;
  classes: Map<string, DmcClassDefinition>;
  instructors: Map<string, DmcInstructorDefinition>;
  activeSlots: number;
};

export type TimetableInput = {
  slots: DmcTimetableSlot[];
  classes: DmcClassDefinition[];
  instructors: DmcInstructorDefinition[];
};

/** `HH:MM` from `HH:MM` or `HH:MM:SS`. */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}

function minutesOfDay(time: string): number {
  const [h, m] = hhmm(time).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Duration in whole minutes, with midnight wrap (23:30 → 00:15 = 45). */
export function localDurationMinutes(startTime: string, endTime: string): number {
  const raw = minutesOfDay(endTime) - minutesOfDay(startTime);
  return raw < 0 ? raw + 1440 : raw;
}

/**
 * Weekday (0 = Sunday … 6 = Saturday) of a Berlin calendar date.
 *
 * Pure calendar arithmetic on the `YYYY-MM-DD` the parser already resolved into
 * Berlin wall clock — no UTC conversion, so a 00:00 class never slides onto the
 * previous day and DST cannot move it either.
 */
export function berlinWeekday(dateKey: string): DmcWeekday {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay() as DmcWeekday;
}

export function slotKey(day: DmcWeekday, startTimeLocal: string, durationMinutes: number): string {
  return `${day}|${hhmm(startTimeLocal)}|${durationMinutes}`;
}

export function buildTimetableIndex(input: TimetableInput): TimetableIndex {
  const bySlotKey = new Map<string, DmcTimetableSlot[]>();
  let activeSlots = 0;
  for (const slot of input.slots) {
    const key = slotKey(slot.dayLocal, slot.startTimeLocal, slot.durationMinutes);
    const list = bySlotKey.get(key);
    if (list) list.push(slot);
    else bySlotKey.set(key, [slot]);
    if (slot.active) activeSlots++;
  }
  return {
    bySlotKey,
    classes: new Map(input.classes.map((c) => [c.sourceClassId, c])),
    instructors: new Map(input.instructors.map((i) => [i.sourceInstructorId, i])),
    activeSlots,
  };
}

/** The dated, Berlin-local time commitment being validated. */
export type DatedCommitment = {
  /** `YYYY-MM-DD`, Berlin local. */
  date: string;
  /** `HH:MM` or `HH:MM:SS`, Berlin local. */
  startTime: string;
  endTime: string;
  status?: string;
  allDay?: boolean;
};

export type TimetableResolution =
  | {
      status: "matched";
      slot: DmcTimetableSlot;
      classDef: DmcClassDefinition | null;
      instructor: DmcInstructorDefinition | null;
      reason: string;
    }
  | { status: "no-match" | "suspended" | "ambiguous" | "rejected"; reason: string };

const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * Resolve one dated commitment against the timetable.
 *
 * Deterministic: weekday, exact start time and exact duration. No tolerance,
 * no overlap acceptance, no title involvement.
 */
export function resolveDmcTimetableSlot(
  index: TimetableIndex,
  commitment: DatedCommitment,
): TimetableResolution {
  if (commitment.status === "cancelled") {
    return { status: "rejected", reason: "cancelled in Google Calendar" };
  }
  if (commitment.allDay === true) {
    return { status: "rejected", reason: "all-day event" };
  }

  const day = berlinWeekday(commitment.date);
  const start = hhmm(commitment.startTime);
  const duration = localDurationMinutes(commitment.startTime, commitment.endTime);
  const label = `${DAY_LABEL[day]} ${start} / ${duration} min`;

  if (duration <= 0) {
    return { status: "rejected", reason: `zero-length event (${label})` };
  }

  const candidates = index.bySlotKey.get(slotKey(day, start, duration)) ?? [];
  const active = candidates.filter((s) => s.active);

  if (active.length > 1) {
    return {
      status: "ambiguous",
      reason: `Multiple active DMC timetable slots match ${label}`,
    };
  }
  if (active.length === 0) {
    if (candidates.length > 0) {
      return { status: "suspended", reason: `Matching DMC timetable slot is suspended (${label})` };
    }
    return { status: "no-match", reason: `No active DMC timetable slot for ${label}` };
  }

  const slot = active[0];
  return {
    status: "matched",
    slot,
    classDef: index.classes.get(slot.sourceClassId) ?? null,
    instructor: index.instructors.get(slot.sourceInstructorId) ?? null,
    reason: `Matched DMC timetable: ${label}`,
  };
}

/** Display name of a timetable instructor, or a neutral dash. */
export function instructorDisplayName(instructor: DmcInstructorDefinition | null): string {
  if (!instructor) return "—";
  const name = [instructor.firstName, instructor.lastName].filter(Boolean).join(" ").trim();
  return name || instructor.title || "—";
}
