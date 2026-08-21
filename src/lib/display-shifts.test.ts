import { describe, expect, it } from "vitest";
import { resolveCheckInTarget } from "./display-shifts";
import type { ScheduledShiftRow } from "./shifts.functions";

function row(date: string, start: string, end: string, id = `${date}-${start}`) {
  return {
    id,
    specific_date: date,
    day_of_week: new Date(`${date}T00:00:00`).getDay(),
    start_time: start,
    end_time: end,
    label: null,
    assigned_operator: "Shad",
    status: "assigned",
    notes: null,
    external_event_id: null,
    created_at: new Date().toISOString(),
  } as unknown as ScheduledShiftRow;
}

const shifts = [row("2026-08-21", "19:00", "21:30"), row("2026-08-21", "23:30", "02:00")];
const at = (iso: string) => new Date(iso);

describe("resolveCheckInTarget", () => {
  it("shows the running shift", () => {
    expect(resolveCheckInTarget(shifts, at("2026-08-21T20:00"))?.startAt.getHours()).toBe(19);
  });

  it("ignores an ended shift and picks the next within 2h", () => {
    const t = resolveCheckInTarget(shifts, at("2026-08-21T22:00"));
    expect(t?.startAt.getHours()).toBe(23);
    expect(resolveCheckInTarget(shifts, at("2026-08-21T23:00"))?.startAt.getHours()).toBe(23);
  });

  it("treats the exact end time as expired", () => {
    expect(resolveCheckInTarget(shifts, at("2026-08-21T21:29:59"))?.startAt.getHours()).toBe(19);
    expect(resolveCheckInTarget(shifts, at("2026-08-21T21:30:00"))?.startAt.getHours()).toBe(23);
  });

  it("returns null when the next shift is more than 2h away", () => {
    expect(resolveCheckInTarget([row("2026-08-21", "19:00", "21:30")], at("2026-08-21T10:00"))).toBe(
      null,
    );
  });

  it("keeps a midnight-crossing shift active past midnight", () => {
    expect(resolveCheckInTarget(shifts, at("2026-08-22T01:00"))?.startAt.getHours()).toBe(23);
    expect(resolveCheckInTarget(shifts, at("2026-08-22T02:00"))).toBe(null);
  });
});
