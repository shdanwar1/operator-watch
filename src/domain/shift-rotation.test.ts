import { describe, expect, it } from "vitest";
import { classifyClass, DEFAULT_ROTATION, planTimetableShifts, rotationForMonth } from "./shift-rotation";
import type { DmcTimetableSlot } from "./timetable";

const slot = (id: string, day: number, start: string, dur = 60): DmcTimetableSlot => ({
  sourceSlotId: id, sourceClassId: "c", sourceInstructorId: "i", dayLocal: day as never,
  scheduleKey: "x", startTimeLocal: start, durationMinutes: dur, active: true, resumesOn: null,
});

describe("classifyClass", () => {
  it("Mon–Thu before 21:00 is day", () => {
    expect(classifyClass(1, "17:00")).toBe("day");
    expect(classifyClass(4, "20:59")).toBe("day");
  });
  it("Mon–Thu from 21:00 and after midnight is night", () => {
    expect(classifyClass(2, "21:00")).toBe("night");
    expect(classifyClass(3, "01:00")).toBe("night");
  });
  it("Friday morning is weekend, Friday evening is night even before 21:00", () => {
    expect(classifyClass(5, "09:00")).toBe("weekend");
    expect(classifyClass(5, "18:00")).toBe("night");
  });
  it("Friday after midnight belongs to Thursday night", () => {
    expect(classifyClass(5, "01:00")).toBe("night");
  });
  it("Saturday and Sunday are weekend", () => {
    expect(classifyClass(6, "10:00")).toBe("weekend");
    expect(classifyClass(0, "22:00")).toBe("weekend");
  });
});

describe("rotationForMonth", () => {
  it("Oct 2026: Shad day, Alex night, Victor weekend", () => {
    expect(rotationForMonth(DEFAULT_ROTATION, "2026-10")).toEqual({ day: "Shad", night: "Alex", weekend: "Victor" });
  });
  it("Nov 2026: Victor day, Shad night, Alex weekend", () => {
    expect(rotationForMonth(DEFAULT_ROTATION, "2026-11")).toEqual({ day: "Victor", night: "Shad", weekend: "Alex" });
  });
  it("Dec 2026: Alex day, Victor night, Shad weekend; Jan 2027 cycles back", () => {
    expect(rotationForMonth(DEFAULT_ROTATION, "2026-12")).toEqual({ day: "Alex", night: "Victor", weekend: "Shad" });
    expect(rotationForMonth(DEFAULT_ROTATION, "2027-01")).toEqual({ day: "Shad", night: "Alex", weekend: "Victor" });
  });
});

describe("planTimetableShifts", () => {
  it("groups day classes and assigns the month's day operator", () => {
    // 2026-10-19 is a Monday.
    const plan = planTimetableShifts({
      slots: [slot("a", 1, "17:00"), slot("b", 1, "18:00"), slot("n", 1, "21:00")],
      from: "2026-10-19", to: "2026-10-19", rotation: DEFAULT_ROTATION,
    });
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ bucket: "day", startTime: "16:30:00", endTime: "19:15:00", operator: "Shad" });
    expect(plan[1]).toMatchObject({ bucket: "night", startTime: "20:30:00", operator: "Alex" });
  });
});
