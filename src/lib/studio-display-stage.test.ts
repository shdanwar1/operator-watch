import { describe, expect, it } from "vitest";
import { computeStage, formatMMSS, DEFAULT_STUDIO_DISPLAY_STATE } from "./studio-display";
const st = (d: number) => ({ ...DEFAULT_STUDIO_DISPLAY_STATE, startTime: "10:00", durationMin: d, classDate: "2026-10-05" });
const at = (t: string) => new Date(`2026-10-05T${t}`);
describe("studio display +1 min start", () => {
  it("45-min acceptance sequence", () => {
    const s = st(45);
    expect(formatMMSS(computeStage(s, at("09:45:00")).timerMs)).toBe("16:00");
    expect(formatMMSS(computeStage(s, at("09:55:00")).timerMs)).toBe("06:00");
    expect(formatMMSS(computeStage(s, at("10:00:00")).timerMs)).toBe("01:00");
    expect(computeStage(s, at("10:00:30")).phase).toBe("before");
    for (let i = 0; i < 10; i++) {
      const g = computeStage(s, at(`10:00:5${i}`));
      expect(g.phase).toBe("countdown10");
      expect(g.bigNumber).toBe(10 - i);
    }
    const green = computeStage(s, at("10:01:00"));
    expect(green.phase).toBe("startclass");
    expect(formatMMSS(green.timerMs)).toBe("44:00");
    expect(computeStage(s, at("10:01:05")).phase).toBe("startclass");
    expect(computeStage(s, at("10:05:00")).phase).toBe("live");
    expect(computeStage(s, at("10:40:00")).phase).toBe("warn5");
    expect(computeStage(s, at("10:44:00")).phase).toBe("warn1");
    expect(computeStage(s, at("10:44:30")).phase).toBe("final30");
    expect(formatMMSS(computeStage(s, at("10:44:30")).timerMs)).toBe("00:30");
    expect(computeStage(s, at("10:45:00")).phase).toBe("qa");
  });
  it("60-min class keeps real end", () => {
    const s = st(60);
    expect(formatMMSS(computeStage(s, at("10:01:00")).timerMs)).toBe("59:00");
    expect(computeStage(s, at("10:55:00")).phase).toBe("warn5");
    expect(computeStage(s, at("10:59:30")).phase).toBe("final30");
    expect(computeStage(s, at("11:00:00")).phase).toBe("qa");
  });
});
