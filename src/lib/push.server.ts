/**
 * Server-only Web Push helpers.
 *
 * VAPID signing runs through `@block65/webcrypto-web-push`, which uses only
 * Web Crypto and therefore works in the edge runtime this app deploys to.
 */
import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";

export type StoredSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  /** "close" asks the service worker to retract an already-shown notification. */
  type?: "notify" | "close";
};

function vapid() {
  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_PRIVATE_KEY"];
  const subject = process.env["VAPID_SUBJECT"] ?? "mailto:notifications@example.com";
  if (!publicKey || !privateKey) throw new Error("VAPID keys are not configured");
  return { publicKey, privateKey, subject };
}

/**
 * Sends one payload to one device.
 *
 * Returns `gone` when the push service says the subscription is dead (404 /
 * 410) so the caller can disable that row.
 */
export async function sendToSubscription(
  sub: StoredSubscription,
  payload: PushPayload,
): Promise<{ ok: boolean; gone: boolean; status: number }> {
  const subscription: PushSubscription = {
    endpoint: sub.endpoint,
    expirationTime: null,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };

  const request = await buildPushPayload(
    { data: JSON.stringify(payload), options: { ttl: 600, urgency: "high" } },
    subscription,
    vapid(),
  );

  const res = await fetch(sub.endpoint, request as unknown as RequestInit);
  return { ok: res.ok, gone: res.status === 404 || res.status === 410, status: res.status };
}

/**
 * Sends to every active device of an operator, disabling dead endpoints.
 *
 * One failing device never stops the others: every subscription is attempted
 * and the caller gets the full picture (`total` = active devices at send time)
 * so it can tell "all sent" from "partly sent" from "nothing to send".
 */
export async function sendToOperator(
  operatorId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number; gone: number; total: number; error?: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("operator_id", operatorId)
    .is("disabled_at", null);
  if (error) throw new Error(error.message);

  const subs = (data ?? []) as StoredSubscription[];
  let sent = 0;
  let failed = 0;
  let gone = 0;
  let lastError: string | undefined;

  for (const sub of subs) {
    try {
      const res = await sendToSubscription(sub, payload);
      if (res.ok) {
        sent += 1;
      } else if (res.gone) {
        // Dead device: retire it. Not counted as a failure — retrying it
        // would never help, and it must not block the live devices.
        gone += 1;
        await supabaseAdmin
          .from("push_subscriptions")
          .update({ disabled_at: new Date().toISOString() } as never)
          .eq("id", sub.id);
      } else {
        failed += 1;
        lastError = `push service returned ${res.status}`;
      }
    } catch (err) {
      failed += 1;
      lastError = err instanceof Error ? err.message : "send failed";
    }
  }

  return { sent, failed, gone, total: subs.length, ...(lastError ? { error: lastError } : {}) };
}

