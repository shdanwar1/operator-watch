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
  /** "close" retracts a shown notification; otherwise the notification type. */
  type?: string;
  /** Set on the exact-start check-in notification so the tap can act on it. */
  scheduledShiftId?: string;
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
export type SendResult = {
  sent: number;
  failed: number;
  gone: number;
  total: number;
  error?: string;
};

type OwnedSubscription = StoredSubscription & { operator_id: string };

const isOperatorId = (id: string | null | undefined) => /^[0-9a-f-]{36}$/i.test(id ?? "");

/**
 * Active subscriptions for several operators in ONE query, grouped by
 * operator. Used by the dispatcher so each run reads each operator's devices
 * once, however many notifications that operator has due.
 */
export async function loadActiveSubscriptions(
  operatorIds: string[],
): Promise<Map<string, OwnedSubscription[]>> {
  const ids = [...new Set(operatorIds.filter(isOperatorId))];
  const out = new Map<string, OwnedSubscription[]>();
  if (!ids.length) return out;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, operator_id")
    .in("operator_id", ids)
    .is("disabled_at", null);
  if (error) throw new Error(error.message);
  for (const s of (data ?? []) as OwnedSubscription[]) {
    const list = out.get(s.operator_id) ?? [];
    list.push(s);
    out.set(s.operator_id, list);
  }
  return out;
}

/**
 * Sends to an operator's already-loaded devices, disabling dead endpoints.
 * Dead devices are removed from `subs` in place so later sends in the same
 * run skip them.
 */
export async function sendToLoadedSubscriptions(
  operatorId: string,
  subs: OwnedSubscription[],
  payload: PushPayload,
): Promise<SendResult> {
  if (!isOperatorId(operatorId)) {
    return { sent: 0, failed: 0, gone: 0, total: 0, error: "missing operator id" };
  }
  // Belt and braces: only rows that actually carry this operator's id.
  const own = subs.filter((s) => s.operator_id === operatorId);
  const total = own.length;
  let sent = 0;
  let failed = 0;
  let gone = 0;
  let lastError: string | undefined;

  for (const sub of own) {
    try {
      const res = await sendToSubscription(sub, payload);
      if (res.ok) {
        sent += 1;
      } else if (res.gone) {
        // Dead device: retire it. Not counted as a failure.
        gone += 1;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin
          .from("push_subscriptions")
          .update({ disabled_at: new Date().toISOString() } as never)
          .eq("id", sub.id);
        const i = subs.indexOf(sub);
        if (i >= 0) subs.splice(i, 1);
      } else {
        failed += 1;
        lastError = `push service returned ${res.status}`;
      }
    } catch (err) {
      failed += 1;
      lastError = err instanceof Error ? err.message : "send failed";
    }
  }

  return { sent, failed, gone, total, ...(lastError ? { error: lastError } : {}) };
}

export async function sendToOperator(operatorId: string, payload: PushPayload): Promise<SendResult> {
  // Hard isolation invariant: a notification is always addressed to exactly
  // one operator. No "send to everyone" fallback.
  if (!isOperatorId(operatorId)) {
    return { sent: 0, failed: 0, gone: 0, total: 0, error: "missing operator id" };
  }
  const subs = (await loadActiveSubscriptions([operatorId])).get(operatorId) ?? [];
  return sendToLoadedSubscriptions(operatorId, subs, payload);
}

