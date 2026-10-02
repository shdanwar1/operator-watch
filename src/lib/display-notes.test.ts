import { describe, expect, it } from "vitest";
import { cancelNotePatch, notesControlAvailable, sendNotePatch } from "./display-notes";
import { DEFAULT_STUDIO_DISPLAY_STATE, type StudioDisplayState } from "./studio-display";

function session(startOffsetMin: number): StudioDisplayState {
  const d = new Date(Date.now() + startOffsetMin * 60_000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return { ...DEFAULT_STUDIO_DISPLAY_STATE, active: true, startTime: `${hh}:${mm}`, durationMin: 45 };
}

describe("notes for display lifecycle", () => {
  it("is available before, during and after class while the session is active", () => {
    expect(notesControlAvailable(session(30))).toBe(true);
    expect(notesControlAvailable(session(-10))).toBe(true);
    expect(notesControlAvailable(session(-120))).toBe(true);
  });

  it("is unavailable once the session has ended", () => {
    expect(notesControlAvailable({ ...session(0), active: false })).toBe(false);
  });

  it("sends a trimmed message and refuses empty ones", () => {
    expect(sendNotePatch("  Welcome everyone ")).toEqual({ notes: "Welcome everyone" });
    expect(sendNotePatch("")).toBeNull();
    expect(sendNotePatch("   \n ")).toBeNull();
  });

  it("replacing and cancelling only change notes, never timing", () => {
    const s = { ...session(-5), notes: "Welcome everyone" };
    const replaced = { ...s, ...sendNotePatch("Please be quiet")! };
    expect(replaced.notes).toBe("Please be quiet");
    const cancelled = { ...replaced, ...cancelNotePatch() };
    expect(cancelled.notes).toBe("");
    expect(cancelled.startTime).toBe(s.startTime);
    expect(cancelled.durationMin).toBe(s.durationMin);
    expect(cancelled.active).toBe(true);
  });
});
