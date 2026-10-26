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
  /** Slots that can be operational on some date, including future resumptions. */
  dateEligibleSlots: number;
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
  let dateEligibleSlots = 0;
  for (const slot of input.slots) {
    const key = slotKey(slot.dayLocal, slot.startTimeLocal, slot.durationMinutes);
    const list = bySlotKey.get(key);
    if (list) list.push(slot);
    else bySlotKey.set(key, [slot]);
    if (slot.active) activeSlots++;
    if (slot.active || slot.resumesOn !== null) dateEligibleSlots++;
  }
  return {
    bySlotKey,
    classes: new Map(input.classes.map((c) => [c.sourceClassId, c])),
    instructors: new Map(input.instructors.map((i) => [i.sourceInstructorId, i])),
    activeSlots,
    dateEligibleSlots,
  };
}

/**
 * Whether a recurring source slot participates in scheduling on one Berlin
 * calendar date. Dates stay as YYYY-MM-DD values; no UTC instant is created.
 */
export function isTimetableSlotOperationalOnDate(
  slot: Pick<DmcTimetableSlot, "active" | "resumesOn" | "activeUntil">,
  date: string,
): boolean {
  if (slot.activeUntil && date > slot.activeUntil) return false;
  if (slot.active) return true;
  if (!slot.resumesOn) return false;

  const validDateKey = (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const probe = new Date(Date.UTC(year, month - 1, day));
    return (
      probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === month - 1 &&
      probe.getUTCDate() === day
    );
  };

  return validDateKey(date) && validDateKey(slot.resumesOn) && date >= slot.resumesOn;
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
  const operational = candidates.filter((s) =>
    isTimetableSlotOperationalOnDate(s, commitment.date),
  );

  if (operational.length > 1) {
    return {
      status: "ambiguous",
      reason: `Multiple operational DMC timetable slots match ${label}`,
    };
  }
  if (operational.length === 0) {
    if (candidates.length > 0) {
      return { status: "suspended", reason: `Matching DMC timetable slot is suspended (${label})` };
    }
    return { status: "no-match", reason: `No active DMC timetable slot for ${label}` };
  }

  const slot = operational[0];
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
