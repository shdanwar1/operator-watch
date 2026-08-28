import { describe, expect, it } from "vitest";
import {
  eventDurationMinutes,
  isValidDanceMasterclassClass,
  type EligibilityEvent,
} from "./class-eligibility";

const ev = (over: Partial<EligibilityEvent>): EligibilityEvent => ({
  summary: "Back to Basics - Marco",
  specific_date: "2026-08-27",
  start_time: "18:00:00",
  end_time: "18:45:00",
  status: "confirmed",
  allDay: false,
  ...over,
});

const evidence = { classId: "c1", teacherId: "t1" };

describe("isValidDanceMasterclassClass", () => {
  it("rejects all-day events regardless of title or metadata", () => {
    const v = isValidDanceMasterclassClass(
      ev({ summary: "Limon Shoot", allDay: true, end_time: "18:45:00" }),
      evidence,
    );
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("all-day event");
  });

  it("accepts an exact 45-minute class as Workout", () => {
    const v = isValidDanceMasterclassClass(ev({}), evidence);
    expect(v.valid).toBe(true);
    expect(v.classType).toBe("Workout");
  });

  it("accepts an exact 60-minute class as Ballet", () => {
    const v = isValidDanceMasterclassClass(
      ev({ summary: "Ballet Class", start_time: "19:00:00", end_time: "20:00:00" }),
      evidence,
    );
    expect(v.valid).toBe(true);
    expect(v.classType).toBe("Ballet");
  });

  it("rejects a 30-minute event", () => {
    const v = isValidDanceMasterclassClass(ev({ end_time: "18:30:00" }), evidence);
    expect(v.valid).toBe(false);
    expect(v.reason).toContain("30 minutes");
  });

  it("rejects a 90-minute event", () => {
    const v = isValidDanceMasterclassClass(ev({ end_time: "19:30:00" }), evidence);
    expect(v.valid).toBe(false);
    expect(v.reason).toContain("90 minutes");
  });

  it("rejects a 45-minute event with no studio-class evidence", () => {
    const v = isValidDanceMasterclassClass(ev({ summary: "Dentist" }), {});
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("not identified as a studio class");
  });

  it("accepts an untitled busy block of exactly 60 minutes", () => {
    const v = isValidDanceMasterclassClass(
      ev({ summary: "Busy", end_time: "19:00:00" }),
      {},
    );
    expect(v.valid).toBe(true);
  });

  it("rejects cancelled events", () => {
    const v = isValidDanceMasterclassClass(ev({ status: "cancelled" }), evidence);
    expect(v.valid).toBe(false);
  });

  it("measures duration across midnight", () => {
    expect(
      eventDurationMinutes(ev({ start_time: "23:30:00", end_time: "00:15:00" })),
    ).toBe(45);
    const v = isValidDanceMasterclassClass(
      ev({ start_time: "23:30:00", end_time: "00:15:00" }),
      evidence,
    );
    expect(v.valid).toBe(true);
  });

  it("is deterministic for the same input", () => {
    const e = ev({});
    expect(isValidDanceMasterclassClass(e, evidence)).toEqual(
      isValidDanceMasterclassClass(e, evidence),
    );
  });
});
