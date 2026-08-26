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