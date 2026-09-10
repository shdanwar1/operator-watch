import { describe, expect, it } from "vitest";
import {
  berlinWeekday,
  buildTimetableIndex,
  instructorDisplayName,
  localDurationMinutes,
  resolveDmcTimetableSlot,
  type DatedCommitment,
} from "./timetable-resolver";
import type { DmcTimetableSlot, DmcWeekday } from "./timetable";

function slot(over: Partial<DmcTimetableSlot> = {}): DmcTimetableSlot {
  return {
    sourceSlotId: "slot-1",
    sourceClassId: "class-1",
    sourceInstructorId: "inst-1",
    dayLocal: 3 as DmcWeekday, // Wednesday
    scheduleKey: "wed2130",
    startTimeLocal: "21:30",
    durationMinutes: 60,
    active: true,
    resumesOn: null,
    ...over,
  };
}

const CLASSES = [
  {
    sourceClassId: "class-1",
    className: "Ballet Class",
    category: "ballet",
    level: null,
    description: null,
    trailerId: null,
  },
];
const INSTRUCTORS = [
  {
    sourceInstructorId: "inst-1",
    firstName: "Ana",
    lastName: "Kovac",
    title: null,
    bioInfo: null,
    imageUrl: null,
  },
];

function index(slots: DmcTimetableSlot[]) {
  return buildTimetableIndex({ slots, classes: CLASSES, instructors: INSTRUCTORS });
}

// 2026-09-09 is a Wednesday.
const WED = "2026-09-09";

describe("berlinWeekday", () => {
  it("reads the weekday from the Berlin calendar date, without UTC drift", () => {
    expect(berlinWeekday("2026-09-09")).toBe(3);
    expect(berlinWeekday("2026-09-13")).toBe(0);
    // DST end in Europe/Berlin (2026-10-25) must not shift the weekday.
    expect(berlinWeekday("2026-10-25")).toBe(0);
  });
});

describe("localDurationMinutes", () => {
  it("handles midnight crossings", () => {
    expect(localDurationMinutes("21:30", "22:30")).toBe(60);
    expect(localDurationMinutes("23:30:00", "00:15:00")).toBe(45);
  });
});

describe("resolveDmcTimetableSlot", () => {
  const idx = index([slot()]);

  it("accepts an exact active match", () => {
    const r = resolveDmcTimetableSlot(idx, {
      date: WED,
      startTime: "21:30:00",
      endTime: "22:30:00",
    });
    expect(r.status).toBe("matched");
    if (r.status !== "matched") return;
    expect(r.classDef?.className).toBe("Ballet Class");
    expect(instructorDisplayName(r.instructor)).toBe("Ana Kovac");
  });

  it("accepts an empty-title free/busy block on the same time", () => {
    const r = resolveDmcTimetableSlot(idx, {
      date: WED,
      startTime: "21:30:00",
      endTime: "22:30:00",
      status: "confirmed",
    });
    expect(r.status).toBe("matched");
  });

  it("ignores titles entirely — a wrong-time 'Ballet Class' is rejected", () => {
    const r = resolveDmcTimetableSlot(idx, {
      date: WED,
      startTime: "19:00:00",
      endTime: "20:00:00",
    });
    expect(r.status).toBe("no-match");
  });

  it("rejects a one-minute start mismatch", () => {
    const r = resolveDmcTimetableSlot(idx, {
      date: WED,
      startTime: "21:31:00",
      endTime: "22:31:00",
    });
    expect(r.status).toBe("no-match");
  });

  it("rejects a duration mismatch on the same start", () => {
    const r = resolveDmcTimetableSlot(idx, {
      date: WED,
      startTime: "21:30:00",
      endTime: "22:15:00",
    });
    expect(r.status).toBe("no-match");
  });

  it("rejects the same time on a different weekday", () => {
    const r = resolveDmcTimetableSlot(idx, {
      date: "2026-09-10",
      startTime: "21:30:00",
      endTime: "22:30:00",
    });
    expect(r.status).toBe("no-match");
  });

  it("reports a suspended slot instead of matching it", () => {
    const r = resolveDmcTimetableSlot(index([slot({ active: false, resumesOn: "2026-10-01" })]), {
      date: WED,
      startTime: "21:30:00",
      endTime: "22:30:00",
    });
    expect(r.status).toBe("suspended");
  });

  it("rejects ambiguous duplicate active slots", () => {
    const r = resolveDmcTimetableSlot(index([slot(), slot({ sourceSlotId: "slot-2" })]), {
      date: WED,
      startTime: "21:30:00",
      endTime: "22:30:00",
    });
    expect(r.status).toBe("ambiguous");
  });

  it("matches a midnight slot on the correct weekday", () => {
    const midnight = index([
      slot({ dayLocal: 2 as DmcWeekday, scheduleKey: "tue0000", startTimeLocal: "00:00", durationMinutes: 45 }),
    ]);
    const r = resolveDmcTimetableSlot(midnight, {
      date: "2026-09-08", // Tuesday
      startTime: "00:00:00",
      endTime: "00:45:00",
    });
    expect(r.status).toBe("matched");
  });

  it("rejects cancelled and all-day events before lookup", () => {
    expect(
      resolveDmcTimetableSlot(idx, {
        date: WED,
        startTime: "21:30:00",
        endTime: "22:30:00",
        status: "cancelled",
      }).status,
    ).toBe("rejected");
    expect(
      resolveDmcTimetableSlot(idx, {
        date: WED,
        startTime: "00:00:00",
        endTime: "00:00:00",
        allDay: true,
      }).status,
    ).toBe("rejected");
  });

  it("matches nothing when the timetable is empty", () => {
    const r = resolveDmcTimetableSlot(index([]), {
      date: WED,
      startTime: "21:30:00",
      endTime: "22:30:00",
    });
    expect(r.status).toBe("no-match");
    expect(index([]).activeSlots).toBe(0);
  });
});

