/**
 * Journey provider for Berlin public transport.
 *
 * The app used to talk to `v6.bvg.transport.rest` directly. That community
 * instance goes offline from time to time (connection refused), which is what
 * made the dashboard show "Route information is currently unavailable".
 *
 * This module tries that instance first and transparently falls back to the
 * Transitous / MOTIS open routing service, normalising both into one shape.
 */

export type ProviderLine = { name?: string; product?: string; mode?: string };
export type ProviderStop = { name?: string };
export type ProviderLeg = {
  departure?: string;
  plannedDeparture?: string;
  arrival?: string;
  plannedArrival?: string;
  walking?: boolean;
  line?: ProviderLine;
  direction?: string;
  origin?: ProviderStop;
  destination?: ProviderStop;
};
export type ProviderJourney = { legs: ProviderLeg[] };

export type JourneyPoint = { lat: number; lng: number; label: string };
export type JourneyAnchor = { kind: "departure" | "arrival"; iso: string };

const BVG_API = "https://v6.bvg.transport.rest/journeys";
const MOTIS_API = "https://api.transitous.org/api/v1/plan";
const TIMEOUT_MS = 9_000;

async function fetchBvg(
  from: JourneyPoint,
  to: JourneyPoint,
  anchor: JourneyAnchor,
  results: number,
  directOnly: boolean,
): Promise<ProviderJourney[]> {
  const url = new URL(BVG_API);
  url.searchParams.set("from.latitude", String(from.lat));
  url.searchParams.set("from.longitude", String(from.lng));
  url.searchParams.set("from.address", from.label);
  url.searchParams.set("to.latitude", String(to.lat));
  url.searchParams.set("to.longitude", String(to.lng));
  url.searchParams.set("to.address", to.label);
  url.searchParams.set(anchor.kind, anchor.iso);
  url.searchParams.set("results", String(results));
  if (directOnly) url.searchParams.set("transfers", "0");
  url.searchParams.set("stopovers", "false");
  url.searchParams.set("remarks", "false");

  const res = await fetch(url.toString(), {
    headers: { accept: "application/json", "user-agent": "studio-operator/1.0" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { journeys?: ProviderJourney[] };
  return Array.isArray(body.journeys) ? body.journeys.filter((j) => Array.isArray(j.legs)) : [];
}

/** MOTIS mode → the product vocabulary the rest of the app already uses. */
const MOTIS_MODE: Record<string, string> = {
  METRO: "subway",
  SUBWAY: "subway",
  TRAM: "tram",
  BUS: "bus",
  COACH: "bus",
  RAIL: "regional",
  REGIONAL_RAIL: "regional",
  REGIONAL_FAST_RAIL: "regional",
  LONG_DISTANCE: "express",
  HIGHSPEED_RAIL: "express",
  NIGHT_RAIL: "regional",
  SUBURBAN: "suburban",
  FERRY: "ferry",
};

type MotisLeg = {
  mode?: string;
  startTime?: string;
  endTime?: string;
  routeShortName?: string;
  headsign?: string;
  from?: { name?: string };
  to?: { name?: string };
};
type MotisItinerary = { legs?: MotisLeg[] };

async function fetchMotis(
  from: JourneyPoint,
  to: JourneyPoint,
  anchor: JourneyAnchor,
  results: number,
): Promise<ProviderJourney[]> {
  const url = new URL(MOTIS_API);
  url.searchParams.set("fromPlace", `${from.lat},${from.lng}`);
  url.searchParams.set("toPlace", `${to.lat},${to.lng}`);
  url.searchParams.set("time", anchor.iso);
  if (anchor.kind === "arrival") url.searchParams.set("arriveBy", "true");
  url.searchParams.set("numItineraries", String(Math.min(results, 10)));

  const res = await fetch(url.toString(), {
    headers: { accept: "application/json", "user-agent": "studio-operator/1.0" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { itineraries?: MotisItinerary[] };
  const its = Array.isArray(body.itineraries) ? body.itineraries : [];

  return its
    .map((it) => {
      const legs: ProviderLeg[] = (it.legs ?? []).map((l) => {
        const walking = (l.mode ?? "").toUpperCase() === "WALK";
        const product = MOTIS_MODE[(l.mode ?? "").toUpperCase()] ?? "transit";
        return {
          departure: l.startTime,
          plannedDeparture: l.startTime,
          arrival: l.endTime,
          plannedArrival: l.endTime,
          walking,
          line: walking
            ? undefined
            : { name: l.routeShortName ?? product.toUpperCase(), product, mode: product },
          direction: l.headsign ?? "",
          origin: { name: l.from?.name ?? "" },
          destination: { name: l.to?.name ?? "" },
        };
      });
      return { legs };
    })
    .filter((j) => j.legs.length > 0);
}

/**
 * Returns journeys in the BVG-ish shape the rest of the app parses.
 * Never throws: an unreachable provider yields an empty list so callers can
 * keep using their cached data.
 */
export async function fetchProviderJourneys(
  from: JourneyPoint,
  to: JourneyPoint,
  anchor: JourneyAnchor,
  results: number,
  options?: { directOnly?: boolean },
): Promise<ProviderJourney[]> {
  try {
    const bvg = await fetchBvg(from, to, anchor, results, !!options?.directOnly);
    if (bvg.length > 0) return bvg;
  } catch {
    // Instance down / timed out — fall through to the open routing service.
  }
  try {
    return await fetchMotis(from, to, anchor, results);
  } catch {
    return [];
  }
}
