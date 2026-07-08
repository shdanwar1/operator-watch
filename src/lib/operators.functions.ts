import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

type GateSession = { unlocked?: boolean; username?: string };

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

export type OperatorProfile = {
  id: string;
  username: string;
  mobile: string | null;
  is_admin: boolean;
};

const USERNAME_RE = /^[a-zA-Z0-9_.-]{2,32}$/;

function requireNonEmpty(v: unknown, field: string, max = 200): string {
  if (typeof v !== "string") throw new Error(`${field} is required`);
  const t = v.trim();
  if (!t) throw new Error(`${field} is required`);
  if (t.length > max) throw new Error(`${field} is too long`);
  return t;
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
      const mobile = requireNonEmpty(data?.mobile, "Mobile number", 40);
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
      .select("id, username, mobile, is_admin")
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
      if (data.mobile !== undefined) {
        out.mobile = String(data.mobile).trim().slice(0, 40);
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
    const { normalizeShiftRow } = await import("./shifts.functions");
    return (shifts ?? []).map((r) => normalizeShiftRow(r as Record<string, unknown>));
  });

