import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { syncGoogleCalendar } from "@/lib/gcal.functions";
import type { MatchLog } from "@/lib/gcal-match";
import { publishSync, subscribeSync, type SyncMessage } from "@/lib/sync-bus";
import { coordinatedSync } from "@/lib/gcal-sync-coordinator";
import { readCache, writeCache } from "@/lib/local-cache";

// Background cadence. Kept deliberately loose: the single-flight/cooldown
// coordinator, the cross-tab broadcast, and realtime DB listeners already
// cover the gaps in between, so this interval only needs to catch changes
// made directly in Google Calendar since the last sync.
const AUTO_SYNC_MS = 10 * 60 * 1000;

/**
 * Shared Google Calendar synchronization.
 *
 * Manual, automatic and first-import syncs all run through here, so every
 * trigger produces the same pipeline: import → refresh the caller's data →
 * broadcast so every other open view refreshes too. Automatic triggers
 * (mount, interval, tab refocus) go through the shared coordinator, which
 * skips the network entirely if a sync completed very recently — no matter
 * how many components ask. Manual triggers (buttons, saving a calendar link)
 * always go through immediately.
 */
export function useCalendarSync(options: {
  /** Only sync when the operator actually has a linked calendar. */
  enabled: boolean;
  /** Re-fetch the caller's own data once the sync has landed. */
  onSynced: () => void | Promise<void>;
  /** Announce results with toasts (the page that owns the sync button). */
  announce?: boolean;
  /** Include next month in the sync window. */
  includeNextMonth?: boolean;
  /** Background (mount/interval/refocus) syncing. Manual syncs always work. */
  auto?: boolean;
  /** Persist the last successful sync time locally under this key. */
  cacheKey?: string | null;
}) {
  const {
    enabled,
    announce = false,
    includeNextMonth = false,
    auto: autoEnabled = true,
    cacheKey = null,
  } = options;
  const syncFn = useServerFn(syncGoogleCalendar);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(() => {
    if (!cacheKey) return null;
    const cached = readCache<number>(cacheKey);
    return cached ? new Date(cached) : null;
  });
  const [logs, setLogs] = useState<MatchLog[]>([]);

  // Kept in refs so the auto-sync interval never restarts on every render.
  const onSyncedRef = useRef(options.onSynced);
  onSyncedRef.current = options.onSynced;
  const nextMonthRef = useRef(includeNextMonth);
  nextMonthRef.current = includeNextMonth;
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;

  const runSync = useCallback(
    async (opts?: { silent?: boolean; force?: boolean }) => {
      if (!enabled) return;
      const silent = opts?.silent ?? !announce;
      // Any explicit call (button click, saving a new link) is real user
      // intent and should never be silently dropped by the cooldown — only
      // the mount/interval/refocus triggers pass force:false.
      const force = opts?.force ?? true;
      setSyncing(true);
      try {
        const { result: res, skipped } = await coordinatedSync(syncFn, {
          includeNextMonth: nextMonthRef.current,
          force,
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
