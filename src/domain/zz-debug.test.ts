import { it } from "vitest";
import { scoreOperators, minutesSinceCheckIn, berlinMinutes } from "./checklist-scoring";
const item = (id: string, completedAt: string | null, heading?: string) => ({
  id, text: id, ...(heading ? { heading } : {}), completed: completedAt !== null, completedAt,
});
const snap = {
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
};
it("debug", () => {
  const ci = new Date("2026-09-20T16:30:00Z");
  console.log("TZ", process.env.TZ, "berlinMin", berlinMinutes(ci), "e1", minutesSinceCheckIn(ci, "21:29"));
  console.log(JSON.stringify(scoreOperators([{ operator_name: "A", check_in_at: "2026-09-20T16:30:00Z", check_out_at: "2026-09-20T19:30:00Z", checklists: snap }])));
});
