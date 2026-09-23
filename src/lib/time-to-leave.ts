/** Operators aim to arrive this many minutes before the shift starts. */
export const ARRIVAL_BUFFER_MIN = 5;
/** Leave-home push fires this many minutes before Time to Leave. */
export const LEAVE_NOTIFY_LEAD_MIN = 15;
/** Arrival offsets (minutes) queried in order; later ones only on failure. */
export const ARRIVAL_ATTEMPT_OFFSETS_MIN = [0, -5, 5] as const;

type JourneyTime = {
  departure?: string | null;
  plannedDeparture?: string | null;
  arrival?: string | null;
  plannedArrival?: string | null;
};

type Journey = { legs?: JourneyTime[] };

export type TimeToLeaveEstimate = {
  departureIso: string;
  arrivalIso: string;
  travelMinutes: number;
};

export function requiredArrival(shiftStart: Date): Date {
  return new Date(shiftStart.getTime() - ARRIVAL_BUFFER_MIN * 60_000);
}

/**
 * Pick the latest journey that still reaches the studio by `requiredArrivalMs`.
 *
 * The origin is the operator's home coordinates, so VBB's first leg is the
 * walk from home (origin type "location"). Its departure is therefore the
 * moment the operator leaves home — walking/access time is already included.
 * Only times are kept; legs, lines and stations are discarded.
 */
export function latestValidJourney(
  value: unknown,
  requiredArrivalMs: number,
): TimeToLeaveEstimate | null {
  const journeys = (value as { journeys?: Journey[] } | null)?.journeys;
  if (!Array.isArray(journeys)) return null;

  let best: (TimeToLeaveEstimate & { depMs: number }) | null = null;
  for (const journey of journeys) {
    const legs = Array.isArray(journey?.legs) ? journey.legs : [];
    const first = legs[0];
    const last = legs[legs.length - 1];
    const departureIso = first?.departure ?? first?.plannedDeparture;
    const arrivalIso = last?.arrival ?? last?.plannedArrival;
    if (!departureIso || !arrivalIso) continue;
    const depMs = Date.parse(departureIso);
    const arrMs = Date.parse(arrivalIso);
    if (!Number.isFinite(depMs) || !Number.isFinite(arrMs) || arrMs <= depMs) continue;
    if (arrMs > requiredArrivalMs) continue;
    if (!best || depMs > best.depMs) {
      best = {
        depMs,
        departureIso: new Date(depMs).toISOString(),
        arrivalIso: new Date(arrMs).toISOString(),
        travelMinutes: Math.max(1, Math.round((arrMs - depMs) / 60_000)),
      };
    }
  }
  if (!best) return null;
  const { depMs: _ignored, ...estimate } = best;
  return estimate;
}

/** Fallback: leave = required arrival − last known commute duration. */
export function leaveFromDuration(shiftStart: Date, minutes: number): Date {
  return new Date(requiredArrival(shiftStart).getTime() - minutes * 60_000);
}

/** Identifies a home→studio pair so a moved home/studio invalidates the cache. */
export function commuteRouteKey(
  home: { lat: number; lng: number },
  studio: { lat: number; lng: number },
): string {
  const f = (n: number) => n.toFixed(5);
  return `${f(home.lat)},${f(home.lng)}>${f(studio.lat)},${f(studio.lng)}`;
}

/** When the leave-home push should fire, or null if it should not be sent. */
export function leaveNotificationAt(leaveAt: Date, now: number): Date | null {
  // Never send a stale reminder: once the leave time itself has passed, skip.
  if (leaveAt.getTime() <= now) return null;
  return new Date(leaveAt.getTime() - LEAVE_NOTIFY_LEAD_MIN * 60_000);
}
