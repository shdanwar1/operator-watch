import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

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

async function requireGate() {
  const session = await useSession<GateSession>(getGateConfig());
  if (!session.data.unlocked) {
    throw new Response("Unauthorized", { status: 401 });
  }
}

async function requireAdminSession() {
  const session = await useSession<GateSession>(getGateConfig());
  if (!session.data.unlocked || !session.data.isAdmin) {
    throw new Response("Admin access required", { status: 403 });
  }
}


export type OperatorProfile = {
  id: string;
  username: string;
  mobile: string | null;
  is_admin: boolean;
  home_label: string | null;
  home_lat: number | null;
  home_lng: number | null;
};

const USERNAME_RE = /^[a-zA-Z0-9_.-]{2,32}$/;

function requireNonEmpty(v: unknown, field: string, max = 200): string {
  if (typeof v !== "string") throw new Error(`${field} is required`);
  const t = v.trim();
  if (!t) throw new Error(`${field} is required`);
  if (t.length > max) throw new Error(`${field} is too long`);
  return t;
}

/** Normalize a German mobile input to E.164 (+49XXXXXXXXXXX). */
function normalizeDeMobile(v: unknown): string {
  if (typeof v !== "string") throw new Error("Mobile number is required");
  const digits = v.replace(/\D+/g, "");
  // Strip country prefixes if present
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
  return `+49${local}`;
}

export const signupOperator = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { username: string; password: string; mobile: string; magic_word: string }) => {
      const username = requireNonEmpty(data?.username, "Username", 32).toLowerCase();
      if (!USERNAME_RE.test(username)) {
        throw new Error("Username must be 2–32 chars: letters, numbers, . _ -");
      }
      const password = requireNonEmpty(data?.password, "Password", 200);
      if (password.length < 4) throw new Error("Password must be at least 4 characters");
      const mobile = normalizeDeMobile(data?.mobile);
      const magic_word = requireNonEmpty(data?.magic_word, "Magic word", 100);
      return { username, password, mobile, magic_word };
    },
  )

  .handler(async ({ data }) => {
    // Signup is intentionally accessible without the site gate so new
    // operators can register from the unlock page.

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("operators")
      .select("id")
      .eq("username", data.username)
      .maybeSingle();
    if (existing) throw new Error("Username is already taken");
    const { data: newId, error } = await supabaseAdmin.rpc("create_operator", {
      p_username: data.username,
      p_password: data.password,
      p_mobile: data.mobile,
      p_magic: data.magic_word,
    });
    if (error) throw new Error(error.message);
    return { id: newId as string, username: data.username };
  });

export const verifyOperatorLogin = createServerFn({ method: "POST" })
  .inputValidator((data: { username: string; password: string }) => ({
    username: requireNonEmpty(data?.username, "Username", 32).toLowerCase(),
    password: requireNonEmpty(data?.password, "Password", 200),
  }))
  .handler(async ({ data }) => {
    await requireGate();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: id, error } = await supabaseAdmin.rpc("verify_operator_password", {
      p_username: data.username,
      p_password: data.password,
    });
    if (error) throw new Error(error.message);
    if (!id) throw new Error("Invalid username or password");
    const { data: row, error: err2 } = await supabaseAdmin
      .from("operators")
      .select("id, username, mobile, is_admin, home_label, home_lat, home_lng")
      .eq("id", id as string)
      .single();
    if (err2) throw new Error(err2.message);
    return row as OperatorProfile;
  });

export const updateOperatorProfile = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id: string;
      current_password: string;
      username?: string;
      new_password?: string;
      mobile?: string;
      magic_word?: string;
    }) => {
      if (!data?.id) throw new Error("id required");
      const current_password = requireNonEmpty(data?.current_password, "Current password", 200);
      const out: {
        id: string;
        current_password: string;
        username?: string;
        new_password?: string;
        mobile?: string;
        magic_word?: string;
      } = { id: String(data.id), current_password };
      if (data.username !== undefined && data.username !== "") {
        const u = String(data.username).trim().toLowerCase();
        if (!USERNAME_RE.test(u)) throw new Error("Invalid username");
        out.username = u;
      }
      if (data.new_password !== undefined && data.new_password !== "") {
        if (String(data.new_password).length < 4) throw new Error("Password must be at least 4 characters");
        out.new_password = String(data.new_password);
      }
      if (data.mobile !== undefined && data.mobile !== "") {
        out.mobile = normalizeDeMobile(data.mobile);
      }

      if (data.magic_word !== undefined && data.magic_word !== "") {
        out.magic_word = String(data.magic_word).trim().slice(0, 100);
      }
      return out;
    },
  )
  .handler(async ({ data }) => {
    await requireGate();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Fetch current username to verify password.
    const { data: row, error: err0 } = await supabaseAdmin
      .from("operators")
      .select("username")
      .eq("id", data.id)
      .single();
    if (err0 || !row) throw new Error("Operator not found");

    const { data: verifiedId, error: err1 } = await supabaseAdmin.rpc("verify_operator_password", {
      p_username: (row as { username: string }).username,
      p_password: data.current_password,
    });
    if (err1) throw new Error(err1.message);
    if (!verifiedId) throw new Error("Current password is incorrect");

    // If username is changing, ensure not taken.
    if (data.username && data.username !== (row as { username: string }).username) {
      const { data: dup } = await supabaseAdmin
        .from("operators")
        .select("id")
        .eq("username", data.username)
        .maybeSingle();
      if (dup && (dup as { id: string }).id !== data.id) {
        throw new Error("Username is already taken");
      }
    }

    const { error: err2 } = await supabaseAdmin.rpc("update_operator", {
      p_id: data.id,
      p_username: (data.username ?? null) as string,
      p_password: (data.new_password ?? null) as string,
      p_mobile: (data.mobile ?? null) as string,
      p_magic: (data.magic_word ?? null) as string,
    });
    if (err2) throw new Error(err2.message);
    return { ok: true as const };
  });

