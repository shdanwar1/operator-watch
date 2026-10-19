// Studio Display shared state — synced across control panel & display window
// via BroadcastChannel + localStorage. No backend required.

/** How the entered clock time is resolved to a real datetime. */
export type TimerMode = "next" | "running";

export type StudioDisplayState = {
  startTime: string; // "HH:MM" 24h
  durationMin: number;
  notes: string;
  /** "next" = next occurrence of that clock time, "running" = today's occurrence. */
  timerMode?: TimerMode;
  /** Optional class context (Detailed calendar mode). */
  className?: string;
  teacherName?: string;
  /** Which preset launched the session ("Workout" / "Ballet"). */
  presetLabel?: string;
  /** True while a Studio Display session is live — drives the control card. */
  active?: boolean;
  /** calendar_classes row id when launched from a specific class. */
  classId?: string;
  /** Real class date "YYYY-MM-DD" — pins overnight classes to the exact day. */
  classDate?: string;
  /** Class end clock time "HH:MM", shown on the control card. */
  endTime?: string;
  updatedAt: number;
};


export const STUDIO_DISPLAY_KEY = "studio_display_state_v1";
export const STUDIO_DISPLAY_CHANNEL = "studio-display";
export const MIN_DURATION_MIN = 10;

/** Class name + teacher stay on screen until 5 minutes before the start. */
export const CLASS_INFO_CUTOFF_MS = 5 * 60_000;

export const DEFAULT_STUDIO_DISPLAY_STATE: StudioDisplayState = {
  startTime: "14:00",
  durationMin: 60,
  notes: "",
  timerMode: "next",
  className: "",
  teacherName: "",
  presetLabel: "",
  active: false,
  classId: "",
  classDate: "",
  endTime: "",
  updatedAt: 0,
};

/** Builds the popup URL that pre-loads a class into the Studio Display. */
export function buildClassDisplayUrl(input: {
  /** calendar_classes row id — lets a live sync refresh this popup. */
  id?: string;
  className: string;
  teacherName: string;
  startTime: string; // "HH:MM" or "HH:MM:SS"
  durationMin: number;
}) {
  const params = new URLSearchParams({
    c: input.className,
    t: input.teacherName,
    s: input.startTime.slice(0, 5),
    d: String(Math.max(MIN_DURATION_MIN, Math.round(input.durationMin))),
  });
  if (input.id) params.set("id", input.id);
  return `/display?${params.toString()}`;
}


/**
 * True when a popup window would leave the app — touch devices (iPhone, iPad,
 * Android), installed or not. iOS hands popups to the system browser and
 * Android can't manage the two-window arrangement, so there the display opens
 * in the same window instead.
 *
 * Desktop is excluded on purpose: macOS Safari Web Apps report standalone but
 * fully support multi-window, so "Open Display" opens a real separate window
 * there, matching Chrome.
 */
export function prefersInAppDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return Boolean(coarse);
}

export function readStudioDisplayState(): StudioDisplayState {
  if (typeof window === "undefined") return DEFAULT_STUDIO_DISPLAY_STATE;
  try {
    const raw = window.localStorage.getItem(STUDIO_DISPLAY_KEY);
    if (!raw) return DEFAULT_STUDIO_DISPLAY_STATE;
    const parsed = JSON.parse(raw) as Partial<StudioDisplayState>;
    return { ...DEFAULT_STUDIO_DISPLAY_STATE, ...parsed };
  } catch {
    return DEFAULT_STUDIO_DISPLAY_STATE;
  }
}

export function writeStudioDisplayState(state: StudioDisplayState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STUDIO_DISPLAY_KEY, JSON.stringify(state));
}

/** Combines "HH:MM" with today's date. */
export function resolveStartAt(startTime: string, ref: Date = new Date()): Date {
  const [h, m] = startTime.split(":").map((n) => parseInt(n, 10));
  const d = new Date(ref);
  d.setHours(isNaN(h) ? 0 : h, isNaN(m) ? 0 : m, 0, 0);
  return d;
}

