import { describe, expect, it } from "vitest";
import {
  indexOperators,
  normalizeUsername,
  operatorForAssignment,
  resolveAssignment,
  sameOperator,
  statusForAssignment,
} from "./operator-identity";
import { assignmentFrom, assignmentToColumn, UNASSIGNED } from "./types";
import type { OperatorIdentity } from "./types";

const directory: OperatorIdentity[] = [
  { id: "op-1", username: "Shad", isAdmin: true, isActive: true },
  { id: "op-2", username: "Alex", isAdmin: false, isActive: true },
  { id: "op-3", username: "Max", isAdmin: false, isActive: false },
];

describe("operator identity", () => {
  it("normalizes names for comparison only", () => {
    expect(normalizeUsername("  Shad ")).toBe("shad");
    expect(normalizeUsername(null)).toBe("");
  });

  it("matches operators case-insensitively and never matches blanks", () => {
    expect(sameOperator("shad", "SHAD")).toBe(true);
    expect(sameOperator(" Alex", "alex ")).toBe(true);
    expect(sameOperator("shad", "alex")).toBe(false);
    expect(sameOperator("", "")).toBe(false);
    expect(sameOperator(null, undefined)).toBe(false);
  });

  it("resolves an assigned row back to the operator identity", () => {
    const byName = indexOperators(directory);
    const assignment = assignmentFrom({ assigned_operator: "  alex " });
    expect(operatorForAssignment(assignment, byName)?.id).toBe("op-2");
    expect(operatorForAssignment(UNASSIGNED, byName)).toBeNull();
  });
});

describe("resolveAssignment", () => {
  it("assigns using the canonical stored spelling", () => {
    const res = resolveAssignment("shAD", directory);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.assignment.operatorName).toBe("Shad");
    expect(res.operator?.id).toBe("op-1");
    expect(assignmentToColumn(res.assignment)).toBe("Shad");
  });

  it("treats blank values as unassign", () => {
    for (const value of [null, undefined, "", "   "]) {
      const res = resolveAssignment(value, directory);
      expect(res.ok).toBe(true);
      if (!res.ok) continue;
      expect(res.assignment.operatorName).toBeNull();
      expect(assignmentToColumn(res.assignment)).toBeNull();
    }
  });

  it("rejects an unknown operator instead of storing free text", () => {
    const res = resolveAssignment("Ghost", directory);
    expect(res).toEqual({ ok: false, reason: "unknown_operator" });
  });

  it("reassigns from one operator to another", () => {
    const first = resolveAssignment("alex", directory);
    const second = resolveAssignment("max", directory);
    expect(first.ok && first.assignment.operatorName).toBe("Alex");
    expect(second.ok && second.assignment.operatorName).toBe("Max");
  });
});

describe("statusForAssignment", () => {
  it("derives assigned/unassigned but never rewrites terminal states", () => {
    expect(statusForAssignment({ operatorName: "Shad" }, "unassigned")).toBe("assigned");
    expect(statusForAssignment(UNASSIGNED, "assigned")).toBe("unassigned");
    expect(statusForAssignment(UNASSIGNED, "completed")).toBe("completed");
    expect(statusForAssignment({ operatorName: "Shad" }, "cancelled")).toBe("cancelled");
  });
});
