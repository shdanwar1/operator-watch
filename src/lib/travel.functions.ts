import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { readAppSettings } from "./settings.functions";

// Office (fixed for every operator).
export const OFFICE = {
  label: "Kaiserin-Augusta-Allee 10, 10553 Berlin",
  lat: 52.5263162,
  lng: 13.3229399,
} as const;

// Always arrive this many minutes before the shift starts.
export const ARRIVAL_BUFFER_MIN = 15;

type GateSession = { siteUnlocked?: boolean; username?: string; isAdmin?: boolean };

function getGateConfig() {
  const password = process.env.SESSION_SECRET;
  if (!password) throw new Error("SESSION_SECRET is not set");
  return {
    password,
    name: "site-gate",
    maxAge: 60 * 60 * 24 * 30,
    cookie: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" },
  };
}

// Approximate walk time from each transit mode's typical stop near the office
// to the office door. Used to pick direct options that let the operator arrive
// on time even after walking from the stop.
const MODE_WALK_MINUTES: Record<string, number> = {
  bus: 7,
  tram: 7,
  ferry: 10,
  subway: 15,
  suburban: 20, // S-Bahn
  regional: 20,
  express: 20,
};

function walkMinutesFor(mode: string): number {
  return MODE_WALK_MINUTES[mode] ?? 15;
}

export type DirectOption = {
  line: string;
  mode: string;
  from_stop: string;
  to_stop: string;
  departure_iso: string;
  arrival_iso: string;
  duration_minutes: number;
  walk_minutes: number;
};

export type TimeToLeaveResult =
  | {
      ok: true;
      home_label: string;
      home_lat: number;
      home_lng: number;
      office_label: string;
      office_lat: number;
      office_lng: number;
      shift_start_iso: string;
      target_arrival_iso: string;
      departure_iso: string;
      arrival_iso: string;
      travel_minutes: number;
      transfers: number;
      direct_options: DirectOption[];
      /** false when the background-notification copy of this plan could not be stored */
      plan_saved: boolean;
    }
  | { ok: false; reason: "no_home" | "no_session" | "no_route"; home_label?: string };

type BvgLine = { name?: string; product?: string; mode?: string };
type BvgStop = { name?: string };
type BvgLeg = {
  departure?: string;
  plannedDeparture?: string;
  arrival?: string;
  plannedArrival?: string;
  walking?: boolean;
  line?: BvgLine;
  origin?: BvgStop;
  destination?: BvgStop;
};
type BvgJourney = { legs: BvgLeg[] };
type BvgResponse = { journeys?: BvgJourney[] };

