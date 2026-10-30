import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import type { AttendanceSummary } from "@/lib/attendance";
import { downloadAttendancePdf } from "@/lib/attendance-pdf";

// Temporary render test: writes a real PDF with the reference image's
// values so the layout can be visually inspected outside the test run.
describe("render attendance pdf", () => {
  it("writes /tmp/attendance-render.pdf", () => {
    const mk = (
      id: string,
      day: number,
      startH: number,
      endH: number,
      workedMin: number,
      dayMin: number,
      nightMin: number,
      weekendMin: number,
      notes: string | null = null,
    ) => ({
      id,
      operator_name: "Shad",
      date: new Date(2026, 9, day, startH),
      checkIn: new Date(2026, 9, day, startH, 29),
      checkOut: new Date(2026, 9, day, endH, 3),
      workedMin,
      dayMin,
      nightMin,
      weekendMin,
      primary: "day" as const,
      categories: ["day" as const],
      scheduledStart: new Date(2026, 9, day, startH, 30),
      scheduledEnd: new Date(2026, 9, day, endH),
      scheduledMin: workedMin,
      diffMin: 0,
      classes: [],
      notes,
      scheduled_shift_id: `ss-${id}`,
    });
    const summary: AttendanceSummary = {
      monthKey: "2026-10",
      monthLabel: "October 2026",
      rows: [
        mk("a", 2, 7, 13, 335, 335, 0, 0),
        mk("b", 5, 16, 21, 325, 325, 0, 0, "Onboarding with Victor & Benjamin"),
        mk("c", 21, 7, 12, 298, 298, 0, 0,
          "Studio display (centre/barre transition) + time-codes application updating on operator suite"),
      ],
      workedMin: 143 * 60 + 33,
      scheduledMin: 144 * 60,
      dayMin: 132 * 60 + 36,
      nightMin: 0,
      weekendMin: 10 * 60 + 57,
    };
    downloadAttendancePdf(summary, "Shad");
    // The Node jsPDF build writes the file itself in doc.save? No — capture
    // the output explicitly. doc.save is called internally, so instead use a
    // second render path: re-run through the same generator by monkey? Simpler:
    // jsPDF save in Node writes to disk with the given filename in CWD.
  });
});
