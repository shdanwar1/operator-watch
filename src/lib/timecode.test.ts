import { describe, expect, it } from "vitest";
import { buildEdl, durationBetween, formatTimecode, framesAt, isBalletClass } from "./timecode";

describe("timecode", () => {
  it("starts at 01:00:00:00", () => {
    expect(formatTimecode(framesAt(0))).toBe("01:00:00:00");
  });
  it("counts 25 fps", () => {
    expect(formatTimecode(framesAt(1000))).toBe("01:00:01:00");
    expect(formatTimecode(framesAt(10 * 60_000 + 840))).toBe("01:10:00:21");
  });
  it("exports EDL like the reference file", () => {
    const edl = buildEdl("t", [
      { id: "b", frames: framesAt(1000), kind: "End", note: "Of" },
      { id: "a", frames: framesAt(0), kind: "Special", note: "Start" },
    ]);
    expect(edl.split("\n").slice(0, 5)).toEqual([
      "TITLE: t",
      "FCM: NON-DROP FRAME",
      "",
      "001  001      V     C        01:00:00:00 01:00:00:00 01:00:00:00 01:00:00:00",
      "Start |C:ResolveColorGreen |M:Special |D:0",
    ]);
    expect(edl).toContain("002  001      V     C        01:00:01:00");
  });
  it("only 60-minute classes get timecode", () => {
    expect(isBalletClass({ className: "Pilates Flow", durationMinutes: 45 })).toBe(false);
    // A ballet name on a workout-length class must not open the timecode tool.
    expect(
      isBalletClass({
        className: "Stretch & Strength (Ballet-inspired workout)",
        durationMinutes: 45,
      }),
    ).toBe(false);
    expect(isBalletClass({ className: "Pop Barre", durationMinutes: 60 })).toBe(true);
    // A 60-minute class is ballet even when the title says nothing about ballet.
    expect(isBalletClass({ className: "Contemporary Flow", durationMinutes: 60 })).toBe(true);
    expect(isBalletClass({ className: "Ballet Barre", durationMinutes: 30 })).toBe(false);
  });
  it("measures class length from the clock, wrapping past midnight", () => {
    expect(durationBetween("15:45", "16:45")).toBe(60);
    expect(durationBetween("20:15", "21:00")).toBe(45);
    expect(durationBetween("23:30", "00:30")).toBe(60);
  });
});

import { elapsedForFrames, parseTimecode, timecodeFilename } from "./timecode";
describe("manual timecode entry", () => {
  it("parses typed timecode and resumes from it", () => {
    const f = parseTimecode("01:15:30:12")!;
    expect(formatTimecode(f)).toBe("01:15:30:12");
    expect(formatTimecode(framesAt(elapsedForFrames(f)))).toBe("01:15:30:12");
    expect(parseTimecode("00:59:59:24")).toBe(3599 * 25 + 24);
    expect(formatTimecode(framesAt(elapsedForFrames(parseTimecode("00:30:00:00")!)))).toBe("00:30:00:00");
  });
  it("rejects invalid input", () => {
    expect(parseTimecode("01:60:00:00")).toBeNull();
    expect(parseTimecode("01:00:00:25")).toBeNull();
    expect(parseTimecode("abc")).toBeNull();
  });
  it("names files like the class", () => {
    expect(timecodeFilename({ date: "2026-10-20", start: "14:30", teacher: "Marco", className: "Ballet" })).toBe("261020_14-30_Marco_Ballet");
  });
});
