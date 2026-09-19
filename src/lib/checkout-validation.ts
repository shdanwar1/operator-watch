import { isEndChecklistComplete } from "@/domain/checklists";

export type CheckoutState = {
  check_in_at: string;
  check_out_at: string | null;
};

/** Validate an attendance checkout without consulting the scheduled shift end. */
export function assertCanCheckOut(state: CheckoutState, now: Date) {
  if (state.check_out_at) throw new Error("This shift is already checked out");

  const checkInAt = new Date(state.check_in_at);
  if (Number.isNaN(checkInAt.getTime()) || now.getTime() < checkInAt.getTime()) {
    throw new Error("Invalid attendance record");
  }
}
/**
 * Operation 2 rule: only the End Shift checklist blocks checkout. Start Shift
 * and class checklists never do.
 */
export function assertEndChecklistComplete(checklists: unknown) {
  const { isEndChecklistComplete } = require("@/domain/checklists") as {
    isEndChecklistComplete: (v: unknown) => boolean;
  };
  if (!isEndChecklistComplete(checklists)) {
    throw new Error("Complete the End Shift Checklist before checking out");
  }
}
