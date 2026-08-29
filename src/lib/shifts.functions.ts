import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { assertCanCheckOut } from "./checkout-validation";

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
  // Admins see every shift. Operators only see their own (case-insensitive).
  // Site-unlocked but not signed in is NOT authorization for any shift data.
  if (!isAdmin) {
    if (!username) return [];
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
    // A scheduled shift may only be checked into by the operator it is
    // assigned to — never trusted just because the client sent its id.
    if (data.scheduled_shift_id) {
      await assertScheduledOwnership(data.scheduled_shift_id, username, false);
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
      check_in_at: string;
      check_out_at: string;
      classes?: ShiftClass[];
      notes?: string | null;
    }) => {
      if (!data) throw new Error("Invalid payload");
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
        check_in_at: ci.toISOString(),
        check_out_at: co.toISOString(),
        classes,
        notes,
      };
    },
  )
  .handler(async ({ data }) => {
    const { username } = await requireGate();
    // Ownership is derived from the session only — never from the request.
    if (!username) throw new Response("Forbidden", { status: 403 });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: op } = await supabaseAdmin
      .from("operators")
      .select("username")
      .ilike("username", username)
      .maybeSingle();
    const operator_name = (op as { username: string } | null)?.username ?? username;
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

export const checkOutShift = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; classes?: ShiftClass[] }) => {
    if (!data?.id) throw new Error("id required");
    const classes = data.classes === undefined
      ? undefined
      : sanitizeShiftPatch({ classes: data.classes }).classes;
    return { id: String(data.id), classes };
  })
  .handler(async ({ data }) => {
    const { username, isAdmin } = await requireGate();
    if (!username || isAdmin) throw new Response("Forbidden", { status: 403 });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing, error: loadError } = await supabaseAdmin
      .from("shifts")
      .select("id, operator_name, check_in_at, check_out_at, scheduled_shift_id")
      .eq("id", data.id)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!existing) throw new Response("Shift not found", { status: 404 });

    const owner = String(existing.operator_name ?? "");
    if (owner.toLowerCase() !== username.toLowerCase()) {
      throw new Response("Forbidden", { status: 403 });
    }

    const now = new Date();
    assertCanCheckOut(
      {
        check_in_at: String(existing.check_in_at),
        check_out_at: existing.check_out_at ? String(existing.check_out_at) : null,
      },
      now,
    );

    const patch: ShiftPatch = { check_out_at: now.toISOString() };
    if (data.classes !== undefined) {
      patch.classes = data.classes;
      patch.live_streams_count = data.classes.length;
    }

    const { data: closed, error } = await supabaseAdmin
      .from("shifts")
      .update(patch as never)
      .eq("id", data.id)
      .is("check_out_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!closed) throw new Error("This shift is already checked out");

    // Checkout is the authoritative completion event for a scheduled shift.
    // Class rows stay untouched so admins keep full history.
    const scheduledId = existing.scheduled_shift_id
      ? String(existing.scheduled_shift_id)
      : null;
    if (scheduledId) {
      await supabaseAdmin
        .from("scheduled_shifts")
        .update({ status: "completed" } as never)
        .eq("id", scheduledId)
        .neq("status", "cancelled");
    }

    return { ok: true as const, check_out_at: now.toISOString() };
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

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every scheduled shift carries a stable external id. Calendar-generated rows
 * use the `op:` prefix (see gcal.functions.ts); rows created inside the app use
 * `manual:` so the calendar sync never deletes them.
 */
function manualEventId(date: string, startTime: string, operator: string | null) {
  const op = (operator ?? "unassigned").trim().toLowerCase() || "unassigned";
  const hhmm = startTime.slice(0, 5).replace(":", "");
  const rand = Math.random().toString(36).slice(2, 8);
  return `manual:${op}:shift:${date}:${hhmm}:${rand}`;
}

type ScheduledInsert = {
  specific_date: string;
  start_time: string;
  end_time: string;
  label: string;
};

function sanitizeScheduled(rows: unknown): ScheduledInsert[] {
  if (!Array.isArray(rows)) throw new Error("rows must be an array");
  if (rows.length > 500) throw new Error("Too many rows");
  return rows.map((r) => {
    const row = r as Partial<ScheduledInsert>;
    const date = String(row.specific_date ?? "");
    if (!DATE_RE.test(date)) throw new Error("Invalid specific_date");
    const st = String(row.start_time ?? "");
    const et = String(row.end_time ?? "");
    if (!TIME_RE.test(st) || !TIME_RE.test(et)) throw new Error("Invalid time format");
    const label = String(row.label ?? "").slice(0, 200);
    return { specific_date: date, start_time: st, end_time: et, label };
  });
}

/** A non-admin may only touch scheduled shifts assigned to themselves. */
function assertAssignedToSelf(
  assigned: string | null | undefined,
  username: string | null,
  isAdmin: boolean,
) {
  if (isAdmin) return;
  const owner = String(assigned ?? "");
  if (!username || owner.toLowerCase() !== username.toLowerCase()) {
    throw new Response("Forbidden", { status: 403 });
  }
}

/** Load a scheduled shift and enforce that the caller owns it or is an admin. */
async function assertScheduledOwnership(id: string, username: string | null, isAdmin: boolean) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: existing, error } = await supabaseAdmin
    .from("scheduled_shifts")
    .select("id, assigned_operator")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!existing) throw new Response("Scheduled shift not found", { status: 404 });
  assertAssignedToSelf(
    (existing as { assigned_operator: string | null }).assigned_operator,
    username,
    isAdmin,
  );
  return existing as { id: string; assigned_operator: string | null };
}

