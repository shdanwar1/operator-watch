import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

type GateSession = {
  siteUnlocked?: boolean;
  username?: string;
  isAdmin?: boolean;
};

function getSessionConfig() {
  const password = process.env.SESSION_SECRET;
  if (!password) throw new Error("SESSION_SECRET is not set");
  return {
    password,
    name: "site-gate",
    maxAge: 60 * 60 * 24 * 30,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
    },
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
  mobile: string | null;
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
  if (!row.calendar_ics_url) missing.push("calendar");
  return missing;
}

/** Session-based lookup of the currently signed-in operator's profile completeness. */
export const getMyProfileStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<MyProfileStatus> => {
    const { username } = await requireSignedIn();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("operators")
      .select("id, username, is_admin, mobile, home_label, home_lat, home_lng, calendar_ics_url")
      .ilike("username", username)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Operator not found");
    const row = data as {
      id: string;
      username: string;
      is_admin: boolean;
      mobile: string | null;
      home_label: string | null;
      home_lat: number | null;
      home_lng: number | null;
      calendar_ics_url: string | null;
    };
    const missing = computeMissing(row);
    return { ...row, missing, complete: missing.length === 0 };
  },
);

/** Same helper used by setOperatorHome — copied here so this fn is standalone. */
async function resolveGoogleMapsUrl(
  input: string,
): Promise<{ label: string; lat: number; lng: number }> {
  const raw = input.trim();
  if (!raw) throw new Error("Paste a Google Maps link");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("That does not look like a valid URL");
  }
  const shortHosts = ["maps.app.goo.gl", "goo.gl", "g.co", "maps.google.com"];
  let finalUrl = u.toString();
  if (shortHosts.includes(u.hostname)) {
    try {
      const res = await fetch(u.toString(), { redirect: "follow" });
      finalUrl = res.url || finalUrl;
    } catch {
      /* fall through */
    }
  }
  const parse = (s: string): { lat: number; lng: number } | null => {
    const bang = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (bang) return { lat: parseFloat(bang[1]), lng: parseFloat(bang[2]) };
    const at = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (at) return { lat: parseFloat(at[1]), lng: parseFloat(at[2]) };
    const q = s.match(/[?&](?:q|query|ll|destination)=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (q) return { lat: parseFloat(q[1]), lng: parseFloat(q[2]) };
    return null;
  };
  const coords = parse(finalUrl) ?? parse(raw);
  if (!coords) {
    throw new Error(
      "Could not read coordinates from that link. Open the place in Google Maps, tap Share, and paste the link.",
    );
  }
  let label = "Home";
  const placeMatch = finalUrl.match(/\/place\/([^/@]+)/);
  if (placeMatch) {
    try {
      label = decodeURIComponent(placeMatch[1]).replace(/\+/g, " ");
    } catch {
      /* keep default */
    }
  }
  return { label, lat: coords.lat, lng: coords.lng };
}

function normalizeCalendarUrl(v: string): string {
  const s = v.trim();
  if (!s) throw new Error("Calendar URL is required");
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) throw new Error("bad protocol");
    return u.toString();
  } catch {
    throw new Error("That does not look like a valid URL");
  }
}

/**
 * Complete-profile save — session/PIN-authenticated. No password required
 * (the operator is already signed in through the site gate + PIN).
 * Any field may be omitted; only provided fields are updated.
 */
export const completeMyProfile = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { maps_url?: string; calendar_ics_url?: string; mobile?: string }) => ({
      maps_url: data?.maps_url ? String(data.maps_url).trim() : undefined,
      calendar_ics_url: data?.calendar_ics_url
        ? String(data.calendar_ics_url).trim()
        : undefined,
      mobile: data?.mobile ? String(data.mobile).trim() : undefined,
    }),
  )
  .handler(async ({ data }) => {
    const { username } = await requireSignedIn();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: op, error: e0 } = await supabaseAdmin
      .from("operators")
      .select("id")
      .ilike("username", username)
      .maybeSingle();
    if (e0 || !op) throw new Error("Operator not found");
    const id = (op as { id: string }).id;

    const patch: {
      home_label?: string;
      home_lat?: number;
      home_lng?: number;
      calendar_ics_url?: string;
      mobile?: string;
    } = {};

    if (data.maps_url) {
      const { label, lat, lng } = await resolveGoogleMapsUrl(data.maps_url);
      patch.home_label = label;
      patch.home_lat = lat;
      patch.home_lng = lng;
    }
    if (data.calendar_ics_url) {
      patch.calendar_ics_url = normalizeCalendarUrl(data.calendar_ics_url);
    }
    if (data.mobile) {
      const digits = data.mobile.replace(/\D+/g, "");
      const local = digits.startsWith("0049")
        ? digits.slice(4)
        : digits.startsWith("49") && digits.length === 13
          ? digits.slice(2)
          : digits.startsWith("0")
            ? digits.slice(1)
            : digits;
      if (!/^\d{11}$/.test(local)) {
        throw new Error("Mobile number must be 11 digits (German +49 number)");
      }
      patch.mobile = `+49${local}`;
    }

    if (Object.keys(patch).length === 0) {
      return { ok: true as const, updated: 0 };
    }

    const { error: e1 } = await supabaseAdmin.from("operators").update(patch).eq("id", id);
    if (e1) throw new Error(e1.message);
    return { ok: true as const, updated: Object.keys(patch).length };
  });
