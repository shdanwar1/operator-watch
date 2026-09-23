import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { readAppSettings } from "./settings.functions";
import { ARRIVAL_BUFFER_MIN, firstCommuteEstimate } from "./time-to-leave";

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

export type TimeToLeaveResult =
  | {
      ok: true;
      shift_start_iso: string;
      departure_iso: string;
      travel_minutes: number;
    }
  | { ok: false; reason: "no_home" | "no_session" | "unavailable" };

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
    const settings = await readAppSettings();
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
    url.searchParams.set("to.latitude", String(settings.studio.lat));
    url.searchParams.set("to.longitude", String(settings.studio.lng));
    url.searchParams.set("arrival", targetArrival.toISOString());
    url.searchParams.set("results", "1");
    url.searchParams.set("stopovers", "false");
    url.searchParams.set("remarks", "false");

    try {
      const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "studio-operator/1.0" },
        signal: AbortSignal.timeout(9_000),
      });
      if (!response.ok) return { ok: false, reason: "unavailable" };
      const estimate = firstCommuteEstimate(await response.json());
      if (!estimate) return { ok: false, reason: "unavailable" };
      return {
        ok: true,
        shift_start_iso: shiftStart.toISOString(),
        departure_iso: estimate.departureIso,
        travel_minutes: estimate.travelMinutes,
      };
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  });