// Verify admin credentials and return all shifts. Admin login is passed
// through on every call — no separate admin session cookie.
export const adminListShifts = createServerFn({ method: "POST" })
  .inputValidator((data: { username: string; password: string }) => ({
    username: requireNonEmpty(data?.username, "Username", 32).toLowerCase(),
    password: requireNonEmpty(data?.password, "Password", 200),
  }))
  .handler(async ({ data }) => {
    await requireGate();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: id, error } = await supabaseAdmin.rpc("verify_operator_password", {
      p_username: data.username,
      p_password: data.password,
    });
    if (error) throw new Error(error.message);
    if (!id) throw new Error("Invalid username or password");
    const { data: op } = await supabaseAdmin
      .from("operators")
      .select("is_admin")
      .eq("id", id as string)
      .single();
    if (!op || !(op as { is_admin: boolean }).is_admin) {
      throw new Error("Not an admin");
    }
    const { data: shifts, error: err2 } = await supabaseAdmin
      .from("shifts")
      .select("*")
      .order("check_in_at", { ascending: false });
    if (err2) throw new Error(err2.message);
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

// Session-authenticated variant: returns all shifts when the current gate
// session belongs to an admin operator. Used by the admin page after login.
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

export type OperatorBasic = { id: string; username: string; is_admin: boolean };

export const adminListOperators = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminSession();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("operators")
    .select("id, username, is_admin")
    .order("username");
  if (error) throw new Error(error.message);
  return (data ?? []) as OperatorBasic[];
});

/**
 * Resolve a Google Maps link (short or long) into { label, lat, lng }.
 * Follows redirects on maps.app.goo.gl / goo.gl / g.co so the app never
 * needs an API key.
 */
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
      // fall through — parsing may still work on the original URL
    }
  }
  const parse = (s: string): { lat: number; lng: number } | null => {
    // /@lat,lng,zoom
    const at = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (at) return { lat: parseFloat(at[1]), lng: parseFloat(at[2]) };
    // !3dLAT!4dLNG
    const bang = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (bang) return { lat: parseFloat(bang[1]), lng: parseFloat(bang[2]) };
    // ?q=lat,lng or ?query=lat,lng or ?ll=lat,lng
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
  // Try to extract a readable label from the resolved URL path
  // e.g. /maps/place/Kaiserin-Augusta-Allee+10,+10553+Berlin/@...
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

export const setOperatorHome = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; current_password: string; maps_url: string }) => ({
    id: requireNonEmpty(data?.id, "id"),
    current_password: requireNonEmpty(data?.current_password, "Current password", 200),
    maps_url: requireNonEmpty(data?.maps_url, "Google Maps link", 2000),
  }))
  .handler(async ({ data }) => {
    await requireGate();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error: err0 } = await supabaseAdmin
      .from("operators")
      .select("username")
      .eq("id", data.id)
      .single();
    if (err0 || !row) throw new Error("Operator not found");

    const { data: verifiedId, error: err1 } = await supabaseAdmin.rpc(
      "verify_operator_password",
      {
        p_username: (row as { username: string }).username,
        p_password: data.current_password,
      },
    );
    if (err1) throw new Error(err1.message);
    if (!verifiedId) throw new Error("Current password is incorrect");

    const { label, lat, lng } = await resolveGoogleMapsUrl(data.maps_url);

    const { error: err2 } = await supabaseAdmin.rpc("set_operator_home", {
      p_id: data.id,
      p_label: label,
      p_lat: lat,
      p_lng: lng,
    });
    if (err2) throw new Error(err2.message);
    return { label, lat, lng };
  });



