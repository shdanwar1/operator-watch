import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttendanceSummary } from "@/lib/attendance";

// Capture every autoTable call so we can assert on the exact table content
// the real generator produces, without needing a browser download.
type AutoTableCall = {
  head?: unknown[][];
  body?: unknown[][];
  foot?: unknown[][];
  columnStyles?: Record<string, unknown>;
  styles?: Record<string, unknown>;
};
const autoTableCalls: AutoTableCall[] = [];
vi.mock("jspdf-autotable", () => ({
  default: (_doc: unknown, opts: AutoTableCall) => {
    autoTableCalls.push(opts);
  },
}));
vi.mock("jspdf", () => ({
  jsPDF: class {
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    text() {}
    save() {}
  },
}));

import { downloadAttendancePdf, roundedPayrollHours } from "@/lib/attendance-pdf";

// Rounding thresholds from the Attendance PDF spec: applied once to the
// aggregated total worked minutes, never per shift.
describe("roundedPayrollHours", () => {
  it.each([
    [12 * 60 + 10, "12.0"], // 0–14 min → down
    [12 * 60 + 14, "12.0"],
    [12 * 60 + 15, "12.5"], // 15–44 min → half hour
    [12 * 60 + 16, "12.5"],
    [12 * 60 + 30, "12.5"],
    [12 * 60 + 44, "12.5"],
    [12 * 60 + 45, "13.0"], // 45–59 min → up
    [12 * 60 + 50, "13.0"],
    [143 * 60 + 33, "143.5"], // reference month total
  ])("rounds %d minutes to %s", (mins, expected) => {
    expect(roundedPayrollHours(mins)).toBe(expected);
  });

  it("never goes below zero", () => {
    expect(roundedPayrollHours(0)).toBe("0.0");
    expect(roundedPayrollHours(-120)).toBe("0.0");
  });

  it("aggregates before rounding (no per-shift rounding)", () => {
    // Two shifts of 12h14m each: per-shift rounding would give 12.0+12.0=24.0,
    // but the aggregated 24h28m rounds to 24.5.
    const total = 2 * (12 * 60 + 14);
    expect(roundedPayrollHours(total)).toBe("24.5");
  });
});

function sampleSummary(): AttendanceSummary {
  const mk = (over: Partial<AttendanceSummary["rows"][number]>) => ({
    id: "s1",
    operator_name: "Shad",
    date: new Date(2026, 9, 2, 14, 30),
    checkIn: new Date(2026, 9, 2, 14, 25),
    checkOut: new Date(2026, 9, 2, 21, 40),
    workedMin: 435,
    dayMin: 435,
    nightMin: 0,
    weekendMin: 0,
    primary: "day" as const,
    categories: ["day" as const],
    scheduledStart: new Date(2026, 9, 2, 14, 30),
    scheduledEnd: new Date(2026, 9, 2, 21, 30),
    scheduledMin: 420,
    diffMin: 15,
    classes: [],
    notes: null,
    scheduled_shift_id: "ss1",
    ...over,
  });
  return {
    monthKey: "2026-10",
    monthLabel: "October 2026",
    rows: [
      mk({}),
      mk({
        id: "s2",
        notes:
          "Stayed 40 minutes late to cover the evening deep clean and hand over " +
          "keys to the night operator because Victor's train was cancelled.",
      }),
    ],
    workedMin: 12 * 60 + 44,
    scheduledMin: 840,
    dayMin: 12 * 60 + 44,
    nightMin: 0,
    weekendMin: 0,
  };
}

describe("downloadAttendancePdf layout", () => {
  beforeEach(() => {
    autoTableCalls.length = 0;
    downloadAttendancePdf(sampleSummary(), "Shad");
  });

  it("uses exactly the six required columns, in order", () => {
    const head = autoTableCalls[0].head![0];
    expect(head).toEqual(["Date", "Scheduled", "Check In", "Check Out", "Worked", "Notes"]);
  });

  it("shows the shift's own note and a dash when there is none", () => {
    const body = autoTableCalls[0].body!;
    expect(body[0][5]).toBe("—");
    expect(body[1][5]).toContain("deep clean");
    expect(body[1][5]).not.toBe(body[0][5]);
  });

  it("lets notes wrap instead of truncating them", () => {
    expect(autoTableCalls[0].styles).toMatchObject({ overflow: "linebreak" });
  });

  it("summary shows only Total Worked Hours and Rounded Payroll Hours", () => {
    const summary = autoTableCalls[1];
    expect(summary.body).toEqual([
      ["Total Worked Hours", "12h 44m"],
      ["Rounded Payroll Hours", "12.5"],
    ]);
    const flat = JSON.stringify(summary.body);
    expect(flat).not.toMatch(/Daytime|Night|Weekend/);
  });
});
