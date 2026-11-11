import { describe, expect, it } from "vitest";
import { maxCheckoutAt } from "./auto-checkout";

describe("12-hour shift limit", () => {
  it("closes 12 hours after check-in", () => {
    // 07:36 Berlin (CET) -> 19:36 Berlin
    expect(maxCheckoutAt(new Date("2026-11-10T06:36:00Z")).toISOString()).toBe("2026-11-10T18:36:00.000Z");
  });
  it("pulls back to 02:59 Berlin when 12h lands in 03:00-05:00", () => {
    // 16:00 Berlin -> 04:00 Berlin, capped at 02:59 Berlin (01:59Z)
    expect(maxCheckoutAt(new Date("2026-11-10T15:00:00Z")).toISOString()).toBe("2026-11-11T01:59:00.000Z");
  });
  it("05:00 Berlin is outside the quiet window", () => {
    expect(maxCheckoutAt(new Date("2026-11-10T16:00:00Z")).toISOString()).toBe("2026-11-11T04:00:00.000Z");
  });
});
