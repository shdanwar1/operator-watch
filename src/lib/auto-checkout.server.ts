/**
 * Server-side auto check-out, run from the every-minute timer.
 * Only shifts whose scheduled end has just passed are checked. Idempotent.
 */
import { AUTO_CHECKOUT_WINDOW_MS, autoCheckoutAt, scheduledEndAt } from "@/domain/auto-checkout";
import { isShiftChecklists } from "@/domain/checklists";
import type { ShiftClass } from "./shifts.functions";
import { closeShift } from "./shift-close.server";

function berlinDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(d);
}

type SchedRow = {
  id: string;
  specific_date: string;
  start_time: string;
  end_time: string;
  status: string | null;
};

/**
 * `preloaded` lets the dispatcher pass scheduled_shifts rows it already read
 * (must cover at least yesterday + today, Berlin) so this skips its own read.
 */
export async function runAutoCheckout(
  now: Date = new Date(),
  preloaded?: SchedRow[],
): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const today = berlinDate(now);
  const yesterday = berlinDate(new Date(now.getTime() - 86_400_000));
  let scheds: SchedRow[];
  if (preloaded) {
    scheds = preloaded.filter(
      (s) =>
        s.status !== "cancelled" &&
        (String(s.specific_date) === today || String(s.specific_date) === yesterday),
    );
  } else {
    const { data, error } = await supabaseAdmin
      .from("scheduled_shifts")
      .select("id, specific_date, start_time, end_time, status")
      .in("specific_date", [yesterday, today])
      .neq("status", "cancelled");
    if (error) {
      console.error("auto-checkout schedule read failed", error.message);
      return 0;
    }
    scheds = (data ?? []) as SchedRow[];
  }
  if (!scheds.length) return 0;

  const endById = new Map<string, Date>();
  for (const s of scheds) {
    const end = scheduledEndAt({
      specific_date: String(s.specific_date),
      start_time: String(s.start_time),
      end_time: String(s.end_time),
    });
    const t = now.getTime() - end.getTime();
    if (t >= 0 && t < AUTO_CHECKOUT_WINDOW_MS) endById.set(String(s.id), end);
  }
  if (endById.size === 0) return 0;

  // Only shifts whose operator explicitly ticked "Auto check-out at shift end".
  const { data: open, error: openErr } = await supabaseAdmin
    .from("shifts")
    .select("id, check_in_at, check_out_at, scheduled_shift_id, checklists, classes")
    .is("check_out_at", null)
    .eq("auto_checkout_at_end", true)
    .in("scheduled_shift_id", [...endById.keys()]);
  // A failed read must be visible in logs, not look like "nothing due".
  if (openErr) {
    console.error("auto-checkout open-shift read failed", openErr.message);
    return 0;
  }

  let closedCount = 0;
  for (const s of open ?? []) {
    const end = endById.get(String(s.scheduled_shift_id));
    if (!end) continue;
    const at = autoCheckoutAt({
      checkOutAt: s.check_out_at ? String(s.check_out_at) : null,
      checklists: s.checklists,
      scheduledEnd: end,
      now,
    });
    if (!at) continue;
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
