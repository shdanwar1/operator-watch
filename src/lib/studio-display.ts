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

/** Combines "HH:MM" with today's date, or tomorrow if already past + far into next day. */
export function resolveStartAt(startTime: string, ref: Date = new Date()): Date {
  const [h, m] = startTime.split(":").map((n) => parseInt(n, 10));
  const d = new Date(ref);
  d.setHours(isNaN(h) ? 0 : h, isNaN(m) ? 0 : m, 0, 0);
  return d;
}

export type TimerPhase = "before" | "running" | "complete";

export function computeTimer(state: StudioDisplayState, now: Date = new Date()) {
  const start = resolveStartAt(state.startTime, now);
  const end = new Date(start.getTime() + state.durationMin * 60_000);
  const nowMs = now.getTime();
  let phase: TimerPhase;
  let remainingMs: number;
  if (nowMs < start.getTime()) {
    phase = "before";
    remainingMs = start.getTime() - nowMs;
  } else if (nowMs < end.getTime()) {
    phase = "running";
    remainingMs = end.getTime() - nowMs;
  } else {
    phase = "complete";
    remainingMs = 0;
  }
  return { phase, remainingMs, start, end };
}

export function formatMMSS(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