export const getTimeToLeave = createServerFn({ method: "POST" })
  .inputValidator((data: { shift_start_iso: string }) => {
    const iso = String(data?.shift_start_iso ?? "");
    if (!iso || Number.isNaN(Date.parse(iso))) {
      throw new Error("shift_start_iso must be an ISO datetime string");
    }
    return { shift_start_iso: iso };
  })
  .handler(async ({ data }): Promise<TimeToLeaveResult> => {
    const session = await useSession<GateSession>(getGateConfig());
    if (!session.data.siteUnlocked || !session.data.username) {
      return { ok: false, reason: "no_session" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Studio location is an admin-managed, system-wide setting.
    const settings = await readAppSettings();
    const office = { label: settings.studio.label, lat: settings.studio.lat, lng: settings.studio.lng };
    const { data: op, error } = await supabaseAdmin
      .from("operators")
      .select("id, home_label, home_lat, home_lng")
      .ilike("username", session.data.username)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!op || op.home_lat == null || op.home_lng == null) {
      return { ok: false, reason: "no_home" };
    }

    const shiftStart = new Date(data.shift_start_iso);
    const targetArrival = new Date(shiftStart.getTime() - ARRIVAL_BUFFER_MIN * 60_000);

    const url = new URL("https://v6.bvg.transport.rest/journeys");
    url.searchParams.set("from.latitude", String(op.home_lat));
    url.searchParams.set("from.longitude", String(op.home_lng));
    url.searchParams.set("from.address", op.home_label ?? "Home");
    url.searchParams.set("to.latitude", String(office.lat));
    url.searchParams.set("to.longitude", String(office.lng));
    url.searchParams.set("to.address", office.label);
    url.searchParams.set("arrival", targetArrival.toISOString());
    url.searchParams.set("results", "3");
    url.searchParams.set("stopovers", "false");
    url.searchParams.set("remarks", "false");

    const res = await fetch(url.toString(), {
      headers: { accept: "application/json", "user-agent": "studio-operator/1.0" },
    });
    if (!res.ok) {
      return { ok: false, reason: "no_route", home_label: op.home_label ?? undefined };
    }
    const body = (await res.json()) as BvgResponse;
    const journeys = body.journeys ?? [];
    if (journeys.length === 0) {
      return { ok: false, reason: "no_route", home_label: op.home_label ?? undefined };
    }

    // Pick the journey with the latest departure that still arrives by target.
    const candidates = journeys
      .map((j) => {
        const first = j.legs[0];
        const last = j.legs[j.legs.length - 1];
        const dep = first?.departure ?? first?.plannedDeparture;
        const arr = last?.arrival ?? last?.plannedArrival;
        if (!dep || !arr) return null;
        return {
          dep,
          arr,
          transfers: Math.max(0, j.legs.filter((l) => !l.walking).length - 1),
        };
      })
      .filter((c): c is { dep: string; arr: string; transfers: number } => c !== null)
      .filter((c) => new Date(c.arr).getTime() <= targetArrival.getTime() + 60_000)
      .sort((a, b) => new Date(b.dep).getTime() - new Date(a.dep).getTime());

    const pick = candidates[0] ?? (() => {
      // Fallback: fastest journey overall (first result from API).
      const j = journeys[0];
      const first = j.legs[0];
      const last = j.legs[j.legs.length - 1];
      const dep = first?.departure ?? first?.plannedDeparture ?? "";
      const arr = last?.arrival ?? last?.plannedArrival ?? "";
      return { dep, arr, transfers: Math.max(0, j.legs.filter((l) => !l.walking).length - 1) };
    })();

    if (!pick.dep || !pick.arr) {
      return { ok: false, reason: "no_route", home_label: op.home_label ?? undefined };
    }

    const travelMinutes = Math.max(
      1,
      Math.round((new Date(pick.arr).getTime() - new Date(pick.dep).getTime()) / 60_000),
    );

    // Fetch direct (0-transfer) options that arrive at the stop early enough
    // to walk to the office door before the shift starts. Per mode we keep
    // the single option whose arrival is closest to (but not after) the
    // shift-start minus that mode's walk buffer.
    const directOptions: DirectOption[] = [];
    try {
      const directUrl = new URL("https://v6.bvg.transport.rest/journeys");
      directUrl.searchParams.set("from.latitude", String(op.home_lat));
      directUrl.searchParams.set("from.longitude", String(op.home_lng));
      directUrl.searchParams.set("from.address", op.home_label ?? "Home");
      directUrl.searchParams.set("to.latitude", String(office.lat));
      directUrl.searchParams.set("to.longitude", String(office.lng));
      directUrl.searchParams.set("to.address", office.label);
      // Anchor at the shift start (not the 15-min buffer) so per-mode walk
      // times can be applied precisely below.
      directUrl.searchParams.set("arrival", shiftStart.toISOString());
      directUrl.searchParams.set("results", "12");
      directUrl.searchParams.set("transfers", "0");
      directUrl.searchParams.set("stopovers", "false");
      directUrl.searchParams.set("remarks", "false");
      const dres = await fetch(directUrl.toString(), {
        headers: { accept: "application/json", "user-agent": "studio-operator/1.0" },
      });
      if (dres.ok) {
        const dbody = (await dres.json()) as BvgResponse;
        const bestByMode = new Map<string, DirectOption>();
        for (const j of dbody.journeys ?? []) {
          const transit = j.legs.filter((l) => !l.walking && l.line?.name);
          if (transit.length !== 1) continue;
          const leg = transit[0];
          const line = leg.line?.name ?? "";
          if (!line) continue;
          const dep = leg.departure ?? leg.plannedDeparture;
          const arr = leg.arrival ?? leg.plannedArrival;
          if (!dep || !arr) continue;
          const mode = leg.line?.product ?? leg.line?.mode ?? "transit";
          const walk = walkMinutesFor(mode);
          const cutoff = shiftStart.getTime() - walk * 60_000;
          const arrMs = new Date(arr).getTime();
          if (arrMs > cutoff) continue;
          const candidate: DirectOption = {
            line,
            mode,
            from_stop: leg.origin?.name ?? "",
            to_stop: leg.destination?.name ?? "",
            departure_iso: dep,
            arrival_iso: arr,
            duration_minutes: Math.max(
              1,
              Math.round((arrMs - new Date(dep).getTime()) / 60_000),
            ),
            walk_minutes: walk,
          };
          // Keep the latest-arriving valid option per mode (closest to shift).
          const prev = bestByMode.get(mode);
          if (!prev || new Date(prev.arrival_iso).getTime() < arrMs) {
            bestByMode.set(mode, candidate);
          }
        }
        directOptions.push(
          ...Array.from(bestByMode.values()).sort(
            (a, b) => new Date(b.arrival_iso).getTime() - new Date(a.arrival_iso).getTime(),
          ),
        );
      }
    } catch {
      // Non-fatal; the primary plan is still returned.
    }


    // Persist the plan so background push can fire "time to leave" without
    // the app being open. A failure here must never break the dashboard, but
    // it must also never be invisible: the caller gets `plan_saved` and can
    // safely retry (the upsert is idempotent, and a failed write leaves any
    // previously good row untouched).
    let planSaved = false;
    let planError: string | undefined;
    const operatorId = (op as { id?: string }).id;
    if (operatorId) {
      for (let attempt = 0; attempt < 3 && !planSaved; attempt += 1) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 250 * attempt));
        try {
          const { error: planErr } = await supabaseAdmin.from("operator_travel_plans").upsert(
            {
              operator_id: operatorId,
              shift_start_at: shiftStart.toISOString(),
              departure_at: pick.dep,
              arrival_at: pick.arr,
              travel_minutes: travelMinutes,
              transfers: pick.transfers,
              route_label: directOptions[0]?.line ?? null,
              calculated_at: new Date().toISOString(),
            } as never,
            { onConflict: "operator_id,shift_start_at,algorithm_version" },
          );
          if (planErr) planError = planErr.message;
          else planSaved = true;
        } catch (err) {
          planError = err instanceof Error ? err.message : "travel plan write failed";
        }
      }
      if (!planSaved) {
        console.error("[travel] server travel plan not persisted", { planError });
      }
    }


    return {
      ok: true,
      home_label: op.home_label ?? "Home",
      home_lat: Number(op.home_lat),
      home_lng: Number(op.home_lng),
      office_label: office.label,
      office_lat: office.lat,
      office_lng: office.lng,
      shift_start_iso: shiftStart.toISOString(),
      target_arrival_iso: targetArrival.toISOString(),
      departure_iso: pick.dep,
      arrival_iso: pick.arr,
      travel_minutes: travelMinutes,
      transfers: pick.transfers,
      direct_options: directOptions,
      plan_saved: planSaved,
    };
  });

