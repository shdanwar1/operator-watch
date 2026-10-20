import { describe, expect, it } from "vitest";
import {
  minutesSinceCheckIn,
  parseClockMinutes,
  scoreOperators,
  scoreTone,
  type ScoreShiftInput,
} from "./checklist-scoring";
import type { ShiftChecklists, ChecklistSnapshotItem } from "./checklists";

const item = (
  id: string,
  completedAt: string | null,
  heading?: string,
): ChecklistSnapshotItem => ({
  id,
  text: id,
  ...(heading ? { heading } : {}),
  completed: completedAt !== null,
  completedAt,
});

const snapshot = (overrides: Partial<ShiftChecklists> = {}): ShiftChecklists => ({
  start: { items: [item("s1", "18:31"), item("s2", "18:32")] },
  classes: [
    {
      classId: "c1",
      type: "ballet",
      className: "Ballet",
      teacherName: "T",
      startTime: "19:00",
      endTime: "20:00",
      items: [
        item("b1", "18:54", "10 Minutes Before Class"),
        item("b2", "19:00", "5 Minutes Before Class"),
        item("b3", "19:01", "Class Starts"),
        item("b4", "19:30", "During the Class"),
        item("b5", "20:00", "End of Class"),
      ],
    },
  ],
  end: { items: [item("e1", "21:29")] },
  ...overrides,
});

/** Shift 18:30–21:30 Berlin (CEST, UTC+2) => 16:30–19:30 UTC. */
const shift = (overrides: Partial<ScoreShiftInput> = {}): ScoreShiftInput => ({
  operator_name: "A",
  check_in_at: "2026-09-20T16:30:00Z",
  check_out_at: "2026-09-20T19:30:00Z",
  checklists: snapshot(),
  ...overrides,
});

describe("clock projection", () => {
  it("parses HH:MM and rejects legacy values", () => {
    expect(parseClockMinutes("18:42")).toBe(18 * 60 + 42);
    expect(parseClockMinutes("00:05")).toBe(5);
    expect(parseClockMinutes("24:00")).toBeNull();
    expect(parseClockMinutes("9:05")).toBeNull();
    expect(parseClockMinutes(null)).toBeNull();
  });
  it("projects same-day and overnight times onto the shift timeline", () => {
    const checkIn = new Date("2026-09-20T16:30:00Z"); // 18:30 Berlin
    expect(minutesSinceCheckIn(checkIn, "18:30")).toBe(0);
    expect(minutesSinceCheckIn(checkIn, "19:00")).toBe(30);
    // 00:30 after an 18:30 check-in is the next day, not -18h.
    expect(minutesSinceCheckIn(checkIn, "00:30")).toBe(360);
  });
  it("anchors at the Berlin check-in wall clock, not UTC", () => {
    // 22:00 Berlin winter (UTC+1) => 21:00Z; a 23:30 tick is +90, not +150.
    const checkIn = new Date("2026-01-20T21:00:00Z");
    expect(minutesSinceCheckIn(checkIn, "23:30")).toBe(90);
  });
});

describe("scoreOperators", () => {
  it("scores a fully on-time shift at 100/100", () => {
    const [score] = scoreOperators([shift()]);
    expect(score).toMatchObject({
      operator: "A",
      shifts: 1,
      completenessPct: 100,
      punctualityPct: 100,
      lateUnits: 0,
    });
  });
  // The fixture shift has 3 units: Start, one class, End.
  it("marks a late Start unit: complete but not punctual", () => {
    const late = snapshot();
    late.start.items[1] = item("s2", "18:50"); // 20 min after check-in, deadline +15
    const [score] = scoreOperators([shift({ checklists: late })]);
    expect(score.completenessPct).toBe(100);
    // 2 of 3 units punctual; the late start unit counts as late.
    expect(score.punctualityPct).toBe(67);
    expect(score.lateUnits).toBe(1);
  });
  it("marks an incomplete End unit as not complete and not late", () => {
    const partial = snapshot();
    partial.end.items.push(item("e2", null));
    const [score] = scoreOperators([shift({ checklists: partial })]);
    expect(score.completenessPct).toBe(67); // 2 of 3 units complete
    expect(score.punctualityPct).toBe(67);
    expect(score.lateUnits).toBe(0);
  });
  it("enforces per-heading class deadlines", () => {
    const late = snapshot();
    // "Class Starts" ticked 3 min after start (deadline +2) -> late.
    late.classes[0].items[2] = item("b3", "19:03", "Class Starts");
    const [score] = scoreOperators([shift({ checklists: late })]);
    expect(score.punctualityPct).toBe(67);
    expect(score.lateUnits).toBe(1);
  });
  it("handles overnight classes past midnight", () => {
    const overnight = snapshot({
      start: { items: [item("s1", "22:01")] },
      classes: [
        {
          classId: "c1",
          type: "ballet",
          className: "Late Ballet",
          teacherName: "T",
          startTime: "23:30",
          endTime: "00:30",
          items: [
            item("b1", "23:24", "10 Minutes Before Class"),
            item("b2", "00:30", "End of Class"),
          ],
        },
      ],
      end: { items: [item("e1", "01:59")] },
    });
    const [score] = scoreOperators([
      shift({
        check_in_at: "2026-09-20T20:00:00Z", // 22:00 Berlin
        check_out_at: "2026-09-21T00:00:00Z", // 02:00 Berlin
        checklists: overnight,
      }),
    ]);
    expect(score).toMatchObject({ completenessPct: 100, punctualityPct: 100, lateUnits: 0 });
  });
  it("ignores cancelled classes", () => {
    const cancelled = snapshot();
    cancelled.classes[0].status = "cancelled";
    cancelled.classes[0].items = cancelled.classes[0].items.map((i) => ({
      ...i,
      completed: false,
      completedAt: null,
    }));
    const [score] = scoreOperators([shift({ checklists: cancelled })]);
    // Only Start + End units remain, both on time.
    expect(score).toMatchObject({ completenessPct: 100, punctualityPct: 100 });
  });
  it("counts legacy items without tick times as late", () => {
    const legacy = snapshot();
    legacy.start.items = [{ id: "s1", text: "s1", completed: true }];
    const [score] = scoreOperators([shift({ checklists: legacy })]);
    expect(score.completenessPct).toBe(100);
    expect(score.punctualityPct).toBe(67);
    expect(score.lateUnits).toBe(1);
  });
  it("skips open shifts and shifts without snapshots, omits empty operators", () => {
    const scores = scoreOperators([
      shift({ operator_name: "Open", check_out_at: null }),
      shift({ operator_name: "NoSnapshot", checklists: null }),
      shift(),
    ]);
    expect(scores).toHaveLength(1);
    expect(scores[0].operator).toBe("A");
  });
  it("sorts by completeness, then punctuality, then name", () => {
    const scores = scoreOperators([
      shift({ operator_name: "Zed", checklists: weakEnd() }),
      shift({ operator_name: "Ann" }),
      shift({ operator_name: "Bob", checklists: weakEnd() }),
    ]);
    expect(scores.map((s) => s.operator)).toEqual(["Ann", "Bob", "Zed"]);
    expect(scores[1].completenessPct).toBe(67);
  });
});

describe("scoreTone", () => {
  it("buckets percentages into done / warn / destructive", () => {
    expect(scoreTone(100)).toBe("done");
    expect(scoreTone(90)).toBe("done");
    expect(scoreTone(89)).toBe("warn");
    expect(scoreTone(75)).toBe("warn");
    expect(scoreTone(74)).toBe("destructive");
    expect(scoreTone(0)).toBe("destructive");
  });
});
