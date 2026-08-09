import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

/**
 * System-wide application settings. These belong to the Admin application:
 * operators read them, only an admin can change them.
 */

type GateSession = { siteUnlocked?: boolean; username?: string; isAdmin?: boolean };

function getSessionConfig() {
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
  const session = await useSession<GateSession>(getSessionConfig());
  if (!session.data.siteUnlocked) throw new Response("Unauthorized", { status: 401 });
  return { username: session.data.username ?? null, isAdmin: !!session.data.isAdmin };
}

async function requireAdmin() {
  const s = await requireGate();
  if (!s.isAdmin) throw new Response("Admin access required", { status: 403 });
  return s;
}

export type StudioSetting = { label: string; lat: number; lng: number };
export type CheckoutSetting = { message: string; enabled: boolean };
export type AppSettings = { studio: StudioSetting; checkout: CheckoutSetting };

export const DEFAULT_SETTINGS: AppSettings = {
  studio: { label: "Dance Masterclass Studio", lat: 52.5263162, lng: 13.3229399 },
  checkout: { message: "Did you turn the security camera back ON?", enabled: true },
};

/** Server-side read used by other server functions (no session requirement). */
export async function readAppSettings(): Promise<AppSettings> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("app_settings").select("key, value");
  const rows = (data ?? []) as { key: string; value: Record<string, unknown> }[];
  const out: AppSettings = {
    studio: { ...DEFAULT_SETTINGS.studio },
    checkout: { ...DEFAULT_SETTINGS.checkout },
  };
  for (const r of rows) {
    if (r.key === "studio" && r.value) {
      out.studio = {
        label: String(r.value.label ?? out.studio.label),
        lat: Number(r.value.lat ?? out.studio.lat),
        lng: Number(r.value.lng ?? out.studio.lng),
      };
    }
    if (r.key === "checkout" && r.value) {
      out.checkout = {
        message: String(r.value.message ?? out.checkout.message),
        enabled: r.value.enabled === undefined ? true : Boolean(r.value.enabled),
      };
    }
  }
  return out;
}

/** Any signed-in user may read settings — they drive operator-facing behaviour. */
export const getAppSettings = createServerFn({ method: "GET" }).handler(async () => {
  await requireGate();
  return readAppSettings();
});

async function writeSetting(key: string, value: Record<string, unknown>) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("app_settings")
    .upsert({ key, value } as never, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export const adminUpdateCheckoutSetting = createServerFn({ method: "POST" })
  .inputValidator((data: { message: string; enabled: boolean }) => ({
    message: String(data?.message ?? "").trim().slice(0, 300),
    enabled: Boolean(data?.enabled),
  }))
  .handler(async ({ data }) => {
    await requireAdmin();
    if (!data.message) throw new Error("Message is required");
    await writeSetting("checkout", data);
    return { ok: true as const };
  });

export const adminUpdateStudioSetting = createServerFn({ method: "POST" })
  .inputValidator((data: { label: string; lat: number; lng: number }) => {
    const lat = Number(data?.lat);
    const lng = Number(data?.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error("Invalid latitude");
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error("Invalid longitude");
    return { label: String(data?.label ?? "").trim().slice(0, 200) || "Studio", lat, lng };
  })
  .handler(async ({ data }) => {
    await requireAdmin();
    await writeSetting("studio", data);
    return { ok: true as const };
  });
