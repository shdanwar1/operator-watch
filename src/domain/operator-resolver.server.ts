/**
 * Operator identity resolution (Operation 4) — server only.
 *
 * The application links operators by username *text* in many places. This
 * module is the single entry point for resolving one, so the fragile
 * case-insensitive lookup lives in exactly one file and a later migration to
 * `operator_id` foreign keys only has to change here. Stored data is untouched.
 */
import type { OperatorAssignment, OperatorIdentity } from "./types";
import {
  indexOperators,
  normalizeUsername,
  resolveAssignment,
  sameOperator,
} from "./operator-identity";

// The comparison rules themselves are pure and live in ./operator-identity so
// they can be used (and tested) without a database.
export { normalizeUsername, sameOperator };

type OperatorRow = {
  id: string;
  username: string;
  is_admin?: boolean | null;
  is_active?: boolean | null;
};

function toIdentity(row: OperatorRow): OperatorIdentity {
  return {
    id: row.id,
    username: row.username,
    isAdmin: row.is_admin === true,
    isActive: row.is_active !== false,
  };
}

/**
 * Resolve a requested assignment against the live operator directory.
 *
 * Returns the value that may be written to `scheduled_shifts.assigned_operator`
 * — always the canonical stored spelling, or null for "unassigned". An unknown
 * operator is rejected instead of being persisted as free text.
 */
export async function resolveAssignmentColumn(
  requested: string | null | undefined,
): Promise<{ column: string | null; assignment: OperatorAssignment; operator: OperatorIdentity | null }> {
  const key = normalizeUsername(requested);
  if (!key) {
    return { column: null, assignment: { operatorName: null }, operator: null };
  }
  const identity = await resolveByUsername(requested);
  const result = resolveAssignment(requested, identity ? [identity] : []);
  if (!result.ok) {
    throw new Response("Unknown operator", { status: 400 });
  }
  return {
    column: result.assignment.operatorName,
    assignment: result.assignment,
    operator: result.operator,
  };
}


/** Resolve by (case-insensitive) username. Returns null when unknown. */
export async function resolveByUsername(
  username: string | null | undefined,
): Promise<OperatorIdentity | null> {
  const name = (username ?? "").trim();
  if (!name) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("operators")
    .select("id, username, is_admin, is_active")
    .ilike("username", name)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toIdentity(data as OperatorRow) : null;
}

/** Resolve by primary key. Returns null when unknown. */
export async function resolveById(id: string): Promise<OperatorIdentity | null> {
  if (!id) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("operators")
    .select("id, username, is_admin, is_active")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toIdentity(data as OperatorRow) : null;
}

/**
 * Canonical stored spelling for a session username, falling back to the given
 * name when the operator row cannot be read.
 */
export async function canonicalUsername(username: string): Promise<string> {
  const identity = await resolveByUsername(username).catch(() => null);
  return identity?.username ?? username;
}

/** Every operator, indexed for name → identity resolution in bulk paths. */
export async function loadOperatorDirectory(): Promise<{
  all: OperatorIdentity[];
  byName: Map<string, OperatorIdentity>;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("operators")
    .select("id, username, is_admin, is_active");
  if (error) throw new Error(error.message);
  const all = ((data ?? []) as OperatorRow[]).map(toIdentity);
  return { all, byName: indexOperators(all) };
}
