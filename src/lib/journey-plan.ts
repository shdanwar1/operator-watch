/**
 * Pure journey shaping for the "Time to Leave" card.
 *
 * One engine, one shape: the server turns provider journeys (BVG / MOTIS)
 * into these structures and the dashboard only renders them.
 *
 *   bestOverall  — fastest door-to-door route, transfers allowed
 *   direct[]     — fastest direct routes (exactly one transit service),
 *                  ranked by complete door-to-door time (walking included)
 */

export type RawLine = { name?: string; product?: string; mode?: string };
export type RawStop = { name?: string };
export type RawLeg = {
  departure?: string;
  plannedDeparture?: string;
  arrival?: string;
  plannedArrival?: string;
  walking?: boolean;
  line?: RawLine;
  direction?: string;
  origin?: RawStop;
  destination?: RawStop;
};
export type RawJourney = { legs?: RawLeg[] };

export type JourneyLeg =
  | { kind: "walk"; minutes: number; to_label?: string }
  | { kind: "transfer"; minutes: number; at: string }
  | {
      kind: "transit";
      line: string;
      mode: string;
      direction: string;
      from_stop: string;
      to_stop: string;
      departure_iso: string;
      arrival_iso: string;
      minutes: number;
    };

export type JourneyPlan = {
  legs: JourneyLeg[];
  leave_iso: string;
  arrive_iso: string;
  total_minutes: number;
  transfers: number;
  /** true when the plan uses exactly one transit service. */
  direct: boolean;
};

export type DirectPlan = {
  line: string;
  mode: string;
  direction: string;
  from_stop: string;
  to_stop: string;
  walk_to_minutes: number;
  walk_from_minutes: number;
  ride_minutes: number;
  departure_iso: string;
  arrival_iso: string;
  leave_iso: string;
  arrive_iso: string;
  total_minutes: number;
};

function mins(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const ms = Date.parse(b) - Date.parse(a);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 60_000)) : 0;
}

const dep = (l: RawLeg) => l.departure ?? l.plannedDeparture;
const arr = (l: RawLeg) => l.arrival ?? l.plannedArrival;

/** Normalises a provider journey into a door-to-door plan. */
export function toJourneyPlan(j: RawJourney): JourneyPlan | null {
  const raw = (j.legs ?? []).filter(Boolean);
  if (raw.length === 0) return null;
  const leave = dep(raw[0]);
  const arrive = arr(raw[raw.length - 1]);
  if (!leave || !arrive) return null;

  const transitCount = raw.filter((l) => !l.walking && l.line?.name).length;
  if (transitCount === 0) return null;

  const legs: JourneyLeg[] = [];
  let lastTransitEnd: string | undefined;
  let lastTransitStop = "";

  for (const l of raw) {
    const d = dep(l);
    const a = arr(l);
    if (!d || !a) continue;
    if (l.walking || !l.line?.name) {
      const m = mins(d, a);
      const label = l.destination?.name;
      const named = label && label !== "END" && label !== "START" ? label : undefined;
      if (m > 0) legs.push({ kind: "walk", minutes: m, to_label: named });
      continue;
    }
    if (lastTransitEnd) {
      const wait = mins(lastTransitEnd, d);
      const alreadyWalked = legs[legs.length - 1]?.kind === "walk";
      if (!alreadyWalked && wait > 0) {
        legs.push({ kind: "transfer", minutes: wait, at: lastTransitStop });
      }
    }
    legs.push({
      kind: "transit",
      line: l.line.name,
      mode: l.line.product ?? l.line.mode ?? "transit",
      direction: l.direction ?? l.destination?.name ?? "",
      from_stop: l.origin?.name ?? "",
      to_stop: l.destination?.name ?? "",
      departure_iso: d,
      arrival_iso: a,
      minutes: mins(d, a),
    });
    lastTransitEnd = a;
    lastTransitStop = l.destination?.name ?? "";
  }

  const total = mins(leave, arrive);
  if (total <= 0) return null;

  return {
    legs,
    leave_iso: leave,
    arrive_iso: arrive,
    total_minutes: total,
    transfers: Math.max(0, transitCount - 1),
    direct: transitCount === 1,
  };
}

/** A direct plan: exactly one transit service, walking either side. */
export function toDirectPlan(j: RawJourney): DirectPlan | null {
  const plan = toJourneyPlan(j);
  if (!plan || !plan.direct) return null;
  const ride = plan.legs.find((l) => l.kind === "transit");
  if (!ride || ride.kind !== "transit") return null;
  return {
    line: ride.line,
    mode: ride.mode,
    direction: ride.direction,
    from_stop: ride.from_stop,
    to_stop: ride.to_stop,
    walk_to_minutes: mins(plan.leave_iso, ride.departure_iso),
    walk_from_minutes: mins(ride.arrival_iso, plan.arrive_iso),
    ride_minutes: ride.minutes,
    departure_iso: ride.departure_iso,
    arrival_iso: ride.arrival_iso,
    leave_iso: plan.leave_iso,
    arrive_iso: plan.arrive_iso,
    total_minutes: plan.total_minutes,
  };
}

