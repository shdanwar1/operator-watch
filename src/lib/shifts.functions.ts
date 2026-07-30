import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

type GateSession = { siteUnlocked?: boolean; username?: string; isAdmin?: boolean };

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
  if (!session.data.siteUnlocked) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return {
    username: session.data.username ?? null,
    isAdmin: !!session.data.isAdmin,
  };
}

export type ShiftClass = { class: string; teacher: string };

export type ShiftRow = {
  id: string;
  operator_name: string;
  check_in_at: string;
  check_out_at: string | null;
  live_streams_count: number;
  notes: string | null;
  scheduled_shift_id: string | null;
  classes: ShiftClass[];
};

export type ScheduledShiftRow = {
  id: string;
  /** Derived from `specific_date` by the database (0 = Sunday). Read-only. */
  day_of_week: number;
  start_time: string;
  end_time: string;
  label: string | null;
  specific_date: string;
  assigned_operator: string | null;
  status: string;
  notes: string | null;
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
  const { username, isAdmin } = await requireGate();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let q = supabaseAdmin.from("shifts").select("*").order("check_in_at", { ascending: false });
  // Non-admin operators only see their own shifts (case-insensitive match).
  if (!isAdmin && username) {
    q = q.ilike("operator_name", username);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => normalizeShift(r as Record<string, unknown>));
});

