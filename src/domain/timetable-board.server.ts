/**
 * Current-week operator board data access — server only.
 *
 * Three batched queries, never one per class:
 *   1. every `calendar_classes` row in the week (all operators)
 *   2. the scheduled shifts those rows reference
 *   3. the DMC class id map, so slots can be matched by identity
 */
import type { ClassOccurrence, ShiftAssignmentRow } from "./timetable-week";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type WeekOperations = {
  occurrences: ClassOccurrence[];
  shifts: ShiftAssignmentRow[];
  classIdBySource: Record<string, string>;
};

export async function loadWeekOperations(from: string, to: string): Promise<WeekOperations> {
  const db = await admin();

  const [classesRes, dmcClassesRes] = await Promise.all([
    db
      .from("calendar_classes")
      .select(
        "id, specific_date, start_time, end_time, dmc_class_id, dmc_instructor_id, status, scheduled_shift_id, operator",
      )
      .gte("specific_date", from)
      .lte("specific_date", to),
    db.from("dmc_classes").select("id, source_class_id"),
  ]);
  if (classesRes.error) throw new Error(classesRes.error.message);
  if (dmcClassesRes.error) throw new Error(dmcClassesRes.error.message);

  const occurrences: ClassOccurrence[] = (classesRes.data ?? []).map((r) => ({
    id: r.id,
    specificDate: r.specific_date,
    startTime: r.start_time,
    endTime: r.end_time,
    dmcClassId: r.dmc_class_id,
    dmcInstructorId: r.dmc_instructor_id,
    status: r.status,
    scheduledShiftId: r.scheduled_shift_id,
    operator: r.operator,
  }));

  const shiftIds = [
    ...new Set(occurrences.flatMap((o) => (o.scheduledShiftId ? [o.scheduledShiftId] : []))),
  ];

  let shifts: ShiftAssignmentRow[] = [];
  if (shiftIds.length > 0) {
    const { data, error } = await db
      .from("scheduled_shifts")
      .select("id, assigned_operator")
      .in("id", shiftIds);
    if (error) throw new Error(error.message);
    shifts = (data ?? []).map((r) => ({ id: r.id, assignedOperator: r.assigned_operator }));
  }

  const classIdBySource: Record<string, string> = {};
  for (const row of dmcClassesRes.data ?? []) classIdBySource[row.source_class_id] = row.id;

  return { occurrences, shifts, classIdBySource };
}
