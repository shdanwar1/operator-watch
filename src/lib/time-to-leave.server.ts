import { readAppSettings } from "./settings.functions";
import {
  ARRIVAL_ATTEMPT_OFFSETS_MIN,
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
      source: "saved" | "live" | "fallback";
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
  username: string;
  home_lat: number | null;
  home_lng: number | null;
  commute_minutes: number | null;
  commute_route_key: string | null;
};

type ShiftRow = {
  id: string;
  time_to_leave: string | null;
};

export type TimeToLeaveStore = {
  loadOperator(where: { operatorId: string } | { username: string }): Promise<OperatorRow | null>;
  findShift(op: OperatorRow, shiftStart: Date): Promise<ShiftRow | null>;
  /** Saves only if the shift still has no value (never overwrites). */
  saveShift(shiftId: string, leaveIso: string, nowIso: string): Promise<string | null>;
  saveCommute(operatorId: string, minutes: number, routeKey: string): Promise<void>;
  studio(): Promise<Coords>;
};

async function supabaseStore(): Promise<TimeToLeaveStore> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { berlinInstant } = await import("./push-time");
  return {
    async loadOperator(where) {
      let q = supabaseAdmin
        .from("operators")
        .select("id, username, home_lat, home_lng, commute_minutes, commute_route_key");
      q =
        "operatorId" in where ? q.eq("id", where.operatorId) : q.ilike("username", where.username);
      const { data, error } = await q.maybeSingle();
      if (error) throw new Error(error.message);
      return data as OperatorRow | null;
    },
    async findShift(op, shiftStart) {
      const day = (offset: number) =>
        new Date(shiftStart.getTime() + offset * 86_400_000).toLocaleDateString("en-CA", {
          timeZone: "Europe/Berlin",
        });
      const { data, error } = await supabaseAdmin
        .from("scheduled_shifts")
        .select("id, specific_date, start_time, status, time_to_leave")
        .ilike("assigned_operator", op.username)
        .in("specific_date", [day(-1), day(0)]);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as (ShiftRow & {
        specific_date: string;
        start_time: string;
        status: string;
      })[];
      const hit = rows.find(
        (r) =>
          r.status !== "cancelled" &&
          berlinInstant(r.specific_date, r.start_time)?.getTime() === shiftStart.getTime(),
      );
      return hit ? { id: hit.id, time_to_leave: hit.time_to_leave } : null;
    },
    async saveShift(shiftId, leaveIso, nowIso) {
      await supabaseAdmin
        .from("scheduled_shifts")
        .update({ time_to_leave: leaveIso, time_to_leave_calculated_at: nowIso } as never)
        .eq("id", shiftId)
        .is("time_to_leave", null);
      // Re-read: a concurrent writer may have saved first; its value wins.
      const { data } = await supabaseAdmin
        .from("scheduled_shifts")
        .select("time_to_leave")
        .eq("id", shiftId)
        .maybeSingle();
      return (data as { time_to_leave: string | null } | null)?.time_to_leave ?? null;
    },
    async saveCommute(operatorId, minutes, routeKey) {
      await supabaseAdmin
        .from("operators")
        .update({ commute_minutes: minutes, commute_route_key: routeKey } as never)
        .eq("id", operatorId);
    },
    async studio() {
      const s = (await readAppSettings()).studio;
      return { lat: s.lat, lng: s.lng };
    },
  };
}

/**
 * The single authoritative Time to Leave for a scheduled shift.
 *
 * scheduled_shifts.time_to_leave is the source of truth: once saved it is
 * returned as-is (no TTL, no travel request). While it is null, a live
 * calculation is attempted and saved on success. Database triggers clear it
 * when the shift, home or studio location changes.
 */
export async function resolveTimeToLeave(
  where: { operatorId: string } | { username: string },
  shiftStart: Date,
  opts: { fetcher?: JourneyFetcher; now?: number; store?: TimeToLeaveStore } = {},
): Promise<LeaveResult> {
  const now = opts.now ?? Date.now();
  const store = opts.store ?? (await supabaseStore());
  const op = await store.loadOperator(where);
  if (!op) return { ok: false, reason: "no_operator" };
  const shiftIso = shiftStart.toISOString();
  const shift = await store.findShift(op, shiftStart);

  if (shift?.time_to_leave) {
    return {
      ok: true,
      shift_start_iso: shiftIso,
      leave_iso: new Date(shift.time_to_leave).toISOString(),
      travel_minutes: Math.round(
        (requiredArrival(shiftStart).getTime() - Date.parse(shift.time_to_leave)) / 60_000,
      ),
      source: "saved",
    };
  }
  if (op.home_lat == null || op.home_lng == null) return { ok: false, reason: "no_home" };

  const home = { lat: op.home_lat, lng: op.home_lng };
  const studio = await store.studio();
  const routeKey = commuteRouteKey(home, studio);

  const live = await liveCommute(home, studio, shiftStart, opts.fetcher);
  if (live) {
    await store.saveCommute(op.id, live.travelMinutes, routeKey);
    const saved = shift
      ? await store.saveShift(shift.id, live.departureIso, new Date(now).toISOString())
      : null;
    const leaveIso = saved ? new Date(saved).toISOString() : live.departureIso;
    return {
      ok: true,
      shift_start_iso: shiftIso,
      leave_iso: leaveIso,
      travel_minutes: live.travelMinutes,
      source: "live",
    };
  }

  // Display-only fallback: last real commute for the same home→studio pair.
  // Never saved, so the shift stays null and the next opportunity retries.
  if (op.commute_minutes != null && op.commute_route_key === routeKey) {
    return {
      ok: true,
      shift_start_iso: shiftIso,
      leave_iso: leaveFromDuration(shiftStart, op.commute_minutes).toISOString(),
      travel_minutes: op.commute_minutes,
      source: "fallback",
    };
  }
  return { ok: false, reason: "unavailable" };
}
