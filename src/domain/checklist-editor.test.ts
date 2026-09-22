import { describe, expect, it } from "vitest";
import {
  addItem,
  deleteItem,
  moveItem,
  moveItemDown,
  moveItemUp,
  newItemId,
  supportsHeadings,
  updateItem,
  validateChecklistTemplate,
} from "./checklist-editor";
import { DEFAULT_CHECKLISTS } from "./checklist-templates";
import { buildShiftChecklists, ensureShiftChecklists } from "./checklists";
import type { ChecklistTemplateItem } from "./checklists";

const items: ChecklistTemplateItem[] = [
  { id: "a", text: "A" },
  { id: "b", text: "B" },
  { id: "c", text: "C" },
];

describe("draft operations", () => {
  it("reorders A,B,C to C,A,B", () => {
    expect(moveItem(items, 2, 0).map((i) => i.id)).toEqual(["c", "a", "b"]);
  });

  it("moves up and down, clamped at the ends", () => {
    expect(moveItemUp(items, 0)).toEqual(items);
    expect(moveItemDown(items, 2)).toEqual(items);
    expect(moveItemDown(items, 0).map((i) => i.id)).toEqual(["b", "a", "c"]);
  });

  it("adds an item with a unique id and keeps order", () => {
    const next = addItem("end_shift", items, { text: "D" });
    expect(next.map((i) => i.text)).toEqual(["A", "B", "C", "D"]);
    expect(new Set(next.map((i) => i.id)).size).toBe(4);
  });

  it("ignores headings on flat checklists", () => {
    const next = addItem("start_shift", items, { text: "D", heading: "Class Starts" });
    expect(next[3]?.heading).toBeUndefined();
    expect(supportsHeadings("start_shift")).toBe(false);
    expect(supportsHeadings("ballet")).toBe(true);
  });

  it("keeps generated ids unique against existing ones", () => {
    const taken = [{ id: "ballet_new_1", text: "X" }];
    expect(newItemId("ballet", taken)).toBe("ballet_new_2");
  });

  it("edits text and clears headings", () => {
    const withHeading = [{ id: "a", text: "A", heading: "Class Starts" }];
    expect(updateItem(withHeading, "a", { text: "A2" })[0]).toEqual({
      id: "a",
      text: "A2",
      heading: "Class Starts",
    });
    expect(updateItem(withHeading, "a", { heading: null })[0]?.heading).toBeUndefined();
  });

  it("deletes B leaving A,C", () => {
    expect(deleteItem(items, "b").map((i) => i.id)).toEqual(["a", "c"]);
  });
});

describe("validation", () => {
  const ok = { title: "Ballet Checklist", items };

  it("accepts a valid template and preserves order", () => {
    const result = validateChecklistTemplate("ballet", ok);
    expect(result.template.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("rejects unknown types", () => {
    expect(() => validateChecklistTemplate("nope", ok)).toThrow(/Invalid checklist type/);
  });

  it("rejects duplicate ids, empty text, empty ids and non-arrays", () => {
    expect(() =>
      validateChecklistTemplate("ballet", { title: "T", items: [items[0], items[0]] }),
    ).toThrow(/Duplicate/);
    expect(() =>
      validateChecklistTemplate("ballet", { title: "T", items: [{ id: "a", text: "  " }] }),
    ).toThrow(/needs some text/);
    expect(() =>
      validateChecklistTemplate("ballet", { title: "T", items: [{ id: "", text: "x" }] }),
    ).toThrow(/missing an id/);
    expect(() => validateChecklistTemplate("ballet", { title: "T", items: "x" })).toThrow(
      /must be a list/,
    );
  });

  it("allows headings only for ballet and workout", () => {
    const withHeading = { title: "T", items: [{ id: "a", text: "A", heading: "Class Starts" }] };
    expect(validateChecklistTemplate("workout", withHeading).template.items[0]?.heading).toBe(
      "Class Starts",
    );
    expect(() => validateChecklistTemplate("end_shift", withHeading)).toThrow(
      /does not support headings/,
    );
  });

  it("keeps headings attached to their items after reordering", () => {
    const ballet = DEFAULT_CHECKLISTS.ballet.items;
    const reordered = moveItem(ballet, 0, 10);
    const validated = validateChecklistTemplate("ballet", {
      title: "Ballet Checklist",
      items: reordered,
    }).template.items;
    const moved = validated.find((i) => i.id === ballet[0]?.id);
    expect(moved?.heading).toBe(ballet[0]?.heading);
    expect(validated.filter((i) => i.heading).length).toBe(ballet.filter((i) => i.heading).length);
  });
});

describe("historical isolation", () => {
  it("an existing snapshot is untouched when the template changes", () => {
    const before = buildShiftChecklists(DEFAULT_CHECKLISTS);
    const originalCount = before.start.items.length;
    const editedConfig = {
      ...DEFAULT_CHECKLISTS,
      start_shift: {
        title: DEFAULT_CHECKLISTS.start_shift.title,
        items: addItem("start_shift", DEFAULT_CHECKLISTS.start_shift.items, { text: "New step" }),
      },
    };
    expect(ensureShiftChecklists(before, editedConfig).start.items.length).toBe(originalCount);
    expect(buildShiftChecklists(editedConfig).start.items.length).toBe(originalCount + 1);
  });
});
