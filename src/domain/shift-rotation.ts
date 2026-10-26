/**
 * Timetable-driven shift planning (replaces Google Calendar sync). Pure.
 *
 * Every dated class occurrence from the DMC Live Timetable falls into exactly
 * one bucket (Berlin wall clock):
 *   day     — Mon–Thu, classes starting 03:00–20:59
 *   night   — Mon–Thu from 21:00, the following 00:00–02:59, and every
 *             Friday class from 12:00 (plus Sat 00:00–02:59)
 *   weekend — Friday 03:00–11:59, all of Saturday/Sunday, Mon 00:00–02:59
 * Classes of one bucket are grouped into shifts with the canonical buffers.
 * Operators rotate monthly: each month every operator moves one bucket along.
 */
import { groupClassesIntoShifts } from "./shift-planning";
import { isTimetableSlotOperationalOnDate } from "./timetable-resolver";
import type { DmcTimetableSlot } from "./timetable";
import { berlinWallToInstant, indexOverrides, resolveOccurrence, type DmcScheduleOverride } from "./schedule-overrides";
import type { RotationAdjustment } from "./rotation-adjustments";

export type ShiftBucket = "day" | "night" | "weekend";
export const SHIFT_BUCKETS: ShiftBucket[] = ["day", "night", "weekend"];

/** Rotation anchor: who holds each bucket in `anchorMonth` (YYYY-MM). */
export type ShiftRotation = {
  anchorMonth: string;
  day: string | null;
  night: string | null;
  weekend: string | null;
};

export const DEFAULT_ROTATION: ShiftRotation = {
  anchorMonth: "2026-10",
  day: "Shad",
  night: "Alex",
  weekend: "Victor",
};

const NIGHT_START = 21 * 60;
const NIGHT_END = 3 * 60;
const FRIDAY_SPLIT = 12 * 60;

function toMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** dayLocal: 0 = Sunday … 6 = Saturday. */
export function classifyClass(dayLocal: number, startTimeLocal: string): ShiftBucket {
  const min = toMin(startTimeLocal);
  if (min < NIGHT_END) {
    // After-midnight classes belong to the previous evening.
    const prev = (dayLocal + 6) % 7;
    if (prev >= 1 && prev <= 5) return "night"; // Mon–Fri evening
    return "weekend"; // Sat/Sun evening
  }
  if (dayLocal === 0 || dayLocal === 6) return "weekend";
  if (dayLocal === 5) return min < FRIDAY_SPLIT ? "weekend" : "night";
  return min >= NIGHT_START ? "night" : "day";
}

function monthIndex(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}

/** Operator holding each bucket in `month` (YYYY-MM). */
export function rotationForMonth(r: ShiftRotation, month: string): Record<ShiftBucket, string | null> {
  const base = [r.day, r.night, r.weekend];
  const k = (((monthIndex(month) - monthIndex(r.anchorMonth)) % 3) + 3) % 3;
  const at = (i: number) => base[(((i - k) % 3) + 3) % 3];
  return { day: at(0), night: at(1), weekend: at(2) };
}

export function classShiftDay(date: string, startTime: string): string {
  return toMin(startTime) < NIGHT_END ? addDays(date, -1) : date;
}

export function resolveClassOperator(input: {
  date: string; startTime: string; rotation: ShiftRotation; adjustments?: RotationAdjustment[];
}): { bucket: ShiftBucket; operator: string | null; shiftDay: string } {
  const day = weekday(input.date);
  const bucket = classifyClass(day, input.startTime);
  const shiftDay = classShiftDay(input.date, input.startTime);
  const at = berlinWallToInstant(input.date, input.startTime);
  const time = input.startTime.slice(0, 5);
  const match = [...(input.adjustments ?? [])].filter((a) =>
    at >= Date.parse(a.valid_from) && at < Date.parse(a.valid_until) &&
    (!a.bucket || a.bucket === bucket) && (a.weekday === null || a.weekday === day) &&
    (!a.start_from || time >= a.start_from.slice(0, 5)) && (!a.start_to || time < a.start_to.slice(0, 5)),
  ).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id))[0];
  return { bucket, shiftDay, operator: match?.operator ?? rotationForMonth(input.rotation, shiftDay.slice(0, 7))[bucket] };
}

