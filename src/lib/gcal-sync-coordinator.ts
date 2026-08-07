/**
 * Tab-local coordination for Google Calendar sync.
 *
 * Several routes (dashboard, calendar) each mount `useCalendarSync`
 * independently, and each decides "sync now" on its own mount with no memory
 * of what any other mounted — or just-unmounted — component already did. Ping-
 * ponging between those pages (or leaving several tabs open) would otherwise
 * re-hit Google Calendar and re-write the database far more often than the
 * underlying schedule actually changes. This module is the single shared
 * source of truth for "did we just sync, and is one already running" so every
 * caller in this tab agrees on it.
 */

export type CoordinatedSyncFn<T> = (args: {
  data: { includeNextMonth: boolean };
}) => Promise<T>;

/** Don't repeat an *automatic* sync within this long of the last completed one. */
const MIN_AUTO_INTERVAL_MS = 90_000;

let inFlight: Promise<unknown> | null = null;
let lastCompletedAt = 0;

export function msSinceLastSync(): number {
  return lastCompletedAt ? Date.now() - lastCompletedAt : Infinity;
}

/**
 * Runs `syncFn` with two guarantees:
 *  - single-flight: if a sync is already running, callers piggy-back on it
 *    instead of starting a second, redundant one.
 *  - cooldown: non-forced (automatic) calls are skipped outright if a sync
 *    completed within the last `MIN_AUTO_INTERVAL_MS`.
 * Manual, user-initiated syncs (button clicks, saving a new calendar link)
 * should always pass `force: true` so they're never silently dropped.
 */
export async function coordinatedSync<T>(
  syncFn: CoordinatedSyncFn<T>,
  opts: { includeNextMonth: boolean; force: boolean },
): Promise<{ result: T; skipped: false } | { result: null; skipped: true }> {
  if (inFlight) {
    await inFlight.catch(() => undefined);
    return { result: null, skipped: true };
  }
  if (!opts.force && msSinceLastSync() < MIN_AUTO_INTERVAL_MS) {
    return { result: null, skipped: true };
  }
  const run = syncFn({ data: { includeNextMonth: opts.includeNextMonth } });
  inFlight = run;
  try {
    const result = await run;
    lastCompletedAt = Date.now();
    return { result, skipped: false };
  } finally {
    inFlight = null;
  }
}
