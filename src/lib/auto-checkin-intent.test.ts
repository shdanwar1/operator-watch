import { describe, it, expect } from "vitest";
import {
  INTENT_TTL_MS,
  intentFromSearch,
  parseStoredIntent,
  serializeIntent,
} from "./auto-checkin-intent";

const ID = "11111111-2222-3333-4444-555555555555";

describe("auto check-in intent", () => {
  it("reads the shift id from the notification URL", () => {
    expect(intentFromSearch(`?autoCheckIn=${ID}`)).toBe(ID);
    expect(intentFromSearch(`?foo=1&autoCheckIn=${ID}`)).toBe(ID);
  });

  it("ignores anything that is not a shift id", () => {
    expect(intentFromSearch("?autoCheckIn=Shad")).toBeNull();
    expect(intentFromSearch("?autoCheckIn=")).toBeNull();
    expect(intentFromSearch("")).toBeNull();
  });

  it("survives being parked while the operator signs in", () => {
    const at = Date.now();
    const raw = serializeIntent(ID, at);
    expect(parseStoredIntent(raw, at + 60_000)).toBe(ID);
  });

  it("drops a stale or corrupt intent", () => {
    const at = Date.now();
    expect(parseStoredIntent(serializeIntent(ID, at), at + INTENT_TTL_MS + 1)).toBeNull();
    expect(parseStoredIntent("not json", at)).toBeNull();
    expect(parseStoredIntent(null, at)).toBeNull();
    expect(parseStoredIntent(JSON.stringify({ id: "x", at }), at)).toBeNull();
  });
});
