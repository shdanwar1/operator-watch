import { readAppSettings } from "./settings.functions";
import {
  ARRIVAL_ATTEMPT_OFFSETS_MIN,
  LEAVE_CACHE_TTL_MS,
  commuteRouteKey,
  latestValidJourney,
  leaveFromDuration,
  requiredArrival,
} from "./time-to-leave";

export type LeaveResult =
  | {
      ok: true;
      shift_start_iso: string;
      leave_iso: string;
      travel_minutes: number;
      source: "live" | "cached" | "fallback";
    }
  | { ok: false; reason: "no_home" | "no_operator" | "unavailable" };

type Coords = { lat: number; lng: number };
export type JourneyFetcher = (home: Coords, studio: Coords, arrival: Date) => Promise<unknown>;

const VBB_URL = "https://v6.bvg.transport.rest/journeys";

/** One VBB journeys request. Throws on HTTP/network errors. */
export const fetchVbbJourneys: JourneyFetcher = async (home, studio, arrival) => {
  const url = new URL(VBB_URL);
  url.searchParams.set("from.latitude", String(home.lat));
  url.searchParams.set("from.longitude", String(home.lng));
  // VBB rejects coordinate locations without an address label (HTTP 500).
  url.searchParams.set("from.address", "Home");
  url.searchParams.set("to.latitude", String(studio.lat));
  url.searchParams.set("to.longitude", String(studio.lng));
  url.searchParams.set("to.address", "Studio");
  url.searchParams.set("arrival", arrival.toISOString());
  url.searchParams.set("results", "4");
  url.searchParams.set("stopovers", "false");
  url.searchParams.set("remarks", "false");
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "studio-operator/1.0" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`VBB ${res.status}`);
  return res.json();
};

/** Live lookup: at most three requests, stops at the first valid journey. */
export async function liveCommute(
  home: Coords,
  studio: Coords,
  shiftStart: Date,
  fetcher: JourneyFetcher = fetchVbbJourneys,
) {
  const required = requiredArrival(shiftStart).getTime();
  for (const offset of ARRIVAL_ATTEMPT_OFFSETS_MIN) {
    try {
      const body = await fetcher(home, studio, new Date(required + offset * 60_000));
      const estimate = latestValidJourney(body, required);
      if (estimate) return estimate;
    } catch {
      // try the next adjusted time
    }
  }
  return null;
}

type OperatorRow = {
  id: string;
  home_lat: number | null;
  home_lng: number | null;
  commute_minutes: number | null;
  commute_route_key: string | null;
  commute_calculated_at: string | null;
  leave_shift_start: string | null;
  leave_at: string | null;
};

/**
 * The single authoritative Time to Leave for an operator's next shift.
 * Used by the Dashboard and by the leave-home notification.
 */
export async function resolveTimeToLeave(
  where: { operatorId: string } | { username: string },
  shiftStart: Date,
  opts: { fetcher?: JourneyFetcher; now?: number } = {},
): Promise<LeaveResult> {
  const now = opts.now ?? Date.now();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let q = supabaseAdmin
    .from("operators")
    .select(
      "id, home_lat, home_lng, commute_minutes, commute_route_key, commute_calculated_at, leave_shift_start, leave_at",
    );
  q = "operatorId" in where ? q.eq("id", where.operatorId) : q.ilike("username", where.username);
  const { data, error } = await q.maybeSingle();
  if (error) return { ok: false, reason: "unavailable" };
  const op = data as OperatorRow | null;
  if (!op) return { ok: false, reason: "no_operator" };
  if (op.home_lat == null || op.home_lng == null) return { ok: false, reason: "no_home" };

  const settings = await readAppSettings();
  const home = { lat: op.home_lat, lng: op.home_lng };
  const studio = { lat: settings.studio.lat, lng: settings.studio.lng };
  const routeKey = commuteRouteKey(home, studio);
  const shiftIso = shiftStart.toISOString();

  // Fresh cached result for this exact shift and route.
  if (
    op.leave_at &&
    op.leave_shift_start &&
    new Date(op.leave_shift_start).getTime() === shiftStart.getTime() &&
    op.commute_route_key === routeKey &&
    op.commute_calculated_at &&
    now - Date.parse(op.commute_calculated_at) < LEAVE_CACHE_TTL_MS &&
    op.commute_minutes != null
  ) {
    return {
      ok: true,
      shift_start_iso: shiftIso,
      leave_iso: new Date(op.leave_at).toISOString(),
      travel_minutes: op.commute_minutes,
      source: "cached",
    };
  }

  const live = await liveCommute(home, studio, shiftStart, opts.fetcher);
  if (live) {
    await supabaseAdmin
      .from("operators")
      .update({
        commute_minutes: live.travelMinutes,
        commute_route_key: routeKey,
        commute_calculated_at: new Date(now).toISOString(),
        leave_shift_start: shiftIso,
        leave_at: live.departureIso,
      } as never)
      .eq("id", op.id);
    return {
      ok: true,
      shift_start_iso: shiftIso,
      leave_iso: live.departureIso,
      travel_minutes: live.travelMinutes,
      source: "live",
    };
  }

  // Fallback: last successful duration for the same home→studio pair.
  if (op.commute_minutes != null && op.commute_route_key === routeKey) {
    const leave = leaveFromDuration(shiftStart, op.commute_minutes);
    // Keep the notification aligned with what the Dashboard shows, but do not
    // refresh commute_calculated_at so the next read retries VBB.
    await supabaseAdmin
      .from("operators")
      .update({ leave_shift_start: shiftIso, leave_at: leave.toISOString() } as never)
      .eq("id", op.id);
    return {
      ok: true,
      shift_start_iso: shiftIso,
      leave_iso: leave.toISOString(),
      travel_minutes: op.commute_minutes,
      source: "fallback",
    };
  }
  return { ok: false, reason: "unavailable" };
}
