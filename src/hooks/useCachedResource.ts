import { useCallback, useEffect, useRef, useState } from "react";
import { readCache, writeCache } from "@/lib/local-cache";

/**
 * The one data-loading shape every page in this app should use.
 *
 * The rule: a page should never blank itself out to show a loading state
 * just because a background refresh is happening. It should show the last
 * good data it has — from a route loader, from local cache, or from the
 * previous successful fetch — right up until a *complete* new result is
 * ready, and then swap the whole thing in at once. A loading state is only
 * appropriate when there is genuinely nothing to show yet at all.
 */
export function useCachedResource<T>(options: {
  /** Null skips caching entirely (e.g. the operator's username isn't known
   *  yet) — the hook still fetches and holds state, it just won't persist. */
  cacheKey: string | null;
  fetcher: () => Promise<T>;
  fallback: T;
  /** Data already available from a route loader — takes priority over the
   *  cache on the very first render, since it's guaranteed fresher. */
  serverInitial?: T;
  /** Background refresh cadence. Omit for fetch-once-and-on-demand only. */
  refreshIntervalMs?: number;
  /** Pause the interval (e.g. while the browser tab is hidden). */
  paused?: boolean;
}) {
  const { cacheKey, fetcher, fallback, serverInitial, refreshIntervalMs, paused = false } = options;

  const [data, setData] = useState<T>(() => {
    if (serverInitial !== undefined) return serverInitial;
    if (cacheKey) {
      const cached = readCache<T>(cacheKey);
      if (cached !== null) return cached;
    }
    return fallback;
  });
  const hasAnyData =
    serverInitial !== undefined || (cacheKey ? readCache<T>(cacheKey) !== null : false);
  const [loading, setLoading] = useState(!hasAnyData);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Kept in a ref so the interval effect doesn't need to restart every time
  // the caller passes a new (but equivalent) fetcher closure.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    // Captured up front: if the resource's identity changes mid-fetch, the
    // result still gets written to the key it was actually fetched for.
    const keyForThisFetch = cacheKeyRef.current;
    try {
      const next = await fetcherRef.current();
      if (keyForThisFetch) writeCache(keyForThisFetch, next);
      if (cacheKeyRef.current === keyForThisFetch) {
        setData(next);
        setError(null);
      }
    } catch (e) {
      // Deliberately don't touch `data` — whatever was on screen stays.
      setError(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // The resource's *identity* can change under the same mounted component.
  const prevKeyRef = useRef(cacheKey);
  useEffect(() => {
    if (prevKeyRef.current === cacheKey) return;
    prevKeyRef.current = cacheKey;
    const cached = cacheKey ? readCache<T>(cacheKey) : null;
    setData(cached ?? fallback);
    setLoading(cached === null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  useEffect(() => {
    refresh();
    if (!refreshIntervalMs || paused) return;
    const id = setInterval(refresh, refreshIntervalMs);
    return () => clearInterval(id);
  }, [refresh, refreshIntervalMs, paused, cacheKey]);

  return { data, setData, loading, refreshing, error, refresh };
}
