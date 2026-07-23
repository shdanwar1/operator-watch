import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import {
  validateUsername,
  validatePin,
  validateMagicWord,
  validateMapsUrl,
  sameUsername,
} from "./validation";

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

async function requireGate() {
  const session = await useSession<GateSession>(getGateConfig());
  if (!session.data.siteUnlocked) throw new Response("Unauthorized", { status: 401 });
  return {
    username: session.data.username ?? null,
    isAdmin: !!session.data.isAdmin,
  };
}

async function requireSignedInOperator() {
  const { username, isAdmin } = await requireGate();
  if (!username) throw new Response("Unauthorized", { status: 401 });
  return { username, isAdmin };
}

async function requireAdminSession() {
  const s = await requireGate();
  if (!s.isAdmin) throw new Response("Admin access required", { status: 403 });
  return s;
}

export type OperatorProfile = {
  id: string;
  username: string;
  is_admin: boolean;
  home_label: string | null;
  home_lat: number | null;
  home_lng: number | null;
  calendar_ics_url: string | null;
};

export type OperatorBasic = { id: string; username: string; is_admin: boolean };

// ---------- self-service ----------

/** Returns the canonical (case-preserving) username stored in the DB. */
export const getOperatorDisplayName = createServerFn({ method: "POST" })
  .inputValidator((data: { username: string }) => ({
    username: validateUsername(data?.username),
  }))
  .handler(async ({ data }): Promise<string | null> => {
    await requireGate();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("operators")
      .select("username")
      .ilike("username", data.username)
      .maybeSingle();
    return (row as { username: string } | null)?.username ?? null;
  });

async function findOperatorIdByUsername(username: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("operators")
    .select("id, username")
    .ilike("username", username)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Operator not found");
  return (data as { id: string }).id;
}

async function ensureUsernameAvailable(username: string, excludeId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("operators")
    .select("id, username")
    .ilike("username", username)
    .maybeSingle();
  if (data && (data as { id: string }).id !== excludeId) {
    throw new Error("This username is already in use.");
  }
}

/** Update the currently signed-in operator's own username / PIN / magic word. */
export const updateMyProfile = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { username?: string; pin?: string; magic_word?: string }) => {
      const out: { username?: string; pin?: string; magic_word?: string } = {};
      if (data?.username !== undefined && data.username !== "") {
        out.username = validateUsername(data.username);
      }
      if (data?.pin !== undefined && data.pin !== "") {
        out.pin = validatePin(data.pin);
      }
      if (data?.magic_word !== undefined && data.magic_word !== "") {
        out.magic_word = validateMagicWord(data.magic_word);
      }
      return out;
    },
  )
  .handler(async ({ data }) => {
    const { username } = await requireSignedInOperator();
    const id = await findOperatorIdByUsername(username);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.username && !sameUsername(data.username, username)) {
      await ensureUsernameAvailable(data.username, id);
    }

    const { error } = await supabaseAdmin.rpc("admin_update_operator", {
      p_id: id,
      p_username: (data.username ?? null) as string,
      p_pin: (data.pin ?? null) as string,
      p_magic: (data.magic_word ?? null) as string,
    });
    if (error) throw new Error(error.message);

    // Refresh session username so the header/greeting shows the new value.
    if (data.username) {
      const session = await useSession<GateSession>(getGateConfig());
      await session.update({ ...session.data, username: data.username });
    }
    return { ok: true as const, username: data.username ?? username };
  });

/** Get the signed-in operator's own profile row. */
export const getMyOperatorProfile = createServerFn({ method: "GET" }).handler(
  async (): Promise<OperatorProfile> => {
    const { username } = await requireSignedInOperator();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("operators")
      .select("id, username, is_admin, home_label, home_lat, home_lng, calendar_ics_url")
      .ilike("username", username)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Operator not found");
    return data as OperatorProfile;
  },
);

// ---------- Home address (Google Maps) ----------

