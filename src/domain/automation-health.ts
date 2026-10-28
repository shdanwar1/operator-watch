export const AUTOMATION_PROCESSES = ["timetable_sync", "push_dispatch", "auto_checkout"] as const;
export type AutomationProcess = (typeof AUTOMATION_PROCESSES)[number];
export type AutomationOutcome = "success" | "noop" | "partial" | "failed";
export type AutomationReport = {
  outcome: AutomationOutcome;
  counters: Record<string, number>;
  stages: Record<string, string>;
  errorCode: string | null;
};
export type AutomationHealthRow = {
  process: AutomationProcess;
  attempted_at: string;
  finished_at: string;
  last_success_at: string | null;
  outcome: AutomationOutcome;
  duration_ms: number;
  counters: Record<string, number>;
  stages: Record<string, string>;
  error_code: string | null;
  last_error_code: string | null;
  last_error_at: string | null;
};
export const HEALTH_ERRORS: Record<string, string> = {
  fetch_failed: "Timetable could not be fetched or validated.",
  snapshot_failed: "Timetable snapshot could not be saved.",
  generation_failed: "Timetable was saved, but shift generation did not finish.",
  schedule_read_failed: "Scheduled shifts could not be read.",
  open_shift_read_failed: "Opted-in open shifts could not be read.",
  class_read_failed: "Class identity references could not be read.",
  checkout_failed: "One or more shift closures failed.",
  operator_read_failed: "Active operators could not be read.",
  dispatch_partial: "Some reminder preparation, claims, sends, or result saves failed.",
  dispatch_failed: "Reminder dispatch did not finish.",
};
export function healthError(code: string | null): string | null {
  return code ? HEALTH_ERRORS[code] ?? "The process reported an error." : null;
}
export function automationStatus(row: AutomationHealthRow | undefined, now: number, dispatchDue: boolean | null) {
  if (!row) return "Not observed";
  if (row.outcome === "failed") return "Failed";
  if (row.outcome === "partial") return "Partial failure";
  const age = now - Date.parse(row.finished_at);
  if (row.process === "timetable_sync" && age > 26 * 60 * 60_000) return "Out of date";
  // The minute timer is conditional: silence when no work is due is normal.
  if (row.process !== "timetable_sync" && age > 12 * 60_000) {
    if (dispatchDue === null) return "Freshness unavailable";
    return dispatchDue ? "Awaiting check" : "Idle";
  }
  return row.outcome === "noop" ? "Nothing due" : "Healthy";
}