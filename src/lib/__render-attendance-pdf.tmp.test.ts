// Temporary harness: render the real attendance PDF and save it to /tmp
// so we can inspect the actual output (columns, notes wrapping, summary).
import { describe, it, vi } from "vitest";
import { existsSync, statSync, writeFileSync } from "node:fs";
import jsPDF from "jspdf";
import { downloadAttendancePdf } from "@/lib/attendance-pdf";
import { summarizeMonth } from "@/lib/attendance";
import type { ShiftRow, ScheduledShiftRow } from "@/lib/shifts.functions";

// The jsPDF Node build writes the file directly in save(); no interception needed.

describe("render real attendance pdf", () => {
  it("writes /tmp/attendance-check.pdf", () => {
    const scheduled: ScheduledShiftRow[] = [
      {
        id: "ss1", operator_name: "Shad", day_of_week: 5, specific_date: "2026-10-02",
        start_time: "14:30", end_time: "21:30", shift_type: "day",
      } as unknown as ScheduledShiftRow,
    ];
    const shifts: ShiftRow[] = [
      {
        id: "s1", operator_name: "Shad",
        check_in_at: "2026-10-02T12:25:00Z", check_out_at: "2026-10-02T19:40:00Z",
        scheduled_shift_id: "ss1", classes: [],
        notes: "Stayed 40 minutes late to cover the evening deep clean and hand over keys to the night operator because Victor's train was cancelled.",
      },
      {
        id: "s2", operator_name: "Shad",
        check_in_at: "2026-10-03T12:30:00Z", check_out_at: "2026-10-03T19:35:00Z",
        scheduled_shift_id: "ss1", classes: [], notes: null,
      },
      {
        id: "s3", operator_name: "Shad",
        check_in_at: "2026-10-06T12:20:00Z", check_out_at: "2026-10-06T19:50:00Z",
        scheduled_shift_id: "ss1", classes: [],
        notes: "Opened the studio early for a private session before the regular timetable.",
      },
    ] as unknown as ShiftRow[];
    const summary = summarizeMonth(shifts, scheduled, new Date(2026, 9, 1));
    downloadAttendancePdf(summary, "Shad");
    if (!existsSync("/tmp/attendance-check.pdf")) {
      throw new Error("PDF was not written — save() was not intercepted");
    }
    console.log("PDF size:", statSync("/tmp/attendance-check.pdf").size);
  });
});