async function resolveGoogleMapsUrl(
  input: string,
): Promise<{ label: string; lat: number; lng: number }> {
  const raw = validateMapsUrl(input);
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
      /* keep raw */
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

export const setMyHomeAddress = createServerFn({ method: "POST" })
  .inputValidator((data: { maps_url: string }) => ({
    maps_url: validateMapsUrl(data?.maps_url),
  }))
  .handler(async ({ data }) => {
    const { username } = await requireSignedInOperator();
    const id = await findOperatorIdByUsername(username);
    const { label, lat, lng } = await resolveGoogleMapsUrl(data.maps_url);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("set_operator_home", {
      p_id: id,
      p_label: label,
      p_lat: lat,
      p_lng: lng,
    });
    if (error) throw new Error(error.message);
    return { label, lat, lng };
  });

// ---------- admin listing ----------

export const adminListShiftsForSession = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminSession();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: shifts, error } = await supabaseAdmin
    .from("shifts")
    .select("*")
    .order("check_in_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (shifts ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const classes = Array.isArray(row.classes)
      ? (row.classes as { class?: string; teacher?: string }[]).map((c) => ({
          class: String(c?.class ?? ""),
          teacher: String(c?.teacher ?? ""),
        }))
      : [];
    return {
      id: String(row.id),
      operator_name: String(row.operator_name ?? ""),
      check_in_at: String(row.check_in_at ?? ""),
      check_out_at: (row.check_out_at as string | null) ?? null,
      live_streams_count: Number(row.live_streams_count ?? 0),
      dance_teachers: Array.isArray(row.dance_teachers)
        ? (row.dance_teachers as unknown[]).map(String)
        : [],
      notes: (row.notes as string | null) ?? null,
      scheduled_shift_id: (row.scheduled_shift_id as string | null) ?? null,
      classes,
    };
  });
});

export const adminListOperators = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminSession();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("operators")
    .select("id, username, is_admin")
    .eq("is_admin", false)
    .order("username");
  if (error) throw new Error(error.message);
  return (data ?? []) as OperatorBasic[];
});

/** Admin: update any operator's username / PIN / magic word. */
export const adminUpdateOperator = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { id: string; username?: string; pin?: string; magic_word?: string }) => {
      if (!data?.id) throw new Error("id required");
      const out: { id: string; username?: string; pin?: string; magic_word?: string } = {
        id: String(data.id),
      };
      if (data.username !== undefined && data.username !== "") {
        out.username = validateUsername(data.username);
      }
      if (data.pin !== undefined && data.pin !== "") {
        out.pin = validatePin(data.pin);
      }
      if (data.magic_word !== undefined && data.magic_word !== "") {
        out.magic_word = validateMagicWord(data.magic_word);
      }
      return out;
    },
  )
  .handler(async ({ data }) => {
    await requireAdminSession();
    if (data.username) await ensureUsernameAvailable(data.username, data.id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("admin_update_operator", {
      p_id: data.id,
      p_username: (data.username ?? null) as string,
      p_pin: (data.pin ?? null) as string,
      p_magic: (data.magic_word ?? null) as string,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Admin: create a new operator. Only username + 4-digit PIN. Everything else is
 *  left NULL so the new operator must complete their profile on first login. */
export const adminCreateOperator = createServerFn({ method: "POST" })
  .inputValidator((data: { username: string; pin: string }) => ({
    username: validateUsername(data?.username),
    pin: validatePin(data?.pin),
  }))
  .handler(async ({ data }) => {
    await requireAdminSession();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: id, error } = await supabaseAdmin.rpc("admin_create_operator", {
      p_username: data.username,
      p_pin: data.pin,
    });
    if (error) {
      const msg = error.message || "Failed to create operator";
      if (/already in use|duplicate/i.test(msg)) {
        throw new Error("This username is already in use.");
      }
      throw new Error(msg);
    }
    return { ok: true as const, id: id as string, username: data.username };
  });
