import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

// Office (fixed for every operator).
export const OFFICE = {
  label: "Kaiserin-Augusta-Allee 10, 10553 Berlin",
  lat: 52.5263162,
  lng: 13.3229399,
} as const;

// Always arrive this many minutes before the shift starts.
export const ARRIVAL_BUFFER_MIN = 15;

type GateSession = { unlocked?: boolean; username?: string; isAdmin?: boolean };

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

export type TimeToLeaveResult =
  | {
      ok: true;
      home_label: string;
      office_label: string;
      shift_start_iso: string;
      target_arrival_iso: string;
      departure_iso: string;
      arrival_iso: string;
      travel_minutes: number;
      transfers: number;
    }
  | { ok: false; reason: "no_home" | "no_session" | "no_route"; home_label?: string };

type BvgLeg = {
  departure?: string;
  plannedDeparture?: string;
  arrival?: string;
  plannedArrival?: string;
  walking?: boolean;
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
    if (!session.data.unlocked || !session.data.username) {
      return { ok: false, reason: "no_session" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: op, error } = await supabaseAdmin
      .from("operators")
      .select("home_label, home_lat, home_lng")
      .eq("username", session.data.username)
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
    url.searchParams.set("to.latitude", String(OFFICE.lat));
    url.searchParams.set("to.longitude", String(OFFICE.lng));
    url.searchParams.set("to.address", OFFICE.label);
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

    return {
      ok: true,
      home_label: op.home_label ?? "Home",
      office_label: OFFICE.label,
      shift_start_iso: shiftStart.toISOString(),
      target_arrival_iso: targetArrival.toISOString(),
      departure_iso: pick.dep,
      arrival_iso: pick.arr,
      travel_minutes: travelMinutes,
      transfers: pick.transfers,
    };
  });
