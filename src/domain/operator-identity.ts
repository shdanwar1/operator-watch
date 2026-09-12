/**
 * Canonical operator identity rules (Operation A) — pure, no database.
 *
 * Operators are still *stored* by name in `scheduled_shifts.assigned_operator`
 * and `shifts.operator_name`. Every comparison and every assignment value must
 * therefore go through this module, so the fragile "lowercase it here too"
 * logic exists exactly once and a later `operator_id` migration only has to
 * change the mapping below.
 */
import type { OperatorAssignment, OperatorIdentity } from "./types";
import { UNASSIGNED } from "./types";

/** Canonical comparison key for an operator name. */
export function normalizeUsername(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

/** True when two operator names refer to the same operator. */
export function sameOperator(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeUsername(a);
  return na !== "" && na === normalizeUsername(b);
}

/** Index a directory of operators for name → identity resolution. */
export function indexOperators(
  operators: readonly OperatorIdentity[],
): Map<string, OperatorIdentity> {
  const byName = new Map<string, OperatorIdentity>();
  for (const op of operators) byName.set(normalizeUsername(op.username), op);
  return byName;
}

/** Identity of the operator a shift row is assigned to, if any. */
export function operatorForAssignment(
  assignment: OperatorAssignment,
  byName: Map<string, OperatorIdentity>,
): OperatorIdentity | null {
  const key = normalizeUsername(assignment.operatorName);
  if (!key) return null;
  return byName.get(key) ?? null;
}

export type AssignmentResolution =
  | { ok: true; assignment: OperatorAssignment; operator: OperatorIdentity | null }
  | { ok: false; reason: "unknown_operator" };

/**
 * Turn a requested assignment (raw name, possibly wrong case, possibly blank)
 * into the value that may be stored.
 *
 * Blank means unassign. A named operator must exist in the directory; the
 * canonical stored spelling is always used, never the caller's spelling.
 */
export function resolveAssignment(
  requested: string | null | undefined,
  operators: readonly OperatorIdentity[] | Map<string, OperatorIdentity>,
): AssignmentResolution {
  const key = normalizeUsername(requested);
  if (!key) return { ok: true, assignment: UNASSIGNED, operator: null };
  const byName = operators instanceof Map ? operators : indexOperators(operators);
  const operator = byName.get(key);
  if (!operator) return { ok: false, reason: "unknown_operator" };
  return { ok: true, assignment: { operatorName: operator.username }, operator };
}

/** Status a shift should carry for a given assignment, preserving terminal states. */
export function statusForAssignment(
  assignment: OperatorAssignment,
  current?: string | null,
): string {
  const status = (current ?? "").toLowerCase();
  if (status === "completed" || status === "cancelled") return current as string;
  return assignment.operatorName ? "assigned" : "unassigned";
}
