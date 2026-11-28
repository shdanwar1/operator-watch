import { expect, it } from "vitest";
import {
  formatSpan,
  joinLocalDateTime,
  localDatePart,
  localTimePart,
  nudgeLocalDateTime,
  nudgeTime,
  spanMinutes,
} from "./time-entry";

it("nudges by 5 and 15 minutes", () => {
  expect(nudgeTime("07:30", 5)).toBe("07:35");
  expect(nudgeTime("07:30", -15)).toBe("07:15");
});
it("wraps across midnight like a clock", () => {
  expect(nudgeTime("00:05", -15)).toBe("23:50");
  expect(nudgeTime("23:55", 5)).toBe("00:00");
});
it("rejects invalid times", () => {
  expect(nudgeTime("", 5)).toBeNull();
  expect(nudgeTime("25:00", 5)).toBeNull();
});
it("measures overnight duration without going negative", () => {
  expect(spanMinutes("23:00", "00:15")).toBe(75);
  expect(spanMinutes("18:00", "19:15")).toBe(75);
  expect(formatSpan(75)).toBe("1 h 15 min");
});

it("keeps date and time edits in one local value", () => {
  const value = joinLocalDateTime("2026-11-28", "23:55");
  expect(localDatePart(value)).toBe("2026-11-28");
  expect(localTimePart(value)).toBe("23:55");
  expect(nudgeLocalDateTime(value, 5)).toBe("2026-11-29T00:00");
});

it("moves to the previous date when adjusting before midnight", () => {
  expect(nudgeLocalDateTime("2026-11-01T00:05", -15)).toBe("2026-10-31T23:50");
});

it("rejects incomplete or invalid record date-times", () => {
  expect(nudgeLocalDateTime("2026-11-28T", 5)).toBeNull();
  expect(nudgeLocalDateTime("2026-02-30T10:00", 5)).toBeNull();
});
