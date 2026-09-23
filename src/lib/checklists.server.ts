/**
 * Checklist persistence (Operation 1) — server only.
 *
 * Master templates: `app_settings.operator_checklists` (fallback = the seeded
 * defaults). Snapshot: `shifts.checklists`, written only when a real shift is
 * opened or its classes change.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { berlinClock } from "./push-time";
import { intervalOf, toDate } from "./class-interval";
import { buildDisplayShifts, dateKey } from "./display-shifts";
import type { ScheduledShiftRow } from "./shifts.functions";
import { DEFAULT_CHECKLISTS } from "@/domain/checklist-templates";
import {
  ensureShiftChecklists,
  isShiftChecklists,
  setChecklistItemState,
  syncClassChecklists,
  type ChecklistClassInput,
  type ChecklistConfig,
  type ShiftChecklists,
} from "@/domain/checklists";

async function admin() {
  return supabaseAdmin;
}

/** Current master templates. Falls back to the seeded defaults. */
export async function readChecklistConfig(): Promise<ChecklistConfig> {
  const db = await admin();
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "operator_checklists")
    .maybeSingle();
  const value = (data as { value?: unknown } | null)?.value;
  if (!value || typeof value !== "object") return DEFAULT_CHECKLISTS;
  const v = value as Partial<ChecklistConfig>;
  return {
    start_shift: v.start_shift ?? DEFAULT_CHECKLISTS.start_shift,
    ballet: v.ballet ?? DEFAULT_CHECKLISTS.ballet,
    workout: v.workout ?? DEFAULT_CHECKLISTS.workout,
    end_shift: v.end_shift ?? DEFAULT_CHECKLISTS.end_shift,
  };
}

function durationMinutes(date: string, start: string, end: string): number {
  const { startAt, endAt } = intervalOf(date, start.slice(0, 5), end.slice(0, 5));
  return Math.round((endAt.getTime() - startAt.getTime()) / 60_000);
}

/** Same leeway the operator UI uses when matching classes to a shift. */
const CLASS_WINDOW_PADDING_MIN = 45;

type ClassRow = {
  id: string;
  dmc_class_id: string | null;
  dmc_instructor_id: string | null;
  specific_date: string;
  start_time: string;
  end_time: string;
  status: string;
  scheduled_shift_id: string | null;
};

/**
 * The operator-facing window of a scheduled shift: its merged segments and
 * absolute start/end, padded like `classesForShift` in display-shifts.ts.
 *
 * Raw scheduled rows are often split at midnight, and `shifts.scheduled_shift_id`
 * points only at the FIRST segment — so matching classes by that single id
 * misses every class after midnight. Merging the operator's rows here (the
 * same pure logic the dashboard uses) yields all segment ids plus the full
 * time window, and classes are matched against both.
 */
async function displayWindowFor(
  scheduledShiftId: string,
): Promise<{ segmentIds: string[]; from: number; to: number; operator: string | null } | null> {
  const db = await admin();
  const { data: anchor, error } = await db
    .from("scheduled_shifts")
    .select("*")
    .eq("id", scheduledShiftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!anchor) return null;
  const a = anchor as ScheduledShiftRow;

  let segmentIds = [a.id];
  let { startAt, endAt } = intervalOf(
    a.specific_date,
    a.start_time.slice(0, 5),
    a.end_time.slice(0, 5),
  );

  if (a.assigned_operator) {
    const { data: rows, error: sErr } = await db
      .from("scheduled_shifts")
      .select("*")
      .ilike("assigned_operator", a.assigned_operator);
    if (sErr) throw new Error(sErr.message);
    const display = buildDisplayShifts((rows ?? []) as ScheduledShiftRow[], new Date(), {
      daysBack: 2,
      daysAhead: 2,
    }).find((d) => d.segments.some((s) => s.id === a.id));
    if (display) {
      segmentIds = display.segments.map((s) => s.id);
      startAt = display.startAt;
      endAt = display.endAt;
    }
  }

  const pad = CLASS_WINDOW_PADDING_MIN * 60_000;
  return {
    segmentIds,
    from: startAt.getTime() - pad,
    to: endAt.getTime() + pad,
    operator: a.assigned_operator,
  };
}

/** The attendance record a checklist snapshot belongs to. */
type ShiftContext = {
  id: string;
  operator_name: string;
  check_in_at: string;
  check_out_at: string | null;
  scheduled_shift_id: string | null;
};

/**
 * Window for a shift opened WITHOUT a scheduled row (ad-hoc check-in). The
 * dashboard shows the operator's classes around the check-in, so the snapshot
 * has to cover the same span — otherwise such a shift gets no class checklists.
 */
function adHocWindow(shift: ShiftContext) {
  const checkIn = new Date(shift.check_in_at).getTime();
  const end = shift.check_out_at ? new Date(shift.check_out_at).getTime() : Date.now();
  return {
    segmentIds: [] as string[],
    from: checkIn - 60 * 60_000,
    to: Math.max(end, checkIn) + 6 * 60 * 60_000,
    operator: shift.operator_name,
  };
}

