/**
 * BVG/VBB access for the smart route cache. Server-only: the dashboard never
 * talks to the transit API directly.
 *
 * Everything here is best-effort — a timeout, rate limit, malformed body or
 * empty result is reported as "no fresh data", never thrown at the caller, so
 * the client can keep using its last successful cache.
 */

import type { SmartDeparture, SmartRoute } from "./smart-routes";

const API = "https://v6.bvg.transport.rest/journeys";
const TIMEOUT_MS = 9_000;

type BvgLine = { name?: string; product?: string; mode?: string };
type BvgStop = { name?: string };
type BvgLeg = {
  departure?: string;
  plannedDeparture?: string;
  arrival?: string;
  plannedArrival?: string;
  walking?: boolean;
  line?: BvgLine;
  direction?: string;
  origin?: BvgStop;
  destination?: BvgStop;
};
type BvgJourney = { legs?: BvgLeg[] };
type BvgResponse = { journeys?: BvgJourney[] };

type Point = { lat: number; lng: number; label: string };

function minutesBetween(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const ms = Date.parse(b) - Date.parse(a);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.round(ms / 60_000));
}

async function fetchJourneys(
  home: Point,
  office: Point,
  anchor: { kind: "departure" | "arrival"; iso: string },
  results: number,
): Promise<BvgJourney[]> {
  const url = new URL(API);
  url.searchParams.set("from.latitude", String(home.lat));
  url.searchParams.set("from.longitude", String(home.lng));
  url.searchParams.set("from.address", home.label);
  url.searchParams.set("to.latitude", String(office.lat));
  url.searchParams.set("to.longitude", String(office.lng));
  url.searchParams.set("to.address", office.label);
  url.searchParams.set(anchor.kind, anchor.iso);
  url.searchParams.set("results", String(results));
  url.searchParams.set("transfers", "0");
  url.searchParams.set("stopovers", "false");
  url.searchParams.set("remarks", "false");

  try {
    const res = await fetch(url.toString(), {
      headers: { accept: "application/json", "user-agent": "studio-operator/1.0" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as BvgResponse;
    return Array.isArray(body.journeys) ? body.journeys : [];
  } catch {
    return [];
  }
}

type Candidate = {
  key: string;
  mode: string;
  line: string;
  direction: string;
  from_stop: string;
  to_stop: string;
  walk_to_minutes: number;
  walk_from_minutes: number;
  ride_minutes: number;
  departure: SmartDeparture;
};

/** A journey qualifies only when it uses exactly one transit service. */
function toCandidate(j: BvgJourney): Candidate | null {
  const legs = (j.legs ?? []).filter(Boolean);
  if (legs.length === 0) return null;
  const transit = legs.filter((l) => !l.walking && l.line?.name);
  if (transit.length !== 1) return null;
  const ride = transit[0];

  const first = legs[0];
  const last = legs[legs.length - 1];
  const leave = first.departure ?? first.plannedDeparture;
  const arrive = last.arrival ?? last.plannedArrival;
  const dep = ride.departure ?? ride.plannedDeparture;
  const stopArr = ride.arrival ?? ride.plannedArrival;
  if (!leave || !arrive || !dep || !stopArr) return null;

  const total = minutesBetween(leave, arrive);
  if (total <= 0) return null;

  const line = ride.line?.name ?? "";
  const mode = ride.line?.product ?? ride.line?.mode ?? "transit";
  if (!line) return null;

  return {
    key: `${mode}:${line}`,
    mode,
    line,
    direction: ride.direction ?? ride.destination?.name ?? "",
    from_stop: ride.origin?.name ?? "",
    to_stop: ride.destination?.name ?? "",
    walk_to_minutes: first.walking ? minutesBetween(leave, dep) : 0,
    walk_from_minutes: last.walking ? minutesBetween(stopArr, arrive) : 0,
    ride_minutes: minutesBetween(dep, stopArr),
    departure: {
      leave_iso: leave,
      departure_iso: dep,
      stop_arrival_iso: stopArr,
      arrival_iso: arrive,
      total_minutes: total,
    },
  };
}

/**
 * Collects direct home → studio options around `targetArrival`, ranks them by
 * real door-to-door time and returns at most the two fastest, each with its
 * upcoming departures.
 */
export async function fetchDirectRoutes(
  home: Point,
  office: Point,
  targetArrival: Date,
): Promise<SmartRoute[]> {
  const now = Date.now();
  const windowStart = new Date(Math.max(now, targetArrival.getTime() - 120 * 60_000));

  const [byArrival, byDeparture] = await Promise.all([
    fetchJourneys(home, office, { kind: "arrival", iso: targetArrival.toISOString() }, 12),
    fetchJourneys(home, office, { kind: "departure", iso: windowStart.toISOString() }, 12),
  ]);

  const grouped = new Map<string, Candidate[]>();
  for (const j of [...byArrival, ...byDeparture]) {
    const c = toCandidate(j);
    if (!c) continue;
    const list = grouped.get(c.key) ?? [];
    if (list.some((x) => x.departure.departure_iso === c.departure.departure_iso)) continue;
    list.push(c);
    grouped.set(c.key, list);
  }

  const routes: SmartRoute[] = [];
  for (const [key, list] of grouped) {
    const departures = list
      .map((c) => c.departure)
      .sort((a, b) => Date.parse(a.leave_iso) - Date.parse(b.leave_iso))
      .slice(0, 6);
    if (departures.length === 0) continue;
    const head = list[0];
    const fastest = Math.min(...departures.map((d) => d.total_minutes));
    routes.push({
      id: key,
      mode: head.mode,
      line: head.line,
      direction: head.direction,
      from_stop: head.from_stop,
      to_stop: head.to_stop,
      walk_to_minutes: head.walk_to_minutes,
      walk_from_minutes: head.walk_from_minutes,
      ride_minutes: head.ride_minutes,
      total_minutes: fastest,
      departures,
    });
  }

  // Ranking is purely by measured travel time — never by transport type.
  routes.sort((a, b) => a.total_minutes - b.total_minutes);
  return routes.slice(0, 2);
}
