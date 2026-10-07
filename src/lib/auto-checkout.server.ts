/**
 * Server-side auto check-out sweep, run from the every-minute timer.
 * Works without any browser open. Bounded batch, idempotent.
 */
import { autoCheckoutAt, autoCheckoutEnabled, scheduledEndAt } from "@/domain/auto-checkout";
import { isShiftChecklists } from "@/domain/checklists";
import { normalizeUsername } from "@/domain/operator-identity";
import type { ShiftClass } from "./shifts.functions";
import { closeShift } from "./shift-close.server";

const BATCH = 25;
// Scan window: ineligible rows (unfinished checklist, not yet ended) must not
// crowd out eligible ones, so scan wide (newest first) and close up to BATCH.
const SCAN = 500;

export async function runAutoCheckout(now: Date = new Date()): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: open, error } = await supabaseAdmin
    .from("shifts")
    .select("id, operator_name, check_in_at, check_out_at, scheduled_shift_id, checklists, classes")
    .is("check_out_at", null)
    .not("scheduled_shift_id", "is", null)
    .order("check_in_at", { ascending: false })
    .limit(SCAN);
  if (error || !open?.length) return 0;

  const schedIds = open.map((s) => String(s.scheduled_shift_id));
  const [{ data: scheds }, { data: ops }] = await Promise.all([
    supabaseAdmin
      .from("scheduled_shifts")
      .select("id, specific_date, start_time, end_time")
      .in("id", schedIds),
    supabaseAdmin.from("operators").select("username, prefs"),
  ]);
  const schedById = new Map((scheds ?? []).map((s) => [String(s.id), s]));
  const prefsByName = new Map(
    (ops ?? []).map((o) => [normalizeUsername(String(o.username)), o.prefs]),
  );

  let closedCount = 0;
  for (const s of open) {
    if (closedCount >= BATCH) break;
    const sched = schedById.get(String(s.scheduled_shift_id));
    if (!sched) continue;
    const at = autoCheckoutAt({
      checkOutAt: s.check_out_at ? String(s.check_out_at) : null,
      checklists: s.checklists,
      scheduledEnd: scheduledEndAt({
        specific_date: String(sched.specific_date),
        start_time: String(sched.start_time),
        end_time: String(sched.end_time),
      }),
      enabled: autoCheckoutEnabled(prefsByName.get(normalizeUsername(String(s.operator_name)))),
    });
    if (!at || at.getTime() > now.getTime()) continue;
    // Never close before check-in.
    const checkIn = new Date(String(s.check_in_at)).getTime();
    const checkOutAt = new Date(Math.max(at.getTime(), checkIn));
    try {
      const classes = await classesForShift(s.checklists, s.classes);
      const ok = await closeShift({
        shiftId: String(s.id),
        checklists: s.checklists,
        scheduledShiftId: String(s.scheduled_shift_id),
        checkOutAt,
        classes,
      });
      if (ok) closedCount++;
    } catch (e) {
      console.error("auto-checkout failed", s.id, e);
    }
  }
  return closedCount;
}

/** Every non-cancelled class from the shift snapshot, with name + teacher. */
async function classesForShift(
  checklists: unknown,
  existing: unknown,
): Promise<ShiftClass[] | undefined> {
  if (!isShiftChecklists(checklists)) return undefined;
  const snap = checklists.classes.filter((c) => c.status !== "cancelled");
  if (snap.length === 0) {
    return Array.isArray(existing) && existing.length ? undefined : [];
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("calendar_classes")
    .select("id, dmc_class_id, dmc_instructor_id")
    .in(
      "id",
      snap.map((c) => c.classId),
    );
  const refs = new Map((data ?? []).map((r) => [String(r.id), r]));
  return [...snap]
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((c) => {
      const r = refs.get(c.classId);
      return {
        class: c.className,
        teacher: c.teacherName,
        dmcClassId: r?.dmc_class_id ?? null,
        dmcInstructorId: r?.dmc_instructor_id ?? null,
      };
    });
}
