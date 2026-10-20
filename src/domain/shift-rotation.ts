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
}): PlannedShift[] {
  const byBucket: Record<ShiftBucket, PlannedClass[]> = { day: [], night: [], weekend: [] };
  for (let date = input.from; date <= input.to; date = addDays(date, 1)) {
    const wd = weekday(date);
    for (const s of input.slots) {
      if (s.dayLocal !== wd || !isTimetableSlotOperationalOnDate(s, date)) continue;
      const start = toMin(s.startTimeLocal);
      byBucket[classifyClass(wd, s.startTimeLocal)].push({
        uid: `tt:${s.sourceSlotId}:${date}`,
        date,
        startTime: hms(start),
        endTime: hms(start + s.durationMinutes),
        sourceClassId: s.sourceClassId,
        sourceInstructorId: s.sourceInstructorId,
      });
    }
  }

  const out: PlannedShift[] = [];
  for (const bucket of SHIFT_BUCKETS) {
    const classes = byBucket[bucket];
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
        operator: rotationForMonth(input.rotation, g.date.slice(0, 7))[bucket],
        classes: g.classKeys.map((k) => byUid.get(k)!),
      });
    }
  }
  return out.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
}