/** The classes belonging to a shift (scheduled or ad-hoc), as checklist inputs. */
async function classesForShift(shift: ShiftContext): Promise<ChecklistClassInput[]> {
  const window = shift.scheduled_shift_id
    ? await displayWindowFor(shift.scheduled_shift_id)
    : adHocWindow(shift);
  if (!window) return [];
  const db = await admin();
  const fromKey = dateKey(new Date(window.from));
  const toKey = dateKey(new Date(window.to));
  let query = db
    .from("calendar_classes")
    .select(
      "id, dmc_class_id, dmc_instructor_id, specific_date, start_time, end_time, status, scheduled_shift_id",
    );
  // The time-window branch is only safe when scoped to this shift's operator —
  // without it, another operator's class at the same time would leak in.
  if (window.operator) {
    query = query.ilike("operator", window.operator);
    query = window.segmentIds.length
      ? query.or(
          `scheduled_shift_id.in.(${window.segmentIds.join(",")}),and(specific_date.gte.${fromKey},specific_date.lte.${toKey})`,
        )
      : query.gte("specific_date", fromKey).lte("specific_date", toKey);
  } else if (window.segmentIds.length) {
    query = query.in("scheduled_shift_id", window.segmentIds);
  } else {
    return [];
  }
  const { data, error } = await query.order("specific_date").order("start_time");
  if (error) throw new Error(error.message);
  const segmentSet = new Set(window.segmentIds);
  const rows = ((data ?? []) as ClassRow[]).filter((c) => {
    if (c.scheduled_shift_id && segmentSet.has(c.scheduled_shift_id)) return true;
    const t = toDate(c.specific_date, c.start_time.slice(0, 5)).getTime();
    return t >= window.from && t <= window.to;
  });
  if (!rows.length) return [];
  const { resolveClassIdentities } = await import("@/domain/dmc-directory.server");
  const resolved = (await resolveClassIdentities(rows)) as ((typeof rows)[number] & {
    className: string;
    teacherName: string;
  })[];
  return resolved.map((r) => ({
    classId: r.id,
    className: r.className,
    teacherName: r.teacherName,
    startTime: r.start_time.slice(0, 5),
    endTime: r.end_time.slice(0, 5),
    durationMinutes: durationMinutes(r.specific_date, r.start_time, r.end_time),
    status: r.status,
  }));
}

