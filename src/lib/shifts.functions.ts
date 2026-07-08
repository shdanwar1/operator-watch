import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

type GateSession = { unlocked?: boolean; username?: string };

function getSessionConfig() {
  const password = process.env.SESSION_SECRET;
  if (!password) throw new Error("SESSION_SECRET is not set");
  return {
    password,
    name: "site-gate",
    maxAge: 60 * 60 * 24 * 30,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
    },
  };
}

async function requireGate() {
  const session = await useSession<GateSession>(getSessionConfig());
  if (!session.data.unlocked) {
    throw new Response("Unauthorized", { status: 401 });
  }
}

export type ShiftClass = { class: string; teacher: string };

export type ShiftRow = {
  id: string;
  operator_name: string;
  check_in_at: string;
  check_out_at: string | null;
  live_streams_count: number;
  dance_teachers: string[];
  notes: string | null;
  scheduled_shift_id: string | null;
  classes: ShiftClass[];
};

export type ScheduledShiftRow = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  label: string | null;
  specific_date: string | null;
};

function normalizeShift(r: Record<string, unknown>): ShiftRow {
  return {
    ...(r as ShiftRow),
    classes: Array.isArray((r as { classes?: unknown }).classes)
      ? ((r as { classes: ShiftClass[] }).classes)
      : [],
  };
}

export const listShifts = createServerFn({ method: "GET" }).handler(async () => {
  await requireGate();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("shifts")
    .select("*")
    .order("check_in_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => normalizeShift(r as Record<string, unknown>));
});

export const listScheduledShifts = createServerFn({ method: "GET" }).handler(async () => {
  await requireGate();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("scheduled_shifts")
    .select("*")
    .order("day_of_week")
    .order("start_time");
  if (error) throw new Error(error.message);
  return (data ?? []) as ScheduledShiftRow[];
});

export const createShift = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { operator_name: string; scheduled_shift_id?: string | null }) => {
      if (!data || typeof data.operator_name !== "string") {
        throw new Error("operator_name is required");
      }
      const name = data.operator_name.trim();
      if (!name || name.length > 100) throw new Error("Invalid operator_name");
      const sid =
        data.scheduled_shift_id === undefined || data.scheduled_shift_id === null
          ? null
          : String(data.scheduled_shift_id);
      if (sid !== null && sid.length > 64) throw new Error("Invalid scheduled_shift_id");
      return { operator_name: name, scheduled_shift_id: sid };
    },
  )
  .handler(async ({ data }) => {
    await requireGate();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("shifts")
      .insert({
        operator_name: data.operator_name,
        scheduled_shift_id: data.scheduled_shift_id,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return normalizeShift(row as Record<string, unknown>);
  });

type ShiftPatch = {
  operator_name?: string;
  check_in_at?: string;
  check_out_at?: string | null;
  live_streams_count?: number;
  dance_teachers?: string[];
  notes?: string | null;
  classes?: ShiftClass[];
};

function sanitizeShiftPatch(patch: ShiftPatch): ShiftPatch {
  const out: ShiftPatch = {};
  if (patch.operator_name !== undefined) {
    const n = String(patch.operator_name).trim();
    if (!n || n.length > 100) throw new Error("Invalid operator_name");
    out.operator_name = n;
  }
  if (patch.check_in_at !== undefined) {
    const d = new Date(patch.check_in_at);
    if (isNaN(d.getTime())) throw new Error("Invalid check_in_at");
    out.check_in_at = d.toISOString();
  }
  if (patch.check_out_at !== undefined) {
    if (patch.check_out_at === null) out.check_out_at = null;
    else {
      const d = new Date(patch.check_out_at);
      if (isNaN(d.getTime())) throw new Error("Invalid check_out_at");
      out.check_out_at = d.toISOString();
    }
  }
  if (patch.live_streams_count !== undefined) {
    const n = Math.floor(Number(patch.live_streams_count));
    if (!Number.isFinite(n) || n < 0 || n > 100000) throw new Error("Invalid live_streams_count");
    out.live_streams_count = n;
  }
  if (patch.dance_teachers !== undefined) {
    if (!Array.isArray(patch.dance_teachers)) throw new Error("Invalid dance_teachers");
    out.dance_teachers = patch.dance_teachers.slice(0, 100).map((t) => String(t).slice(0, 100));
  }
  if (patch.notes !== undefined) {
    out.notes = patch.notes === null ? null : String(patch.notes).slice(0, 5000);
  }
  if (patch.classes !== undefined) {
    if (!Array.isArray(patch.classes)) throw new Error("Invalid classes");
    out.classes = patch.classes.slice(0, 100).map((c) => ({
      class: String(c?.class ?? "").slice(0, 200),
      teacher: String(c?.teacher ?? "").slice(0, 200),
    }));
  }
  return out;
}

export const updateShift = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; patch: ShiftPatch }) => {
    if (!data?.id) throw new Error("id required");
    return { id: String(data.id), patch: sanitizeShiftPatch(data.patch ?? {}) };
  })
  .handler(async ({ data }) => {
    await requireGate();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("shifts")
      .update(data.patch as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deleteShift = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => {
    if (!data?.id) throw new Error("id required");
    return { id: String(data.id) };
  })
  .handler(async ({ data }) => {
    await requireGate();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("shifts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

type ScheduledInsert = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  label: string;
};

function sanitizeScheduled(rows: unknown): ScheduledInsert[] {
  if (!Array.isArray(rows)) throw new Error("rows must be an array");
  if (rows.length > 500) throw new Error("Too many rows");
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
  return rows.map((r) => {
    const row = r as Partial<ScheduledInsert>;
    const dow = Number(row.day_of_week);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) throw new Error("Invalid day_of_week");
    const st = String(row.start_time ?? "");
    const et = String(row.end_time ?? "");
    if (!timeRe.test(st) || !timeRe.test(et)) throw new Error("Invalid time format");
    const label = String(row.label ?? "").slice(0, 200);
    return { day_of_week: dow, start_time: st, end_time: et, label };
  });
}

export const insertScheduledShifts = createServerFn({ method: "POST" })
  .inputValidator((data: { rows: unknown }) => ({ rows: sanitizeScheduled(data?.rows) }))
  .handler(async ({ data }) => {
    await requireGate();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("scheduled_shifts").insert(data.rows);
    if (error) throw new Error(error.message);
    return { inserted: data.rows.length };
  });