/**
 * Resolves the class start datetime from a clock time, using full date+time
 * values so midnight/overnight classes need no manual mode switching.
 *
 * Rule: consider yesterday's, today's and tomorrow's occurrence of the entered
 * clock time. If one of them is currently running (start .. end + Q&A window),
 * that is the class. Otherwise pick the occurrence nearest to now, preferring
 * the upcoming one on a tie.
 *
 * "running" (legacy timerMode) still pins the class to today's occurrence.
 */
export function resolveClassStart(
  state: Pick<StudioDisplayState, "startTime" | "durationMin" | "timerMode"> & {
    classDate?: string;
  },
  ref: Date = new Date(),
): Date {
  // A class launched from the calendar carries its real date, so the exact
  // occurrence is known and no clock-only guessing is needed.
  if (state.classDate && /^\d{4}-\d{2}-\d{2}$/.test(state.classDate)) {
    const [y, m, d] = state.classDate.split("-").map(Number);
    const [h, mi] = state.startTime.split(":").map((n) => parseInt(n, 10));
    return new Date(y, (m || 1) - 1, d || 1, isNaN(h) ? 0 : h, isNaN(mi) ? 0 : mi, 0, 0);
  }
  const base = resolveStartAt(state.startTime, ref);
  if (state.timerMode === "running") return base;



  const now = ref.getTime();
  const spanMs = Math.max(0, state.durationMin) * 60_000 + QA_MS;
  const candidates = [-1, 0, 1].map((offset) => {
    const d = new Date(base);
    d.setDate(d.getDate() + offset);
    return d;
  });

  const active = candidates.find(
    (c) => now >= c.getTime() && now < c.getTime() + spanMs,
  );
  if (active) return active;

  let best = candidates[0]!;
  for (const c of candidates) {
    const dc = Math.abs(c.getTime() - now);
    const db = Math.abs(best.getTime() - now);
    if (dc < db || (dc === db && c.getTime() > now)) best = c;
  }
  return best;
}

/** Full start/end datetimes of the resolved class occurrence. */
export function resolveClassInterval(
  state: Pick<StudioDisplayState, "startTime" | "durationMin" | "timerMode"> & {
    classDate?: string;
  },
  ref: Date = new Date(),
) {
  const startAt = resolveClassStart(state, ref);
  const endAt = new Date(startAt.getTime() + Math.max(0, state.durationMin) * 60_000);
  return { startAt, endAt };
}

/** Notes are editable only while the class is actually running. */
export function notesEditable(
  state: Pick<StudioDisplayState, "startTime" | "durationMin" | "timerMode"> & {
    classDate?: string;
  },
  ref: Date = new Date(),
): boolean {
  const { startAt, endAt } = resolveClassInterval(state, ref);
  const now = ref.getTime();
  return now >= startAt.getTime() && now < endAt.getTime();
}



export type StagePhase =
  | "idle"          // no class scheduled recently / far in future
  | "before"        // >10s before start, showing icebreakers
  | "countdown10"   // final 10s cinematic countdown before class
  | "startclass"    // first 30s after start+1min, green, "Start the Class"
  | "live"          // green, "Time Remaining"
  | "warn5"         // yellow
  | "warn1"         // orange
  | "final30"       // red, blink
  | "qa"            // 5 min post-class Q&A with circular countdown
  | "complete";     // (kept for back-compat) black, "Class Complete"

export type StageInfo = {
  phase: StagePhase;
  label: string;
  bgColor: string;
  fg: "light" | "dark";
  timerMs: number;
  direction: "down" | "up";
  blink: boolean;
  pulse: boolean;
  // number to render for final-10 cinematic countdown
  bigNumber?: number;
  // total duration of current phase (for progress rings)
  totalMs?: number;
};

export const STAGE_COLORS = {
  black: "#000000",
  blue: "#0b63d6",
  green: "#059669",
  yellow: "#facc15",
  orange: "#f97316",
  red: "#dc2626",
} as const;

