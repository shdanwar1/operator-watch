import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { autoCheckoutEnabled } from "@/domain/auto-checkout";

type GateSession = { siteUnlocked?: boolean; username?: string; isAdmin?: boolean };

async function requireOperator() {
  const password = process.env.SESSION_SECRET;
  if (!password) throw new Error("SESSION_SECRET is not set");
  const session = await useSession<GateSession>({
    password,
    name: "site-gate",
    maxAge: 60 * 60 * 24 * 30,
    cookie: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" },
  });
  const username = session.data.username;
  if (!session.data.siteUnlocked || !username || session.data.isAdmin) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return username;
}

export const getMyAutoCheckout = createServerFn({ method: "GET" }).handler(async () => {
  const username = await requireOperator();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("operators")
    .select("prefs")
    .ilike("username", username)
    .maybeSingle();
  return { enabled: autoCheckoutEnabled(data?.prefs) };
});

export const setMyAutoCheckout = createServerFn({ method: "POST" })
  .inputValidator((d: { enabled: boolean }) => ({ enabled: Boolean(d?.enabled) }))
  .handler(async ({ data }) => {
    const username = await requireOperator();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("operators")
      .select("id, prefs")
      .ilike("username", username)
      .maybeSingle();
    if (error || !row) throw new Error("Operator not found");
    const prefs =
      row.prefs && typeof row.prefs === "object" ? (row.prefs as Record<string, unknown>) : {};
    const { error: e2 } = await supabaseAdmin
      .from("operators")
      .update({ prefs: { ...prefs, autoCheckout: data.enabled } } as never)
      .eq("id", row.id);
    if (e2) throw new Error(e2.message);
    return { enabled: data.enabled };
  });
