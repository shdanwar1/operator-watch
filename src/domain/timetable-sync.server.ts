/**
 * The single timetable sync engine: fetch → validate → commit. Used by the
 * admin "Sync" button and the daily 05:00 Berlin job. Any failure before the
 * commit leaves the stored timetable exactly as it was.
 */
import type { DmcTimetableAnomaly } from "./timetable";

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
  const { dmcPublicTimetableProvider } = await import("./dmc-timetable-provider.server");
  const result = await dmcPublicTimetableProvider.fetchTimetable();
  if (!result.ok) return { ok: false, error: result.error };

  const { commitSnapshot } = await import("./timetable-repository.server");
  const committed = await commitSnapshot(result.snapshot);
  // Operator shifts are derived from the timetable (Google sync is retired).
  const { generateTimetableShifts } = await import("./shift-generation.server");
  await generateTimetableShifts();
  return {
    ok: true,
    ...committed,
    anomalies: result.anomalies,
    refreshedAt: result.snapshot.fetchedAt,
  };
}
