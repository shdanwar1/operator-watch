import { describe, expect, it } from "vitest";
import { autoCheckoutAt, scheduledEndAt } from "./auto-checkout";

const sched = { specific_date: "2026-10-05", start_time: "18:30:00", end_time: "22:30:00" };
const end = scheduledEndAt(sched);
const snap = (doneAt: string | null, completed = true) => ({
  start: { items: [] },
  classes: [],
  end: {
    items: [
      { id: "a", text: "A", completed: true, completedAt: "2026-10-05T18:00:00Z" },
      { id: "b", text: "B", completed, completedAt: doneAt },
    ],
  },
});

describe("auto check-out", () => {
  it("scheduled end is Berlin time (CEST)", () => {
    expect(end.toISOString()).toBe("2026-10-05T20:30:00.000Z");
  });
  const at = (now: string, cl = snap("2026-10-05T20:20:00Z"), out: string | null = null) =>
    autoCheckoutAt({ checkOutAt: out, checklists: cl, scheduledEnd: end, now: new Date(now) });
  it("due exactly at end → checks out at scheduled end", () => {
    expect(at("2026-10-05T20:30:00Z")?.toISOString()).toBe(end.toISOString());
  });
  it("due within catch-up window", () => {
    expect(at("2026-10-05T20:34:00Z")?.toISOString()).toBe(end.toISOString());
  });
  it("not before end", () => {
    expect(at("2026-10-05T20:29:00Z")).toBeNull();
  });
  it("old shift after window is ignored", () => {
    expect(at("2026-10-05T20:40:00Z")).toBeNull();
  });
  it("incomplete checklist → stays open", () => {
    expect(at("2026-10-05T20:30:00Z", snap(null, false))).toBeNull();
  });
  it("already checked out → nothing", () => {
    expect(at("2026-10-05T20:30:00Z", undefined, "2026-10-05T20:27:00Z")).toBeNull();
  });
  it("real HH:MM completion times still check out at end", () => {
    expect(at("2026-10-05T20:30:00Z", snap("22:26"))?.toISOString()).toBe(end.toISOString());
  });
  it("overnight shift ends next day", () => {
    expect(scheduledEndAt({ specific_date: "2026-10-05", start_time: "22:00", end_time: "02:00" }).toISOString()).toBe("2026-10-06T00:00:00.000Z");
  });
  it("DST end day uses winter offset", () => {
    expect(scheduledEndAt({ specific_date: "2026-10-25", start_time: "18:30", end_time: "22:30" }).toISOString()).toBe("2026-10-25T21:30:00.000Z");
  });
});
