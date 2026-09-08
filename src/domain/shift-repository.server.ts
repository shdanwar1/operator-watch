/**
 * Scheduled-shift data access (Operation 4) — server only.
 *
 * Small and deliberate: only the `scheduled_shifts` access patterns that are
 * duplicated across the codebase live here. No generic repository framework,
 * no query changes — the SQL executed is identical to what the call sites ran
 * before. Authorization stays where it was, at the server-function boundary.
 */
import type { ScheduledShiftRecord } from "./types";

export const SHIFT_COLUMNS =
  "id, specific_date, start_time, end_time, status, label, notes, assigned_operator, external_event_id";

export type ShiftInsert = {
  specific_date: string;
  start_time: string;
  end_time: string;
  label: string | null;
  status: string;
  notes: string | null;
  assigned_operator: string | null;
  external_event_id: string;
};

export type ShiftPatch = Partial<Omit<ShiftInsert, "external_event_id">> & {
  external_event_id?: string;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Full row by id, or null when it does not exist. */
export async function findById(id: string): Promise<ScheduledShiftRecord | null> {
  const db = await admin();
  const { data, error } = await db
    .from("scheduled_shifts")
    .select(SHIFT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as ScheduledShiftRecord | null;
}

/** Only the fields needed to authorize an operation on a shift. */
export async function findOwner(
  id: string,
): Promise<{ id: string; assigned_operator: string | null } | null> {
  const db = await admin();
  const { data, error } = await db
    .from("scheduled_shifts")
    .select("id, assigned_operator")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as { id: string; assigned_operator: string | null } | null;
}

/** Shifts whose `specific_date` falls inside [from, to], inclusive. */
export async function listInRange(from: string, to: string): Promise<ScheduledShiftRecord[]> {
  const db = await admin();
  const { data, error } = await db
    .from("scheduled_shifts")
    .select(SHIFT_COLUMNS)
    .gte("specific_date", from)
    .lte("specific_date", to);
  if (error) throw new Error(error.message);
  return (data ?? []) as ScheduledShiftRecord[];
}

export async function insert(rows: ShiftInsert[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await admin();
  const { error } = await db.from("scheduled_shifts").insert(rows);
  if (error) throw new Error(error.message);
}

export async function insertOne(row: ShiftInsert): Promise<ScheduledShiftRecord> {
  const db = await admin();
  const { data, error } = await db.from("scheduled_shifts").insert(row).select().single();
  if (error) throw new Error(error.message);
  return data as ScheduledShiftRecord;
}

export async function patch(id: string, values: ShiftPatch): Promise<void> {
  const db = await admin();
  const { error } = await db
    .from("scheduled_shifts")
    .update(values as never)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function remove(id: string): Promise<void> {
  const db = await admin();
  const { error } = await db.from("scheduled_shifts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function removeMany(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const db = await admin();
  const { error } = await db.from("scheduled_shifts").delete().in("id", ids);
  if (error) throw new Error(error.message);
  return ids.length;
}
