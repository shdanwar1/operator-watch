import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPushPublicKey, registerPushSubscription } from "@/lib/push.functions";
import { pushSupport, reconcilePushSubscription } from "@/lib/push-client";

/**
 * Keeps this device's push endpoint bound to the *currently signed-in*
 * operator.
 *
 * Without this, a browser that once registered as operator A keeps receiving
 * A's reminders after operator B signs in on the same device. Registering is
 * an ownership transfer on the server (the endpoint is detached from any other
 * operator first), so running it on every app load closes that window app-wide
 * instead of only on the Profile page. It never prompts: it does nothing
 * unless notification permission is already granted.
 */
export function PushBinding() {
  const fetchKey = useServerFn(getPushPublicKey);
  const register = useServerFn(registerPushSubscription);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const support = pushSupport();
        if (!support.supported || support.permission !== "granted") return;
        const { publicKey } = await fetchKey();
        const live = await reconcilePushSubscription(publicKey);
        if (!live || cancelled) return;
        await register({
          data: {
            endpoint: live.endpoint,
            p256dh: live.p256dh,
            auth: live.auth,
            userAgent: navigator.userAgent,
            platform: navigator.platform,
          },
        });
      } catch {
        /* binding is best-effort; the Profile toggle remains the manual path */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchKey, register]);

  return null;
}
