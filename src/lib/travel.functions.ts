import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { readAppSettings } from "./settings.functions";

// Office (fixed for every operator).
export const OFFICE = {
  label: "Kaiserin-Augusta-Allee 10, 10553 Berlin",
  lat: 52.5263162,
  lng: 13.3229399,
} as const;

// Aim to arrive this many minutes before the shift starts (0–5 min window).
export const ARRIVAL_BUFFER_MIN = 5;

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

export type { DirectPlan, JourneyPlan, JourneyLeg } from "./journey-plan";

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
      /** Option 1 — fastest door-to-door route, transfers allowed. */
      best: import("./journey-plan").JourneyPlan;
      /** Options 2 and 3 — fastest direct routes, door-to-door ranked. */
      direct_routes: import("./journey-plan").DirectPlan[];
      /** false when the background-notification copy of this plan could not be stored */
      plan_saved: boolean;
    }
  | { ok: false; reason: "no_home" | "no_session" | "no_route"; home_label?: string };

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

    const { fetchProviderJourneys } = await import("./journeys.server");
    const home = {
      lat: Number(op.home_lat),
      lng: Number(op.home_lng),
      label: op.home_label ?? "Home",
    };
    const office_pt = { lat: office.lat, lng: office.lng, label: office.label };
    const target = { kind: "arrival" as const, iso: targetArrival.toISOString() };

    // One engine, two views: every route (transfers allowed) and the direct
    // subset. Providers already search all stops within walking distance of
    // home, so direct discovery is never limited to the nearest stop.
    const [anyJourneys, directJourneys] = await Promise.all([
      fetchProviderJourneys(home, office_pt, target, 8).catch(() => []),
      fetchProviderJourneys(home, office_pt, target, 12, { directOnly: true }).catch(() => []),
    ]);

    const { pickBestPlan, pickDirectPlans, rescheduleJourneyPlan, rescheduleDirectPlan } =
      await import("./journey-plan");
    const pool = [...anyJourneys, ...directJourneys];
    const rawBest = pickBestPlan(pool, targetArrival);
    if (!rawBest) {
      return { ok: false, reason: "no_route", home_label: op.home_label ?? undefined };
    }
    // Departure is scheduled backward from the shift, per option.
    const now = new Date();
    const best = rescheduleJourneyPlan(rawBest, targetArrival, now);
    const directRoutes = pickDirectPlans(pool, targetArrival, 2).map((p) =>
      rescheduleDirectPlan(p, targetArrival, now),
    );

    const pick = {
      dep: best.leave_iso,
      arr: best.arrive_iso,
      transfers: best.transfers,
    };
    const travelMinutes = best.total_minutes;

    // Persist the plan so background push can fire "time to leave" without
    // the app being open. A failure here must never break the dashboard, but
    // it must also never be invisible: the caller gets `plan_saved` and can
    // safely retry (the upsert is idempotent, and a failed write leaves any
    // previously good row untouched).
    let planSaved = false;
    let planError: string | undefined;
    const operatorId = (op as { id?: string }).id;
    // Direct link to the shift, so deleting a shift takes its travel plan with
    // it instead of leaving a plan keyed only by a start instant.
    let shiftId: string | null = null;
    if (operatorId) {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Berlin",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(shiftStart);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      const localDate = `${get("year")}-${get("month")}-${get("day")}`;
      const localTime = `${get("hour")}:${get("minute")}`;
      const { data: match } = await supabaseAdmin
        .from("scheduled_shifts")
        .select("id, start_time")
        .eq("specific_date", localDate)
        .ilike("assigned_operator", session.data.username)
        .limit(20);
      shiftId =
        (match ?? []).find((r) => String(r.start_time).slice(0, 5) === localTime)?.id ?? null;
    }
    if (operatorId) {
      for (let attempt = 0; attempt < 3 && !planSaved; attempt += 1) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 250 * attempt));
        try {
          const { error: planErr } = await supabaseAdmin.from("operator_travel_plans").upsert(
            {
              operator_id: operatorId,
              shift_id: shiftId,
              shift_start_at: shiftStart.toISOString(),
              departure_at: pick.dep,
              arrival_at: pick.arr,
              travel_minutes: travelMinutes,
              transfers: pick.transfers,
              route_label:
                best.legs.find((l) => l.kind === "transit")?.line ?? null,
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
      best,
      direct_routes: directRoutes,
      plan_saved: planSaved,
    };
  });
