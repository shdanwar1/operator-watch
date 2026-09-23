import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPushPublicKey, registerPushSubscription } from "@/lib/push.functions";
import { pushSupport, reconcilePushSubscription } from "@/lib/push-client";
import { currentDevice } from "@/lib/device-info";

/**
 * Keeps this device's push endpoint bound to the *currently signed-in*
 * operator. Registering is an ownership transfer on the server, so running it
 * on every app load stops a shared phone from receiving a previous operator's
 * reminders. It never prompts, and does nothing on desktop browsers.
 */
export function PushBinding() {
  const fetchKey = useServerFn(getPushPublicKey);
  const register = useServerFn(registerPushSubscription);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const device = currentDevice();
        if (device.type === "desktop") return;
        const support = pushSupport();
        if (!support.supported || support.permission !== "granted") return;
        const { publicKey } = await fetchKey();
        const live = await reconcilePushSubscription(publicKey);
        if (!live || cancelled) return;
        await register({
          data: {
            ...live,
            userAgent: navigator.userAgent,
            platform: device.os,
            deviceType: device.type,
            browser: device.browser,
            label: device.label,
          },
        });
      } catch {
        /* best-effort; the Profile section is the manual path and shows errors */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchKey, register]);

  return null;
}
