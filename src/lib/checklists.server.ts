/**
 * Checklist persistence (Operation 1) — server only.
 *
 * Master templates: `app_settings.operator_checklists` (fallback = the seeded
 * defaults). Snapshot: `shifts.checklists`, written only when a real shift is
 * opened or its classes change.
 */
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
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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

/** The classes attached to a scheduled shift, as checklist inputs. */
async function classesForScheduledShift(
  scheduledShiftId: string | null,
): Promise<ChecklistClassInput[]> {
  if (!scheduledShiftId) return [];
  const db = await admin();
  const { data, error } = await db
    .from("calendar_classes")
    .select("id, dmc_class_id, dmc_instructor_id, specific_date, start_time, end_time, status")
    .eq("scheduled_shift_id", scheduledShiftId)
    .order("specific_date")
    .order("start_time");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as {
    id: string;
    dmc_class_id: string | null;
    dmc_instructor_id: string | null;
    specific_date: string;
    start_time: string;
    end_time: string;
    status: string;
  }[];
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

async function writeChecklists(shiftId: string, value: ShiftChecklists) {
  const db = await admin();
  const { error } = await db
    .from("shifts")
    .update({ checklists: value } as never)
    .eq("id", shiftId);
  if (error) throw new Error(error.message);
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
  await writeChecklists(shiftId, snapshot);
  return snapshot;
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
  const { data } = await db
    .from("shifts")
    .select("id, checklists")
    .eq("scheduled_shift_id", scheduledShiftId)
    .is("check_out_at", null)
    .maybeSingle();
  const open = data as { id: string; checklists: unknown } | null;
  if (!open || !isShiftChecklists(open.checklists)) return;
  const [config, classes] = await Promise.all([
    readChecklistConfig(),
    classesForScheduledShift(scheduledShiftId),
  ]);
  await writeChecklists(open.id, syncClassChecklists(open.checklists, config, classes));
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
  const next = setChecklistItemState(current, target, input.itemId, input.completed);
  await writeChecklists(input.shiftId, next);
  return next;
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
