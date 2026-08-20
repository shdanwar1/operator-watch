import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import type { SmartRoutesResult } from "./smart-routes";

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

/**
 * Background refresh of one operator's direct home → studio options.
 * Never throws at the client: a transit-API problem is reported as
 * `api_unavailable` so the dashboard can keep using its cache.
 */
export const getSmartRoutes = createServerFn({ method: "POST" })
  .inputValidator((data: { target_arrival_iso: string }) => {
    const iso = String(data?.target_arrival_iso ?? "");
    if (!iso || Number.isNaN(Date.parse(iso))) {
      throw new Error("target_arrival_iso must be an ISO datetime string");
    }
    return { target_arrival_iso: iso };
  })
  .handler(async ({ data }): Promise<SmartRoutesResult> => {
    const session = await useSession<GateSession>(getGateConfig());
    if (!session.data.siteUnlocked || !session.data.username) {
      return { ok: false, reason: "no_session" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { readAppSettings } = await import("./settings.functions");
    const { fetchDirectRoutes } = await import("./transit.server");
    const { berlinDayOf } = await import("./smart-routes");

    // Routes are strictly per operator: only this session's own home is read.
    const { data: op, error } = await supabaseAdmin
      .from("operators")
      .select("home_label, home_lat, home_lng")
      .ilike("username", session.data.username)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!op || op.home_lat == null || op.home_lng == null) {
      return { ok: false, reason: "no_home" };
    }

    const settings = await readAppSettings();
    const office = {
      lat: settings.studio.lat,
      lng: settings.studio.lng,
      label: settings.studio.label,
    };
    const home = {
      lat: Number(op.home_lat),
      lng: Number(op.home_lng),
      label: op.home_label ?? "Home",
    };
    const targetArrival = new Date(data.target_arrival_iso);

    let routes: Awaited<ReturnType<typeof fetchDirectRoutes>>;
    try {
      routes = await fetchDirectRoutes(home, office, targetArrival);
    } catch {
      return { ok: false, reason: "api_unavailable" };
    }
    if (routes.length === 0) return { ok: false, reason: "no_direct" };

    return {
      ok: true,
      set: {
        home_label: home.label,
        office_label: office.label,
        anchor_day: berlinDayOf(targetArrival),
        fetched_at: new Date().toISOString(),
        routes,
      },
    };
  });
