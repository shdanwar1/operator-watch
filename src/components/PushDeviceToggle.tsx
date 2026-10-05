import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getPushPublicKey,
  getMyPushStatus,
  registerPushSubscription,
  unregisterPushSubscription,
  clearMyPushDevices,
  sendTestPush,
  type PushDevice,
} from "@/lib/push.functions";
import {
  currentPushEndpoint,
  pushSupport,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push-client";
import { currentDevice, type DeviceInfo } from "@/lib/device-info";

const SUBSCRIBE_ERRORS: Record<string, string> = {
  needs_install: "On iPhone and iPad, add the app to your Home Screen first, then enable notifications.",
  denied: "Notifications are blocked for this site. Allow them in your browser settings, then try again.",
  unsupported: "This browser doesn't support background notifications.",
  no_key: "Notifications aren't configured yet.",
  failed: "Couldn't create a notification subscription on this device.",
};

function errorText(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * Registered notification devices for the signed-in operator.
 *
 * "This device" is On only when the browser's own subscription endpoint is
 * confirmed stored on the server — local permission alone never counts.
 */
export function PushDeviceToggle() {
  const fetchKey = useServerFn(getPushPublicKey);
  const fetchStatus = useServerFn(getMyPushStatus);
  const register = useServerFn(registerPushSubscription);
  const unregister = useServerFn(unregisterPushSubscription);
  const clearAll = useServerFn(clearMyPushDevices);
  const test = useServerFn(sendTestPush);

  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [support, setSupport] = useState<ReturnType<typeof pushSupport> | null>(null);
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(async () => {
    setDevice(currentDevice());
    setSupport(pushSupport());
    const [status, local] = await Promise.all([fetchStatus(), currentPushEndpoint().catch(() => null)]);
    setDevices(status.devices);
    setEndpoint(local);
  }, [fetchStatus]);

  useEffect(() => {
    refresh().catch((e) => setError(errorText(e, "Couldn't load notification devices.")));
  }, [refresh]);

  const isDesktop = device?.type === "desktop";
  const enabled = Boolean(endpoint) && devices.some((d) => d.endpoint === endpoint);
  const others = devices.filter((d) => d.endpoint !== endpoint);

  async function enable() {
    if (!device || isDesktop) return;
    setBusy(true);
    setError(null);
    try {
      const { publicKey } = await fetchKey();
      const res = await subscribeToPush(publicKey);
      if (!res.ok) {
        setError(res.detail ? `${SUBSCRIBE_ERRORS[res.reason]} (${res.detail})` : SUBSCRIBE_ERRORS[res.reason]);
        return;
      }
      const saved = await register({
        data: {
          endpoint: res.endpoint,
          p256dh: res.p256dh,
          auth: res.auth,
          userAgent: navigator.userAgent,
          platform: device.os,
          deviceType: device.type,
          browser: device.browser,
          label: device.label,
        },
      });
      await refresh();
      if (saved.endpoint === res.endpoint) toast.success("Notifications on for this device");
    } catch (e) {
      setError(errorText(e, "Couldn't register this device. Please try again."));
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const removed = await unsubscribeFromPush();
      if (removed) await unregister({ data: { endpoint: removed } });
      await refresh();
    } catch (e) {
      setError(errorText(e, "Couldn't turn off notifications. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function doClearAll() {
    setBusy(true);
    setError(null);
    try {
      await clearAll();
      await unsubscribeFromPush().catch(() => null);
      setConfirmClear(false);
      await refresh();
      toast.success("All notification devices cleared");
    } catch (e) {
      setError(errorText(e, "Couldn't clear devices. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    try {
      const res = await test();
      if (res.total === 0) toast.error("No device is registered for notifications yet");
      else if (res.sent > 0)
        toast.success(res.failed > 0 ? `Test sent to ${res.sent} of ${res.total} devices` : "Test sent");
      else toast.error("Couldn't deliver the test to any device");
    } catch (e) {
      toast.error(errorText(e, "Couldn't send a test"));
    }
  }

  let status = "Notifications Off";
  let hint: string | null = null;
  if (isDesktop) {
    status = "Notifications unavailable";
    hint = "Notifications are available on mobile devices only.";
  } else if (enabled) {
    status = "Notifications On";
  } else if (support && !support.supported) {
    status = "Notifications unavailable";
    hint = support.needsInstall ? SUBSCRIBE_ERRORS.needs_install : SUBSCRIBE_ERRORS.unsupported;
  }

  const thisOn = enabled;
  return (
    <>
      <div className="px-5 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold">{device?.label ?? "…"}</div>
            {hint && <div className="mt-0.5 text-[13px] text-muted-foreground">{hint}</div>}
          </div>
          <span className={thisOn ? "shrink-0 text-[13px] text-done" : "shrink-0 text-[13px] text-muted-foreground"}>
            {thisOn ? "On" : status === "Notifications unavailable" ? "Unavailable" : "Off"}
          </span>
        </div>
        {!isDesktop && support?.supported && (
          <div className="mt-2.5 flex items-center gap-2">
            {enabled ? (
              <>
                <Button size="sm" variant="outline" onClick={() => void sendTest()}>
                  Test
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void disable()}>
                  Turn off
                </Button>
              </>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => void enable()}>
                {busy ? "Enabling…" : "Enable notifications"}
              </Button>
            )}
          </div>
        )}
        {error && (
          <div role="alert" className="mt-2 text-[13px] text-destructive">
            {error}
          </div>
        )}
      </div>

      {others.map((d) => (
        <div key={d.endpoint} className="flex items-start justify-between gap-3 px-5 py-3.5">
          <div className="min-w-0 truncate text-[15px] font-semibold">{d.label}</div>
          <span className="shrink-0 text-[13px] text-done">On</span>
        </div>
      ))}

      {devices.length > 0 && (
        <div className="px-5 py-3">
          <button
            type="button"
            className="press text-[14px] text-destructive"
            disabled={busy}
            onClick={() => setConfirmClear(true)}
          >
            Clear all devices
          </button>
        </div>
      )}

      <Dialog open={confirmClear} onOpenChange={(o) => !busy && setConfirmClear(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear all notification devices?</DialogTitle>
            <DialogDescription>This will disable notifications on all registered devices.</DialogDescription>
          </DialogHeader>
          {error && <div className="text-[13px] text-destructive">{error}</div>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void doClearAll()}>
              Clear all devices
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
