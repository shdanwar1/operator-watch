import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getSmartRoutes } from "@/lib/transit.functions";
import {
  berlinDayOf,
  readSmartRoutes,
  shouldRefreshSmartRoutes,
  smartRoutesKey,
  writeSmartRoutes,
  SMART_ROUTES_VERSION,
  type SmartRouteSet,
  type SmartRoutesIdentity,
} from "@/lib/smart-routes";

export type SmartRoutesState = {
  /** Last successful route set — painted immediately, never blocks on the API. */
  set: SmartRouteSet | null;
  /** A background refresh is in flight (the UI keeps showing cached data). */
  refreshing: boolean;
  /** The most recent refresh failed, so `set` is the last saved timetable. */
  stale: boolean;
  /** No direct option exists for this home → studio pair. */
  noDirect: boolean;
  refresh: () => void;
};

/**
 * Local-first smart routes.
 *
 * Reads the cache synchronously (instant paint) and only contacts the transit
 * API when the cache is missing, older than its TTL, or was fetched for a
 * different day / location pair. A failed refresh leaves the cache intact.
 */
export function useSmartRoutes(
  identity: SmartRoutesIdentity | null,
  targetArrival: Date | null,
): SmartRoutesState {
  const fetchRoutes = useServerFn(getSmartRoutes);
  const key = identity && identity.homeLat != null ? smartRoutesKey(identity) : null;
  const targetIso = targetArrival ? targetArrival.toISOString() : null;

  const [set, setSet] = useState<SmartRouteSet | null>(() => readSmartRoutes(key));
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const [noDirect, setNoDirect] = useState(false);
  const attemptedRef = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const cached = readSmartRoutes(key);
    setSet(cached);
    if (!key || !identity || !targetIso) return;

    const target = new Date(targetIso);
    const guard = `${key}|${berlinDayOf(target)}|${attempt}`;
    if (attemptedRef.current === guard) return;
    if (attempt === 0 && !shouldRefreshSmartRoutes(cached, target, new Date())) return;
    attemptedRef.current = guard;

    let cancelled = false;
    setRefreshing(true);

    (async () => {
      try {
        const res = await fetchRoutes({ data: { target_arrival_iso: targetIso } });
        if (cancelled) return;
        if (res?.ok) {
          const next: SmartRouteSet = {
            version: SMART_ROUTES_VERSION,
            operator: identity.username,
            ...res.set,
          };
          writeSmartRoutes(key, next);
          setSet(next);
          setStale(false);
          setNoDirect(false);
        } else if (res?.reason === "no_direct") {
          // Authoritative "there is no direct option" — drop any stale set.
          writeSmartRoutes(key, {
            version: SMART_ROUTES_VERSION,
            operator: identity.username,
            home_label: "",
            office_label: "",
            anchor_day: berlinDayOf(target),
            fetched_at: new Date().toISOString(),
            routes: [],
          });
          setSet(null);
          setNoDirect(true);
          setStale(false);
        } else {
          // Transient: keep whatever was cached.
          setStale(!!cached);
        }
      } catch {
        if (!cancelled) setStale(!!cached);
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Keyed on identity + target day only: clock ticks never refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, targetIso ? berlinDayOf(new Date(targetIso)) : null, attempt]);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  const routes = set && set.routes.length > 0 ? set : null;
  return { set: routes, refreshing, stale, noDirect: noDirect || (!!set && set.routes.length === 0), refresh };
}
