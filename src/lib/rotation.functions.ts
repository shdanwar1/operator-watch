import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import type { ShiftRotation } from "@/domain/shift-rotation";

type GateSession = { siteUnlocked?: boolean; username?: string; isAdmin?: boolean };

async function requireAdmin() {
  const password = process.env.SESSION_SECRET;
  if (!password) throw new Error("SESSION_SECRET is not set");
  const session = await useSession<GateSession>({
    password,
    name: "site-gate",
    maxAge: 60 * 60 * 24 * 30,
    cookie: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
  });
  if (!session.data.siteUnlocked || !session.data.isAdmin) {
    throw new Response("Admin access required", { status: 403 });
  }
}

export const adminGetRotation = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { readRotation } = await import("@/domain/shift-generation.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("operators")
    .select("username")
    .eq("is_active", true)
    .eq("is_admin", false)
    .order("username");
  return {
    rotation: await readRotation(),
    operators: (data ?? []).map((o) => o.username as string),
  };
});

/** Saves who holds each bucket in the current month, then regenerates shifts. */
export const adminSetRotation = createServerFn({ method: "POST" })
  .inputValidator((d: { day: string | null; night: string | null; weekend: string | null }) => ({
    day: d?.day ? String(d.day) : null,
    night: d?.night ? String(d.night) : null,
    weekend: d?.weekend ? String(d.weekend) : null,
  }))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { berlinDateKey } = await import("@/lib/gcal-core");
    const { ROTATION_SETTING_KEY, generateTimetableShifts } = await import(
      "@/domain/shift-generation.server"
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const value: ShiftRotation = { anchorMonth: berlinDateKey().slice(0, 7), ...data };
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: ROTATION_SETTING_KEY, value } as never, { onConflict: "key" });
    if (error) throw new Error(error.message);
    const result = await generateTimetableShifts();
    return { ok: true as const, ...result };
  });
