import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { syncGoogleCalendar } from "@/lib/gcal.functions";
import type { MatchLog } from "@/lib/gcal-match";
import { publishSync, subscribeSync, type SyncMessage } from "@/lib/sync-bus";

const AUTO_SYNC_MS = 5 * 60 * 1000;

/**
 * Shared Google Calendar synchronization.
 *
 * Manual, automatic and first-import syncs all run through here, so every
 * trigger produces the same pipeline: import → refresh the caller's data →
 * broadcast so every other open view refreshes too.
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
}) {
  const { enabled, announce = false, includeNextMonth = false } = options;
  const syncFn = useServerFn(syncGoogleCalendar);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [logs, setLogs] = useState<MatchLog[]>([]);

  // Kept in refs so the auto-sync interval never restarts on every render.
  const onSyncedRef = useRef(options.onSynced);
  onSyncedRef.current = options.onSynced;
  const nextMonthRef = useRef(includeNextMonth);
  nextMonthRef.current = includeNextMonth;

  const runSync = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!enabled) return;
      const silent = opts?.silent ?? !announce;
      setSyncing(true);
      try {
        const res = await syncFn({ data: { includeNextMonth: nextMonthRef.current } });
        setLastSync(new Date());
        setLogs(res.logs ?? []);
        if (!res.ok) {
          if (!silent) toast.error(res.error ?? "Sync failed");
          return res;
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

  // Automatic sync: on mount and every 5 minutes, identical to a manual run.
  useEffect(() => {
    if (!enabled) return;
    runSync({ silent: true });
    const t = setInterval(() => runSync({ silent: true }), AUTO_SYNC_MS);
    return () => clearInterval(t);
  }, [enabled, runSync]);

  return { syncing, lastSync, logs, setLogs, runSync };
}

/** Refreshes the caller whenever any view reports a completed sync. */
export function useSyncListener(handler: (message: SyncMessage) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribeSync((m) => ref.current(m)), []);
}
