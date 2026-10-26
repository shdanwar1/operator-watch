/**
 * Writes timetable-planned shifts into `scheduled_shifts` + `calendar_classes`.
 * Runs after every timetable sync and after an admin rotation change.
 * Idempotent: identities are deterministic (`tt:` prefix). Worked or completed
 * shifts are never rewritten; only today-onwards rows are touched.
 */
import { berlinDateKey } from "@/lib/gcal-core";
import * as shiftRepo from "./shift-repository.server";
import { DEFAULT_ROTATION, planTimetableShifts, type ShiftRotation } from "./shift-rotation";
import type { RotationAdjustment } from "./rotation-adjustments";

export const ROTATION_SETTING_KEY = "shift_rotation";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function readRotation(): Promise<ShiftRotation> {
  const db = await admin();
  const { data } = await db.from("app_settings").select("value").eq("key", ROTATION_SETTING_KEY).maybeSingle();
  const v = (data?.value ?? null) as Partial<ShiftRotation> | null;
  if (!v || typeof v.anchorMonth !== "string") return { ...DEFAULT_ROTATION };
  return {
    anchorMonth: v.anchorMonth,
    day: v.day ?? null,
    night: v.night ?? null,
    weekend: v.weekend ?? null,
  };
}

function endOfNextMonth(today: string) {
  const [y, m] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
}

export type GenerationResult = { shifts: number; removed: number; classes: number };

export async function readRotationAdjustments(): Promise<RotationAdjustment[]> {
  const db = await admin();
  const { data, error } = await db.from("rotation_adjustments").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as RotationAdjustment[];
}

export async function generateTimetableShifts(notBefore?: string): Promise<GenerationResult> {
  const db = await admin();
  const today = notBefore && notBefore > berlinDateKey() ? notBefore : berlinDateKey();
  const to = endOfNextMonth(today);
  const spill = new Date(Date.parse(`${to}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

  const { loadStoredTimetable } = await import("./timetable-repository.server");
  const { loadDmcIdsBySourceId } = await import("./dmc-directory.server");
  const [{ slots, overrides, instructors }, rotation, ids, adjustments] = await Promise.all([
    loadStoredTimetable(),
    readRotation(),
    loadDmcIdsBySourceId(),
    readRotationAdjustments(),
  ]);
  if (slots.length === 0) return { shifts: 0, removed: 0, classes: 0 };

  // Existing generated + legacy Google rows from today on.
  const [ttRows, gRows] = await Promise.all([
    shiftRepo.listByIdentityPrefix("tt:", today, spill),
    shiftRepo.listByIdentityPrefix("op:", today, spill),
  ]);
  const allIds = [...ttRows, ...gRows].map((r) => r.id);
  const worked = new Set<string>();
  if (allIds.length) {
    const { data, error } = await db.from("shifts").select("scheduled_shift_id").in("scheduled_shift_id", allIds);
    if (error) throw new Error(error.message);
    for (const w of data ?? []) if (w.scheduled_shift_id) worked.add(w.scheduled_shift_id as string);
  }
  const frozen = (r: { id: string; status: string }) => worked.has(r.id) || r.status === "completed";
  const frozenRows = ttRows.filter(frozen);
  const frozenIds = new Set(frozenRows.map((r) => r.id));
  const excludedClassUids = new Set<string>();
  if (frozenIds.size) {
    const { data, error } = await db.from("calendar_classes").select("uid").in("scheduled_shift_id", [...frozenIds]);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) excludedClassUids.add(row.uid);
  }
  const plans = planTimetableShifts({
    slots, from: today, to: spill, rotation, overrides, adjustments, excludedClassUids,
    instructorIds: instructors.map((i) => i.sourceInstructorId),
  }).filter((p) => p.date >= today && p.date <= to && p.operator);

  const desired = new Map(plans.map((p) => [p.uid, p]));
  const stale = [
    ...ttRows.filter((r) => !frozen(r) && !desired.has(r.external_event_id ?? "")),
    ...gRows.filter((r) => !frozen(r)), // Google sync is retired
  ].map((r) => r.id);
  if (stale.length) {
    await db.from("calendar_classes").delete().in("scheduled_shift_id", stale);
    await shiftRepo.removeMany(stale);
  }

  const existing = new Map(ttRows.filter((r) => !stale.includes(r.id)).flatMap((r) => r.external_event_id ? [[r.external_event_id, r] as const] : []));
  const classRows: {
    operator: string; uid: string; dmc_class_id: string | null; dmc_instructor_id: string | null;
    specific_date: string; start_time: string; end_time: string; status: string; scheduled_shift_id: string;
  }[] = [];

  for (const p of plans) {
    const operator = p.operator;
    if (!operator) continue;
    const row = existing.get(p.uid);
    if (row && frozen(row)) continue;
    const payload = {
      specific_date: p.date,
      start_time: p.startTime,
      end_time: p.endTime,
      label: p.classes.length === 1 ? "1 class" : `${p.classes.length} classes`,
      assigned_operator: p.operator,
      status: row?.status === "cancelled" ? "cancelled" : "assigned",
      external_event_id: p.uid,
    };
    let id: string;
    if (row) {
      await shiftRepo.patch(row.id, payload);
      id = row.id;
    } else {
      id = (await shiftRepo.insertOne({ ...payload, notes: null })).id;
    }
    for (const c of p.classes) {
      classRows.push({
        operator,
        uid: c.uid,
        dmc_class_id: ids.classIdBySource.get(c.sourceClassId) ?? null,
        dmc_instructor_id: ids.instructorIdBySource.get(c.sourceInstructorId) ?? null,
        specific_date: c.date,
        start_time: c.startTime,
        end_time: c.endTime,
        status: "scheduled",
        scheduled_shift_id: id,
      });
    }
  }

  // Keep operator-set class states (completed / cancelled).
  const { data: kept } = await db
    .from("calendar_classes")
    .select("id, uid, operator, status")
    .like("uid", "tt:%")
    .gte("specific_date", today);
  const keepStatus = new Map<string, string>();
  for (const k of kept ?? []) if (k.status !== "scheduled") keepStatus.set(`${k.operator}|${k.uid}`, k.status as string);
  for (const r of classRows) r.status = keepStatus.get(`${r.operator}|${r.uid}`) ?? r.status;

  for (let i = 0; i < classRows.length; i += 200) {
    const { error } = await db
      .from("calendar_classes")
      .upsert(classRows.slice(i, i + 200), { onConflict: "operator,uid" });
    if (error) throw new Error(error.message);
  }

  // Remove generated future class rows no longer planned (e.g. operator moved).
  const want = new Set(classRows.map((r) => `${r.operator}|${r.uid}`));
  const frozenShiftIds = new Set(ttRows.filter(frozen).map((r) => r.id));
  const orphan = (kept ?? [])
    .filter((k) => !want.has(`${k.operator}|${k.uid}`))
    .map((k) => k.id as string);
  if (orphan.length) {
    const { data: rows } = await db.from("calendar_classes").select("id, scheduled_shift_id").in("id", orphan);
    const del = (rows ?? []).filter((r) => !frozenShiftIds.has(r.scheduled_shift_id as string)).map((r) => r.id as string);
    if (del.length) await db.from("calendar_classes").delete().in("id", del);
  }

  return { shifts: plans.length, removed: stale.length, classes: classRows.length };
}
