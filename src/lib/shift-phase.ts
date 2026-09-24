// Shift phase — the single state machine behind the dashboard's Shift Card.
//
// The operator's day is one lifecycle (leave home → check in → run classes →
// check out). This picks which phase the card is in, from the clock alone.

import type { DisplayShift } from "@/lib/display-shifts";

/** Travel information becomes relevant six hours before the shift starts. */
export const LEAVE_WINDOW_MS = 6 * 60 * 60 * 1000;

/** Check-in against a scheduled shift opens one hour before its start. */
export const CHECK_IN_WINDOW_MS = 60 * 60 * 1000;

/**
 * With no scheduled shift starting inside this window, checking in starts an
 * unscheduled shift instead (see `resolveCheckInTarget`).
 */
export const UNSCHEDULED_LEAD_MS = 2 * 60 * 60 * 1000;

export type ShiftPhase = "on-air" | "check-in" | "leave" | "idle";

export function shiftPhase({
  now,
  next,
  active,
}: {
  now: Date;
  /** Next continuous shift that has not ended yet, if any. */
  next: DisplayShift | null;
  /** True while an attendance record is open (checked in, not out). */
  active: boolean;
}): ShiftPhase {
  if (active) return "on-air";
  if (!next) return "idle";
  const untilStart = next.startAt.getTime() - now.getTime();
  // Already running (or past its start) — check-in is the action.
  if (untilStart <= CHECK_IN_WINDOW_MS) return "check-in";
  if (untilStart <= LEAVE_WINDOW_MS) return "leave";
  return "idle";
}

/** Human label for the status strip. */
export function phaseLabel(phase: ShiftPhase): string {
  switch (phase) {
    case "on-air":
      return "On air";
    case "check-in":
      return "Ready to check in";
    case "leave":
      return "Travel";
    default:
      return "No shift soon";
  }
}

export type PreCheckInState = "normal" | "window" | "late";

/**
 * Pre-check-in Dashboard state for the next shift that hasn't ended:
 * normal until start − 1h, check-in window until start, late until end.
 */
export function preCheckInState(next: DisplayShift | null, now: Date): PreCheckInState {
  if (!next) return "normal";
  const t = now.getTime();
  const start = next.startAt.getTime();
  if (t >= next.endAt.getTime()) return "normal";
  if (t >= start) return "late";
  if (t >= start - CHECK_IN_WINDOW_MS) return "window";
  return "normal";
}
