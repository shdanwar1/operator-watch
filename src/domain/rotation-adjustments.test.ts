import { describe, expect, it } from "vitest";
import { DEFAULT_ROTATION, planTimetableShifts, resolveClassOperator } from "./shift-rotation";
import { adjustmentSchema, missingAdjustmentSeeds, NOVEMBER_ADJUSTMENTS, validateAdjustment } from "./rotation-adjustments";
import type { DmcTimetableSlot } from "./timetable";

const resolve = (date: string, startTime: string) => resolveClassOperator({ date, startTime, rotation: DEFAULT_ROTATION, adjustments: NOVEMBER_ADJUSTMENTS });
describe("November acceptance table", () => {
  it.each([
    ["2026-10-29", "14:00", "day", "Shad"], ["2026-10-29", "20:59", "day", "Shad"],
    ["2026-10-30", "09:00", "weekend", "Victor"], ["2026-10-30", "21:30", "night", "Alex"],
    ["2026-10-31", "00:00", "night", "Alex"], ["2026-10-31", "01:45", "night", "Alex"], ["2026-10-31", "14:00", "weekend", "Victor"],
    ["2026-11-01", "16:00", "weekend", "Victor"], ["2026-11-01", "17:15", "weekend", "Victor"], ["2026-11-01", "18:29", "weekend", "Victor"], ["2026-11-01", "18:30", "weekend", "Alex"], ["2026-11-01", "21:45", "weekend", "Alex"],
    ["2026-11-02", "15:00", "day", "Victor"], ["2026-11-02", "21:30", "night", "Shad"],
    ["2026-11-03", "08:00", "day", "Victor"], ["2026-11-03", "09:00", "day", "Victor"], ["2026-11-03", "11:59", "day", "Victor"], ["2026-11-03", "12:00", "day", "Alex"], ["2026-11-03", "12:30", "day", "Alex"], ["2026-11-03", "20:15", "day", "Alex"], ["2026-11-03", "20:59", "day", "Alex"], ["2026-11-03", "21:00", "night", "Shad"],
    ["2026-11-04", "14:30", "day", "Victor"], ["2026-11-04", "20:59", "day", "Victor"], ["2026-11-05", "14:00", "day", "Victor"], ["2026-11-05", "20:59", "day", "Victor"], ["2026-11-09", "15:00", "day", "Victor"], ["2026-11-09", "20:59", "day", "Victor"],
    ["2026-11-06", "07:30", "weekend", "Alex"], ["2026-11-06", "10:00", "weekend", "Alex"], ["2026-11-06", "19:00", "night", "Shad"], ["2026-11-07", "14:00", "weekend", "Alex"], ["2026-11-08", "14:00", "weekend", "Alex"],
    ["2026-11-30", "21:00", "night", "Shad"], ["2026-12-01", "00:00", "night", "Shad"], ["2026-12-01", "01:00", "night", "Shad"],
    ["2026-12-01", "08:00", "day", "Alex"], ["2026-12-01", "09:00", "day", "Alex"], ["2026-12-01", "12:30", "day", "Alex"], ["2026-12-01", "21:00", "night", "Victor"],
  ])("%s %s → %s / %s", (date, time, bucket, operator) => {
    expect(resolve(date, time)).toMatchObject({ bucket, operator });
  });
});
const input = { operator: "Alex", validFrom: "2026-11-01T00:00", validUntil: "2026-12-01T00:00", bucket: null, weekday: null, startFrom: null, startTo: null, note: null };
it("validates date ordering and real dates", () => {
  expect(adjustmentSchema.safeParse({ ...input, validUntil: input.validFrom }).success).toBe(false);
  expect(adjustmentSchema.safeParse({ ...input, validFrom: "2026-02-30T00:00" }).success).toBe(false);
});
it("rejects invalid or backwards clock windows", () => {
  expect(adjustmentSchema.safeParse({ ...input, startFrom: "21:00", startTo: "12:00" }).success).toBe(false);
  expect(adjustmentSchema.safeParse({ ...input, startFrom: "25:00" }).success).toBe(false);
});
it("rejects unknown operators", () => { expect(() => validateAdjustment(input, ["Shad"])).toThrow("existing active operator"); });
it("converts Berlin validity to start instants", () => { expect(validateAdjustment(input, ["Alex"]).valid_from).toBe("2026-10-31T23:00:00.000Z"); });
it("seeding twice produces no second rows", () => {
  const first = missingAdjustmentSeeds([]);
  expect(first).toHaveLength(2);
  expect(missingAdjustmentSeeds(first.map((r) => r.id))).toEqual([]);
});
it("newest matching adjustment wins regardless of input order", () => {
  const newer = { ...NOVEMBER_ADJUSTMENTS[0], id: "newer", operator: "Victor", created_at: "2026-10-27T10:00:00Z" };
  expect(resolveClassOperator({ date: "2026-11-03", startTime: "12:30", rotation: DEFAULT_ROTATION, adjustments: [newer, ...NOVEMBER_ADJUSTMENTS] }).operator).toBe("Victor");
});
it("uses class calendar weekday for filters but preceding shift day for month", () => {
  expect(resolve("2026-12-01", "01:00").shiftDay).toBe("2026-11-30");
  const a = { ...NOVEMBER_ADJUSTMENTS[0], bucket: "night" as const, start_from: null, start_to: null, valid_until: "2026-12-02T00:00:00Z" };
  expect(resolveClassOperator({ date: "2026-12-01", startTime: "01:00", rotation: DEFAULT_ROTATION, adjustments: [a] }).operator).toBe("Alex");
});
const slot = (id: string, dayLocal: DmcTimetableSlot["dayLocal"], startTimeLocal: string): DmcTimetableSlot => ({ sourceSlotId: id, sourceClassId: id, sourceInstructorId: "i", scheduleKey: "x", dayLocal, startTimeLocal, durationMinutes: 60, active: true, resumesOn: null });
it("splits the Sunday handover into independently buffered operator shifts", () => {
  const plans = planTimetableShifts({ slots: [slot("r", 0, "17:15"), slot("a", 0, "18:30")], from: "2026-11-01", to: "2026-11-01", rotation: DEFAULT_ROTATION, adjustments: NOVEMBER_ADJUSTMENTS });
  expect(plans.map((p) => [p.operator, p.startTime, p.endTime])).toEqual([["Victor", "16:45:00", "18:30:00"], ["Alex", "18:00:00", "19:45:00"]]);
});
it("groups month-end classes with Shad, not December's night holder", () => {
  const plans = planTimetableShifts({ slots: [slot("m", 1, "23:30"), slot("t", 2, "00:00"), slot("t1", 2, "01:00")], from: "2026-11-30", to: "2026-12-01", rotation: DEFAULT_ROTATION });
  expect(plans).toHaveLength(1);
  expect(plans[0]).toMatchObject({ operator: "Shad", date: "2026-11-30", endTime: "02:15:00" });
  expect(plans[0].classes).toHaveLength(3);
});
it("does not replan frozen class identities", () => {
  const plans = planTimetableShifts({ slots: [slot("a", 1, "15:00")], from: "2026-11-02", to: "2026-11-02", rotation: DEFAULT_ROTATION, excludedClassUids: new Set(["tt:a:2026-11-02"]) });
  expect(plans).toEqual([]);
});
it.each([[4, "14:30"], [4, "15:45"], [5, "21:30"], [5, "22:45"], [6, "18:30"], [6, "19:30"], [0, "16:00"], [0, "17:15"]] as const)("Ruth %s %s produces no November classes after the inclusive cutoff", (day, time) => {
  const ruth = { ...slot("ruth", day, time), activeUntil: "2026-11-01" };
  const plans = planTimetableShifts({ slots: [ruth], from: "2026-11-02", to: "2026-11-30", rotation: DEFAULT_ROTATION, adjustments: NOVEMBER_ADJUSTMENTS });
  expect(plans).toEqual([]);
});