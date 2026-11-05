import { describe, expect, it } from "vitest";
import { buildAttendanceRows, payrollBuckets, summarizeMonth, sundayMinutes } from "@/lib/attendance";
import { roundedPayrollHours } from "@/lib/attendance-pdf";
import type { ShiftRow } from "@/lib/shifts.functions";

const iso = (s: string) => new Date(s);
// Berlin is UTC+2 until 25 Oct 2026 03:00, then UTC+1.
describe("sundayMinutes (Europe/Berlin)", () => {
  it("Sun 11:00–16:00 → 5h", () =>
    expect(sundayMinutes(iso("2026-10-04T09:00:00Z"), iso("2026-10-04T14:00:00Z"))).toBe(300));
  it("Sat 23:00 → Sun 02:00 → 2h", () =>
    expect(sundayMinutes(iso("2026-10-03T21:00:00Z"), iso("2026-10-04T00:00:00Z"))).toBe(120));
  it("Sun 22:00 → Mon 01:00 → 2h", () =>
    expect(sundayMinutes(iso("2026-10-04T20:00:00Z"), iso("2026-10-04T23:00:00Z"))).toBe(120));
  it("weekday → 0", () =>
    expect(sundayMinutes(iso("2026-10-06T10:00:00Z"), iso("2026-10-06T15:00:00Z"))).toBe(0));
  it("DST Sunday 25 Oct counts real elapsed time (Berlin 01:00–05:00 = 5h)", () =>
    expect(sundayMinutes(iso("2026-10-24T23:00:00Z"), iso("2026-10-25T04:00:00Z"))).toBe(300));
  it("cuts at the period end", () =>
    expect(
      sundayMinutes(iso("2026-05-31T20:00:00Z"), iso("2026-06-01T00:00:00Z"), undefined, iso("2026-05-31T21:00:00Z")),
    ).toBe(60));
});

function shift(id: string, inAt: string, outAt: string, sched: string | null = "ss"): ShiftRow {
  return { id, operator_name: "Shad", check_in_at: inAt, check_out_at: outAt, scheduled_shift_id: sched, classes: [], notes: null } as unknown as ShiftRow;
}

describe("dots share the totals classification", () => {
  const shifts = [
    shift("a", "2026-10-02T05:30:00Z", "2026-10-02T11:00:00Z"), // Fri day
    shift("b", "2026-10-04T16:00:00Z", "2026-10-04T21:00:00Z"), // Sun 18–23 weekend
    shift("c", "2026-10-06T18:00:00Z", "2026-10-07T01:30:00Z"), // Tue evening into Wed small hours: day+night
    shift("d", "2026-10-14T10:00:00Z", "2026-10-14T11:30:00Z", null), // unscheduled
  ];
  const summary = summarizeMonth(shifts, [], new Date(2026, 9, 1));

  it("bucket per row equals the minutes counted into the totals", () => {
    for (const r of summary.rows) {
      const b = payrollBuckets(r);
      expect(b.includes("day")).toBe(r.dayMin > 0);
      expect(b.includes("night")).toBe(r.nightMin > 0);
      expect(b.includes("weekend")).toBe(r.weekendMin > 0);
    }
    expect(payrollBuckets(summary.rows[2])).toEqual(["day", "night"]);
    expect(payrollBuckets(summary.rows[1])).toEqual(["weekend"]);
  });

  it("Sunday is a sub-line: Total stays Day + Night + Weekend", () => {
    expect(summary.sundayMin).toBe(300);
    expect(roundedPayrollHours(summary.sundayMin)).toBe("5.0");
    expect(summary.workedMin).toBe(summary.dayMin + summary.nightMin + summary.weekendMin);
    expect(buildAttendanceRows(shifts, []).reduce((a, r) => a + r.workedMin, 0)).toBe(summary.workedMin);
  });
});

import { shiftTypeCategories } from "@/lib/attendance";
describe("dashboard shift-type dots", () => {
  const at = (y: number, m: number, d: number, h: number, mi = 0) => new Date(y, m - 1, d, h, mi);
  it("Fri 19:00–21:30 → Day", () => expect(shiftTypeCategories(at(2026, 11, 6, 19), at(2026, 11, 6, 21, 30))).toEqual(["day"]));
  it("Mon 21:00–Tue 02:00 → Night", () => expect(shiftTypeCategories(at(2026, 11, 9, 21), at(2026, 11, 10, 2))).toEqual(["night"]));
  it("Fri 23:30–Sat 02:00 → Weekend + Night", () => expect(shiftTypeCategories(at(2026, 11, 6, 23, 30), at(2026, 11, 7, 2))).toEqual(["weekend", "night"]));
  it("Sat 10:00–14:00 → Weekend", () => expect(shiftTypeCategories(at(2026, 11, 7, 10), at(2026, 11, 7, 14))).toEqual(["weekend"]));
});
