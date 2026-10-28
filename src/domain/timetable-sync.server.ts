/**
 * The single timetable sync engine: fetch → validate → commit. Used by the
 * admin "Sync" button and the daily 05:00 Berlin job. Any failure before the
 * commit leaves the stored timetable exactly as it was.
 */
import type { DmcTimetableAnomaly } from "./timetable";
import { recordAutomationHealth } from "@/lib/automation-health.server";
import type { AutomationReport } from "./automation-health";

export type TimetableSyncResult =
  | {
      ok: true;
      classes: number;
      instructors: number;
      slots: number;
      removedSlots: number;
      anomalies: DmcTimetableAnomaly[];
      refreshedAt: string;
    }
  | { ok: false; error: string };

export async function runTimetableSync(): Promise<TimetableSyncResult> {
  const startedAt = Date.now();
  const report: AutomationReport = { outcome: "failed", counters: {}, stages: { snapshot: "not completed", shift_generation: "not started" }, errorCode: "fetch_failed" };
  try {
  const { dmcPublicTimetableProvider } = await import("./dmc-timetable-provider.server");
  const result = await dmcPublicTimetableProvider.fetchTimetable();
  if (!result.ok) return { ok: false, error: result.error };

  report.errorCode = "snapshot_failed";
  const { commitSnapshot } = await import("./timetable-repository.server");
  const committed = await commitSnapshot(result.snapshot);
  report.stages.snapshot = "saved";
  report.counters = { slots: committed.slots, removed_slots: committed.removedSlots };
  report.outcome = "partial";
  report.errorCode = "generation_failed";
  // Operator shifts are derived from the timetable (Google sync is retired).
  const { generateTimetableShifts } = await import("./shift-generation.server");
  const generated = await generateTimetableShifts();
  report.stages.shift_generation = "completed";
  report.counters.shifts = generated.shifts;
  report.outcome = "success";
  report.errorCode = null;
  return {
    ok: true,
    ...committed,
    anomalies: result.anomalies,
    refreshedAt: result.snapshot.fetchedAt,
  };
  } finally {
    await recordAutomationHealth("timetable_sync", startedAt, report);
  }
}
