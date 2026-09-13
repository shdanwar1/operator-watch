import { describe, expect, it } from "vitest";
import {
  berlinDate,
  buildOperatorBoard,
  currentBerlinMonth,
  currentBerlinWeek,
  monthWeekRanges,
  weekIndexForDate,
  weekRangeShortLabel,
  dayDateLabel,
  resolveOperator,
  weekdayOf,
  weekRangeLabel,
  weekDatesAtOffset,
  weekDatesFrom,
  weekRangeCompactLabel,
  weekMonthTitle,
  type ClassOccurrence,
} from "./timetable-week";
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
  {
    sourceClassId: "c2",
    className: "Full Body",
    category: "workout",
    level: null,
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
    imageUrl: null,
  },
];

const slot = (over: Partial<DmcTimetableSlot> = {}): DmcTimetableSlot => ({
  sourceSlotId: "s1",
  sourceClassId: "c1",
  sourceInstructorId: "i1",
  dayLocal: 1,
  scheduleKey: "mon0900",
  startTimeLocal: "09:00",
  durationMinutes: 45,
  active: true,
  resumesOn: null,
  ...over,
});

const occurrence = (over: Partial<ClassOccurrence> = {}): ClassOccurrence => ({
  id: "o1",
  specificDate: "2026-09-14",
  startTime: "09:00:00",
  endTime: "09:45:00",
  dmcClassId: "db-c1",
  dmcInstructorId: "db-i1",
  status: "confirmed",
  scheduledShiftId: "shift-1",
  operator: "shad",
  ...over,
});

const classIdBySource = { c1: "db-c1", c2: "db-c2" };

const board = (over: Partial<Parameters<typeof buildOperatorBoard>[0]> = {}) =>
  buildOperatorBoard({
    weekDates: currentBerlinWeek(new Date("2026-09-16T10:00:00Z")),
    slots: [slot()],
    classes,
    instructors,
    occurrences: [occurrence()],
    shifts: [{ id: "shift-1", assignedOperator: "Alex" }],
    classIdBySource,
    ...over,
  });

describe("Berlin week arithmetic", () => {
  it("resolves the Monday–Sunday week containing a Wednesday", () => {
    const week = currentBerlinWeek(new Date("2026-09-16T10:00:00Z"));
    expect(week).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]);
  });

  it("keeps Sunday in the week that started on the preceding Monday", () => {
    expect(currentBerlinWeek(new Date("2026-09-20T12:00:00Z"))[0]).toBe("2026-09-14");
  });

  it("rolls over to the new week at Berlin midnight, not UTC midnight", () => {
    // 22:30 UTC Sunday is already Monday 00:30 in Berlin (CEST).
    expect(berlinDate(new Date("2026-09-20T22:30:00Z"))).toBe("2026-09-21");
    expect(currentBerlinWeek(new Date("2026-09-20T22:30:00Z"))[0]).toBe("2026-09-21");
  });

  it("crosses month and DST boundaries", () => {
    // DST ends in Berlin on 25 October 2026.
    expect(currentBerlinWeek(new Date("2026-10-28T09:00:00Z"))).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
  });

  it("labels the week and its days", () => {
    expect(weekRangeLabel(currentBerlinWeek(new Date("2026-09-16T10:00:00Z")))).toBe(
      "14–20 September 2026",
    );
    expect(dayDateLabel("2026-09-14")).toBe("14 September");
    expect(weekdayOf("2026-09-14")).toBe(1);
    expect(weekdayOf("2026-09-20")).toBe(0);
  });
});