async function loadShift(shiftId: string) {
  const db = await admin();
  const { data, error } = await db
    .from("shifts")
    .select("id, operator_name, check_in_at, check_out_at, scheduled_shift_id, checklists")
    .eq("id", shiftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as (ShiftContext & { checklists: unknown }) | null;
}

/**
 * Compare-and-swap protects the whole-snapshot writers (creation and class
 * synchronization). The comparison runs INSIDE Postgres under a row lock via
 * `update_shift_checklists_cas` — sending the previous snapshot as a PostgREST
 * query-string filter produced oversized URLs and "Bad Request" failures.
 */
async function updateChecklists(
  shiftId: string,
  transform: (shift: NonNullable<Awaited<ReturnType<typeof loadShift>>>) => ShiftChecklists,
): Promise<ShiftChecklists> {
  const db = await admin();
  for (let attempt = 0; attempt < 12; attempt++) {
    const shift = await loadShift(shiftId);
    if (!shift) throw new Error("Shift not found");
    if (shift.check_out_at) throw new Error("Shift is already checked out");
    const next = transform(shift);
    const { data, error } = await db.rpc(
      "update_shift_checklists_cas" as never,
      {
        p_shift_id: shiftId,
        p_expected: shift.checklists ?? null,
        p_next: next,
      } as never,
    );
    if (error) throw new Error(error.message);
    if (data) return next;
  }
  throw new Error("Checklist changed repeatedly. Please try again.");
}

/**
 * Idempotent: creates the snapshot only when the shift has none. An existing
 * snapshot (and its completed items) is never overwritten or reset.
 */
export async function ensureChecklistsForShift(shiftId: string): Promise<ShiftChecklists | null> {
  const shift = await loadShift(shiftId);
  if (!shift) return null;
  if (isShiftChecklists(shift.checklists)) return shift.checklists;
  const [config, classes] = await Promise.all([readChecklistConfig(), classesForShift(shift)]);
  const snapshot = ensureShiftChecklists(null, config, classes);
  return updateChecklists(shiftId, (latest) =>
    isShiftChecklists(latest.checklists) ? latest.checklists : snapshot,
  );
}

/**
 * Brings one OPEN shift's class entries in line with its live classes.
 * Completion state is keyed by class id, so existing progress is preserved and
 * only genuinely new/changed classes are touched. Returns the current snapshot
 * unchanged when nothing differs (no write).
 */
async function syncClassesForShift(
  shift: ShiftContext & { checklists: unknown },
): Promise<ShiftChecklists | null> {
  if (shift.check_out_at) {
    return isShiftChecklists(shift.checklists) ? shift.checklists : null;
  }
  const [config, classes] = await Promise.all([readChecklistConfig(), classesForShift(shift)]);
  const current = ensureShiftChecklists(shift.checklists, config, classes);
  const next = syncClassChecklists(current, config, classes);
  if (isShiftChecklists(shift.checklists) && JSON.stringify(next) === JSON.stringify(current)) {
    return current;
  }
  return updateChecklists(shift.id, (latest) => {
    const base = ensureShiftChecklists(latest.checklists, config, classes);
    return syncClassChecklists(base, config, classes);
  });
}

/**
 * Keeps the snapshot of the OPEN shift for this scheduled shift in line with
 * its live classes. A no-op when nobody is checked in.
 */
export async function syncChecklistsForScheduledShift(
  scheduledShiftId: string | null,
): Promise<void> {
  if (!scheduledShiftId) return;
  const db = await admin();
  // The caller may pass ANY segment of a day-split shift (e.g. an after-midnight
  // class points at the second segment) while the open shift row references the
  // first — so look the open shift up across all merged segments.
  const window = await displayWindowFor(scheduledShiftId);
  const { data } = await db
    .from("shifts")
    .select("id")
    .in("scheduled_shift_id", window?.segmentIds ?? [scheduledShiftId])
    .is("check_out_at", null)
    .maybeSingle();
  const open = data as { id: string } | null;
  if (!open) return;
  const shift = await loadShift(open.id);
  if (!shift || !isShiftChecklists(shift.checklists)) return;
  await syncClassesForShift(shift);
}

/** Operator toggle of one checklist item on their own OPEN shift. */
export async function setChecklistItem(input: {
  shiftId: string;
  operator: string;
  section: "start" | "end" | "class";
  classId?: string | null;
  itemId: string;
  completed: boolean;
}): Promise<ShiftChecklists> {
  const { sameOperator } = await import("@/domain/operator-identity");
  const shift = await loadShift(input.shiftId);
  if (!shift) throw new Response("Shift not found", { status: 404 });
  if (!sameOperator(shift.operator_name, input.operator)) {
    throw new Response("Forbidden", { status: 403 });
  }
  if (shift.check_out_at) throw new Response("Shift is already checked out", { status: 409 });

  const current =
    (isShiftChecklists(shift.checklists) ? shift.checklists : null) ??
    (await ensureChecklistsForShift(input.shiftId));
  if (!current) throw new Response("Shift not found", { status: 404 });

  // Single atomic statement inside Postgres (row-locked): only this one item is
  // touched, so overlapping rapid clicks can never overwrite each other.
  const db = await admin();
  const { data, error } = await db.rpc(
    "set_shift_checklist_item" as never,
    {
      p_shift_id: input.shiftId,
      p_operator: input.operator,
      p_section: input.section,
      p_class_id: input.section === "class" ? String(input.classId ?? "") : null,
      p_item_id: input.itemId,
      p_completed: input.completed,
      p_completed_at: input.completed ? berlinClock(new Date()) : null,
    } as never,
  );
  if (error) {
    const message = String(error.message ?? "");
    if (message.includes("FORBIDDEN")) throw new Response("Forbidden", { status: 403 });
    if (message.includes("SHIFT_CLOSED")) {
      throw new Response("Shift is already checked out", { status: 409 });
    }
    if (message.includes("SHIFT_NOT_FOUND")) throw new Response("Shift not found", { status: 404 });
    throw new Error(message || "Could not save the checklist item");
  }
  if (!isShiftChecklists(data)) throw new Error("Could not save the checklist item");
  return data;
}

/**
 * The operator's own snapshot for one shift. Created on first read if missing.
 *
 * While the shift is open the class entries are reconciled with its live
 * classes, so a class added, retimed or cancelled after check-in still gets the
 * right checklist. Completion state is keyed by class id and never reset; a
 * closed shift is returned exactly as recorded.
 */
export async function readChecklistsForShift(input: {
  shiftId: string;
  operator: string;
}): Promise<ShiftChecklists | null> {
  const { sameOperator } = await import("@/domain/operator-identity");
  const shift = await loadShift(input.shiftId);
  if (!shift) throw new Response("Shift not found", { status: 404 });
  if (!sameOperator(shift.operator_name, input.operator)) {
    throw new Response("Forbidden", { status: 403 });
  }
  if (shift.check_out_at) {
    return isShiftChecklists(shift.checklists) ? shift.checklists : null;
  }
  try {
    return await syncClassesForShift(shift);
  } catch (err) {
    // Reading must never fail because of the reconciliation step.
    console.error("syncClassesForShift failed", err);
    return isShiftChecklists(shift.checklists) ? shift.checklists : null;
  }
}