/*
 * Free/Busy regression: a Google calendar set to "See only free/busy
 * information" exposes no title, no description and no instructor. Such a
 * block must still resolve to its DMC class purely on Berlin date + time.
 */
describe("free/busy blocks (no title, no teacher, no class name)", () => {
  const timetable = buildTimetableIndex({
    slots: [slot({ sourceSlotId: "slot-bi", sourceClassId: "class-bi", sourceInstructorId: "inst-mp" })],
    classes: [
      {
        sourceClassId: "class-bi",
        className: "Beginner-Intermediate",
        category: "ballet",
        level: null,
        description: null,
        trailerId: null,
      },
    ],
    instructors: [
      {
        sourceInstructorId: "inst-mp",
        firstName: "Marco",
        lastName: "Palamone",
        title: null,
        bioInfo: null,
        imageUrl: null,
      },
    ],
  });

  // 2026-09-16 is a Wednesday.
  const busy = (over: Partial<DatedCommitment> = {}): DatedCommitment => ({
    date: "2026-09-16",
    startTime: "21:30:00",
    endTime: "22:30:00",
    status: "confirmed",
    ...over,
  });

  it("E/F/G: resolves a titleless busy block with full timetable metadata", () => {
    const r = resolveDmcTimetableSlot(timetable, busy());
    expect(r.status).toBe("matched");
    if (r.status !== "matched") return;
    expect(r.classDef?.className).toBe("Beginner-Intermediate");
    expect(instructorDisplayName(r.instructor)).toBe("Marco Palamone");
    expect(r.classDef?.category).toBe("ballet");
  });

  it("A: rejects a busy block with no timetable slot at that time", () => {
    expect(resolveDmcTimetableSlot(timetable, busy({ startTime: "10:00:00", endTime: "11:00:00" })).status).toBe(
      "no-match",
    );
  });

  it("B: rejects a one-minute start offset", () => {
    expect(
      resolveDmcTimetableSlot(timetable, busy({ startTime: "21:31:00", endTime: "22:31:00" })).status,
    ).toBe("no-match");
  });

  it("C: rejects a wrong duration on the right start", () => {
    expect(resolveDmcTimetableSlot(timetable, busy({ endTime: "22:15:00" })).status).toBe("no-match");
  });

  it("D: rejects a suspended matching slot", () => {
    const suspended = buildTimetableIndex({
      slots: [slot({ active: false, resumesOn: "2026-10-01" })],
      classes: CLASSES,
      instructors: INSTRUCTORS,
    });
    expect(resolveDmcTimetableSlot(suspended, busy()).status).toBe("suspended");
  });

  it("H: rejects an unrelated all-day busy block", () => {
    expect(
      resolveDmcTimetableSlot(timetable, busy({ startTime: "00:00:00", endTime: "00:00:00", allDay: true })).status,
    ).toBe("rejected");
  });

  it("resolves a midnight busy block on the Berlin weekday, not UTC", () => {
    const midnight = buildTimetableIndex({
      slots: [slot({ dayLocal: 2 as DmcWeekday, scheduleKey: "tue0000", startTimeLocal: "00:00", durationMinutes: 45 })],
      classes: CLASSES,
      instructors: INSTRUCTORS,
    });
    expect(
      resolveDmcTimetableSlot(midnight, busy({ date: "2026-09-15", startTime: "00:00:00", endTime: "00:45:00" }))
        .status,
    ).toBe("matched");
  });
});
