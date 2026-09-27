import { describe, it, expect } from "vitest";
import { planDailyReminders, dailyReminderKey, berlinDateKey, type DailyShift } from "./daily-reminder";
import { startReminderKey, startCheckInKey, leaveHomeKey } from "./push-keys";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const ops = new Map([
  ["alex", A],
  ["max", B],
]);
// 2026-09-28 09:00 Berlin (CEST) = 07:00Z
const nine = new Date("2026-09-28T07:00:00Z");
const shift = (p: Partial<DailyShift>): DailyShift => ({
  id: Math.random().toString(),
  assigned_operator: "Alex",
  specific_date: "2026-09-28",
  start_time: "09:30",
  status: "assigned",
  created_at: "2026-09-20T10:00:00Z",
  ...p,
});

describe("daily 09:00 reminder", () => {
  it("one shift today → one notification at 09:00 Berlin", () => {
    const jobs = planDailyReminders(nine, ops, [shift({})]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].body).toBe("Good morning — you have a shift today at 09:30.");
    expect(jobs[0].at.toISOString()).toBe(nine.toISOString());
  });
  it("no shift → nothing", () => {
    expect(planDailyReminders(nine, ops, [])).toHaveLength(0);
  });
  it("multiple shifts → exactly one notification mentioning first", () => {
    const jobs = planDailyReminders(nine, ops, [
      shift({ start_time: "18:00" }),
      shift({ start_time: "09:30" }),
      shift({ start_time: "13:00" }),
    ]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].body).toBe("Good morning — you have 3 shifts today. Your first shift starts at 09:30.");
  });
  it("cancelled only → nothing", () => {
    expect(planDailyReminders(nine, ops, [shift({ status: "cancelled" })])).toHaveLength(0);
  });
  it("repeated runs produce the same idempotent key", () => {
    const a = planDailyReminders(nine, ops, [shift({})]);
    const b = planDailyReminders(new Date(nine.getTime() + 60_000), ops, [shift({})]);
    expect(a[0].key).toBe(b[0].key);
    expect(a[0].key).toBe(dailyReminderKey(A, "2026-09-28"));
  });
  it("uses the Berlin date, not UTC", () => {
    // 23:30Z on Sep 27 is already Sep 28 in Berlin
    expect(berlinDateKey(new Date("2026-09-27T23:30:00Z"))).toBe("2026-09-28");
    // 09:00 UTC is 11:00 Berlin → outside window
    expect(planDailyReminders(new Date("2026-09-28T09:00:00Z"), ops, [shift({})])).toHaveLength(0);
    // winter time: 09:00 Berlin (CET) = 08:00Z
    expect(
      planDailyReminders(new Date("2026-12-01T08:00:00Z"), ops, [shift({ specific_date: "2026-12-01" })]),
    ).toHaveLength(1);
  });
  it("shift added after 09:00 is not sent retroactively", () => {
    const later = new Date(nine.getTime() + 5 * 60_000);
    expect(
      planDailyReminders(later, ops, [shift({ created_at: new Date(nine.getTime() + 60_000).toISOString() })]),
    ).toHaveLength(0);
  });
  it("operators are handled independently", () => {
    const jobs = planDailyReminders(nine, ops, [shift({}), shift({ assigned_operator: "Max", start_time: "14:00" })]);
    expect(jobs.map((j) => j.operatorId).sort()).toEqual([A, B].sort());
    expect(new Set(jobs.map((j) => j.key)).size).toBe(2);
  });
  it("does not collide with the three per-shift notification keys", () => {
    const start = new Date("2026-09-28T07:30:00Z");
    const key = planDailyReminders(nine, ops, [shift({})])[0].key;
    for (const k of [startReminderKey("x", start), startCheckInKey("x", start), leaveHomeKey("x", start)]) {
      expect(k).not.toBe(key);
      expect(k.startsWith("daily_shift_reminder:")).toBe(false);
    }
  });
});
