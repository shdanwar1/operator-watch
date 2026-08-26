import { describe, expect, it } from "vitest";
import { assertCanCheckOut } from "./checkout-validation";

function openShift(checkIn: string) {
  return { check_in_at: checkIn, check_out_at: null };
}

describe("checkout validation", () => {
  it.each([
    ["normal checkout", "2026-08-25T18:00:00Z", "2026-08-25T22:00:00Z"],
    ["early checkout", "2026-08-25T18:00:00Z", "2026-08-25T20:00:00Z"],
    ["very early checkout", "2026-08-25T18:00:00Z", "2026-08-25T18:15:00Z"],
    ["midnight shift early checkout", "2026-08-25T23:30:00Z", "2026-08-26T00:45:00Z"],
  ])("allows %s", (_label, checkIn, checkout) => {
    expect(() => assertCanCheckOut(openShift(checkIn), new Date(checkout))).not.toThrow();
  });

  it("rejects an already completed shift", () => {
    expect(() =>
      assertCanCheckOut(
        { check_in_at: "2026-08-25T18:00:00Z", check_out_at: "2026-08-25T20:00:00Z" },
        new Date("2026-08-25T20:01:00Z"),
      ),
    ).toThrow("already checked out");
  });

  it("rejects checkout before check-in", () => {
    expect(() =>
      assertCanCheckOut(openShift("2026-08-25T18:00:00Z"), new Date("2026-08-25T17:59:00Z")),
    ).toThrow("Invalid attendance record");
  });
});