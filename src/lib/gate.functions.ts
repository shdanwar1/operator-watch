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

// Shared site password. Not a secret — printed on the studio wall.
const SITE_PASSWORD = "dancemasterclass";

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
    if (data.password !== SITE_PASSWORD) {
      return { ok: false as const };
    }
    const session = await useSession<GateSession>(getSessionConfig());
    await session.update({ siteUnlocked: true });
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
  const username = session.data.username ?? null;
  const isAdmin = Boolean(session.data.isAdmin);
  return {
    siteUnlocked,
    unlocked: siteUnlocked && Boolean(username), // fully signed in
    username,
    isAdmin,
  };
});
