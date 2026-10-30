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
vi.mock("jspdf", () => {
  class FakeDoc {
    internal = { pageSize: { getWidth: () => 595.28 } };
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    setFillColor() {}
    circle() {}
    text() {}
    save() {}
  }
  return { default: FakeDoc, jsPDF: FakeDoc };
});

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

  it("draws exactly two tables: the top summary and the shift table", () => {
    expect(autoTableCalls).toHaveLength(2);
  });

  it("summary sits in the header, right-aligned beside the title", () => {
    const summary = autoTableCalls[0];
    // startY above the main table's 120, and pinned to the right margin.
    expect(summary).toMatchObject({ startY: 42 });
    expect((summary as { margin?: { left?: number } }).margin!.left).toBeGreaterThan(200);
  });

  it("summary lists Day, Night, Weekend with actual and rounded hours", () => {
    const summary = autoTableCalls[0];
    expect(summary.head).toEqual([["", "Category", "Actual Hours", "Rounded"]]);
    expect(summary.body).toEqual([
      ["", "Day", "12h 44m", "12.5"],
      ["", "Night", "0h 00m", "0.0"],
      ["", "Weekend", "0h 00m", "0.0"],
    ]);
  });

  it("summary footer shows the emphasised Total row", () => {
    const summary = autoTableCalls[0];
    expect(summary.foot).toEqual([["", "Total", "12h 44m", "12.5"]]);
  });

  it("summary is not repeated at the bottom of the report", () => {
    const main = autoTableCalls[1];
    expect(JSON.stringify(main.head)).not.toContain("Category");
    expect(main.head).toEqual([["Date", "Scheduled", "Check In", "Check Out", "Worked", "Notes"]]);
  });

  it("shows the shift's own note and a dash when there is none", () => {
    const body = autoTableCalls[1].body!;
    expect(body[0][5]).toBe("—");
    expect(body[1][5]).toContain("deep clean");
    expect(body[1][5]).not.toBe(body[0][5]);
  });

  it("lets notes wrap instead of truncating them", () => {
    expect(autoTableCalls[1].styles).toMatchObject({ overflow: "linebreak" });
  });
});