/** Display-only offset: the screen treats scheduled start + 1 min as "go". */
export const DISPLAY_START_OFFSET_MS = 60_000;
const STARTCLASS_MS = 30_000; // first 30s after display start: "START THE CLASS"
export const QA_MS = 5 * 60_000; // 5 min Q&A after class ends

export function computeStage(state: StudioDisplayState, now: Date = new Date()): StageInfo {
  const start = resolveClassStart(state, now);
  const end = new Date(start.getTime() + state.durationMin * 60_000);
  const displayStart = start.getTime() + DISPLAY_START_OFFSET_MS;
  const nowMs = now.getTime();
  const untilStart = displayStart - nowMs;
  const untilEnd = end.getTime() - nowMs;
  const sinceStart = nowMs - displayStart;

  // Before display start
  if (nowMs < displayStart) {
    if (untilStart <= 10_000) {
      const n = Math.max(1, Math.ceil(untilStart / 1000));
      return {
        phase: "countdown10",
        label: "",
        bgColor: STAGE_COLORS.black,
        fg: "light",
        timerMs: untilStart,
        direction: "down",
        blink: false,
        pulse: true,
        bigNumber: n,
      };
    }
    return {
      phase: "before",
      label: "Class starts in",
      bgColor: STAGE_COLORS.black,
      fg: "light",
      timerMs: untilStart,
      direction: "down",
      blink: false,
      pulse: false,
    };
  }

  // Ended → Q&A window, then idle
  if (nowMs >= end.getTime()) {
    const sinceEnd = nowMs - end.getTime();
    if (sinceEnd < QA_MS) {
      const remaining = QA_MS - sinceEnd;
      return {
        phase: "qa",
        label: "Class Complete",
        bgColor: STAGE_COLORS.black,
        fg: "light",
        timerMs: remaining,
        direction: "down",
        blink: false,
        pulse: false,
        totalMs: QA_MS,
      };
    }
    return {
      phase: "idle",
      label: "Waiting for Next Class",
      bgColor: STAGE_COLORS.black,
      fg: "light",
      timerMs: 0,
      direction: "down",
      blink: false,
      pulse: false,
    };
  }

  // In class — timer counts down from full duration
  if (untilEnd <= 30_000) {
    return {
      phase: "final30",
      label: "Final 30 Seconds",
      bgColor: STAGE_COLORS.red,
      fg: "light",
      timerMs: untilEnd,
      direction: "down",
      blink: true,
      pulse: true,
    };
  }
  if (untilEnd <= 60_000) {
    return {
      phase: "warn1",
      label: "1 Minute Remaining",
      bgColor: STAGE_COLORS.orange,
      fg: "light",
      timerMs: untilEnd,
      direction: "down",
      blink: false,
      pulse: false,
    };
  }
  if (untilEnd <= 5 * 60_000) {
    return {
      phase: "warn5",
      label: "5 Minutes Remaining",
      bgColor: STAGE_COLORS.yellow,
      fg: "dark",
      timerMs: untilEnd,
      direction: "down",
      blink: false,
      pulse: false,
    };
  }
  if (sinceStart < STARTCLASS_MS) {
    return {
      phase: "startclass",
      label: "Start the Class",
      bgColor: STAGE_COLORS.green,
      fg: "light",
      timerMs: untilEnd,
      direction: "down",
      blink: false,
      pulse: false,
    };
  }
  return {
    phase: "live",
    label: "Time Remaining",
    bgColor: STAGE_COLORS.green,
    fg: "light",
    timerMs: untilEnd,
    direction: "down",
    blink: false,
    pulse: false,
  };
}

export function formatMMSS(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// Back-compat shim
export function computeTimer(state: StudioDisplayState, now: Date = new Date()) {
  const stage = computeStage(state, now);
  const phase =
    stage.phase === "before" || stage.phase === "countdown10"
      ? "before"
      : stage.phase === "complete" || stage.phase === "idle" || stage.phase === "qa"
      ? "complete"
      : "running";
  return { phase, remainingMs: stage.timerMs, stage };
}
