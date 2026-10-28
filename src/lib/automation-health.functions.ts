import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import type { AutomationHealthRow } from "@/domain/automation-health";

export const adminGetAutomationHealth = createServerFn({ method: "GET" }).handler(async () => {
  const password = process.env.SESSION_SECRET;
  if (!password) throw new Error("Session unavailable");
  const session = await useSession<{ siteUnlocked?: boolean; username?: string; isAdmin?: boolean }>({
    password, name: "site-gate", maxAge: 60 * 60 * 24 * 30,
    cookie: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
  });
  if (!session.data.siteUnlocked || !session.data.username || !session.data.isAdmin)
    throw new Response("Admin access required", { status: 403 });
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [health, due] = await Promise.all([
    supabaseAdmin.from("automation_health").select("*"),
    supabaseAdmin.rpc("push_dispatch_due"),
  ]);
  if (health.error) throw new Error("Automation health unavailable");
  return { rows: (health.data ?? []) as AutomationHealthRow[], now: Date.now(), dispatchDue: due.error ? null : due.data === true };
});