export const ARRIVAL_BUFFER_MIN = 5;

type JourneyTime = {
  departure?: string;
  plannedDeparture?: string;
  arrival?: string;
  plannedArrival?: string;
};

type Journey = { legs?: JourneyTime[] };

export type TimeToLeaveEstimate = {
  departureIso: string;
  arrivalIso: string;
  travelMinutes: number;
};

/**
 * Reduce a VBB response to the only information the product needs.
 * Journey legs, services, stops and alternatives are intentionally discarded.
 */
export function firstCommuteEstimate(value: unknown): TimeToLeaveEstimate | null {
  const journeys = (value as { journeys?: Journey[] } | null)?.journeys;
  if (!Array.isArray(journeys)) return null;

  for (const journey of journeys) {
    const legs = Array.isArray(journey.legs) ? journey.legs : [];
    const first = legs[0];
    const last = legs[legs.length - 1];
    const departureIso = first?.departure ?? first?.plannedDeparture;
    const arrivalIso = last?.arrival ?? last?.plannedArrival;
    if (!departureIso || !arrivalIso) continue;
    const duration = Date.parse(arrivalIso) - Date.parse(departureIso);
    if (!Number.isFinite(duration) || duration <= 0) continue;
    return {
      departureIso,
      arrivalIso,
      travelMinutes: Math.max(1, Math.round(duration / 60_000)),
    };
  }
  return null;
}