export type PlannedClass = {
  uid: string;
  date: string;
  startTime: string;
  endTime: string;
  sourceClassId: string;
  sourceInstructorId: string;
};

export type PlannedShift = {
  uid: string;
  bucket: ShiftBucket;
  date: string;
  startTime: string;
  endTime: string;
  operator: string | null;
  classes: PlannedClass[];
};

function addDays(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

function weekday(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function hms(min: number) {
  const c = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(c % 60).padStart(2, "0")}:00`;
}

export function timetableShiftUid(bucket: ShiftBucket, date: string, startTime: string) {
  return `tt:${bucket}:shift:${date}:${startTime.slice(0, 5).replace(":", "")}`;
}

/** Plans every shift whose classes fall in [from, to] (inclusive dates). */
export function planTimetableShifts(input: {
  slots: DmcTimetableSlot[];
  from: string;
  to: string;
  rotation: ShiftRotation;
  overrides?: DmcScheduleOverride[];
  instructorIds?: string[];
  adjustments?: RotationAdjustment[];
  excludedClassUids?: Set<string>;
}): PlannedShift[] {
  const index = indexOverrides(input.overrides);
  const instructors = (input.instructorIds ?? []).map((sourceInstructorId) => ({ sourceInstructorId }));
  const assignedGroups = new Map<string, { bucket: ShiftBucket; operator: string | null; classes: PlannedClass[] }>();
  for (let date = input.from; date <= input.to; date = addDays(date, 1)) {
    const wd = weekday(date);
    for (const s of input.slots) {
      if (s.dayLocal !== wd || !isTimetableSlotOperationalOnDate(s, date)) continue;
      const occ = resolveOccurrence({ slot: s, date, index, instructors });
      if (occ.cancelled) continue; // cancelled for this date: no shift work
      const start = toMin(s.startTimeLocal);
      const uid = `tt:${s.sourceSlotId}:${date}`;
      if (input.excludedClassUids?.has(uid)) continue;
      const assignment = resolveClassOperator({ date, startTime: s.startTimeLocal, rotation: input.rotation, adjustments: input.adjustments });
      const key = JSON.stringify([assignment.bucket, assignment.shiftDay, assignment.operator]);
      let assigned = assignedGroups.get(key);
      if (!assigned) {
        assigned = { bucket: assignment.bucket, operator: assignment.operator, classes: [] };
        assignedGroups.set(key, assigned);
      }
      assigned.classes.push({
        uid: `tt:${s.sourceSlotId}:${date}`,
        date,
        startTime: hms(start),
        endTime: hms(start + s.durationMinutes),
        sourceClassId: s.sourceClassId,
        sourceInstructorId: occ.idInstructor,
      });
    }
  }

  const out: PlannedShift[] = [];
  for (const { bucket, operator, classes } of assignedGroups.values()) {
    const byUid = new Map(classes.map((c) => [c.uid, c]));
    const groups = groupClassesIntoShifts(
      classes.map((c) => ({ key: c.uid, date: c.date, startMin: toMin(c.startTime), endMin: toMin(c.endTime) })),
    );
    for (const g of groups) {
      const startTime = hms(g.startMin);
      out.push({
        uid: timetableShiftUid(bucket, g.date, startTime),
        bucket,
        date: g.date,
        startTime,
        endTime: hms(g.endMin),
        operator,
        classes: g.classKeys.flatMap((k) => { const c = byUid.get(k); return c ? [c] : []; }),
      });
    }
  }
  // Keep legacy identities stable; distinguish simultaneous split-operator groups.
  const counts = new Map<string, number>();
  for (const p of out) counts.set(p.uid, (counts.get(p.uid) ?? 0) + 1);
  for (const p of out) if ((counts.get(p.uid) ?? 0) > 1) p.uid += `:${encodeURIComponent(p.operator ?? "unassigned")}`;
  return out.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
}
