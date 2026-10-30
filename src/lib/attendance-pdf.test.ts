import { describe, expect, it } from "vitest";
import { roundedPayrollHours } from "@/lib/attendance-pdf";

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
