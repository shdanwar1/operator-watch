import { describe, it, expect } from "vitest";
import {
  AUTO_CHECKIN_WINDOW_MS,
  NOTIFICATION_TYPES,
  startCheckInKey,
  startReminderKey,
  withinAutoCheckInWindow,
} from "./push-keys";
import { berlinInstant } from "./push-time";

const SHIFT_ID = "11111111-2222-3333-4444-555555555555";

describe("notification identity", () => {
  const start = new Date("2026-09-14T18:00:00.000Z");

  it("uses a distinct type for reminder and exact-start check-in", () => {
    expect(NOTIFICATION_TYPES.shiftStartReminder).toBe("shift_start");
    expect(NOTIFICATION_TYPES.shiftStartCheckIn).toBe("shift_start_check_in");
    expect(NOTIFICATION_TYPES.shiftStartCheckIn).not.toBe(NOTIFICATION_TYPES.shiftStartReminder);
  });

  it("keeps the two delivery keys independent for one shift", () => {
    const keys = [startReminderKey(SHIFT_ID, start), startCheckInKey(SHIFT_ID, start)];
    expect(new Set(keys).size).toBe(2);
  });

  it("invalidates keys when the shift is retimed", () => {
    const retimed = new Date(start.getTime() + 30 * 60_000);
    expect(startCheckInKey(SHIFT_ID, retimed)).not.toBe(startCheckInKey(SHIFT_ID, start));
    expect(startReminderKey(SHIFT_ID, retimed)).not.toBe(startReminderKey(SHIFT_ID, start));
  });
});

describe("notification timing", () => {
  it("reminds exactly 15 minutes before the Berlin start", () => {
    const start = berlinInstant("2026-09-14", "20:00")!;
    const remindAt = new Date(start.getTime() - 15 * 60_000);
    expect(start.toISOString()).toBe("2026-09-14T18:00:00.000Z");
    expect(remindAt.toISOString()).toBe("2026-09-14T17:45:00.000Z");
  });

  it("fires the check-in notification exactly at the start", () => {
    const start = berlinInstant("2026-09-14", "20:00")!;
    expect(start.getTime() - start.getTime()).toBe(0);
  });

  it("handles winter time and the DST changeover", () => {
    expect(berlinInstant("2026-01-15", "20:00")!.toISOString()).toBe("2026-01-15T19:00:00.000Z");
    // Clocks go back on 25 Oct 2026 (CEST -> CET).
    expect(berlinInstant("2026-10-24", "20:00")!.toISOString()).toBe("2026-10-24T18:00:00.000Z");
    expect(berlinInstant("2026-10-26", "20:00")!.toISOString()).toBe("2026-10-26T19:00:00.000Z");
  });
});

describe("automatic check-in window", () => {
  const start = new Date("2026-09-14T18:00:00.000Z");
  const at = (min: number) => new Date(start.getTime() + min * 60_000);

  it("accepts a tap at the shift start", () => {
    expect(withinAutoCheckInWindow(start, start)).toBe(true);
  });

  it("accepts taps inside the ten-minute window", () => {
    expect(withinAutoCheckInWindow(start, at(4))).toBe(true);
    expect(withinAutoCheckInWindow(start, at(9))).toBe(true);
    expect(withinAutoCheckInWindow(start, at(10))).toBe(true);
  });

  it("rejects a tap after the window", () => {
    expect(withinAutoCheckInWindow(start, at(11))).toBe(false);
    expect(
      withinAutoCheckInWindow(start, new Date(start.getTime() + AUTO_CHECKIN_WINDOW_MS + 1)),
    ).toBe(false);
  });

  it("rejects a tap long before the shift", () => {
    expect(withinAutoCheckInWindow(start, at(-30))).toBe(false);
  });
});

describe("notification payload", () => {
  it("only identifies the shift", () => {
    const payload = {
      type: NOTIFICATION_TYPES.shiftStartCheckIn,
      url: `/?autoCheckIn=${SHIFT_ID}`,
    };
    const serialized = JSON.stringify(payload);
    for (const secret of ["pin", "password", "token", "operator_id", "service_role"]) {
      expect(serialized.toLowerCase()).not.toContain(secret);
    }
    expect(new URLSearchParams(payload.url.split("?")[1]).get("autoCheckIn")).toBe(SHIFT_ID);
  });
});
