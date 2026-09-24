import { describe, expect, it } from "vitest";
import { preCheckInState } from "./shift-phase";
import type { DisplayShift } from "./display-shifts";

const s = {
  id: "x",
  segments: [],
  startAt: new Date("2026-08-21T14:00:00"),
  endAt: new Date("2026-08-21T21:30:00"),
} as DisplayShift;
const at = (hm: string) => preCheckInState(s, new Date(`2026-08-21T${hm}`));

describe("preCheckInState", () => {
  it("follows the exact boundaries", () => {
    expect(at("12:59:59")).toBe("normal");
    expect(at("13:00:00")).toBe("window");
    expect(at("13:59:59")).toBe("window");
    expect(at("14:00:00")).toBe("late");
    expect(at("21:29:59")).toBe("late");
    expect(at("21:30:00")).toBe("normal");
    expect(preCheckInState(null, new Date())).toBe("normal");
  });
});
