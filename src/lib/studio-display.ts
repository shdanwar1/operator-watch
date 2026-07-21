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

export const DEFAULT_STUDIO_DISPLAY_STATE: StudioDisplayState = {
  startTime: "14:00",
  durationMin: 90,
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
  | "before"
  | "warmup"
  | "live"
  | "warn5"
  | "warn1"
  | "final30"
  | "complete";

export type StageInfo = {
  phase: StagePhase;
  label: string;
  bg: string;      // tailwind bg class
  fg: string;      // tailwind text class
  timerMs: number; // ms to render in MM:SS
  direction: "down" | "up";
  blink: boolean;
  pulse: boolean;
};

const WARMUP_MS = 60_000;

export function computeStage(state: StudioDisplayState, now: Date = new Date()): StageInfo {
  const start = resolveStartAt(state.startTime, now);
  const warmupEnd = new Date(start.getTime() + WARMUP_MS);
  const end = new Date(warmupEnd.getTime() + state.durationMin * 60_000);
  const nowMs = now.getTime();
  const untilEnd = end.getTime() - nowMs;

  if (nowMs < start.getTime()) {
    return {
      phase: "before",
      label: "Class starts in",
      bg: "bg-black",
      fg: "text-white",
      timerMs: start.getTime() - nowMs,
      direction: "down",
      blink: false,
      pulse: false,
    };
  }
  if (nowMs < warmupEnd.getTime()) {
    return {
      phase: "warmup",
      label: "Wait for Participants",
      bg: "bg-sky-600",
      fg: "text-white",
      timerMs: nowMs - start.getTime(), // counts up 0 → 60s
      direction: "up",
      blink: false,
      pulse: false,
    };
  }
  if (nowMs >= end.getTime()) {
    return {
      phase: "complete",
      label: "Class Complete",
      bg: "bg-black",
      fg: "text-white",
      timerMs: 0,
      direction: "down",
      blink: false,
      pulse: false,
    };
  }
  if (untilEnd <= 30_000) {
    return {
      phase: "final30",
      label: "30 Seconds Remaining",
      bg: "bg-red-600",
      fg: "text-white",
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
      bg: "bg-orange-500",
      fg: "text-white",
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
      bg: "bg-yellow-400",
      fg: "text-neutral-900",
      timerMs: untilEnd,
      direction: "down",
      blink: false,
      pulse: false,
    };
  }
  return {
    phase: "live",
    label: "Class Live",
    bg: "bg-emerald-600",
    fg: "text-white",
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

// Back-compat shim for older callers.
export function computeTimer(state: StudioDisplayState, now: Date = new Date()) {
  const stage = computeStage(state, now);
  const phase =
    stage.phase === "before" ? "before" : stage.phase === "complete" ? "complete" : "running";
  return { phase, remainingMs: stage.timerMs, stage };
}
