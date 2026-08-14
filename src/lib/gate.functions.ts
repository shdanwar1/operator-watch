import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

/**
 * Two-stage gate:
 *  - siteUnlocked: shared site password entered ("Unlock Studio")
 *  - username/isAdmin: an operator has authenticated with their PIN
 *
 * `unlocked` in the returned status means BOTH stages are complete
 * (kept for backwards compatibility with existing route guards).
 */
type GateSession = {
  siteUnlocked?: boolean;
  username?: string;
  isAdmin?: boolean;
};

/**
 * The shared site password is stored as a one-way hash in the database
 * (app_settings → site_password) and verified with a security-definer
 * function. It is never held in application code or sent to the browser.
 */
async function checkSitePassword(password: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("verify_site_password", { p_pw: password });
  if (error) throw new Error(error.message);
  return data === true;
}

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

/** Stage 1 — enter the shared site password. */
export const unlockSite = createServerFn({ method: "POST" })
  .inputValidator((data: { password: string }) => ({
    password: String(data?.password ?? ""),
  }))
  .handler(async ({ data }) => {
    if (!(await checkSitePassword(data.password))) {
      return { ok: false as const };
    }
    const session = await useSession<GateSession>(getSessionConfig());
    await session.update({ siteUnlocked: true });
    return { ok: true as const };
  });

/** Admin only — replace the shared site password. */
export const adminChangeSitePassword = createServerFn({ method: "POST" })
  .inputValidator((data: { current: string; next: string; confirm: string }) => ({
    current: String(data?.current ?? ""),
    next: String(data?.next ?? ""),
    confirm: String(data?.confirm ?? ""),
  }))
  .handler(async ({ data }) => {
    const session = await useSession<GateSession>(getSessionConfig());
    if (!session.data.siteUnlocked || !session.data.username || !session.data.isAdmin) {
      throw new Response("Admin access required", { status: 403 });
    }
    if (data.next !== data.confirm) throw new Error("New passwords do not match");
    if (data.next.trim().length < 6) throw new Error("New password must be at least 6 characters");
    if (!(await checkSitePassword(data.current))) throw new Error("Current site password is incorrect");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("set_site_password", { p_pw: data.next.trim() });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });


/** Stage 2 — profiles shown on the user-selection screen. */
export const listOperatorProfiles = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ id: string; username: string; is_admin: boolean }[]> => {
    const session = await useSession<GateSession>(getSessionConfig());
    if (!session.data.siteUnlocked) {
      throw new Response("Site locked", { status: 401 });
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("list_operators_for_selection");
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; username: string; is_admin: boolean }[];
  },
);

/** Stage 3 — verify the selected operator's PIN. */
export const signInWithPin = createServerFn({ method: "POST" })
  .inputValidator((data: { username: string; pin: string }) => ({
    username: String(data?.username ?? "").trim(),
    pin: String(data?.pin ?? "").trim(),
  }))
  .handler(async ({ data }) => {
    const session = await useSession<GateSession>(getSessionConfig());
    if (!session.data.siteUnlocked) {
      return { ok: false as const, reason: "site_locked" as const };
    }
    if (!data.username || !/^\d{3,10}$/.test(data.pin)) {
      return { ok: false as const, reason: "invalid" as const };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: id, error } = await supabaseAdmin.rpc("verify_operator_pin", {
      p_username: data.username,
      p_pin: data.pin,
    });
    if (error) throw new Error(error.message);
    if (!id) return { ok: false as const, reason: "invalid" as const };
    const { data: row } = await supabaseAdmin
      .from("operators")
      .select("username, is_admin")
      .eq("id", id as string)
      .maybeSingle();
    const canonical = (row?.username as string | undefined) ?? data.username;
    const isAdmin = Boolean(row?.is_admin);
    await session.update({
      siteUnlocked: true,
      username: canonical,
      isAdmin,
    });
    return { ok: true as const, isAdmin };
  });

/** Sign out the current operator but keep the site unlocked (returns to user select). */
export const signOutUser = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useSession<GateSession>(getSessionConfig());
  await session.update({
    siteUnlocked: session.data.siteUnlocked ?? false,
    username: undefined,
    isAdmin: false,
  });
  return { ok: true as const };
});

/** Lock the entire site (returns to the shared-password screen). */
export const lockSite = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useSession<GateSession>(getSessionConfig());
  await session.clear();
  return { ok: true as const };
});

export const getGateStatus = createServerFn({ method: "GET" }).handler(async () => {
  const session = await useSession<GateSession>(getSessionConfig());
  const siteUnlocked = Boolean(session.data.siteUnlocked);
  let username = session.data.username ?? null;
  let isAdmin = Boolean(session.data.isAdmin);

  // If the signed-in operator has been deactivated, drop them from the session
  // so protected routes redirect back to the user-select screen immediately.
  if (username && !isAdmin) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("operators")
      .select("is_active")
      .ilike("username", username)
      .maybeSingle();
    if (!row || (row as { is_active: boolean }).is_active === false) {
      await session.update({ siteUnlocked, username: undefined, isAdmin: false });
      username = null;
      isAdmin = false;
    }
  }

  return {
    siteUnlocked,
    unlocked: siteUnlocked && Boolean(username),
    username,
    isAdmin,
  };
});
