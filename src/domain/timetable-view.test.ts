import { describe, expect, it } from "vitest";
import {
  addMinutesLocal,
  buildTimetableWeek,
  resumesOnLabel,
  toDisplayCategory,
  WEEK_ORDER,
} from "./timetable-view";
import type { DmcTimetableSlot } from "./timetable";

const classes = [
  {
    sourceClassId: "c1",
    className: "Ballet Basics",
    category: "ballet class",
    level: "beginner",
    description: null,
    trailerId: null,
  },
];

const instructors = [
  {
    sourceInstructorId: "i1",
    firstName: "Alice",
    lastName: "Heyward",
    title: null,
    bioInfo: null,
    imageUrl: "https://example.com/a.jpg",
  },
];

const slot = (over: Partial<DmcTimetableSlot> = {}): DmcTimetableSlot => ({
  sourceSlotId: "s1",
  sourceClassId: "c1",
  sourceInstructorId: "i1",
  dayLocal: 1,
  scheduleKey: "mon1930",
  startTimeLocal: "19:30",
  durationMinutes: 60,
  active: true,
  resumesOn: null,
  ...over,
});

describe("addMinutesLocal", () => {
  it("adds wall-clock minutes", () => {
    expect(addMinutesLocal("08:00", 45)).toEqual({ time: "08:45", nextDay: false });
    expect(addMinutesLocal("19:30", 60)).toEqual({ time: "20:30", nextDay: false });
  });

  it("keeps a midnight class on its own day", () => {
    expect(addMinutesLocal("00:00", 45)).toEqual({ time: "00:45", nextDay: false });
    expect(addMinutesLocal("01:00", 60)).toEqual({ time: "02:00", nextDay: false });
  });

  it("flags a class that ends after midnight without moving the day", () => {
    expect(addMinutesLocal("23:30", 60)).toEqual({ time: "00:30", nextDay: true });
    expect(addMinutesLocal("23:15", 45)).toEqual({ time: "00:00", nextDay: true });
  });
});

describe("buildTimetableWeek", () => {
  it("orders days Monday first, Sunday last", () => {
    expect(WEEK_ORDER).toEqual([1, 2, 3, 4, 5, 6, 0]);
    const week = buildTimetableWeek({ slots: [], classes, instructors });
    expect(week.map((d) => d.label)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
  });

  it("resolves class and instructor and derives the end time", () => {
    const week = buildTimetableWeek({ slots: [slot()], classes, instructors });
    const card = week[0].cards[0];
    expect(card).toMatchObject({
      className: "Ballet Basics",
      category: "ballet class",
      displayCategory: "Ballet",
      instructorName: "Alice Heyward",
      instructorInitials: "AH",
      startTime: "19:30",
      endTime: "20:30",
      endsNextDay: false,
    });
  });

  it("normalizes workout and stretching to Workout, ballet to Ballet", () => {
    const mk = (cat: string) =>
      buildTimetableWeek({
        slots: [slot()],
        classes: [{ ...classes[0], sourceClassId: "c1", category: cat }],
        instructors,
      })[0].cards[0].displayCategory;
    expect(mk("workout")).toBe("Workout");
    expect(mk("stretching")).toBe("Workout");
    expect(mk("ballet class")).toBe("Ballet");
    expect(mk(null)).toBeNull();
  });

  it("sorts a day's classes by start time", () => {
    const week = buildTimetableWeek({
      slots: [
        slot({ sourceSlotId: "b", startTimeLocal: "20:00" }),
        slot({ sourceSlotId: "a", startTimeLocal: "08:00" }),
        slot({ sourceSlotId: "c", startTimeLocal: "00:00" }),
      ],
      classes,
      instructors,
    });
    expect(week[0].cards.map((c) => c.sourceSlotId)).toEqual(["c", "a", "b"]);
  });

  it("puts a Sunday slot in the last column", () => {
    const week = buildTimetableWeek({ slots: [slot({ dayLocal: 0 })], classes, instructors });
    expect(week[6].cards).toHaveLength(1);
    expect(week[0].cards).toHaveLength(0);
  });

  it("keeps suspended slots with their resume date", () => {
    const week = buildTimetableWeek({
      slots: [slot({ active: false, resumesOn: "2026-09-20" })],
      classes,
      instructors,
    });
    expect(week[0].cards[0]).toMatchObject({ active: false, resumesOn: "2026-09-20" });
  });

  it("renders safely when a reference is unexpectedly absent", () => {
    const week = buildTimetableWeek({ slots: [slot()], classes: [], instructors: [] });
    expect(week[0].cards[0]).toMatchObject({
      className: "Unknown class",
      instructorName: "Unknown instructor",
      instructorImageUrl: null,
    });
  });
});

describe("resumesOnLabel", () => {
  it("formats a resume date for display only", () => {
    expect(resumesOnLabel("2026-09-20")).toBe("Back on 20 September");
    expect(resumesOnLabel("2026-01-05")).toBe("Back on 5 January");
    expect(resumesOnLabel(null)).toBeNull();
  });
});
