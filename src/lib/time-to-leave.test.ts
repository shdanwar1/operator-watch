import { describe, expect, it } from "vitest";
import { firstCommuteEstimate } from "./time-to-leave";

describe("firstCommuteEstimate", () => {
  it("keeps only the first valid door-to-door times", () => {
    expect(
      firstCommuteEstimate({
        journeys: [
          {
            legs: [
              { departure: "2026-09-25T07:32:00.000Z", arrival: "2026-09-25T07:40:00.000Z" },
              { departure: "2026-09-25T07:44:00.000Z", arrival: "2026-09-25T07:55:00.000Z" },
            ],
          },
        ],
      }),
    ).toEqual({
      departureIso: "2026-09-25T07:32:00.000Z",
      arrivalIso: "2026-09-25T07:55:00.000Z",
      travelMinutes: 23,
    });
  });

  it("accepts planned times when live times are absent", () => {
    expect(
      firstCommuteEstimate({
        journeys: [{ legs: [{ plannedDeparture: "2026-09-25T07:20:00Z", plannedArrival: "2026-09-25T07:50:00Z" }] }],
      })?.travelMinutes,
    ).toBe(30);
  });

  it("returns null for unavailable or malformed journeys", () => {
    expect(firstCommuteEstimate(null)).toBeNull();
    expect(firstCommuteEstimate({ journeys: [] })).toBeNull();
    expect(firstCommuteEstimate({ journeys: [{ legs: [{ departure: "bad", arrival: "bad" }] }] })).toBeNull();
  });
});