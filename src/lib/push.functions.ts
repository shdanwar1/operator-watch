import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

/**
 * Web Push subscription management for the signed-in operator.
 *
 * Devices register their push endpoint here; the dispatcher (cron) sends to
 * them later, so notifications arrive with the app closed.
 */

type GateSession = { siteUnlocked?: boolean; username?: string; isAdmin?: boolean };

function getSessionConfig() {
  const password = process.env["SESSION_SECRET"];
  if (!password) throw new Error("SESSION_SECRET is not set");
  return {
    password,
    name: "site-gate",
    maxAge: 60 * 60 * 24 * 30,
    cookie: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" },
  };
}

async function requireOperatorId() {
  const session = await useSession<GateSession>(getSessionConfig());
  const username = session.data.username ?? "";
  if (!session.data.siteUnlocked || !username) {
    throw new Response("Unauthorized", { status: 401 });
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("operators")
    .select("id")
    .ilike("username", username)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Response("Unauthorized", { status: 401 });
  return { operatorId: (data as { id: string }).id, username };
}

/** The VAPID public key the browser needs to create a subscription. */
export const getPushPublicKey = createServerFn({ method: "GET" }).handler(async () => {
  return { publicKey: process.env["VAPID_PUBLIC_KEY"] ?? null };
});

type SubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
  platform?: string;
};

function validateSubscription(data: SubscriptionInput): SubscriptionInput {
  const endpoint = String(data?.endpoint ?? "");
  const p256dh = String(data?.p256dh ?? "");
  const auth = String(data?.auth ?? "");
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 2000) {
    throw new Error("Invalid push endpoint");
  }
  if (!p256dh || p256dh.length > 500 || !auth || auth.length > 500) {
    throw new Error("Invalid push keys");
  }
  return {
    endpoint,
    p256dh,
    auth,
    userAgent: String(data?.userAgent ?? "").slice(0, 300) || undefined,
    platform: String(data?.platform ?? "").slice(0, 100) || undefined,
  };
}

export const registerPushSubscription = createServerFn({ method: "POST" })
  .inputValidator(validateSubscription)
  .handler(async ({ data }) => {
    const { operatorId } = await requireOperatorId();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // A device belongs to exactly one operator. If this endpoint was
    // registered by someone else (shared browser, operator switch), that
    // association is removed before the new one is written — never kept
    // alongside it.
    await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", data.endpoint)
      .neq("operator_id", operatorId);

    const { error } = await supabaseAdmin.from("push_subscriptions").upsert(
      {
        operator_id: operatorId,
        endpoint: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        user_agent: data.userAgent ?? null,
        platform: data.platform ?? null,
        last_seen_at: new Date().toISOString(),
        disabled_at: null,
      } as never,
      { onConflict: "endpoint" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unregisterPushSubscription = createServerFn({ method: "POST" })
  .inputValidator((data: { endpoint: string }) => ({ endpoint: String(data?.endpoint ?? "") }))
  .handler(async ({ data }) => {
    const { operatorId } = await requireOperatorId();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("operator_id", operatorId)
      .eq("endpoint", data.endpoint);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** How many devices this operator currently receives notifications on. */
export const getMyPushStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { operatorId } = await requireOperatorId();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("endpoint")
    .eq("operator_id", operatorId)
    .is("disabled_at", null);
  if (error) throw new Error(error.message);
  return { devices: (data ?? []).map((r) => (r as { endpoint: string }).endpoint) };
});

/** Sends a test notification to every device of the signed-in operator. */
export const sendTestPush = createServerFn({ method: "POST" }).handler(async () => {
  const { operatorId } = await requireOperatorId();
  const { sendToOperator } = await import("./push.server");
  return sendToOperator(operatorId, {
    title: "Notifications are on",
    body: "You'll get shift reminders here, even when the app is closed.",
    tag: "test",
    url: "/",
  });
});
