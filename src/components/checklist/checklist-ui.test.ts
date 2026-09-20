import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CHECKLISTS } from "@/domain/checklist-templates";
import {
  buildShiftChecklists,
  checklistProgress,
  isEndChecklistComplete,
  setChecklistItemState,
  type ShiftChecklists,
} from "@/domain/checklists";

const dashboard = readFileSync("src/routes/index.tsx", "utf8");
const panel = readFileSync("src/components/checklist/ChecklistPanel.tsx", "utf8");
const item = readFileSync("src/components/checklist/ChecklistItem.tsx", "utf8");
const hook = readFileSync("src/components/checklist/useShiftChecklists.ts", "utf8");

const HEADINGS = [
  "10 Minutes Before Class",
  "5 Minutes Before Class",
  "Class Starts",
  "During the Class",
  "End of Class",
  "After the Class",
];

function snapshot(): ShiftChecklists {
  return buildShiftChecklists(DEFAULT_CHECKLISTS, [
    {
      classId: "ballet-1",
      className: "Long Lines",
      teacherName: "Max",
      startTime: "10:30",
      endTime: "11:30",
      durationMinutes: 60,
    },
    {
      classId: "ballet-2",
      className: "Back to Basics",
      teacherName: "Max",
      startTime: "11:45",
      endTime: "12:45",
      durationMinutes: 60,
    },
    {
      classId: "workout-1",
      className: "Yoga",
      teacherName: "Isabel",
      startTime: "14:00",
      endTime: "14:45",
      durationMinutes: 45,
    },
    {
      classId: "other-1",
      className: "Workshop",
      teacherName: "Ulian",
      startTime: "16:00",
      endTime: "17:30",
      durationMinutes: 90,
    },
  ]);
}

describe("checklist templates rendered by the operator UI", () => {
  it("Start Shift has 22 items and no headings", () => {
    const items = DEFAULT_CHECKLISTS.start_shift.items;
    expect(items).toHaveLength(22);
    expect(items.every((i) => !i.heading)).toBe(true);
  });

  it("End Shift has 10 items and no headings", () => {
    const items = DEFAULT_CHECKLISTS.end_shift.items;
    expect(items).toHaveLength(10);
    expect(items.every((i) => !i.heading)).toBe(true);
  });

  it.each([
    ["ballet", 28],
    ["workout", 25],
  ] as const)("%s has %i items with the six headings in order", (type, count) => {
    const items = DEFAULT_CHECKLISTS[type].items;
    expect(items).toHaveLength(count);
    const order: string[] = [];
    for (const i of items) {
      expect(i.heading).toBeTruthy();
      if (i.heading && i.heading !== order[order.length - 1]) order.push(i.heading);
    }
    expect(order).toEqual(HEADINGS);
  });
});

describe("snapshot the operator UI renders", () => {
  it("gives 60 min Ballet, 45 min Workout and nothing to other durations", () => {
    const s = snapshot();
    expect(s.classes.map((c) => c.classId)).toEqual(["ballet-1", "ballet-2", "workout-1"]);
    expect(s.classes.map((c) => c.type)).toEqual(["ballet", "ballet", "workout"]);
    expect(s.classes.find((c) => c.classId === "other-1")).toBeUndefined();
  });

  it("preserves item order and text per class", () => {
    const s = snapshot();
    const ballet = s.classes[0]!;
    expect(ballet.items.map((i) => i.text)).toEqual(
      DEFAULT_CHECKLISTS.ballet.items.map((i) => i.text),
    );
  });

  it("keeps class checklists independent", () => {
    const s = snapshot();
    const first = s.classes[0]!;
    const next = setChecklistItemState(
      s,
      { section: "class", classId: "ballet-1" },
      first.items[0]!.id,
      true,
    );
    expect(checklistProgress(next.classes[0]!.items).completed).toBe(1);
    expect(checklistProgress(next.classes[1]!.items).completed).toBe(0);
    expect(checklistProgress(next.start.items).completed).toBe(0);
    expect(checklistProgress(next.end.items).completed).toBe(0);
  });

  it("derives progress as completed / total", () => {
    const s = snapshot();
    expect(checklistProgress(s.start.items)).toEqual({
      completed: 0,
      total: 22,
      complete: false,
    });
    const done = s.start.items.reduce(
      (acc, i) => setChecklistItemState(acc, { section: "start" }, i.id, true),
      s,
    );
    expect(checklistProgress(done.start.items)).toEqual({
      completed: 22,
      total: 22,
      complete: true,
    });
  });
});

describe("checkout gate", () => {
  it("blocks while any End Shift item is open", () => {
    const s = snapshot();
    expect(isEndChecklistComplete(s)).toBe(false);
    const partial = setChecklistItemState(s, { section: "end" }, s.end.items[0]!.id, true);
    expect(isEndChecklistComplete(partial)).toBe(false);
  });

  it("allows checkout once every End Shift item is done", () => {
    const s = snapshot();
    const done = s.end.items.reduce(
      (acc, i) => setChecklistItemState(acc, { section: "end" }, i.id, true),
      s,
    );
    expect(isEndChecklistComplete(done)).toBe(true);
  });

  it("does not block on Start Shift or class checklists", () => {
    const s = snapshot();
    const done = s.end.items.reduce(
      (acc, i) => setChecklistItemState(acc, { section: "end" }, i.id, true),
      s,
    );
    expect(checklistProgress(done.start.items).complete).toBe(false);
    expect(isEndChecklistComplete(done)).toBe(true);
  });

  it("treats a shift without a snapshot as unblocked", () => {
    expect(isEndChecklistComplete(null)).toBe(true);
  });
});

describe("operator dashboard wiring", () => {
  it("places Start Shift under the timer and above Shift Overview", () => {
    const start = dashboard.indexOf('title="Start Shift Checklist"');
    const overview = dashboard.indexOf('title="Shift Overview"');
    const end = dashboard.indexOf('title="End Shift Checklist"');
    const hold = dashboard.indexOf('label="Hold to check out"');
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(overview);
    expect(overview).toBeLessThan(end);
    expect(end).toBeLessThan(hold);
  });

  it("renders class checklists inside the class rows", () => {
    expect(dashboard).toContain("renderClassExtra");
    expect(dashboard).toContain('section: "class"');
  });

  it("blocks the hold control until the End Shift checklist is complete", () => {
    expect(dashboard).toContain("disabled={!endComplete}");
    expect(dashboard).toContain("Complete the End Shift Checklist before checking out.");
  });

  it("makes a cancelled class checklist read-only", () => {
    expect(dashboard).toContain('readOnly={st === "cancelled"}');
  });

  it("collapses checklists by default", () => {
    expect(panel).toContain("useState(false)");
  });

  it("stops checklist clicks from reaching the class row controls", () => {
    expect(panel).toContain("e.stopPropagation()");
  });

  it("uses the Operation 1 server functions and no parallel mutation layer", () => {
    expect(hook).toContain("setMyChecklistItem");
    expect(hook).toContain("getMyShiftChecklists");
    expect(hook).not.toContain("localStorage");
    expect(hook).not.toContain("setInterval");
  });

  it("rolls an optimistic toggle back when the server rejects it", () => {
    expect(hook).toContain("pending.current.filter((op) => op !== operation)");
    expect(hook).toContain("confirmed.current = saved");
    expect(hook).toContain("project()");
  });

  it("renders headings as plain labels, not accordions", () => {
    expect(panel).not.toContain("Accordion");
    expect(item).toContain("Checkbox");
  });
});
