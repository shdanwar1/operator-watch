import { describe, expect, it, vi } from "vitest";
import {
  commuteRouteKey,
  latestValidJourney,
  leaveFromDuration,
  leaveNotificationAt,
  requiredArrival,
} from "./time-to-leave";
import { liveCommute } from "./time-to-leave.server";
import { berlinClock, berlinInstant } from "./push-time";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

const walk = (dep: string, arr: string) => ({ walking: true, departure: dep, arrival: arr });
const ride = (dep: string, arr: string) => ({ departure: dep, arrival: arr });
const j = (...legs: object[]) => ({ legs });
const home = { lat: 52.52, lng: 13.4 };
const studio = { lat: 52.5, lng: 13.35 };

describe("latestValidJourney", () => {
  const shift = berlinInstant("2026-09-25", "10:00")!; // Berlin CEST
  const required = requiredArrival(shift).getTime(); // 09:55 Berlin

  it("normal weekday: home departure includes the walk from home", () => {
    const r = latestValidJourney(
      { journeys: [j(walk("2026-09-25T09:05:00+02:00", "2026-09-25T09:12:00+02:00"), ride("2026-09-25T09:14:00+02:00", "2026-09-25T09:48:00+02:00"))] },
      required,
    )!;
    expect(berlinClock(new Date(r.departureIso))).toBe("09:05");
    expect(r.travelMinutes).toBe(43);
  });

  it("picks the latest journey arriving by the required time, rejecting late ones", () => {
    const r = latestValidJourney(
      {
        journeys: [
          j(ride("2026-09-25T08:50:00+02:00", "2026-09-25T09:30:00+02:00")),
          j(ride("2026-09-25T09:05:00+02:00", "2026-09-25T09:48:00+02:00")),
          j(ride("2026-09-25T09:20:00+02:00", "2026-09-25T10:02:00+02:00")),
        ],
      },
      required,
    )!;
    expect(berlinClock(new Date(r.departureIso))).toBe("09:05");
  });

  it("returns null for empty, malformed or only-late responses", () => {
    expect(latestValidJourney({ journeys: [] }, required)).toBeNull();
    expect(latestValidJourney(null, required)).toBeNull();
    expect(latestValidJourney({ journeys: [{ legs: [{}] }, { nope: 1 }] }, required)).toBeNull();
    expect(
      latestValidJourney({ journeys: [j(ride("2026-09-25T09:30:00+02:00", "2026-09-25T10:01:00+02:00"))] }, required),
    ).toBeNull();
  });

  it("falls back to planned times", () => {
    const r = latestValidJourney(
      { journeys: [{ legs: [{ plannedDeparture: "2026-09-25T09:10:00+02:00", plannedArrival: "2026-09-25T09:40:00+02:00" }] }] },
      required,
    );
    expect(r?.travelMinutes).toBe(30);
  });
});

describe("liveCommute", () => {
  const shift = berlinInstant("2026-09-25", "10:00")!;

  it("retries with adjusted times after errors / empty results, then stops", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("VBB 500"))
      .mockResolvedValueOnce({ journeys: [] })
      .mockResolvedValueOnce({ journeys: [j(ride("2026-09-25T09:10:00+02:00", "2026-09-25T09:50:00+02:00"))] });
    const r = await liveCommute(home, studio, shift, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(r?.travelMinutes).toBe(40);
  });

  it("makes one request when the first succeeds", async () => {
    const fetcher = vi.fn().mockResolvedValue({ journeys: [j(ride("2026-09-25T09:10:00+02:00", "2026-09-25T09:50:00+02:00"))] });
    await liveCommute(home, studio, shift, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns null when the API is unavailable for every attempt", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("down"));
    expect(await liveCommute(home, studio, shift, fetcher)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("different times of day can yield different durations", async () => {
    const eve = berlinInstant("2026-09-25", "18:00")!;
    const fetcher = vi.fn(async (_h, _s, arrival: Date) =>
      arrival.getTime() < eve.getTime() - 60 * 60_000
        ? { journeys: [j(ride("2026-09-25T09:10:00+02:00", "2026-09-25T09:50:00+02:00"))] }
        : { journeys: [j(ride("2026-09-25T17:30:00+02:00", "2026-09-25T17:52:00+02:00"))] },
    );
    expect((await liveCommute(home, studio, shift, fetcher))?.travelMinutes).toBe(40);
    expect((await liveCommute(home, studio, eve, fetcher))?.travelMinutes).toBe(22);
  });
});

describe("fallback and Berlin time", () => {
  it("fallback duration: 10:00 shift, 50 min → leave 09:05", () => {
    const shift = berlinInstant("2026-09-25", "10:00")!;
    expect(berlinClock(leaveFromDuration(shift, 50))).toBe("09:05");
  });

  it("shift just after midnight leaves the previous evening", () => {
    const shift = berlinInstant("2026-09-26", "00:30")!;
    const leave = leaveFromDuration(shift, 40);
    expect(berlinClock(leave)).toBe("23:45");
    expect(leave.toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" })).toBe("2026-09-25");
  });

  it("DST change night (CEST→CET) stays in absolute time", () => {
    const shift = berlinInstant("2026-10-25", "03:30")!; // after clocks go back
    expect(berlinClock(leaveFromDuration(shift, 60))).toBe("02:25");
  });

  it("route key changes when home moves", () => {
    expect(commuteRouteKey(home, studio)).not.toBe(commuteRouteKey({ lat: 52.53, lng: 13.4 }, studio));
  });
});

describe("leave-home notification timing", () => {
  it("Time to Leave 09:05 → notification exactly 08:50 Berlin", () => {
    const leave = berlinInstant("2026-09-25", "09:05")!;
    const now = berlinInstant("2026-09-25", "08:00")!.getTime();
    expect(berlinClock(leaveNotificationAt(leave, now)!)).toBe("08:50");
  });

  it("no stale notification once the leave time has passed", () => {
    const leave = berlinInstant("2026-09-25", "09:05")!;
    expect(leaveNotificationAt(leave, berlinInstant("2026-09-25", "09:06")!.getTime())).toBeNull();
  });
});
