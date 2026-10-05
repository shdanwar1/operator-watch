import { describe, expect, it } from "vitest";
import { autoCheckoutAt, autoCheckoutEnabled, scheduledEndAt } from "./auto-checkout";

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
  it("completed before end → at scheduled end", () => {
    const at = autoCheckoutAt({ checkOutAt: null, checklists: snap("2026-10-05T20:20:00Z"), scheduledEnd: end, enabled: true });
    expect(at?.toISOString()).toBe(end.toISOString());
  });
  it("completed exactly at end → at scheduled end", () => {
    const at = autoCheckoutAt({ checkOutAt: null, checklists: snap(end.toISOString()), scheduledEnd: end, enabled: true });
    expect(at?.toISOString()).toBe(end.toISOString());
  });
  it("completed after end → +10 minutes", () => {
    const at = autoCheckoutAt({ checkOutAt: null, checklists: snap("2026-10-05T20:36:00Z"), scheduledEnd: end, enabled: true });
    expect(at?.toISOString()).toBe("2026-10-05T20:46:00.000Z");
  });
  it("incomplete → never", () => {
    expect(autoCheckoutAt({ checkOutAt: null, checklists: snap(null, false), scheduledEnd: end, enabled: true })).toBeNull();
  });
  it("switch off → never", () => {
    expect(autoCheckoutAt({ checkOutAt: null, checklists: snap("2026-10-05T20:20:00Z"), scheduledEnd: end, enabled: false })).toBeNull();
  });
  it("already checked out → never", () => {
    expect(autoCheckoutAt({ checkOutAt: "2026-10-05T20:27:00Z", checklists: snap("2026-10-05T20:20:00Z"), scheduledEnd: end, enabled: true })).toBeNull();
  });
  it("overnight shift ends next day", () => {
    expect(scheduledEndAt({ specific_date: "2026-10-05", start_time: "22:00", end_time: "02:00" }).toISOString()).toBe("2026-10-06T00:00:00.000Z");
  });
  it("DST end day uses winter offset", () => {
    expect(scheduledEndAt({ specific_date: "2026-10-25", start_time: "18:30", end_time: "22:30" }).toISOString()).toBe("2026-10-25T21:30:00.000Z");
  });
  it("preference defaults to on", () => {
    expect(autoCheckoutEnabled({})).toBe(true);
    expect(autoCheckoutEnabled({ autoCheckout: false })).toBe(false);
  });
});
