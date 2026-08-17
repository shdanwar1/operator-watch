/**
 * Browser side of Web Push: permission, service worker, subscription.
 *
 * Registration must happen from a real user gesture (iOS requires it), and
 * on iOS only inside an installed (home-screen) app.
 */

const SW_URL = "/push-sw.js";

export type PushSupport = {
  supported: boolean;
  /** iOS Safari only allows push in an installed home-screen app. */
  needsInstall: boolean;
  permission: NotificationPermission | "unsupported";
};

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { supported: false, needsInstall: isIos() && !isStandalone(), permission: "unsupported" };
  }
  return {
    supported: true,
    needsInstall: isIos() && !isStandalone(),
    permission: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  };
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function encodeKey(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(SW_URL);
  if (existing) return existing;
  return navigator.serviceWorker.register(SW_URL, { scope: "/" });
}

export type SubscribeResult =
  | { ok: true; endpoint: string; p256dh: string; auth: string }
  | { ok: false; reason: "unsupported" | "needs_install" | "denied" | "no_key" | "failed" };

/** Must be called from a user gesture. */
export async function subscribeToPush(publicKey: string | null): Promise<SubscribeResult> {
  const support = pushSupport();
  if (!support.supported) {
    return { ok: false, reason: support.needsInstall ? "needs_install" : "unsupported" };
  }
  if (!publicKey) return { ok: false, reason: "no_key" };

  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };

  try {
    const registration = await ensureRegistration();
    await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      }));

    return {
      ok: true,
      endpoint: subscription.endpoint,
      p256dh: encodeKey(subscription.getKey("p256dh")),
      auth: encodeKey(subscription.getKey("auth")),
    };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Removes the local subscription and returns the endpoint that was removed. */
export async function unsubscribeFromPush(): Promise<string | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration(SW_URL);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  try {
    await subscription.unsubscribe();
  } catch {
    /* ignore */
  }
  return endpoint;
}

export async function currentPushEndpoint(): Promise<string | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration(SW_URL);
  const subscription = await registration?.pushManager.getSubscription();
  return subscription?.endpoint ?? null;
}
