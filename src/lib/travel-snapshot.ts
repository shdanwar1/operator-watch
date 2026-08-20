/**
 * Persistent travel plans for the "Time to Leave" card.
 *
 * The rule this file exists to enforce:
 *
 *   Fetch the route once. Store the successful travel plan. Calculate the
 *   clock locally.
 *
 * A snapshot holds everything needed to reconstruct the card (times, route
 * details, direct options) without touching the transit API again — so reloads, rerenders, focus changes and clock ticks
 * are all free. A failed route request is *never* persisted and never
 * replaces a valid snapshot.
 */

import { readCache, writeCache, operatorNamespace } from "@/lib/local-cache";
import type { TimeToLeaveResult } from "@/lib/travel.functions";
import type { DirectPlan, JourneyPlan } from "@/lib/journey-plan";

/** Bump to invalidate every stored plan (algorithm / shape changes). */
export const TRAVEL_SNAPSHOT_VERSION = 4;

export type TimeToLeaveSnapshot = {
  version: number;

  operator: string;

  shift_start_iso: string;
  shift_end_iso: string;

  home_label: string;
  home_lat: number;
  home_lng: number;

  office_label: string;
  office_lat: number;
  office_lng: number;

  target_arrival_iso: string;

  departure_iso: string;
  arrival_iso: string;

  travel_minutes: number;
  transfers: number;

  /** Option 1 — fastest overall route. */
  best: JourneyPlan;
  /** Options 2 and 3 — fastest direct alternatives. */
  direct_routes: DirectPlan[];

  calculated_at: string;
};

const BASE = `time-to-leave:v${TRAVEL_SNAPSHOT_VERSION}`;

function coordFp(lat: number | null | undefined, lng: number | null | undefined) {
  if (lat == null || lng == null) return "none";
  return `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
}

/**
 * Identity of a travel plan: anything that would change the resulting route.
 * Two different identities are two different cache entries, so an old plan
 * can never survive a change of shift, home location, or algorithm version.
 */
export type TravelPlanIdentity = {
  username: string;
  shiftStartIso: string;
  shiftEndIso: string;
  homeLat: number | null;
  homeLng: number | null;
  /** Destination: an admin can move the studio, which invalidates every plan. */
  studioLat: number | null;
  studioLng: number | null;
};

export function travelPlanKey(id: TravelPlanIdentity): string {
  const fingerprint = [
    id.shiftEndIso,
    coordFp(id.homeLat, id.homeLng),
    coordFp(id.studioLat, id.studioLng),
    `v${TRAVEL_SNAPSHOT_VERSION}`,
  ].join("|");
  return `${operatorNamespace(id.username)}${BASE}:${id.shiftStartIso}:${fingerprint}`;
}

export function readSnapshot(key: string | null): TimeToLeaveSnapshot | null {
  if (!key) return null;
  const snap = readCache<TimeToLeaveSnapshot>(key);
  if (!snap || snap.version !== TRAVEL_SNAPSHOT_VERSION) return null;
  if (!snap.departure_iso || !snap.arrival_iso) return null;
  return snap;
}

/** Persists a *successful* plan only. Failures never reach this function. */
export function writeSnapshot(key: string, snap: TimeToLeaveSnapshot): void {
  writeCache(key, snap);
}

export function snapshotFromResult(
  result: Extract<TimeToLeaveResult, { ok: true }>,
  meta: { operator: string; shiftEndIso: string },
): TimeToLeaveSnapshot {
  return {
    version: TRAVEL_SNAPSHOT_VERSION,
    operator: meta.operator,
    shift_start_iso: result.shift_start_iso,
    shift_end_iso: meta.shiftEndIso,
    home_label: result.home_label,
    home_lat: result.home_lat,
    home_lng: result.home_lng,
    office_label: result.office_label,
    office_lat: result.office_lat,
    office_lng: result.office_lng,
    target_arrival_iso: result.target_arrival_iso,
    departure_iso: result.departure_iso,
    arrival_iso: result.arrival_iso,
    travel_minutes: result.travel_minutes,
    transfers: result.transfers,
    best: result.best,
    direct_routes: result.direct_routes,
    calculated_at: new Date().toISOString(),
  };
}
