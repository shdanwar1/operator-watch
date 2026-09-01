/**
 * One shared configuration model for every Studio Display entry point:
 * Workout, Ballet, Customize, saved presets and the temporary class card.
 * All of them produce a StudioConfig which feeds the existing /display engine.
 */
import { MIN_DURATION_MIN } from "@/lib/studio-display";
import { intervalOf } from "@/lib/class-interval";

export type StudioConfig = {
  startTime: string; // "HH:MM"
  durationMin: number;
  notes: string;
  className?: string;
  teacherName?: string;
  /** calendar_classes row id, when launched from a specific class. */
  classId?: string;
  /** "Workout" / "Ballet" — shown on the active display control card. */
  presetLabel?: string;
};

export const WORKOUT_MIN = 45;
export const BALLET_MIN = 60;

/** Round-trip a class from Shift Overview into the Studio Display page URL. */
export type TemporaryClass = {
  classId: string;
  className: string;
  teacherName: string;
  /** class date key, "YYYY-MM-DD" */
  date: string;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
};

export type TemporaryClassSearch = {
  cid?: string;
  cn?: string;
  tn?: string;
  cd?: string;
  cs?: string;
  ce?: string;
};

export function temporaryClassSearch(input: TemporaryClass): TemporaryClassSearch {
  return {
    cid: input.classId,
    cn: input.className,
    tn: input.teacherName,
    cd: input.date,
    cs: input.startTime.slice(0, 5),
    ce: input.endTime.slice(0, 5),
  };
}

export function parseTemporaryClass(search: TemporaryClassSearch): TemporaryClass | null {
  const { cid, cd, cs, ce } = search;
  if (!cid || !cd || !cs || !ce) return null;
  return {
    classId: cid,
    className: search.cn ?? "",
    teacherName: search.tn ?? "",
    date: cd,
    startTime: cs.slice(0, 5),
    endTime: ce.slice(0, 5),
  };
}

/** Full datetime interval of the temporary class, overnight aware. */
export function temporaryClassInterval(tc: TemporaryClass) {
  return intervalOf(tc.date, tc.startTime, tc.endTime);
}

export function temporaryClassDurationMin(tc: TemporaryClass): number {
  const { startAt, endAt } = temporaryClassInterval(tc);
  return Math.max(MIN_DURATION_MIN, Math.round((endAt.getTime() - startAt.getTime()) / 60_000));
}

/** The temporary card is valid only until the class's real end datetime. */
export function temporaryClassExpired(tc: TemporaryClass, now: Date = new Date()): boolean {
  return now.getTime() >= temporaryClassInterval(tc).endAt.getTime();
}

/** 45 min -> Workout, 60 min -> Ballet, anything else -> Customize. */
export function defaultPresetIdFor(durationMin: number): "workout" | "ballet" | "custom" {
  if (durationMin === WORKOUT_MIN) return "workout";
  if (durationMin === BALLET_MIN) return "ballet";
  return "custom";
}
