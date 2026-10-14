import { describe, expect, it } from "vitest";
import { classFilenameOf } from "./ClassScheduleCard";

describe("classFilenameOf", () => {
  it("formats the filename from the spec example", () => {
    expect(
      classFilenameOf({
        specific_date: "2026-10-14",
        start_time: "09:00",
        teacherName: "Anna Freedman",
        className: "Ballerina Posture & Grace",
      }),
    ).toBe("261014_09-00_Anna Freedman_Ballerina Posture & Grace");
  });

  it("pads month, day and minutes", () => {
    expect(
      classFilenameOf({
        specific_date: "2026-01-02",
        start_time: "07:05",
        teacherName: "Alex Rho",
        className: "Morning Flow",
      }),
    ).toBe("260102_07-05_Alex Rho_Morning Flow");
  });
});
