import { describe, expect, it } from "vitest";
import { DEFAULT_CHECKLISTS } from "./checklist-templates";
import {
  buildShiftChecklists,
  checklistTypeForDuration,
  ensureShiftChecklists,
  isShiftChecklists,
  setChecklistItemState,
  syncClassChecklists,
  type ChecklistClassInput,
  type ChecklistConfig,
} from "./checklists";

const config: ChecklistConfig = DEFAULT_CHECKLISTS;

const ballet: ChecklistClassInput = {
  classId: "c1",
  className: "Back to Basics",
  teacherName: "Max Azaro",
  startTime: "10:30",
  endTime: "11:30",
  durationMinutes: 60,
};
const workout: ChecklistClassInput = {
  classId: "c2",
  className: "Full Body",
  teacherName: "Alex",
  startTime: "12:00",
  endTime: "12:45",
  durationMinutes: 45,
};

describe("classification", () => {
  it("maps supported durations only", () => {
    expect(checklistTypeForDuration(45)).toBe("workout");
    expect(checklistTypeForDuration(60)).toBe("ballet");
    expect(checklistTypeForDuration(44)).toBeNull();
    expect(checklistTypeForDuration(46)).toBeNull();
    expect(checklistTypeForDuration(61)).toBeNull();
  });
});

describe("snapshot generation", () => {
  it("preserves order, ids, text and headings, and starts uncompleted", () => {
    const snap = buildShiftChecklists(config, [ballet]);
    expect(snap.start.items.map((i) => i.id)).toEqual(
      config.start_shift.items.map((i) => i.id),
    );
    expect(snap.start.items.every((i) => i.completed === false)).toBe(true);
    expect(snap.start.items.every((i) => i.heading === undefined)).toBe(true);
    expect(snap.end.items.every((i) => i.heading === undefined)).toBe(true);

    const cls = snap.classes[0];
    expect(cls.type).toBe("ballet");
    expect(cls.items.map((i) => i.id)).toEqual(config.ballet.items.map((i) => i.id));
    expect(cls.items[0].text).toBe(config.ballet.items[0].text);
    expect(cls.items[0].heading).toBe("10 Minutes Before Class");
    expect(cls.items.every((i) => i.completed === false)).toBe(true);
  });

  it("skips classes with an unsupported duration", () => {
    const snap = buildShiftChecklists(config, [{ ...ballet, durationMinutes: 90 }]);
    expect(snap.classes).toEqual([]);
  });

  it("accepts a shift with no classes", () => {
    expect(buildShiftChecklists(config, []).classes).toEqual([]);
  });
});

describe("template isolation", () => {
  it("keeps an existing snapshot unchanged when the master template changes", () => {
    const snap = buildShiftChecklists(config, [ballet]);
    const before = JSON.parse(JSON.stringify(snap));
    const edited: ChecklistConfig = {
      ...config,
      ballet: { ...config.ballet, items: [...config.ballet.items, { id: "bal_29", text: "New" }] },
    };
    expect(ensureShiftChecklists(snap, edited, [ballet])).toEqual(before);
    expect(buildShiftChecklists(edited, [ballet]).classes[0].items).toHaveLength(
      config.ballet.items.length + 1,
    );
  });
});

describe("idempotency", () => {
  it("never creates a second snapshot or resets completion", () => {
    const first = buildShiftChecklists(config, [ballet]);
    const withProgress = setChecklistItemState(first, { section: "start" }, "start_01", true);
    const again = ensureShiftChecklists(withProgress, config, [ballet]);
    expect(again).toBe(withProgress);
    expect(again.start.items[0].completed).toBe(true);
  });
});

describe("class synchronization", () => {
  it("adds, removes and retypes class checklists", () => {
    let snap = buildShiftChecklists(config, [ballet]);
    snap = setChecklistItemState(snap, { section: "class", classId: "c1" }, "bal_01", true);

    snap = syncClassChecklists(snap, config, [ballet, workout]);
    expect(snap.classes.map((c) => c.classId)).toEqual(["c1", "c2"]);
    expect(snap.classes[1].type).toBe("workout");
    expect(snap.classes[0].items[0].completed).toBe(true);

    snap = syncClassChecklists(snap, config, [workout]);
    expect(snap.classes.map((c) => c.classId)).toEqual(["c2"]);

    const retyped = syncClassChecklists(snap, config, [{ ...workout, durationMinutes: 60 }]);
    expect(retyped.classes[0].type).toBe("ballet");
    expect(retyped.classes[0].items.map((i) => i.id)).toEqual(
      config.ballet.items.map((i) => i.id),
    );
  });

  it("keeps cancelled classes with their status and completion", () => {
    let snap = buildShiftChecklists(config, [ballet]);
    snap = setChecklistItemState(snap, { section: "class", classId: "c1" }, "bal_02", true);
    snap = syncClassChecklists(snap, config, [{ ...ballet, status: "cancelled" }]);
    expect(snap.classes).toHaveLength(1);
    expect(snap.classes[0].status).toBe("cancelled");
    expect(snap.classes[0].items[1].completed).toBe(true);
  });
});

describe("historical shifts", () => {
  it("treats a missing snapshot as valid and builds one on demand", () => {
    expect(isShiftChecklists(null)).toBe(false);
    const built = ensureShiftChecklists(null, config, []);
    expect(isShiftChecklists(built)).toBe(true);
  });
});