// ---------- Route geometry (server-side; keeps routing API key off the client) ----------

const COORD = (n: unknown) => {
  const v = Number(n);
  if (!Number.isFinite(v)) throw new Error("Invalid coordinate");
  return v;
};

async function orsGeometry(
  home: { lat: number; lng: number },
  office: { lat: number; lng: number },
): Promise<[number, number][] | null> {
  const key = process.env["ORS_API_KEY"];
  if (!key) return null;
  const res = await fetch("https://api.openrouteservice.org/v2/directions/driving-car/geojson", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: key },
    body: JSON.stringify({
      coordinates: [
        [home.lng, home.lat],
        [office.lng, office.lat],
      ],
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    features?: { geometry?: { coordinates?: [number, number][] } }[];
  };
  const line = json.features?.[0]?.geometry?.coordinates;
  if (!line?.length) return null;
  return line.map(([lng, lat]) => [lat, lng] as [number, number]);
}

async function osrmGeometry(
  home: { lat: number; lng: number },
  office: { lat: number; lng: number },
): Promise<[number, number][] | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${home.lng},${home.lat};${office.lng},${office.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    routes?: { geometry?: { coordinates?: [number, number][] } }[];
  };
  const line = json.routes?.[0]?.geometry?.coordinates;
  if (!line?.length) return null;
  return line.map(([lng, lat]) => [lat, lng] as [number, number]);
}

export const getRouteGeometry = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { from_lat: number; from_lng: number; to_lat: number; to_lng: number }) => ({
      from_lat: COORD(data?.from_lat),
      from_lng: COORD(data?.from_lng),
      to_lat: COORD(data?.to_lat),
      to_lng: COORD(data?.to_lng),
    }),
  )
  .handler(async ({ data }): Promise<{ coords: [number, number][] | null }> => {
    const session = await useSession<GateSession>(getGateConfig());
    if (!session.data.siteUnlocked || !session.data.username) {
      return { coords: null };
    }
    const from = { lat: data.from_lat, lng: data.from_lng };
    const to = { lat: data.to_lat, lng: data.to_lng };
    let coords: [number, number][] | null = null;
    try {
      coords = await orsGeometry(from, to);
    } catch {
      coords = null;
    }
    if (!coords) {
      try {
        coords = await osrmGeometry(from, to);
      } catch {
        coords = null;
      }
    }
    return { coords };
  });

