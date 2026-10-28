import { describe, expect, it } from "vitest";
import { automationStatus, healthError, type AutomationHealthRow } from "./automation-health";
const now = Date.parse("2026-10-28T08:00:00Z");
function row(patch: Partial<AutomationHealthRow> = {}): AutomationHealthRow {
  return { process: "push_dispatch", attempted_at: new Date(now).toISOString(), finished_at: new Date(now).toISOString(), last_success_at: null, outcome: "noop", duration_ms: 100, counters: {}, stages: {}, error_code: null, last_error_code: null, last_error_at: null, ...patch };
}
describe("automation freshness and outcomes", () => {
  it("does not label successful inactivity a failure", () => expect(automationStatus(row(), now, false)).toBe("Nothing due"));
  it("does not label an unobserved process healthy", () => expect(automationStatus(undefined, now, false)).toBe("Not observed"));
  it("reports partial and failed outcomes even when recent", () => {
    expect(automationStatus(row({ outcome: "partial" }), now, false)).toBe("Partial failure");
    expect(automationStatus(row({ outcome: "failed" }), now, false)).toBe("Failed");
  });
  it("allows 26 hours for daily timetable freshness", () => {
    const at = new Date(now - 26 * 60 * 60_000).toISOString();
    expect(automationStatus(row({ process: "timetable_sync", finished_at: at }), now, false)).toBe("Nothing due");
    expect(automationStatus(row({ process: "timetable_sync", finished_at: at }), now + 1, false)).toBe("Out of date");
  });
  it("conditional minute jobs are idle when no work is due, not broken", () => {
    const old = row({ finished_at: new Date(now - 13 * 60_000).toISOString() });
    expect(automationStatus(old, now, false)).toBe("Idle");
    expect(automationStatus(old, now, true)).toBe("Awaiting check");
    expect(automationStatus(old, now, null)).toBe("Freshness unavailable");
  });
  it("never exposes unknown raw diagnostic text", () => {
    expect(healthError("secret-token-and-device-url")).toBe("The process reported an error.");
    expect(healthError(null)).toBeNull();
  });
});