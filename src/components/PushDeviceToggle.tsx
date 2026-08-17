import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  getPushPublicKey,
  getMyPushStatus,
  registerPushSubscription,
  unregisterPushSubscription,
  sendTestPush,
} from "@/lib/push.functions";
import {
  currentPushEndpoint,
  pushSupport,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push-client";

/**
 * Turns background notifications on for *this* device.
 *
 * The preference toggles above decide *which* reminders are sent; this decides
 * whether this phone/computer is one of the places they arrive.
 */
export function PushDeviceToggle() {
  const fetchKey = useServerFn(getPushPublicKey);
  const fetchStatus = useServerFn(getMyPushStatus);
  const register = useServerFn(registerPushSubscription);
  const unregister = useServerFn(unregisterPushSubscription);
  const test = useServerFn(sendTestPush);

  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState(0);
  const [support, setSupport] = useState<ReturnType<typeof pushSupport> | null>(null);

  const refresh = useCallback(async () => {
    const s = pushSupport();
    setSupport(s);
    if (!s.supported) return;
    const endpoint = await currentPushEndpoint();
    try {
      const status = await fetchStatus();
      setDevices(status.devices.length);
      setEnabled(Boolean(endpoint) && status.devices.includes(endpoint ?? ""));
    } catch {
      setEnabled(false);
    }
  }, [fetchStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      if (next) {
        const { publicKey } = await fetchKey();
        const res = await subscribeToPush(publicKey);
        if (!res.ok) {
          const messages: Record<string, string> = {
            needs_install: "On iPhone, add the app to your Home Screen first, then turn this on.",
            denied: "Notifications are blocked in your browser settings.",
            unsupported: "This browser doesn't support background notifications.",
            no_key: "Notifications aren't configured yet.",
            failed: "Couldn't turn on notifications on this device.",
          };
          toast.error(messages[res.reason] ?? "Couldn't turn on notifications.");
          return;
        }
        await register({
          data: {
            endpoint: res.endpoint,
            p256dh: res.p256dh,
            auth: res.auth,
            userAgent: navigator.userAgent,
            platform: navigator.platform,
          },
        });
        setEnabled(true);
        toast.success("Notifications on for this device");
      } else {
        const endpoint = await unsubscribeFromPush();
        if (endpoint) await unregister({ data: { endpoint } });
        setEnabled(false);
        toast.success("Notifications off for this device");
      }
      await refresh();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const blocked = support?.supported === false;

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="text-[15px]">This device</div>
        <div className="text-[13px] text-muted-foreground">
          {blocked
            ? support?.needsInstall
              ? "Add to Home Screen to enable"
              : "Not supported in this browser"
            : enabled
              ? devices > 1
                ? `On · ${devices} devices`
                : "On"
              : "Off"}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {enabled && (
          <button
            type="button"
            className="press rounded-full border border-border px-3 py-1.5 text-[13px]"
            onClick={async () => {
              try {
                const res = await test();
                toast[res.sent > 0 ? "success" : "error"](
                  res.sent > 0 ? "Test sent" : "Couldn't deliver the test",
                );
              } catch {
                toast.error("Couldn't send a test");
              }
            }}
          >
            Test
          </button>
        )}
        <Switch checked={enabled} disabled={busy || blocked} onCheckedChange={(v) => void toggle(v)} />
      </div>
    </div>
  );
}