/**
 * Fastest door-to-door plan that still arrives by `targetArrival`
 * (falling back to the fastest plan overall when none qualifies).
 */
export function pickBestPlan(journeys: RawJourney[], targetArrival: Date): JourneyPlan | null {
  const plans = journeys
    .map(toJourneyPlan)
    .filter((p): p is JourneyPlan => p !== null);
  if (plans.length === 0) return null;
  const limit = targetArrival.getTime() + 60_000;
  const inTime = plans.filter((p) => Date.parse(p.arrive_iso) <= limit);
  const pool = inTime.length > 0 ? inTime : plans;
  return [...pool].sort(
    (a, b) =>
      a.total_minutes - b.total_minutes ||
      Date.parse(b.leave_iso) - Date.parse(a.leave_iso),
  )[0];
}

/**
 * Up to two direct options, ranked by complete door-to-door time (walking to
 * the first stop and from the last stop to the studio included) — never by
 * raw vehicle time and never by transport type.
 */
export function pickDirectPlans(
  journeys: RawJourney[],
  targetArrival: Date,
  max = 2,
): DirectPlan[] {
  const limit = targetArrival.getTime() + 60_000;
  const all = journeys
    .map(toDirectPlan)
    .filter((p): p is DirectPlan => p !== null)
    .filter((p) => Date.parse(p.arrive_iso) <= limit);

  const byLine = new Map<string, DirectPlan>();
  for (const p of all) {
    const key = `${p.mode}:${p.line}`;
    const prev = byLine.get(key);
    if (!prev || p.total_minutes < prev.total_minutes) byLine.set(key, p);
  }
  return Array.from(byLine.values())
    .sort((a, b) => a.total_minutes - b.total_minutes)
    .slice(0, max);
}

export function modeLabel(mode: string): string {
  switch (mode) {
    case "bus":
      return "Bus";
    case "tram":
      return "Tram";
    case "subway":
      return "U-Bahn";
    case "suburban":
      return "S-Bahn";
    case "regional":
      return "Regional";
    case "express":
      return "Express";
    case "ferry":
      return "Ferry";
    default:
      return "Transit";
  }
}

/**
 * Backward scheduling.
 *
 * Departure is derived from the shift, not from "now": every option is shifted
 * so it arrives as late as possible inside the 0–5 minute window before the
 * shift starts (aiming for exactly 5 minutes early). Leg durations never
 * change — the whole timeline just slides.
 *
 * If the resulting departure is already in the past the plan is instead
 * anchored to `now`, so the card never shows a departure that has passed and
 * the (possibly late) arrival is shown honestly.
 */
export const SHIFT_ARRIVAL_BUFFER_MIN = 5;

function shiftIso(iso: string, deltaMs: number): string {
  return new Date(Date.parse(iso) + deltaMs).toISOString();
}

/** Offset (ms) that lands the plan's arrival in the target window. */
function offsetFor(arriveIso: string, leaveIso: string, targetArrival: Date, now: Date): number {
  let delta = targetArrival.getTime() - Date.parse(arriveIso);
  const leaveAt = Date.parse(leaveIso) + delta;
  if (leaveAt < now.getTime()) delta += now.getTime() - leaveAt;
  return delta;
}

export function rescheduleJourneyPlan(
  plan: JourneyPlan,
  targetArrival: Date,
  now: Date = new Date(),
): JourneyPlan {
  const delta = offsetFor(plan.arrive_iso, plan.leave_iso, targetArrival, now);
  if (delta === 0) return plan;
  return {
    ...plan,
    legs: plan.legs.map((l) =>
      l.kind === "transit"
        ? {
            ...l,
            departure_iso: shiftIso(l.departure_iso, delta),
            arrival_iso: shiftIso(l.arrival_iso, delta),
          }
        : l,
    ),
    leave_iso: shiftIso(plan.leave_iso, delta),
    arrive_iso: shiftIso(plan.arrive_iso, delta),
  };
}

export function rescheduleDirectPlan(
  plan: DirectPlan,
  targetArrival: Date,
  now: Date = new Date(),
): DirectPlan {
  const delta = offsetFor(plan.arrive_iso, plan.leave_iso, targetArrival, now);
  if (delta === 0) return plan;
  return {
    ...plan,
    departure_iso: shiftIso(plan.departure_iso, delta),
    arrival_iso: shiftIso(plan.arrival_iso, delta),
    leave_iso: shiftIso(plan.leave_iso, delta),
    arrive_iso: shiftIso(plan.arrive_iso, delta),
  };
}
