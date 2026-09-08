import { describe, expect, it } from "vitest";
import { normalizeDmcPayload, parseScheduleKey } from "./timetable-normalize";
import { staleSourceIds } from "./timetable-repository.server";

const CLASS = {
  id: "c1",
  className: "Beginner-Intermediate",
  category: "ballet class",
  level: "beginner",
  description: "desc",
  trailerId: "t9",
};

const INSTRUCTOR = {
  id: "i1",
  image_url: "https://example.com/a.jpg",
  information: { firstName: "Alice", lastName: "Heyward", bioInfo: "bio", title: "" },
};

const slot = (over: Record<string, unknown> = {}) => ({
  id: "mon1930",
  classId: "c1",
  instructorId: "i1",
  dayLocal: 1,
  scheduleKey: "mon1930",
  duration: 60,
  active: true,
  // legacy / duplicate fields that must be ignored
  className: "STALE NAME",
  startTime: "07:00",
  assignedClassId: null,
  ...over,
});

const payload = (slots: unknown[]) => ({
  slots,
  classes: [CLASS],
  instructors: [INSTRUCTOR],
});

const ok = (slots: unknown[]) => {
  const res = normalizeDmcPayload(payload(slots), "2026-09-08T22:00:00.000Z");
  if (!res.ok) throw new Error(`expected ok, got: ${res.error}`);
  return res;
};

describe("parseScheduleKey", () => {
  it("reads weekday and time", () => {
    expect(parseScheduleKey("mon0000")).toEqual({ dayLocal: 1, startTimeLocal: "00:00" });
    expect(parseScheduleKey("fri0800")).toEqual({ dayLocal: 5, startTimeLocal: "08:00" });
    expect(parseScheduleKey("fri1930")).toEqual({ dayLocal: 5, startTimeLocal: "19:30" });
  });

  it("maps every weekday", () => {
    const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    keys.forEach((k, i) => expect(parseScheduleKey(`${k}1200`)?.dayLocal).toBe(i));
  });

  it("rejects malformed keys", () => {
    for (const bad of ["MON1930", "mon193", "xyz1200", "mon2500", "mon1960", "1930mon", 1930]) {
      expect(parseScheduleKey(bad)).toBeNull();
    }
  });
});

describe("normalizeDmcPayload", () => {
  it("resolves the class and instructor through their ids", () => {
    const { snapshot } = ok([slot()]);
    expect(snapshot.slots[0].sourceClassId).toBe("c1");
    expect(snapshot.slots[0].sourceInstructorId).toBe("i1");
    expect(snapshot.classes[0].className).toBe("Beginner-Intermediate");
    expect(snapshot.instructors[0]).toMatchObject({
      firstName: "Alice",
      lastName: "Heyward",
      title: null,
      imageUrl: "https://example.com/a.jpg",
    });
  });

  it("ignores legacy fields and keeps the authoritative schedule", () => {
    const { snapshot } = ok([
      slot({ id: "sun2130", className: "wrong", startTime: "21:30", assignedClassId: "zzz" }),
    ]);
    const s = snapshot.slots[0];
    expect(s.sourceSlotId).toBe("sun2130"); // preserved as reference only
    expect(s.dayLocal).toBe(1);
    expect(s.startTimeLocal).toBe("19:30");
    expect(s.durationMinutes).toBe(60);
    expect(s.scheduleKey).toBe("mon1930");
  });

  it("keeps Berlin local midnight as midnight", () => {
    const { snapshot } = ok([slot({ scheduleKey: "mon0000", dayLocal: 1 })]);
    expect(snapshot.slots[0].startTimeLocal).toBe("00:00");
    expect(snapshot.slots[0].dayLocal).toBe(1);
  });

  it("keeps active state per slot and stores resumesOn verbatim", () => {
    const { snapshot } = ok([
      slot({ id: "a", active: true }),
      slot({ id: "b", active: false, resumesOn: "2026-10-01", scheduleKey: "sun2130", dayLocal: 0 }),
    ]);
    expect(snapshot.slots[0]).toMatchObject({ active: true, resumesOn: null });
    expect(snapshot.slots[1]).toMatchObject({ active: false, resumesOn: "2026-10-01" });
  });

  it("preserves any positive duration, not just 45 and 60", () => {
    expect(ok([slot({ duration: 45 })]).snapshot.slots[0].durationMinutes).toBe(45);
    expect(ok([slot({ duration: 90 })]).snapshot.slots[0].durationMinutes).toBe(90);
  });

  it("rejects slots with bad schedule data instead of guessing", () => {
    const res = normalizeDmcPayload(
      payload([
        slot({ id: "bad-key", scheduleKey: "monday1930" }),
        slot({ id: "bad-day", dayLocal: 9 }),
        slot({ id: "day-mismatch", dayLocal: 2 }),
        slot({ id: "bad-duration", duration: 0 }),
        slot({ id: "good" }),
      ]),
      "now",
    );
    if (!res.ok) throw new Error("expected ok");
    expect(res.snapshot.slots.map((s) => s.sourceSlotId)).toEqual(["good"]);
    expect(res.anomalies).toHaveLength(4);
  });

  it("rejects slots referencing an unknown class or instructor", () => {
    const res = normalizeDmcPayload(
      payload([
        slot({ id: "no-class", classId: "missing" }),
        slot({ id: "no-instructor", instructorId: "missing" }),
        slot({ id: "good" }),
      ]),
      "now",
    );
    if (!res.ok) throw new Error("expected ok");
    expect(res.snapshot.slots.map((s) => s.sourceSlotId)).toEqual(["good"]);
    expect(res.anomalies.map((a) => a.sourceSlotId).sort()).toEqual(["no-class", "no-instructor"]);
  });

  it("drops duplicate slot ids from one payload", () => {
    const res = ok([slot({ id: "dup" }), slot({ id: "dup", duration: 45 })]);
    expect(res.snapshot.slots).toHaveLength(1);
    expect(res.snapshot.slots[0].durationMinutes).toBe(60);
  });

  it("fails the whole refresh on a malformed payload", () => {
    expect(normalizeDmcPayload(null, "now").ok).toBe(false);
    expect(normalizeDmcPayload({ slots: [] }, "now").ok).toBe(false);
    expect(normalizeDmcPayload({ slots: "x", classes: [], instructors: [] }, "now").ok).toBe(false);
    expect(normalizeDmcPayload(payload([slot({ scheduleKey: "nope" })]), "now").ok).toBe(false);
  });

  it("is deterministic across repeated normalizations", () => {
    const a = ok([slot()]).snapshot.slots;
    const b = ok([slot()]).snapshot.slots;
    expect(a).toEqual(b);
  });
});

describe("staleSourceIds", () => {
  it("keeps ids still present and reports only the vanished ones", () => {
    expect(staleSourceIds(["a", "b", "c"], ["a", "c"])).toEqual(["b"]);
  });

  it("treats a moved slot as the same slot", () => {
    // same source id, changed scheduleKey → still present, so never deleted
    expect(staleSourceIds(["ABC123"], ["ABC123"])).toEqual([]);
  });

  it("reports nothing when the source is unchanged", () => {
    expect(staleSourceIds(["a", "b"], ["a", "b"])).toEqual([]);
  });
});
