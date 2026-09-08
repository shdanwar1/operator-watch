/**
 * DMC public payload → internal timetable snapshot (Operation 5).
 *
 * Pure and deterministic: no I/O, no database, no dates of its own. Every
 * scheduling value comes from the authoritative fields only:
 *
 *   scheduleKey → weekday letters + start time      (slot.id is NEVER parsed)
 *   dayLocal    → weekday                            (must agree with the key)
 *   duration    → minutes
 *   classId     → classes[].className                (slot.className ignored)
 *   instructorId→ instructors[].information          (never invented)
 *
 * `slot.startTime`, `slot.className` and `assignedClassId` are legacy/duplicate
 * fields and are deliberately not read.
 */
import {
  DMC_WEEKDAY_KEYS,
  type DmcClassDefinition,
  type DmcInstructorDefinition,
  type DmcTimetableAnomaly,
  type DmcTimetableSlot,
  type DmcTimetableSnapshot,
  type DmcWeekday,
} from "./timetable";

export type NormalizeResult =
  | { ok: true; snapshot: DmcTimetableSnapshot; anomalies: DmcTimetableAnomaly[] }
  | { ok: false; error: string };

const SCHEDULE_KEY_RE = /^(sun|mon|tue|wed|thu|fri|sat)(\d{2})(\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Parsed schedule key, or null when malformed. Never guesses. */
export function parseScheduleKey(
  raw: unknown,
): { dayLocal: DmcWeekday; startTimeLocal: string } | null {
  if (typeof raw !== "string") return null;
  const m = SCHEDULE_KEY_RE.exec(raw);
  if (!m) return null;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  if (hours > 23 || minutes > 59) return null;
  const dayLocal = DMC_WEEKDAY_KEYS.indexOf(m[1] as (typeof DMC_WEEKDAY_KEYS)[number]) as DmcWeekday;
  return { dayLocal, startTimeLocal: `${m[2]}:${m[3]}` };
}

export function parseDayLocal(raw: unknown): DmcWeekday | null {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 6) return null;
  return raw as DmcWeekday;
}

export function parseDuration(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0 || raw > 24 * 60) return null;
  return raw;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseResumesOn(raw: unknown): string | null {
  const value = str(raw);
  return value && DATE_RE.test(value) ? value : null;
}

function normalizeClass(raw: unknown): DmcClassDefinition | null {
  if (!isRecord(raw)) return null;
  const sourceClassId = str(raw["id"]);
  const className = str(raw["className"]);
  if (!sourceClassId || !className) return null;
  return {
    sourceClassId,
    className,
    category: str(raw["category"]),
    level: str(raw["level"]),
    description: str(raw["description"]),
    trailerId: str(raw["trailerId"]),
  };
}

function normalizeInstructor(raw: unknown): DmcInstructorDefinition | null {
  if (!isRecord(raw)) return null;
  const sourceInstructorId = str(raw["id"]);
  if (!sourceInstructorId) return null;
  const info = isRecord(raw["information"]) ? raw["information"] : {};
  return {
    sourceInstructorId,
    firstName: str(info["firstName"]),
    lastName: str(info["lastName"]),
    title: str(info["title"]),
    bioInfo: str(info["bioInfo"]),
    imageUrl: str(raw["image_url"]),
  };
}

/**
 * Validate and normalize a raw DMC public payload.
 *
 * A slot that cannot be trusted is excluded and reported as an anomaly rather
 * than committed with invented data. The whole payload is rejected when its
 * shape is wrong or when no trustworthy slot survives, so a bad refresh can
 * never replace good stored data.
 */
export function normalizeDmcPayload(payload: unknown, fetchedAt: string): NormalizeResult {
  if (!isRecord(payload)) return { ok: false, error: "Timetable response was not an object." };
  const { slots, classes, instructors } = payload as Record<string, unknown>;
  if (!Array.isArray(slots) || !Array.isArray(classes) || !Array.isArray(instructors)) {
    return { ok: false, error: "Timetable response is missing slots, classes or instructors." };
  }

  const classList: DmcClassDefinition[] = [];
  const classById = new Map<string, DmcClassDefinition>();
  for (const raw of classes) {
    const parsed = normalizeClass(raw);
    if (!parsed || classById.has(parsed.sourceClassId)) continue;
    classById.set(parsed.sourceClassId, parsed);
    classList.push(parsed);
  }

  const instructorList: DmcInstructorDefinition[] = [];
  const instructorById = new Map<string, DmcInstructorDefinition>();
  for (const raw of instructors) {
    const parsed = normalizeInstructor(raw);
    if (!parsed || instructorById.has(parsed.sourceInstructorId)) continue;
    instructorById.set(parsed.sourceInstructorId, parsed);
    instructorList.push(parsed);
  }

  const anomalies: DmcTimetableAnomaly[] = [];
  const slotList: DmcTimetableSlot[] = [];
  const seenSlotIds = new Set<string>();

  for (const raw of slots) {
    if (!isRecord(raw)) {
      anomalies.push({ sourceSlotId: null, reason: "Slot entry was not an object." });
      continue;
    }
    const sourceSlotId = str(raw["id"]);
    const reject = (reason: string) => anomalies.push({ sourceSlotId, reason });

    if (!sourceSlotId) {
      reject("Slot has no source id.");
      continue;
    }
    if (seenSlotIds.has(sourceSlotId)) {
      reject("Duplicate slot id in source payload.");
      continue;
    }

    const key = parseScheduleKey(raw["scheduleKey"]);
    if (!key) {
      reject("Malformed scheduleKey.");
      continue;
    }
    const dayLocal = parseDayLocal(raw["dayLocal"]);
    if (dayLocal === null) {
      reject("dayLocal is missing or outside 0–6.");
      continue;
    }
    if (dayLocal !== key.dayLocal) {
      reject("dayLocal disagrees with scheduleKey weekday.");
      continue;
    }
    const durationMinutes = parseDuration(raw["duration"]);
    if (durationMinutes === null) {
      reject("Duration is not a positive whole number of minutes.");
      continue;
    }
    const sourceClassId = str(raw["classId"]);
    if (!sourceClassId || !classById.has(sourceClassId)) {
      reject("Slot references an unknown class.");
      continue;
    }
    const sourceInstructorId = str(raw["instructorId"]);
    if (!sourceInstructorId || !instructorById.has(sourceInstructorId)) {
      reject("Slot references an unknown instructor.");
      continue;
    }

    seenSlotIds.add(sourceSlotId);
    slotList.push({
      sourceSlotId,
      sourceClassId,
      sourceInstructorId,
      dayLocal,
      scheduleKey: `${DMC_WEEKDAY_KEYS[dayLocal]}${key.startTimeLocal.replace(":", "")}`,
      startTimeLocal: key.startTimeLocal,
      durationMinutes,
      active: raw["active"] !== false,
      resumesOn: parseResumesOn(raw["resumesOn"]),
    });
  }

  if (slotList.length === 0) {
    return { ok: false, error: "Timetable response contained no usable slots." };
  }

  return {
    ok: true,
    snapshot: { classes: classList, instructors: instructorList, slots: slotList, fetchedAt },
    anomalies,
  };
}