describe("operator resolution", () => {
  const shifts = new Map([["shift-1", { id: "shift-1", assignedOperator: "Alex" }]]);

  it("prefers the scheduled shift's current operator over the stored one", () => {
    expect(resolveOperator(occurrence({ operator: "shad" }), shifts)).toBe("Alex");
  });

  it("falls back to the class row when the shift is gone", () => {
    expect(resolveOperator(occurrence({ scheduledShiftId: "missing" }), shifts)).toBe("shad");
  });

  it("returns null when neither has an operator", () => {
    expect(
      resolveOperator(occurrence({ scheduledShiftId: null, operator: null }), shifts),
    ).toBeNull();
    expect(resolveOperator(null, shifts)).toBeNull();
  });

  it("treats a blank assigned operator on the shift as unassigned", () => {
    expect(
      resolveOperator(
        occurrence(),
        new Map([["shift-1", { id: "shift-1", assignedOperator: "   " }]]),
      ),
    ).toBeNull();
  });
});

describe("operator board", () => {
  it("always renders all seven days of the current week", () => {
    const week = board();
    expect(week).toHaveLength(7);
    expect(week.map((d) => d.weekday)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
    expect(week[0].date).toBe("2026-09-14");
  });

  it("shows the reassigned operator, not the stale class-row operator", () => {
    const card = board().find((d) => d.date === "2026-09-14")!.cards[0];
    expect(card.operatorName).toBe("Alex");
    expect(card.assigned).toBe(true);
    expect(card.className).toBe("Ballet Basics");
  });

  it("falls back to the class-row operator when the shift is missing", () => {
    const card = board({ shifts: [] }).find((d) => d.date === "2026-09-14")!.cards[0];
    expect(card.operatorName).toBe("shad");
  });

  it("marks a DMC class with no dated row as unassigned but still shows it", () => {
    const week = board({ occurrences: [], shifts: [] });
    const card = week.find((d) => d.date === "2026-09-14")!.cards[0];
    expect(card.assigned).toBe(false);
    expect(card.operatorName).toBeNull();
  });

  it("includes classes from every operator", () => {
    const week = board({
      slots: [slot(), slot({ sourceSlotId: "s2", sourceClassId: "c2", startTimeLocal: "11:00" })],
      occurrences: [
        occurrence(),
        occurrence({
          id: "o2",
          dmcClassId: "db-c2",
          startTime: "11:00:00",
          scheduledShiftId: "shift-2",
          operator: "nina",
        }),
      ],
      shifts: [
        { id: "shift-1", assignedOperator: "Alex" },
        { id: "shift-2", assignedOperator: "Nina" },
      ],
    });
    expect(week[0].cards.map((c) => c.operatorName)).toEqual(["Alex", "Nina"]);
  });

  it("matches on DMC identity, date and start time — never on titles", () => {
    // Same class id but a different start time: not the same occurrence.
    const week = board({ occurrences: [occurrence({ startTime: "18:00:00" })], shifts: [] });
    expect(week[0].cards[0].assigned).toBe(false);

    // Different class id at the same time: also not a match.
    const other = board({ occurrences: [occurrence({ dmcClassId: "db-c2" })], shifts: [] });
    expect(other[0].cards[0].assigned).toBe(false);
  });

  it("keeps suspended classes visible with their resume note untouched", () => {
    const week = board({ slots: [slot({ active: false, resumesOn: "2026-09-20" })] });
    const card = week[0].cards[0];
    expect(card.active).toBe(false);
    expect(card.resumesOn).toBe("2026-09-20");
    expect(card.operatorName).toBe("Alex");
  });

  it("does not mutate its inputs", () => {
    const slots = [slot({ active: false, resumesOn: "2026-09-20" })];
    const occurrences = [occurrence()];
    board({ slots, occurrences });
    expect(slots[0]).toEqual(slot({ active: false, resumesOn: "2026-09-20" }));
    expect(occurrences[0]).toEqual(occurrence());
  });
});

describe("current month and its four week views", () => {
  it("resolves the current Berlin month", () => {
    expect(currentBerlinMonth(new Date("2026-09-16T10:00:00Z"))).toEqual({ year: 2026, month: 9 });
    // 22:30 UTC on 30 September is already 1 October in Berlin.
    expect(currentBerlinMonth(new Date("2026-09-30T22:30:00Z"))).toEqual({ year: 2026, month: 10 });
  });

  it("divides the month into exactly four fixed ranges", () => {
    const sep = monthWeekRanges(2026, 9);
    expect(sep).toHaveLength(4);
    expect(sep[0][0]).toBe("2026-09-01");
    expect(sep[0].at(-1)).toBe("2026-09-07");
    expect(sep[1][0]).toBe("2026-09-08");
    expect(sep[1].at(-1)).toBe("2026-09-14");
    expect(sep[2][0]).toBe("2026-09-15");
    expect(sep[2].at(-1)).toBe("2026-09-21");
    expect(sep[3][0]).toBe("2026-09-22");
    expect(sep[3].at(-1)).toBe("2026-09-30");

    // Week 4 stops on the real final day; there is never a fifth week.
    expect(monthWeekRanges(2026, 10)[3].at(-1)).toBe("2026-10-31");
    expect(monthWeekRanges(2027, 2)[3].at(-1)).toBe("2027-02-28");
    expect(monthWeekRanges(2028, 2)[3].at(-1)).toBe("2028-02-29");
  });

  it("never leaks a date from another month", () => {
    for (const week of monthWeekRanges(2026, 9)) {
      for (const date of week) expect(date.startsWith("2026-09-")).toBe(true);
    }
  });

  it("selects the week containing today", () => {
    expect(weekIndexForDate("2026-09-01")).toBe(0);
    expect(weekIndexForDate("2026-09-13")).toBe(1);
    expect(weekIndexForDate("2026-09-21")).toBe(2);
    expect(weekIndexForDate("2026-09-28")).toBe(3);
  });

  it("labels each week range compactly", () => {
    const [w1, , , w4] = monthWeekRanges(2026, 9);
    expect(weekRangeShortLabel(w1)).toBe("1–7 Sep");
    expect(weekRangeShortLabel(w4)).toBe("22–30 Sep");
  });
});

describe("dated suspended / resumesOn occurrences", () => {
  const monthBoard = (over: Partial<Parameters<typeof buildOperatorBoard>[0]> = {}) =>
    buildOperatorBoard({
      weekDates: monthWeekRanges(2026, 9).flat(),
      slots: [slot()],
      classes,
      instructors,
      occurrences: [],
      shifts: [],
      classIdBySource,
      ...over,
    });

  const cardOn = (days: ReturnType<typeof monthBoard>, date: string) =>
    days.find((d) => d.date === date)!.cards[0];

  it("treats an active slot as operational on every occurrence", () => {
    const days = monthBoard();
    expect(cardOn(days, "2026-09-07").active).toBe(true);
    expect(cardOn(days, "2026-09-28").active).toBe(true);
  });

  it("keeps a suspended slot with no resume date suspended everywhere", () => {
    const days = monthBoard({ slots: [slot({ active: false, resumesOn: null })] });
    expect(cardOn(days, "2026-09-07").active).toBe(false);
    expect(cardOn(days, "2026-09-28").active).toBe(false);
  });

  it("flips from suspended to operational on the resume date", () => {
    const slots = [slot({ active: false, resumesOn: "2026-09-21" })];
    const days = monthBoard({ slots });
    expect(cardOn(days, "2026-09-14").active).toBe(false);
    expect(cardOn(days, "2026-09-21").active).toBe(true);
    expect(cardOn(days, "2026-09-28").active).toBe(true);
    // The stored slot state itself is never mutated.
    expect(slots[0].active).toBe(false);
    expect(slots[0].resumesOn).toBe("2026-09-21");
  });

  it("keeps the resume note available while suspended", () => {
    const days = monthBoard({ slots: [slot({ active: false, resumesOn: "2026-09-21" })] });
    expect(cardOn(days, "2026-09-14").resumesOn).toBe("2026-09-21");
  });
});

describe("Google-Calendar-style week navigation", () => {
  it("always shows a Monday→Sunday week containing today", () => {
    const week = weekDatesAtOffset(berlinDate(new Date("2026-09-13T10:00:00Z")), 0);
    expect(week[0]).toBe("2026-09-07");
    expect(week.at(-1)).toBe("2026-09-13");
    expect(weekdayOf(week[0])).toBe(1);
    expect(weekdayOf(week.at(-1)!)).toBe(0);
  });

  it("moves exactly seven days per step, in both directions", () => {
    const today = "2026-09-13";
    expect(weekDatesAtOffset(today, -1)[0]).toBe("2026-08-31");
    expect(weekDatesAtOffset(today, 1)[0]).toBe("2026-09-14");
    expect(weekDatesAtOffset(today, 3)).toEqual(weekDatesFrom("2026-09-28"));
    expect(weekDatesAtOffset(today, 3).at(-1)).toBe("2026-10-04");
  });

  it("shows weeks that cross a month boundary", () => {
    expect(weekDatesAtOffset("2026-09-13", -1)).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
    expect(weekRangeCompactLabel(weekDatesAtOffset("2026-09-13", -1))).toBe("31 Aug – 6 Sep");
    expect(weekMonthTitle(weekDatesAtOffset("2026-09-13", -1))).toBe("August / September 2026");
    expect(weekMonthTitle(weekDatesFrom("2026-09-14"))).toBe("September 2026");
    expect(weekMonthTitle(weekDatesAtOffset("2026-09-13", 3))).toBe("September / October 2026");
  });
});

describe("month-scoped operator assignment", () => {
  const septemberBoard = (weekDates: string[]) =>
    buildOperatorBoard({
      weekDates,
      // A Monday slot and a Thursday slot, so out-of-month days have classes too.
      slots: [slot(), slot({ sourceSlotId: "s2", dayLocal: 4 })],
      classes,
      instructors,
      occurrences: [
        occurrence({ specificDate: "2026-08-31" }),
        occurrence({ specificDate: "2026-09-14" }),
        occurrence({ id: "o3", specificDate: "2026-10-01" }),
      ],
      shifts: [{ id: "shift-1", assignedOperator: "Alex" }],
      classIdBySource,
      assignmentMonth: "2026-09",
    });

  it("shows 31 August classes with no operator while September is current", () => {
    const day = septemberBoard(weekDatesAtOffset("2026-09-13", -1)).find(
      (d) => d.date === "2026-08-31",
    )!;
    expect(day.cards).toHaveLength(1);
    expect(day.cards[0].assigned).toBe(false);
    expect(day.cards[0].operatorName).toBeNull();
  });

  it("uses September assignments for September dates", () => {
    const day = septemberBoard(weekDatesFrom("2026-09-14")).find((d) => d.date === "2026-09-14")!;
    expect(day.cards[0].operatorName).toBe("Alex");
  });

  it("shows 1–4 October classes with no operator", () => {
    const week = septemberBoard(weekDatesAtOffset("2026-09-13", 3));
    const oct1 = week.find((d) => d.date === "2026-10-01")!;
    expect(oct1.cards).toHaveLength(1);
    expect(oct1.cards[0].operatorName).toBeNull();
    for (const d of week.filter((d) => d.date >= "2026-10-01")) {
      for (const c of d.cards) expect(c.assigned).toBe(false);
    }
  });

  it("keeps resumesOn date-aware across the month boundary", () => {
    const week = buildOperatorBoard({
      weekDates: weekDatesAtOffset("2026-09-13", 3),
      slots: [slot({ active: false, resumesOn: "2026-10-01" })],
      classes,
      instructors,
      occurrences: [],
      shifts: [],
      classIdBySource,
      assignmentMonth: "2026-09",
    });
    expect(week.find((d) => d.date === "2026-09-28")!.cards[0].active).toBe(false);
    expect(week.find((d) => d.date === "2026-10-05")).toBeUndefined();
  });
});
