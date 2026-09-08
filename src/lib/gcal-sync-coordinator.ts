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

export type CoordinatedSyncFn<T> = (args: { data: Record<string, never> }) => Promise<T>;

/** Don't repeat an *automatic* sync within this long of the last completed one. */
const MIN_AUTO_INTERVAL_MS = 90_000;

let inFlight: Promise<unknown> | null = null;
let lastCompletedAt = 0;

export function msSinceLastSync(): number {
  return lastCompletedAt ? Date.now() - lastCompletedAt : Infinity;
}

/**
 * Runs `syncFn` with two guarantees:
 *  - single-flight: if a sync is already running, callers piggy-back on it and
 *    receive that same result instead of starting a second, redundant one.
 *  - cooldown: non-forced (automatic) calls are skipped outright if a
 *    *successful* sync completed within the last `MIN_AUTO_INTERVAL_MS`. A
 *    failed sync never starts the cooldown, so automatic retries continue.
 * Manual, user-initiated syncs (button clicks, saving a new calendar link)
 * should always pass `force: true` so they're never silently dropped.
 */
export async function coordinatedSync<T>(
  syncFn: CoordinatedSyncFn<T>,
  opts: {
    includeNextMonth: boolean;
    force: boolean;
    /** Only a result that passes this counts as a completed sync. */
    isSuccess?: (result: T) => boolean;
  },
): Promise<{ result: T; skipped: false } | { result: null; skipped: true }> {
  if (inFlight) {
    // Share the running sync's outcome rather than reporting "nothing happened":
    // every waiting caller still needs to refresh from the same result.
    try {
      return { result: (await inFlight) as T, skipped: false };
    } catch {
      return { result: null, skipped: true };
    }
  }
  if (!opts.force && msSinceLastSync() < MIN_AUTO_INTERVAL_MS) {
    return { result: null, skipped: true };
  }
  const run = syncFn({ data: { includeNextMonth: opts.includeNextMonth } });
  inFlight = run;
  try {
    const result = await run;
    if (!opts.isSuccess || opts.isSuccess(result)) lastCompletedAt = Date.now();
    return { result, skipped: false };
  } finally {
    inFlight = null;
  }
}

