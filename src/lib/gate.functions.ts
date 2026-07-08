import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

type GateSession = { unlocked?: boolean; username?: string };

function getSessionConfig() {
  const password = process.env.SESSION_SECRET;
  if (!password) throw new Error("SESSION_SECRET is not set");
  return {
    password,
    name: "site-gate",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
    },
  };
}

export const unlockSite = createServerFn({ method: "POST" })
  .inputValidator((data: { username: string; password: string }) => ({
    username: String(data?.username ?? "").trim().toLowerCase(),
    password: String(data?.password ?? ""),
  }))
  .handler(async ({ data }) => {
    if (!data.username || !data.password) {
      return { ok: false as const };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: id, error } = await supabaseAdmin.rpc("verify_operator_password", {
      p_username: data.username,
      p_password: data.password,
    });
    if (error) throw new Error(error.message);
    if (!id) return { ok: false as const };
    const session = await useSession<GateSession>(getSessionConfig());
    await session.update({ unlocked: true, username: data.username });
    return { ok: true as const };
  });


export const lockSite = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useSession<GateSession>(getSessionConfig());
  await session.clear();
  return { ok: true as const };
});

export const getGateStatus = createServerFn({ method: "GET" }).handler(async () => {
  const session = await useSession<GateSession>(getSessionConfig());
  return {
    unlocked: Boolean(session.data.unlocked),
    username: session.data.username ?? null,
  };
});
