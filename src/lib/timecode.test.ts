import { describe, expect, it } from "vitest";
import { buildEdl, formatTimecode, framesAt, isBalletClass } from "./timecode";

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
  it("only ballet classes get timecode", () => {
    expect(isBalletClass({ className: "Pilates Flow", durationMinutes: 45 })).toBe(false);
    expect(isBalletClass({ className: "Pop Barre", durationMinutes: 60 })).toBe(true);
  });
});
