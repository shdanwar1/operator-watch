/**
 * The one check-out path shared by manual and automatic check-out.
 * Idempotent: the update only matches a still-open shift.
 */
import { assertEndChecklistComplete } from "./checkout-validation";
import type { ShiftClass } from "./shifts.functions";

export async function closeShift(opts: {
  shiftId: string;
  checklists: unknown;
  scheduledShiftId: string | null;
  checkOutAt: Date;
  classes?: ShiftClass[];
}): Promise<boolean> {
  assertEndChecklistComplete(opts.checklists);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const patch: Record<string, unknown> = { check_out_at: opts.checkOutAt.toISOString() };
  if (opts.classes !== undefined) {
    patch.classes = opts.classes;
    patch.live_streams_count = opts.classes.length;
  }
  const { data: closed, error } = await supabaseAdmin
    .from("shifts")
    .update(patch as never)
    .eq("id", opts.shiftId)
    .is("check_out_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!closed) return false;

  // Checkout is the authoritative completion event for a scheduled shift.
  if (opts.scheduledShiftId) {
    await supabaseAdmin
      .from("scheduled_shifts")
      .update({ status: "completed" } as never)
      .eq("id", opts.scheduledShiftId)
      .neq("status", "cancelled");
  }
  return true;
}
