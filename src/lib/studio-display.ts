// Studio Display shared state — synced across control panel & display window
// via BroadcastChannel + localStorage. No backend required.

export type StudioDisplayState = {
  startTime: string; // "HH:MM" 24h
  durationMin: number;
  notes: string;
  updatedAt: number;
};

export const STUDIO_DISPLAY_KEY = "studio_display_state_v1";
export const STUDIO_DISPLAY_CHANNEL = "studio-display";
export const MIN_DURATION_MIN = 10;

export const DEFAULT_STUDIO_DISPLAY_STATE: StudioDisplayState = {
  startTime: "14:00",
  durationMin: 60,
  notes: "",
  updatedAt: 0,
};

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

export type StagePhase =
  | "idle"          // no class scheduled recently / far in future
  | "before"        // >10s before start, showing icebreakers
  | "countdown10"   // final 10s cinematic countdown before class
  | "joining"       // first 60s of class, blue, "Waiting for Participants"
  | "startclass"    // 60s..90s, green, "Start the Class"
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

const JOINING_MS = 60_000;   // first minute of class
const STARTCLASS_MS = 30_000; // next 30s "START THE CLASS"
export const QA_MS = 5 * 60_000; // 5 min Q&A after class ends

export function computeStage(state: StudioDisplayState, now: Date = new Date()): StageInfo {
  const start = resolveStartAt(state.startTime, now);
  const end = new Date(start.getTime() + state.durationMin * 60_000);
  const nowMs = now.getTime();
  const untilStart = start.getTime() - nowMs;
  const untilEnd = end.getTime() - nowMs;
  const sinceStart = nowMs - start.getTime();

  // Before class
  if (nowMs < start.getTime()) {
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
  if (sinceStart < JOINING_MS) {
    return {
      phase: "joining",
      label: "Waiting for Participants",
      bgColor: STAGE_COLORS.blue,
      fg: "light",
      timerMs: untilEnd,
      direction: "down",
      blink: false,
      pulse: false,
    };
  }
  if (sinceStart < JOINING_MS + STARTCLASS_MS) {
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
