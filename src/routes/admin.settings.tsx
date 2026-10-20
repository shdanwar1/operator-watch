import { PAGE_TITLES, pageMeta } from "@/lib/page-titles";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PinDialog } from "@/components/admin/PinDialog";
import { adminChangeOwnPin } from "@/lib/operators.functions";
import { adminChangeSitePassword, getGateStatus } from "@/lib/gate.functions";
import {
  getAppSettings,
  adminUpdateCheckoutSetting,
  adminUpdateStudioSetting,
  adminVerifyStudioMapsLink,
} from "@/lib/settings.functions";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({
    meta: pageMeta(PAGE_TITLES.settings, "Manage studio settings and system options."),
  }),
  loader: async () => {
    const status = await getGateStatus();
    return { username: status.username ?? "admin" };
  },
  component: AdminSettings,
});

function SectionLabel({ children }: { children: string }) {
  return (
    <h2 className="px-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </h2>
  );
}

function AdminSettings() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </header>

      <section className="space-y-2">
        <SectionLabel>Account</SectionLabel>
        <AccountSection />
      </section>

      <section className="space-y-2">
        <SectionLabel>Security</SectionLabel>
        <SitePasswordSection />
      </section>

      <section className="space-y-2">
        <SectionLabel>Shift rotation</SectionLabel>
        <RotationSection />
      </section>

      <section className="space-y-2">
        <SectionLabel>Studio</SectionLabel>
        <StudioSection />
      </section>

      <section className="space-y-2">
        <SectionLabel>System</SectionLabel>
        <CheckoutSection />
      </section>
    </div>
  );
}

function AccountSection() {
  const changeOwnPin = useServerFn(adminChangeOwnPin);
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardContent className="divide-y divide-border p-0">
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <div>
            <div className="text-sm">Admin PIN</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="tracking-[0.4em] text-muted-foreground">••••</span>
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              Change PIN
            </Button>
          </div>
        </div>
      </CardContent>
      <PinDialog
        open={open}
        title="Change administrator PIN"
        onOpenChange={setOpen}
        onSubmit={async (pin) => {
          await changeOwnPin({ data: { pin } });
          setOpen(false);
          toast.success("Admin PIN updated");
        }}
      />
    </Card>
  );
}

function SitePasswordSection() {
  const changeSitePassword = useServerFn(adminChangeSitePassword);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  const valid = current.length > 0 && next.trim().length >= 6 && next === confirm;

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 p-5">
        <div>
          <div className="text-sm">Site password</div>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Change
        </Button>
      </CardContent>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) reset();
          setOpen(v);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change site password</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Current site password</Label>
              <Input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label>New site password</Label>
              <Input
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Confirm new site password</Label>
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            {next.length > 0 && next.trim().length < 6 && (
              <p className="text-xs text-destructive">Use at least 6 characters.</p>
            )}
            {confirm.length > 0 && next !== confirm && (
              <p className="text-xs text-destructive">Passwords do not match.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!valid || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await changeSitePassword({ data: { current, next, confirm } });
                  if (!res.ok) {
                    toast.error(res.message || "Failed to change password");
                    return;
                  }
                  reset();
                  setOpen(false);
                  toast.success("Site password changed");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed to change password");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Change Site Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}


function StudioSection() {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getAppSettings);
  const verifyFn = useServerFn(adminVerifyStudioMapsLink);
  const saveFn = useServerFn(adminUpdateStudioSetting);
  const { data } = useQuery({ queryKey: ["app-settings"], queryFn: () => fetchSettings() });
  const [mapsUrl, setMapsUrl] = useState("");
  const [verified, setVerified] = useState<{ address: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const savedAddress = data?.studio.address ?? null;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-semibold tracking-tight">Studio address</h2>
          {savedAddress && <span className="text-sm text-muted-foreground">{savedAddress}</span>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="studio-maps-url">Google Maps link</Label>
          <Input
            id="studio-maps-url"
            value={mapsUrl}
            onChange={(e) => {
              setMapsUrl(e.target.value);
              setVerified(null);
              setError(null);
            }}
            placeholder="https://maps.app.goo.gl/…"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        {verified && (
          <div className="rounded-md border bg-muted/40 px-3 py-2">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Verified location
            </div>
            <div className="text-sm">{verified.address}</div>
            {verified.label && verified.label !== verified.address && (
              <div className="text-xs text-muted-foreground">{verified.label}</div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !mapsUrl.trim() || !!verified}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const res = await verifyFn({ data: { maps_url: mapsUrl } });
                if (!res.ok) {
                  setVerified(null);
                  setError(res.message || "Could not verify that link");
                  return;
                }
                const addr = res.full_address ?? res.address;
                if (!addr) {
                  setVerified(null);
                  setError("Could not resolve an address from that link");
                  return;
                }
                setVerified({ address: addr, label: res.label });
              } catch (e) {
                setVerified(null);
                setError(e instanceof Error ? e.message : "Could not verify that link");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && !verified ? "Verifying…" : "Verify"}
          </Button>
          <Button
            size="sm"
            disabled={busy || !verified}
            onClick={async () => {
              setBusy(true);
              try {
                await saveFn({ data: { maps_url: mapsUrl } });
                setMapsUrl("");
                setVerified(null);
                setError(null);
                qc.invalidateQueries({ queryKey: ["app-settings"] });
                toast.success("Studio address saved");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to save");
              } finally {
                setBusy(false);
              }
            }}
          >
            Save studio
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}


function CheckoutSection() {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getAppSettings);
  const saveFn = useServerFn(adminUpdateCheckoutSetting);
  const { data } = useQuery({ queryKey: ["app-settings"], queryFn: () => fetchSettings() });
  const [msg, setMsg] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);

  const message = msg ?? data?.checkout.message ?? "";
  const on = enabled ?? data?.checkout.enabled ?? true;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Check-out confirmation</h2>
          </div>
          <Switch checked={on} onCheckedChange={(v) => setEnabled(v)} />
        </div>
        <Textarea rows={2} value={message} onChange={(e) => setMsg(e.target.value)} />
        <Button
          size="sm"
          onClick={async () => {
            try {
              await saveFn({ data: { message, enabled: on } });
              setMsg(null);
              setEnabled(null);
              qc.invalidateQueries({ queryKey: ["app-settings"] });
              toast.success("Check-out reminder saved");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed to save");
            }
          }}
        >
          Save reminder
        </Button>
      </CardContent>
    </Card>
  );
}

