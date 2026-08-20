/**
 * Smart public-transport route intelligence for the "Time to Leave" card.
 *
 * The rule this file exists to enforce:
 *
 *   The dashboard reads routes from a *local* cache. The BVG/VBB API is only
 *   contacted by a background refresh (once a day, or when the operator's
 *   home / the studio / the shift day changes). A failed refresh never
 *   deletes or replaces a good cache — the card keeps working offline.
 *
 * Only *direct* options (a single transit service, walking either side) are
 * kept, ranked by real door-to-door time, and at most the two fastest ones
 * are stored/shown.
 */

import { readCache, writeCache, operatorNamespace } from "@/lib/local-cache";

/** Bump to invalidate every stored route set. */
export const SMART_ROUTES_VERSION = 1;

/** A single door-to-door run of one direct route. */
export type SmartDeparture = {
  /** When the operator must leave home (start of the first walking leg). */
  leave_iso: string;
  /** When the vehicle departs the boarding stop. */
  departure_iso: string;
  /** When the vehicle reaches the alighting stop. */
  stop_arrival_iso: string;
  /** When the operator reaches the studio door. */
  arrival_iso: string;
  /** Door-to-door minutes, walking included. */
  total_minutes: number;
};

export type SmartRoute = {
  id: string;
  mode: string;
  line: string;
  direction: string;
  from_stop: string;
  to_stop: string;
  walk_to_minutes: number;
  walk_from_minutes: number;
  ride_minutes: number;
  /** Typical (fastest observed) door-to-door minutes — the ranking value. */
  total_minutes: number;
  departures: SmartDeparture[];
};

export type SmartRouteSet = {
  version: number;
  operator: string;
  home_label: string;
  office_label: string;
  /** Berlin day the departures were fetched for (YYYY-MM-DD). */
  anchor_day: string;
  fetched_at: string;
  /** 0, 1 or 2 direct routes, fastest first. */
  routes: SmartRoute[];
};

export type SmartRoutesResult =
  | { ok: true; set: Omit<SmartRouteSet, "version" | "operator"> }
  | { ok: false; reason: "no_session" | "no_home" | "api_unavailable" | "no_direct" };

/** How long a cached route set stays fresh before a background refresh. */
export const SMART_ROUTES_TTL_MS = 12 * 60 * 60 * 1000;

export function berlinDayOf(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
}

export type SmartRoutesIdentity = {
  username: string;
  homeLat: number | null;
  homeLng: number | null;
  studioLat: number | null;
  studioLng: number | null;
};

function coordFp(lat: number | null | undefined, lng: number | null | undefined) {
  if (lat == null || lng == null) return "none";
  return `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
}

/**
 * Cache key. Home and studio coordinates are part of it, so moving either one
 * automatically invalidates the previous route set instead of showing routes
 * from the old location pair.
 */
export function smartRoutesKey(id: SmartRoutesIdentity): string {
  return `${operatorNamespace(id.username)}smart-routes:v${SMART_ROUTES_VERSION}:${coordFp(
    id.homeLat,
    id.homeLng,
  )}|${coordFp(id.studioLat, id.studioLng)}`;
}

export function readSmartRoutes(key: string | null): SmartRouteSet | null {
  if (!key) return null;
  const set = readCache<SmartRouteSet>(key);
  if (!set || set.version !== SMART_ROUTES_VERSION) return null;
  if (!Array.isArray(set.routes)) return null;
  return set;
}

export function writeSmartRoutes(key: string, set: SmartRouteSet): void {
  writeCache(key, set);
}

/** True when a background refresh should be attempted (never blocks the UI). */
export function shouldRefreshSmartRoutes(
  set: SmartRouteSet | null,
  targetArrival: Date | null,
  now: Date,
): boolean {
  if (!set) return true;
  if (now.getTime() - Date.parse(set.fetched_at) > SMART_ROUTES_TTL_MS) return true;
  if (targetArrival && set.anchor_day !== berlinDayOf(targetArrival)) return true;
  return false;
}

export type SmartPlan = {
  route: SmartRoute;
  /** Leave-home time. */
  leave: Date;
  /** Studio-door arrival. */
  arrival: Date;
  total_minutes: number;
  /** Departure was taken from the cached timetable rather than estimated. */
  from_timetable: boolean;
};

/**
 * Picks the departure to actually take: the latest one that still reaches the
 * studio by `targetArrival`. When the cached timetable holds nothing usable
 * for that moment (e.g. yesterday's data), the route's door-to-door duration
 * is still used to estimate the leave time — the card stays functional.
 */
export function planFromSmartRoutes(
  set: SmartRouteSet | null,
  targetArrival: Date | null,
): SmartPlan | null {
  if (!set || !targetArrival || set.routes.length === 0) return null;
  const limit = targetArrival.getTime() + 60_000;

  let best: SmartPlan | null = null;
  for (const route of set.routes) {
    for (const dep of route.departures) {
      const arr = Date.parse(dep.arrival_iso);
      const leave = Date.parse(dep.leave_iso);
      if (!Number.isFinite(arr) || !Number.isFinite(leave)) continue;
      if (arr > limit) continue;
      if (!best || leave > best.leave.getTime()) {
        best = {
          route,
          leave: new Date(leave),
          arrival: new Date(arr),
          total_minutes: dep.total_minutes,
          from_timetable: true,
        };
      }
    }
  }
  if (best) return best;

  const fastest = set.routes[0];
  return {
    route: fastest,
    leave: new Date(targetArrival.getTime() - fastest.total_minutes * 60_000),
    arrival: targetArrival,
    total_minutes: fastest.total_minutes,
    from_timetable: false,
  };
}

const MODE_LABEL: Record<string, string> = {
  bus: "Bus",
  tram: "Tram",
  subway: "U-Bahn",
  suburban: "S-Bahn",
  regional: "Regional",
  express: "Express",
  ferry: "Ferry",
};

export function modeLabel(mode: string): string {
  return MODE_LABEL[mode] ?? "Transit";
}
