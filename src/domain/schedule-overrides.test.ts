import { describe, expect, it } from "vitest";
import {
  backOnLabel,
  berlinDateOf,
  berlinWallToInstant,
  indexOverrides,
  nextOccurrence,
  normalizeOverrides,
  resolveOccurrence,
  type DmcPreview,
} from "./schedule-overrides";
import { normalizeDmcPayload } from "./timetable-normalize";
import { planTimetableShifts, DEFAULT_ROTATION } from "./shift-rotation";
import type { DmcTimetableSlot } from "./timetable";

const slot = (id: string, day: number, time: string, over: Partial<DmcTimetableSlot> = {}): DmcTimetableSlot => ({
  sourceSlotId: id,
  sourceClassId: "C1",
  sourceInstructorId: "REG",
  dayLocal: day as DmcTimetableSlot["dayLocal"],
  scheduleKey: id,
  startTimeLocal: time,
  durationMinutes: 60,
  active: true,
  resumesOn: null,
  ...over,
});
const instructors = [{ sourceInstructorId: "REG" }, { sourceInstructorId: "SUB" }];
const previews: DmcPreview[] = [{ trailerId: "T-REG", classId: "C1", instructorId: "REG" }];

describe("schedule overrides", () => {
  it("1. Thursday cancellation shows Back on November 5", () => {
    const index = indexOverrides(
      normalizeOverrides([
        { slotId: "thu1830", date: "2026-10-29", cancelled: true },
        { slotId: "thu1945", date: "2026-10-29", cancelled: true },
      ]),
    );
    for (const id of ["thu1830", "thu1945"]) {
      const r = resolveOccurrence({ slot: slot(id, 4, "18:30"), date: "2026-10-29", index });
      expect(r.cancelled).toBe(true);
      expect(r.active).toBe(false);
      expect(r.cancelledOn).toBe("2026-10-29");
      expect(backOnLabel(r.resumesOn)).toBe("Back on November 5");
    }
  });

  it("2. consecutive cancellations resume on 2026-12-06", () => {
    const index = indexOverrides(
      ["2026-11-15", "2026-11-22", "2026-11-29"].flatMap((date) =>
        ["sun2130", "sun2245"].map((slotId) => ({ slotId, date, cancelled: true, instructorId: null })),
      ),
    );
    const r = resolveOccurrence({ slot: slot("sun2130", 0, "21:30"), date: "2026-11-15", index });
    expect(r.resumesOn).toBe("2026-12-06");
  });

  it("3. weekly suspension wins over a substitute override", () => {
    const s = slot("fri1030", 5, "10:30", { active: false, resumesOn: null });
    const index = indexOverrides([{ slotId: "fri1030", date: "2026-10-23", cancelled: false, instructorId: "SUB" }]);
    const r = resolveOccurrence({ slot: s, date: "2026-10-23", index, instructors });
    expect(r.active).toBe(false);
    expect(r.substitute).toBe(false);
    expect(r.idInstructor).toBe("REG");
    expect(backOnLabel(r.resumesOn)).toBeNull(); // no resume date → card hidden
  });

  const payload = {
    classes: [{ id: "C1", className: "Barre" }],
    instructors: [{ id: "REG", information: { firstName: "R" } }],
    slots: [{ id: "thu1830", scheduleKey: "thu1830", dayLocal: 4, duration: 60, classId: "C1", instructorId: "REG" }],
  };
  const plan = (overrides?: unknown) => {
    const n = normalizeDmcPayload({ ...payload, ...(overrides === undefined ? {} : { overrides }) }, "x");
    if (!n.ok) throw new Error(n.error);
    return planTimetableShifts({ slots: n.snapshot.slots, from: "2026-10-26", to: "2026-11-08", rotation: DEFAULT_ROTATION, overrides: n.snapshot.overrides });
  };

  it("4. empty overrides produce the weekly schedule", () => {
    expect(plan([])).toEqual(plan(undefined));
    expect(plan([]).length).toBe(2);
  });

  it("5. missing overrides property produces the weekly schedule", () => {
    expect(plan(undefined).map((p) => p.date)).toEqual(["2026-10-29", "2026-11-05"]);
    expect(plan(null).length).toBe(2);
  });

  it("6. valid substitute replaces teacher only on that date", () => {
    const index = indexOverrides([{ slotId: "s", date: "2026-10-29", cancelled: false, instructorId: "SUB" }]);
    const p: DmcPreview[] = [...previews, { trailerId: "T-SUB", classId: "C1", instructorId: "SUB" }];
    const r = resolveOccurrence({ slot: slot("s", 4, "18:30"), date: "2026-10-29", index, instructors, previews: p });
    expect(r.idInstructor).toBe("SUB");
    expect(r.weeklyInstructorId).toBe("REG");
    expect(r.trailerId).toBe("T-SUB");
  });

  it("7. missing substitute trailer shows no trailer", () => {
    const index = indexOverrides([{ slotId: "s", date: "2026-10-29", cancelled: false, instructorId: "SUB" }]);
    const r = resolveOccurrence({ slot: slot("s", 4, "18:30"), date: "2026-10-29", index, instructors, previews });
    expect(r.trailerId).toBeNull();
  });

  it("8. unknown substitute keeps the regular instructor", () => {
    const index = indexOverrides([{ slotId: "s", date: "2026-10-29", cancelled: false, instructorId: "NOPE" }]);
    const r = resolveOccurrence({ slot: slot("s", 4, "18:30"), date: "2026-10-29", index, instructors, previews });
    expect(r.idInstructor).toBe("REG");
    expect(r.trailerId).toBe("T-REG");
  });

  it("9. overrides affect only their date across weeks", () => {
    const n = plan([{ slotId: "thu1830", date: "2026-10-29", cancelled: true }]);
    expect(n.map((p) => p.date)).toEqual(["2026-11-05"]);
  });

  it("10. Berlin wall time converts correctly across both DST changes", () => {
    // 2026-10-25: CEST→CET. Sunday 18:30 Berlin = 17:30 UTC.
    expect(new Date(berlinWallToInstant("2026-10-25", "18:30")).toISOString()).toBe("2026-10-25T17:30:00.000Z");
    expect(new Date(berlinWallToInstant("2026-10-24", "18:30")).toISOString()).toBe("2026-10-24T16:30:00.000Z");
    // 2027-03-28: CET→CEST.
    expect(new Date(berlinWallToInstant("2027-03-28", "18:30")).toISOString()).toBe("2027-03-28T16:30:00.000Z");
    expect(new Date(berlinWallToInstant("2027-03-27", "18:30")).toISOString()).toBe("2027-03-27T17:30:00.000Z");
    // Override key uses Berlin date: 23:30 Berlin is still that date for a New York viewer.
    const at = berlinWallToInstant("2026-10-25", "23:30");
    expect(berlinDateOf(at)).toBe("2026-10-25");
    expect(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at)).toBe("18:30");
  });

  it("11. a class in progress stays the current occurrence", () => {
    const s = slot("thu1830", 4, "18:30");
    const now = berlinWallToInstant("2026-10-29", "19:00");
    expect(nextOccurrence(s, now).date).toBe("2026-10-29");
    expect(nextOccurrence(s, berlinWallToInstant("2026-10-29", "20:00")).date).toBe("2026-11-05");
  });

  it("12. malformed resume dates display nothing", () => {
    expect(backOnLabel("2026-13-40")).toBeNull();
    expect(backOnLabel("not-a-date")).toBeNull();
    expect(backOnLabel(null)).toBeNull();
  });
});
