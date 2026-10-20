import { it } from "vitest";
import { scoreOperators } from "./checklist-scoring";
import type { ShiftChecklists, ChecklistSnapshotItem } from "./checklists";
const item = (id: string, completedAt: string | null, heading?: string): ChecklistSnapshotItem => ({
  id, text: id, ...(heading ? { heading } : {}), completed: completedAt !== null, completedAt,
});
const snapshot = (overrides: Partial<ShiftChecklists> = {}): ShiftChecklists => ({
  start: { items: [item("s1", "18:31"), item("s2", "18:32")] },
  classes: [{
    classId: "c1", type: "ballet" as const, className: "Ballet", teacherName: "T",
    startTime: "19:00", endTime: "20:00",
    items: [
      item("b1", "18:54", "10 Minutes Before Class"),
      item("b2", "19:00", "5 Minutes Before Class"),
      item("b3", "19:01", "Class Starts"),
      item("b4", "19:30", "During the Class"),
      item("b5", "20:00", "End of Class"),
    ],
  }],
  end: { items: [item("e1", "21:29")] },
  ...overrides,
});
it("debug-late-start", () => {
  const late = snapshot();
  late.start.items[1] = item("s2", "18:50");
  const r = scoreOperators([{ operator_name: "A", check_in_at: "2026-09-20T16:30:00Z", check_out_at: "2026-09-20T19:30:00Z", checklists: late }]);
  console.log("RESULT", JSON.stringify(r));
});
