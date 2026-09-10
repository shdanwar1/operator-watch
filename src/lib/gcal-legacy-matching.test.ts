import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Operation 7 guard: the DMC Live Timetable is the only authority that decides
 * whether a Google Calendar event is a DMC class. The legacy title/teacher/
 * alias matcher must stay gone.
 */
describe("legacy Google class/teacher matching is removed", () => {
  const server = readFileSync("src/lib/gcal.server.ts", "utf8");
  const functions = readFileSync("src/lib/gcal.functions.ts", "utf8");
  const card = readFileSync("src/components/ClassScheduleCard.tsx", "utf8");

  it("deletes the old matcher and eligibility modules", () => {
    expect(existsSync("src/lib/gcal-match.ts")).toBe(false);
    expect(existsSync("src/lib/class-eligibility.ts")).toBe(false);
  });

  it("keeps Google sync free of matcher, alias and eligibility dependencies", () => {
    for (const needle of [
      "gcal-match",
      "class-eligibility",
      "class_aliases",
      "aliasKeyFor",
      "matchEvent",
      "correctClassMapping",
    ]) {
      expect(server).not.toContain(needle);
    }
  });

  it("resolves DMC classes through the timetable resolver", () => {
    expect(server).toContain("resolveDmcTimetableSlot");
  });

  it("exposes no class-correction server function", () => {
    expect(functions).not.toContain("correctMyClassMatch");
    expect(functions).not.toContain("correctClassMapping");
  });

  it("removes the operator 'Fix class match' action but keeps lifecycle actions", () => {
    expect(card).not.toContain("Fix class match");
    expect(card).toContain("Mark as Completed");
    expect(card).toContain("Cancel Class");
  });
});