export const insertScheduledShifts = createServerFn({ method: "POST" })
  .inputValidator((data: { rows: unknown }) => ({ rows: sanitizeScheduled(data?.rows) }))
  .handler(async ({ data }) => {
    const { username, isAdmin } = await requireGate();
    if (!isAdmin && !username) throw new Response("Forbidden", { status: 403 });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = data.rows.map((r) => ({
      ...r,
      // Non-admins can only create shifts for themselves.
      ...(isAdmin ? {} : { assigned_operator: username, status: "assigned" }),
      external_event_id: manualEventId(r.specific_date, r.start_time, isAdmin ? null : username),
    }));
    const { error } = await supabaseAdmin.from("scheduled_shifts").insert(rows);
    if (error) throw new Error(error.message);
    return { inserted: rows.length };
  });


type ScheduledPatch = {
  start_time?: string;
  end_time?: string;
  label?: string | null;
  specific_date?: string;
  assigned_operator?: string | null;
  status?: string;
  notes?: string | null;
};

const VALID_STATUSES = new Set(["assigned", "unassigned", "completed", "cancelled"]);

function sanitizeScheduledPatch(patch: ScheduledPatch): ScheduledPatch {
  const out: ScheduledPatch = {};
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
    const d = String(patch.specific_date);
    if (!DATE_RE.test(d)) throw new Error("Invalid specific_date");
    out.specific_date = d;
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
    if (!p.specific_date) throw new Error("specific_date required");
    if (!p.start_time) throw new Error("start_time required");
    if (!p.end_time) throw new Error("end_time required");
    return {
      start_time: p.start_time,
      end_time: p.end_time,
      label: p.label ?? "",
      specific_date: p.specific_date,
      assigned_operator: p.assigned_operator ?? null,
      status: p.status ?? (p.assigned_operator ? "assigned" : "unassigned"),
      notes: p.notes ?? null,
    };
  })
  .handler(async ({ data }) => {
    const { username, isAdmin } = await requireGate();
    assertAssignedToSelf(data.assigned_operator, username, isAdmin);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("scheduled_shifts")
      .insert({
        ...data,
        external_event_id: manualEventId(
          data.specific_date,
          data.start_time,
          data.assigned_operator,
        ),
      })
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
    const { username, isAdmin } = await requireGate();
    await assertScheduledOwnership(data.id, username, isAdmin);
    // Non-admins may not reassign a shift to somebody else.
    if (!isAdmin && data.patch.assigned_operator !== undefined) {
      assertAssignedToSelf(data.patch.assigned_operator, username, isAdmin);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("scheduled_shifts")
      .update(data.patch as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    try {
      const { reconcileShiftNotifications } = await import("./notifications.server");
      await reconcileShiftNotifications();
    } catch (err) {
      console.error("[shifts] notification reconciliation failed", err);
    }
    return { ok: true as const };
  });

export const deleteScheduledShift = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => {
    if (!data?.id) throw new Error("id required");
    return { id: String(data.id) };
  })
  .handler(async ({ data }) => {
    const { username, isAdmin } = await requireGate();
    await assertScheduledOwnership(data.id, username, isAdmin);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("scheduled_shifts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    try {
      const { reconcileShiftNotifications } = await import("./notifications.server");
      await reconcileShiftNotifications();
    } catch (err) {
      console.error("[shifts] notification reconciliation failed", err);
    }
    return { ok: true as const };
  });


