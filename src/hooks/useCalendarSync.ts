import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { syncGoogleCalendar } from "@/lib/gcal.functions";
import type { MatchLog } from "@/lib/gcal-match";
import { publishSync, subscribeSync, type SyncMessage } from "@/lib/sync-bus";
import { coordinatedSync } from "@/lib/gcal-sync-coordinator";
import { readCache, writeCache } from "@/lib/local-cache";

/**
 * Shared Google Calendar synchronization.
 *
 * Google Calendar import is MANUAL ONLY: nothing here syncs on mount, on a
 * timer, on refocus or on tab visibility changes. A sync only happens when
 * something calls `runSync()` in response to a user action. The scope is
 * always the current calendar month.
 */
export function useCalendarSync(options: {
  /** Only sync when the operator actually has a linked calendar. */
  enabled: boolean;
  /** Re-fetch the caller's own data once the sync has landed. */
  onSynced: () => void | Promise<void>;
  /** Announce results with toasts (the page that owns the sync button). */
  announce?: boolean;
  /** Persist the last successful sync time locally under this key. */
  cacheKey?: string | null;
}) {
  const { enabled, announce = false, cacheKey = null } = options;
  const syncFn = useServerFn(syncGoogleCalendar);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(() => {
    if (!cacheKey) return null;
    const cached = readCache<number>(cacheKey);
    return cached ? new Date(cached) : null;
  });
  const [logs, setLogs] = useState<MatchLog[]>([]);

  // Kept in refs so callbacks stay stable across renders.
  const onSyncedRef = useRef(options.onSynced);
  onSyncedRef.current = options.onSynced;
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;

  const runSync = useCallback(
    async (opts?: { silent?: boolean; force?: boolean }) => {
      if (!enabled) return;
      const silent = opts?.silent ?? !announce;
      // Every sync is user-initiated now, so it always goes through; the
      // coordinator still de-duplicates concurrent clicks.
      const force = opts?.force ?? true;
      setSyncing(true);
      try {
        const { result: res, skipped } = await coordinatedSync(syncFn, {
          // Manual sync is always current-month-only.
          includeNextMonth: false,
          force,
          isSuccess: (r) => r?.ok === true,
        });
        if (skipped || !res) return undefined;

        setLogs(res.logs ?? []);
        if (!res.ok) {
          if (!silent) toast.error(res.error ?? "Sync failed");
          return res;
        }
        // The server/database timestamp is authoritative; the local cache is
        // only a paint-fast copy of it.
        if (res.syncedAt) {
          const at = new Date(res.syncedAt);
          setLastSync(at);
          if (cacheKeyRef.current) writeCache(cacheKeyRef.current, at.getTime());
        }
        // Refresh the caller first, then everything else that is open.
        await onSyncedRef.current();
        publishSync({ type: "data-synced", at: Date.now() });
        if (!silent) toast.success("Google Calendar synchronized successfully.");
        return res;

      } catch (e) {
        if (!silent) toast.error(e instanceof Error ? e.message : "Sync failed");
        return undefined;
      } finally {
        setSyncing(false);
      }
    },
    [enabled, announce, syncFn],
  );

  // Automatic sync: on mount, then on a background cadence — paused while
  // the tab is hidden (no point polling a calendar nobody is looking at),
  // with an immediate catch-up check when it becomes visible again.
  useEffect(() => {
    if (!enabled || !autoEnabled) return;
    const auto = () => runSync({ silent: true, force: false });
    auto();

    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval) return;
      interval = setInterval(auto, AUTO_SYNC_MS);
    };
    const stop = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        auto();
        start();
      } else {
        stop();
      }
    };

    if (typeof document !== "undefined" && document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, autoEnabled, runSync]);

  return { syncing, lastSync, setLastSync, logs, setLogs, runSync };
}

/** Refreshes the caller whenever any view reports a completed sync. */
export function useSyncListener(handler: (message: SyncMessage) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribeSync((m) => ref.current(m)), []);
}
