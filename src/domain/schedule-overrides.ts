/**
 * Per-date schedule overrides (cancellations and substitute teachers). Pure.
 *
 * Overrides are temporary exceptions keyed by `${slotId}_${berlinDate}`; they
 * never change the weekly timetable. A weekly suspension (`active === false`)
 * always wins over an override. Missing/empty override data changes nothing.
 */
import type { DmcInstructorDefinition, DmcTimetableSlot } from "./timetable";

export type DmcScheduleOverride = {
  slotId: string;
  /** Berlin calendar date, YYYY-MM-DD. */
  date: string;
  cancelled: boolean;
  instructorId: string | null;
};

export type DmcPreview = { trailerId: string; classId: string; instructorId: string };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar-date parts, or null when malformed. Never uses `new Date("YYYY-MM-DD")`. */
export function parseDateParts(value: unknown): { y: number; m: number; d: number } | null {
  if (typeof value !== "string") return null;
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

export function addCalendarDays(date: string, days: number): string {
  const p = parseDateParts(date);
  if (!p) return date;
  return new Date(Date.UTC(p.y, p.m - 1, p.d + days)).toISOString().slice(0, 10);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Tolerant parse: anything missing or malformed yields no override. */
export function normalizeOverrides(raw: unknown): DmcScheduleOverride[] {
  if (!Array.isArray(raw)) return [];
  const out: DmcScheduleOverride[] = [];
  for (const o of raw) {
    if (!isRecord(o)) continue;
    const slotId = typeof o.slotId === "string" ? o.slotId.trim() : "";
    const date = typeof o.date === "string" ? o.date : "";
    if (!slotId || !parseDateParts(date)) continue;
    const instructorId =
      typeof o.instructorId === "string" && o.instructorId.trim() ? o.instructorId.trim() : null;
    out.push({ slotId, date, cancelled: o.cancelled === true, instructorId });
  }
  return out;
}

export function normalizePreviews(raw: unknown): DmcPreview[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p) =>
    isRecord(p) &&
    typeof p.trailerId === "string" &&
    typeof p.classId === "string" &&
    typeof p.instructorId === "string"
      ? [{ trailerId: p.trailerId, classId: p.classId, instructorId: p.instructorId }]
      : [],
  );
}

export type OverrideIndex = Map<string, DmcScheduleOverride>;

export function indexOverrides(overrides: DmcScheduleOverride[] | null | undefined): OverrideIndex {
  const map: OverrideIndex = new Map();
  for (const o of overrides ?? []) map.set(`${o.slotId}_${o.date}`, o);
  return map;
}

/** Trailer for exactly this instructor + class; never falls back. */
export function trailerFor(previews: DmcPreview[], instructorId: string, classId: string): string | null {
  return previews.find((p) => p.instructorId === instructorId && p.classId === classId)?.trailerId ?? null;
}

export type ResolvedOccurrence = {
  slot: DmcTimetableSlot;
  date: string;
  active: boolean;
  cancelled: boolean;
  cancelledOn: string | null;
  resumesOn: string | null;
  /** Instructor actually teaching on this date. */
  idInstructor: string;
  /** Regular weekly instructor. */
  weeklyInstructorId: string;
  substitute: boolean;
  trailerId: string | null;
};

/** Apply the override (if any) to one dated occurrence of a slot. */
export function resolveOccurrence(input: {
  slot: DmcTimetableSlot;
  date: string;
  index: OverrideIndex;
  instructors?: Pick<DmcInstructorDefinition, "sourceInstructorId">[];
  previews?: DmcPreview[];
}): ResolvedOccurrence {
  const { slot, date, index } = input;
  const previews = input.previews ?? [];
  const regular = slot.sourceInstructorId;
  const base: ResolvedOccurrence = {
    slot,
    date,
    active: slot.active,
    cancelled: false,
    cancelledOn: null,
    resumesOn: slot.resumesOn,
    idInstructor: regular,
    weeklyInstructorId: regular,
    substitute: false,
    trailerId: trailerFor(previews, regular, slot.sourceClassId),
  };
  // Weekly suspensions take precedence over every date-specific override.
  if (!slot.active) return base;

  const o = index.get(`${slot.sourceSlotId}_${date}`);
  if (!o) return base;

  if (o.cancelled) {
    let next = addCalendarDays(date, 7);
    for (let i = 0; i < 12 && index.get(`${slot.sourceSlotId}_${next}`)?.cancelled; i++) {
      next = addCalendarDays(next, 7);
    }
    return { ...base, active: false, cancelled: true, cancelledOn: date, resumesOn: next };
  }

  const known = (input.instructors ?? []).some((i) => i.sourceInstructorId === o.instructorId);
  if (o.instructorId && o.instructorId !== regular && known) {
    return {
      ...base,
      idInstructor: o.instructorId,
      substitute: true,
      trailerId: trailerFor(previews, o.instructorId, slot.sourceClassId),
    };
  }
  return base;
}

/** Offset of Europe/Berlin from UTC at an instant, in minutes. */
function berlinOffsetMinutes(at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(at));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"));
  return Math.round((asUtc - Math.floor(at / 60000) * 60000) / 60000);
}

/** Instant (ms) of a Berlin wall-clock time on a Berlin date, DST-correct. */
export function berlinWallToInstant(date: string, time: string): number {
  const p = parseDateParts(date)!;
  const [h, mi] = time.split(":").map(Number);
  const naive = Date.UTC(p.y, p.m - 1, p.d, h, mi);
  let at = naive - berlinOffsetMinutes(naive) * 60000;
  at = naive - berlinOffsetMinutes(at) * 60000;
  return at;
}

/** Berlin calendar date of an instant, independent of the viewer's timezone. */
export function berlinDateOf(at: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}

/**
 * The current-or-next occurrence of a weekly slot, searching from
 * `now - max(duration, 30 min)` so a class in progress stays current.
 */
export function nextOccurrence(slot: DmcTimetableSlot, now: number): { date: string; startsAt: number } {
  const from = now - Math.max(slot.durationMinutes, 30) * 60000;
  let date = berlinDateOf(from);
  for (let i = 0; i < 9; i++) {
    const p = parseDateParts(date)!;
    if (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() === slot.dayLocal) {
      const startsAt = berlinWallToInstant(date, slot.startTimeLocal);
      if (startsAt >= from) return { date, startsAt };
    }
    date = addCalendarDays(date, 1);
  }
  throw new Error("unreachable");
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "Back on November 5", or null when the date is missing or malformed. */
export function backOnLabel(resumesOn: string | null | undefined): string | null {
  const p = parseDateParts(resumesOn);
  return p ? `Back on ${MONTHS[p.m - 1]} ${p.d}` : null;
}