export const listScheduledShifts = createServerFn({ method: "GET" }).handler(async () => {
  const { username, isAdmin } = await requireGate();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let q = supabaseAdmin
    .from("scheduled_shifts")
    .select("*")
    .order("day_of_week")
    .order("start_time");
  // Operators only see their own scheduled shifts. Admins see everything.
  if (!isAdmin) {
    if (!username) return [];
    q = q.ilike("assigned_operator", username);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ScheduledShiftRow[];
});


export const createShift = createServerFn({ method: "POST" })
  .inputValidator(
    (data?: { scheduled_shift_id?: string | null }) => {
      const sid =
        !data || data.scheduled_shift_id === undefined || data.scheduled_shift_id === null
          ? null
          : String(data.scheduled_shift_id);
      if (sid !== null && sid.length > 64) throw new Error("Invalid scheduled_shift_id");
      return { scheduled_shift_id: sid };
    },
  )
  .handler(async ({ data }) => {
    // Session-authenticated: the signed-in operator (username + PIN) checks
    // themselves in. No secondary secret is required.
    const { username, isAdmin } = await requireGate();
    if (!username || isAdmin) {
      throw new Response("Sign in as an operator to check in", { status: 403 });
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: op } = await supabaseAdmin
      .from("operators")
      .select("username")
      .ilike("username", username)
      .maybeSingle();
    const canonical = (op as { username: string } | null)?.username ?? username;

    const { data: row, error } = await supabaseAdmin
      .from("shifts")
      .insert({
        operator_name: canonical,
        scheduled_shift_id: data.scheduled_shift_id,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return normalizeShift(row as Record<string, unknown>);
  });

export const createPastShift = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      operator_name: string;
      check_in_at: string;
      check_out_at: string;
      classes?: ShiftClass[];
      notes?: string | null;
    }) => {
      if (!data || typeof data.operator_name !== "string") {
        throw new Error("operator_name is required");
      }
      const name = data.operator_name.trim();
      if (!name || name.length > 100) throw new Error("Invalid operator_name");
      const ci = new Date(data.check_in_at);
      const co = new Date(data.check_out_at);
      if (isNaN(ci.getTime())) throw new Error("Invalid check_in_at");
      if (isNaN(co.getTime())) throw new Error("Invalid check_out_at");
      if (co.getTime() <= ci.getTime()) throw new Error("Check-out must be after check-in");
      const classes = Array.isArray(data.classes)
        ? data.classes.slice(0, 100).map((c) => ({
            class: String(c?.class ?? "").slice(0, 200),
            teacher: String(c?.teacher ?? "").slice(0, 200),
          }))
        : [];
      const notes =
        data.notes === undefined || data.notes === null
          ? null
          : String(data.notes).slice(0, 5000);
      return {
        operator_name: name,
        check_in_at: ci.toISOString(),
        check_out_at: co.toISOString(),
        classes,
        notes,
      };
    },
  )
  .handler(async ({ data }) => {
    const { username, isAdmin } = await requireGate();
    // Non-admins may only create past shifts under their own operator name.
    const operator_name =
      isAdmin
        ? data.operator_name
        : username && data.operator_name.toLowerCase() === username.toLowerCase()
          ? username
          : (() => {
              throw new Response("Forbidden", { status: 403 });
            })();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("shifts")
      .insert({
        operator_name,
        check_in_at: data.check_in_at,
        check_out_at: data.check_out_at,
        classes: data.classes,
        live_streams_count: data.classes.length,
        notes: data.notes,
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
  if (patch.notes !== undefined) {
    out.notes = patch.notes === null ? null : String(patch.notes).slice(0, 5000);
  }
  if (patch.classes !== undefined) {
    if (!Array.isArray(patch.classes)) throw new Error("Invalid classes");
    out.classes = patch.classes.slice(0, 100).map((c) => ({
      class: String(c?.class ?? "").slice(0, 200),
      teacher: String(c?.teacher ?? "").slice(0, 200),
    }));
    // Streams count is always the number of classes.
    out.live_streams_count = out.classes.length;
  }
  return out;
}

/** Load a shift's owner and enforce that the caller is the owner or an admin. */
async function assertShiftOwnership(
  shiftId: string,
  username: string | null,
  isAdmin: boolean,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: existing, error } = await supabaseAdmin
    .from("shifts")
    .select("id, operator_name")
    .eq("id", shiftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!existing) throw new Response("Shift not found", { status: 404 });
  if (isAdmin) return existing as { id: string; operator_name: string };
  const owner = String((existing as { operator_name: string }).operator_name ?? "");
  if (!username || owner.toLowerCase() !== username.toLowerCase()) {
    throw new Response("Forbidden", { status: 403 });
  }
  return existing as { id: string; operator_name: string };
}

export const updateShift = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; patch: ShiftPatch }) => {
    if (!data?.id) throw new Error("id required");
    return { id: String(data.id), patch: sanitizeShiftPatch(data.patch ?? {}) };
  })
  .handler(async ({ data }) => {
    const { username, isAdmin } = await requireGate();
    await assertShiftOwnership(data.id, username, isAdmin);
    // Non-admins may not reassign a shift to another operator.
    const patch = { ...data.patch };
    if (!isAdmin && patch.operator_name !== undefined) {
      if (!username || patch.operator_name.toLowerCase() !== username.toLowerCase()) {
        throw new Response("Forbidden", { status: 403 });
      }
      delete patch.operator_name;
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("shifts")
      .update(patch as never)
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
    const { username, isAdmin } = await requireGate();
    await assertShiftOwnership(data.id, username, isAdmin);
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

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type ScheduledPatch = {
  day_of_week?: number;
  start_time?: string;
  end_time?: string;
  label?: string | null;
  specific_date?: string | null;
  assigned_operator?: string | null;
  status?: string;
  notes?: string | null;
};

const VALID_STATUSES = new Set(["assigned", "unassigned", "completed", "cancelled"]);

function sanitizeScheduledPatch(patch: ScheduledPatch): ScheduledPatch {
  const out: ScheduledPatch = {};
  if (patch.day_of_week !== undefined) {
    const dow = Number(patch.day_of_week);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) throw new Error("Invalid day_of_week");
    out.day_of_week = dow;
  }
  if (patch.start_time !== undefined) {
    const st = String(patch.start_time);
    if (!TIME_RE.test(st)) throw new Error("Invalid start_time");
    out.start_time = st;
  }
  if (patch.end_time !== undefined) {
    const et = String(patch.end_time);
    if (!TIME_RE.test(et)) throw new Error("Invalid end_time");
    out.end_time = et;
  }
  if (patch.label !== undefined) {
    out.label = patch.label === null ? null : String(patch.label).slice(0, 200);
  }
  if (patch.specific_date !== undefined) {
    if (patch.specific_date === null || patch.specific_date === "") {
      out.specific_date = null;
    } else {
      const d = String(patch.specific_date);
      if (!DATE_RE.test(d)) throw new Error("Invalid specific_date");
      out.specific_date = d;
    }
  }
  if (patch.assigned_operator !== undefined) {
    if (patch.assigned_operator === null || patch.assigned_operator === "") {
      out.assigned_operator = null;
    } else {
      out.assigned_operator = String(patch.assigned_operator).trim().slice(0, 100);
    }
  }
  if (patch.status !== undefined) {
    const s = String(patch.status);
    if (!VALID_STATUSES.has(s)) throw new Error("Invalid status");
    out.status = s;
  }
  if (patch.notes !== undefined) {
    out.notes = patch.notes === null ? null : String(patch.notes).slice(0, 5000);
  }
  return out;
}

export const createScheduledShift = createServerFn({ method: "POST" })
  .inputValidator((data: ScheduledPatch) => {
    const p = sanitizeScheduledPatch(data ?? {});
    if (p.day_of_week === undefined) throw new Error("day_of_week required");
    if (!p.start_time) throw new Error("start_time required");
    if (!p.end_time) throw new Error("end_time required");
    return {
      day_of_week: p.day_of_week,
      start_time: p.start_time,
      end_time: p.end_time,
      label: p.label ?? "",
      specific_date: p.specific_date ?? null,
      assigned_operator: p.assigned_operator ?? null,
      status: p.status ?? (p.assigned_operator ? "assigned" : "unassigned"),
      notes: p.notes ?? null,
    };
  })
  .handler(async ({ data }) => {
    await requireGate();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("scheduled_shifts")
      .insert(data)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row as ScheduledShiftRow;
  });

export const updateScheduledShift = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; patch: ScheduledPatch }) => {
    if (!data?.id) throw new Error("id required");
    return { id: String(data.id), patch: sanitizeScheduledPatch(data.patch ?? {}) };
  })
  .handler(async ({ data }) => {
    await requireGate();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("scheduled_shifts")
      .update(data.patch as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deleteScheduledShift = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => {
    if (!data?.id) throw new Error("id required");
    return { id: String(data.id) };
  })
  .handler(async ({ data }) => {
    await requireGate();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("scheduled_shifts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

