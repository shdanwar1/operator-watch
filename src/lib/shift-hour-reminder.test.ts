import { describe, expect, it } from "vitest";
import { planShiftHourReminders } from "./shift-hour-reminder";
import { leaveHomeKey, startCheckInKey, startReminderKey } from "./push-keys";

const ops = new Map([["alex", "operator-a"], ["max", "operator-b"]]);
const shift = {
  id: "shift-a", assigned_operator: "Alex", specific_date: "2026-10-16",
  start_time: "19:00", status: "assigned",
};
const at = new Date("2026-10-16T16:00:00Z");

describe("one-hour shift reminders", () => {
  it("replaces the morning reminder with exactly one hour before start", () => {
    const jobs = planShiftHourReminders(at, ops, [shift]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].at.toISOString()).toBe("2026-10-16T16:00:00.000Z");
    expect(jobs[0].body).toBe("Your shift starts at 19:00 — one hour from now.");
    expect(planShiftHourReminders(new Date("2026-10-16T07:00:00Z"), ops, [shift])).toEqual([]);
  });
  it("has independent idempotent keys for each shift and operator", () => {
    const shifts = [shift, { ...shift, id: "shift-b", assigned_operator: "Max" }];
    const first = planShiftHourReminders(at, ops, shifts);
    expect(first).toHaveLength(2);
    expect(new Set(first.map((j) => j.key)).size).toBe(2);
    expect(first.map((j) => j.operatorId)).toEqual(["operator-a", "operator-b"]);
    expect(planShiftHourReminders(new Date(at.getTime() + 60_000), ops, shifts).map((j) => j.key))
      .toEqual(first.map((j) => j.key));
  });
  it("keeps multiple shifts for the same operator separate", () => {
    expect(planShiftHourReminders(at, ops, [shift, { ...shift, id: "shift-b", start_time: "19:01" }])).toHaveLength(2);
  });
  it("uses distinct keys from the three preserved notifications", () => {
    const job = planShiftHourReminders(at, ops, [shift])[0];
    const start = new Date(job.shiftStartMs);
    expect(new Set([job.key, startReminderKey(shift.id, start), startCheckInKey(shift.id, start), leaveHomeKey(shift.id, start)]).size).toBe(4);
  });
  it("handles tomorrow's midnight shift before the Berlin day changes", () => {
    const jobs = planShiftHourReminders(new Date("2026-10-16T21:30:00Z"), ops,
      [{ ...shift, specific_date: "2026-10-17", start_time: "00:30" }]);
    expect(jobs[0].at.toISOString()).toBe("2026-10-16T21:30:00.000Z");
  });
  it.each([
    ["2026-10-24", "16:00:00"], ["2026-10-26", "17:00:00"],
  ])("handles Berlin DST on %s", (date, utc) => {
    const now = new Date(`${date}T${utc}Z`);
    const jobs = planShiftHourReminders(now, ops, [{ ...shift, specific_date: date }]);
    expect(jobs[0].at.getTime()).toBe(now.getTime());
    expect(jobs[0].shiftStartMs - now.getTime()).toBe(60 * 60_000);
  });
  it("ignores cancelled, unassigned and inactive/unknown operators", () => {
    expect(planShiftHourReminders(at, ops, [
      { ...shift, status: "cancelled" }, { ...shift, assigned_operator: null },
      { ...shift, assigned_operator: "Inactive" },
    ])).toEqual([]);
  });
  it("retains the retry window but excludes stale reminders", () => {
    expect(planShiftHourReminders(new Date(at.getTime() - 60_000), ops, [shift])).toHaveLength(1);
    expect(planShiftHourReminders(new Date(at.getTime() - 60_001), ops, [shift])).toEqual([]);
    expect(planShiftHourReminders(new Date(at.getTime() + 15 * 60_000), ops, [shift])).toHaveLength(1);
    expect(planShiftHourReminders(new Date(at.getTime() + 15 * 60_000 + 1), ops, [shift])).toEqual([]);
  });
  it("handles retiming and assignment normalization", () => {
    const first = planShiftHourReminders(at, ops, [shift])[0];
    const retimed = { ...shift, assigned_operator: " ALEX ", start_time: "19:01" };
    expect(planShiftHourReminders(at, ops, [retimed])[0].key).not.toBe(first.key);
  });
});