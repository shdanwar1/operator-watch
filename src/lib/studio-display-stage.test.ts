import { describe, expect, it } from "vitest";
import { computeStage, formatMMSS, DEFAULT_STUDIO_DISPLAY_STATE, STAGE_COLORS, isBalletSession } from "./studio-display";
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

describe("Ballet end-relative BARRE to CENTER guidance", () => {
  it("selects Ballet by duration with explicit presets taking priority", () => {
    expect(isBalletSession(st(60))).toBe(true);
    expect(isBalletSession(st(45))).toBe(false);
    expect(isBalletSession(st(50))).toBe(false);
    expect(isBalletSession({ ...st(60), presetLabel: "Workout" })).toBe(false);
    expect(isBalletSession({ ...st(45), presetLabel: "Ballet" })).toBe(true);
  });
  it("starts on Barre without changing the start announcement", () => {
    const stage = computeStage(st(60), at("10:01:00"));
    expect(stage.phase).toBe("startclass");
    expect(stage.bgColor).toBe(STAGE_COLORS.green);
    expect(stage.ballet).toEqual({ segment: "barre", switchProgress: 0, centerIntro: false });
  });
  it("rests on Barre with 30 minutes remaining", () => {
    const stage = computeStage(st(60), at("10:30:00"));
    expect(stage.phase).toBe("live");
    expect(stage.bgColor).toBe(STAGE_COLORS.green);
    expect(stage.ballet).toEqual({ segment: "barre", switchProgress: 0, centerIntro: false });
  });
  it("slides evenly over the last minute of Barre while fading green to indigo", () => {
    for (const [time, progress] of [["10:39:00", 0], ["10:39:30", 0.5], ["10:39:59", 59 / 60]] as const) {
      const stage = computeStage(st(60), at(time));
      expect(stage.ballet?.switchProgress).toBeCloseTo(progress);
    }
    expect(computeStage(st(60), at("10:38:59")).bgColor).toBe(STAGE_COLORS.green);
    expect(computeStage(st(60), at("10:39:00")).bgColor).toBe(STAGE_COLORS.green);
    expect(computeStage(st(60), at("10:39:30")).bgColor).toBe(`color-mix(in oklab, ${STAGE_COLORS.green}, ${STAGE_COLORS.indigo} 50.0%)`);
  });
  it("labels Switch to Center for exactly 30 seconds at 20 minutes remaining", () => {
    for (const [time, intro] of [["10:40:00", true], ["10:40:29", true], ["10:40:30", false]] as const) {
      const stage = computeStage(st(60), at(time));
      expect(stage.phase).toBe("live");
      expect(stage.label).toBe(intro ? "Switch to Center" : "Time Remaining");
      expect(stage.bgColor).toBe(STAGE_COLORS.indigo);
      expect(stage.ballet).toEqual({ segment: "center", switchProgress: 1, centerIntro: intro });
    }
    expect(formatMMSS(computeStage(st(60), at("10:40:00")).timerMs)).toBe("20:00");
  });
  it("keeps Center indigo until the existing warning stages", () => {
    for (const [time, phase, color] of [["10:50:00", "live", STAGE_COLORS.indigo], ["10:55:00", "warn5", STAGE_COLORS.yellow], ["10:59:00", "warn1", STAGE_COLORS.orange], ["10:59:30", "final30", STAGE_COLORS.red]] as const) {
      const stage = computeStage(st(60), at(time));
      expect(stage.phase).toBe(phase);
      expect(stage.bgColor).toBe(color);
      expect(stage.ballet?.segment).toBe("center");
    }
  });
  it("omits the switch outside the running class", () => {
    for (const time of ["09:45:00", "10:00:55", "11:00:00", "11:05:00"]) {
      expect(computeStage(st(60), at(time))).not.toHaveProperty("ballet");
    }
  });
  it("leaves Workout and all other non-Ballet stages unchanged", () => {
    for (const duration of [45, 50, 60]) {
      const state = { ...st(duration), presetLabel: duration === 60 ? "Workout" : "" };
      for (let seconds = -60; seconds <= duration * 60 + 300; seconds += 15) {
        const stage = computeStage(state, new Date(at("10:00:00").getTime() + seconds * 1000));
        expect(stage).not.toHaveProperty("ballet");
        expect(stage.bgColor).not.toBe(STAGE_COLORS.indigo);
      }
    }
  });
});
