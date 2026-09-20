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

/** The classes attached to a scheduled shift, as checklist inputs. */
async function classesForScheduledShift(
  scheduledShiftId: string | null,
): Promise<ChecklistClassInput[]> {
  if (!scheduledShiftId) return [];
  const window = await displayWindowFor(scheduledShiftId);
  if (!window) return [];
  const db = await admin();
  const fromKey = dateKey(new Date(window.from));
  const toKey = dateKey(new Date(window.to));
  const idList = window.segmentIds.join(",");
  let query = db
    .from("calendar_classes")
    .select(
      "id, dmc_class_id, dmc_instructor_id, specific_date, start_time, end_time, status, scheduled_shift_id",
    );
  // The time-window branch is only safe when scoped to this shift's operator —
  // without it, another operator's class at the same time would leak in.
  query = window.operator
    ? query
        .ilike("operator", window.operator)
        .or(
          `scheduled_shift_id.in.(${idList}),and(specific_date.gte.${fromKey},specific_date.lte.${toKey})`,
        )
    : query.in("scheduled_shift_id", window.segmentIds);
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
    .select("id, operator_name, check_out_at, scheduled_shift_id, checklists")
    .eq("id", shiftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as {
    id: string;
    operator_name: string;
    check_out_at: string | null;
    scheduled_shift_id: string | null;
    checklists: unknown;
  } | null;
}

/** Compare-and-swap protects all snapshot writers, including class synchronization. */
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
    let query = db
      .from("shifts")
      .update({ checklists: next } as never)
      .eq("id", shiftId)
      .eq("operator_name", shift.operator_name)
      .is("check_out_at", null);
    query =
      shift.checklists === null
        ? query.is("checklists", null)
        : query.eq("checklists", JSON.stringify(shift.checklists));
    const { data, error } = await query.select("id");
    if (error) throw new Error(error.message);
    if (data?.length) return next;
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
  const [config, classes] = await Promise.all([
    readChecklistConfig(),
    classesForScheduledShift(shift.scheduled_shift_id),
  ]);
  const snapshot = ensureShiftChecklists(null, config, classes);
  return updateChecklists(shiftId, (latest) =>
    isShiftChecklists(latest.checklists) ? latest.checklists : snapshot,
  );
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
    .select("id, checklists")
    .in("scheduled_shift_id", window?.segmentIds ?? [scheduledShiftId])
    .is("check_out_at", null)
    .maybeSingle();
  const open = data as { id: string; checklists: unknown } | null;
  if (!open || !isShiftChecklists(open.checklists)) return;
  const [config, classes] = await Promise.all([
    readChecklistConfig(),
    classesForScheduledShift(scheduledShiftId),
  ]);
  await updateChecklists(open.id, (latest) =>
    syncClassChecklists(ensureShiftChecklists(latest.checklists, config, classes), config, classes),
  );
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

  const target =
    input.section === "class"
      ? ({ section: "class", classId: String(input.classId ?? "") } as const)
      : ({ section: input.section } as const);
  return updateChecklists(input.shiftId, (latest) => {
    if (!sameOperator(latest.operator_name, input.operator)) {
      throw new Response("Forbidden", { status: 403 });
    }
    const snapshot = isShiftChecklists(latest.checklists) ? latest.checklists : current;
    return setChecklistItemState(
      snapshot,
      target,
      input.itemId,
      input.completed,
      input.completed ? berlinClock(new Date()) : null,
    );
  });
}

/** The operator's own snapshot for one shift. Created on first read if missing. */
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
  if (isShiftChecklists(shift.checklists)) return shift.checklists;
  if (shift.check_out_at) return null;
  return ensureChecklistsForShift(input.shiftId);
}
