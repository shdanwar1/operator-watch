import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { validateCalendarUrl } from "./validation";
import { resolveGoogleMapsUrl } from "./maps-link.server";


type GateSession = { siteUnlocked?: boolean; username?: string; isAdmin?: boolean };

function getSessionConfig() {
  const password = process.env.SESSION_SECRET;
  if (!password) throw new Error("SESSION_SECRET is not set");
  return {
    password,
    name: "site-gate",
    maxAge: 60 * 60 * 24 * 30,
    cookie: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" },
  };
}

async function requireSignedIn() {
  const session = await useSession<GateSession>(getSessionConfig());
  const username = session.data.username;
  if (!session.data.siteUnlocked || !username) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return { username, isAdmin: Boolean(session.data.isAdmin) };
}

export type ProfileMissing = "home" | "calendar";

export type MyProfileStatus = {
  id: string;
  username: string;
  is_admin: boolean;
  home_label: string | null;
  home_lat: number | null;
  home_lng: number | null;
  calendar_ics_url: string | null;
  missing: ProfileMissing[];
  complete: boolean;
};

function computeMissing(row: {
  home_lat: number | null;
  home_lng: number | null;
  calendar_ics_url: string | null;
}): ProfileMissing[] {
  const missing: ProfileMissing[] = [];
  if (row.home_lat == null || row.home_lng == null) missing.push("home");
  // Google Calendar is retired: shifts come from the live timetable.
  return missing;
}

export const getMyProfileStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<MyProfileStatus> => {
    const { username } = await requireSignedIn();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("operators")
      .select("id, username, is_admin, home_label, home_lat, home_lng, calendar_ics_url")
      .ilike("username", username)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Operator not found");
    const publicRow = data as {
      id: string;
      username: string;
      is_admin: boolean;
      home_label: string | null;
      home_lat: number | null;
      home_lng: number | null;
      calendar_ics_url: string | null;
    };
    const missing = computeMissing(publicRow);
    return { ...publicRow, missing, complete: missing.length === 0 };
  },
);

export const completeMyProfile = createServerFn({ method: "POST" })
  .inputValidator((data: { maps_url?: string; calendar_ics_url?: string }) => ({
    maps_url: data?.maps_url ? String(data.maps_url).trim() : undefined,
    calendar_ics_url: data?.calendar_ics_url
      ? String(data.calendar_ics_url).trim()
      : undefined,
  }))
  .handler(async ({ data }) => {
    const { username } = await requireSignedIn();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { resolveByUsername } = await import("@/domain/operator-resolver.server");
    const op = await resolveByUsername(username);
    if (!op) throw new Error("Operator not found");
    const id = op.id;

    const patch: {
      home_label?: string;
      home_lat?: number;
      home_lng?: number;
      calendar_ics_url?: string;
    } = {};

    if (data.maps_url) {
      const { label, lat, lng } = await resolveGoogleMapsUrl(data.maps_url);
      patch.home_label = label;
      patch.home_lat = lat;
      patch.home_lng = lng;
    }
    if (data.calendar_ics_url) {
      patch.calendar_ics_url = validateCalendarUrl(data.calendar_ics_url);
    }

    let updated = 0;
    if (Object.keys(patch).length > 0) {
      const { error: e1 } = await supabaseAdmin.from("operators").update(patch).eq("id", id);
      if (e1) throw new Error(e1.message);
      updated += Object.keys(patch).length;
    }

    return { ok: true as const, updated };
  });
