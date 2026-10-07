import { PAGE_TITLES, pageMeta } from "@/lib/page-titles";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import { getGateStatus, signOutUser } from "@/lib/gate.functions";
import { releasePushEndpoint } from "@/lib/push.functions";
import { unsubscribeFromPush } from "@/lib/push-client";
import { clearAllCaches } from "@/lib/local-cache";
import {
  setMyHomeAddress,
  updateMyProfile,
  changeMyPin,
  getMyOperatorProfile,
  type OperatorProfile,
} from "@/lib/operators.functions";
import { getMyCalendarUrl, setMyCalendarUrl } from "@/lib/gcal.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast, Toaster } from "sonner";
import { AppShell, PageHeader } from "@/components/AppShell";
import { PushDeviceToggle } from "@/components/PushDeviceToggle";
import { PIN_RE, USERNAME_RE } from "@/lib/validation";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/profile")({
  beforeLoad: async () => {
    const status = await getGateStatus();
    if (!status.unlocked) throw redirect({ to: "/unlock" });
    if (status.isAdmin) throw redirect({ to: "/admin" });
  },
  loader: async (): Promise<{
    profile: OperatorProfile;
    icsUrl: string | null;
  }> => {
    const [profile, calRes] = await Promise.all([
      getMyOperatorProfile(),
      getMyCalendarUrl().catch(() => ({ icsUrl: null as string | null })),
    ]);
    return { profile, icsUrl: calRes.icsUrl };
  },
  head: () => ({
    meta: pageMeta(
      PAGE_TITLES.profile,
      "Manage your operator account, calendar sync, notifications and dashboard preferences.",
    ),
  }),
  component: ProfilePage,
});

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[18px] border border-border bg-card">
      <header className="border-b border-border px-5 py-3.5">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      </header>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

function Row({
  label,
  action,
  children,
}: {
  label?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        {label && (
          <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            {label}
          </div>
        )}
        <div className={label ? "mt-1" : undefined}>{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="block text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function ResetPinDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const changePin = useServerFn(changeMyPin);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  const error =
    next && !PIN_RE.test(next)
      ? "PIN must contain exactly 4 digits"
      : confirm && next !== confirm
        ? "PINs do not match"
        : null;

  const valid = PIN_RE.test(current) && PIN_RE.test(next) && next === confirm;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset PIN</DialogTitle>
          <DialogDescription>Takes effect at your next sign-in.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {(
            [
              ["Current PIN", current, setCurrent],
              ["New PIN", next, setNext],
              ["Confirm new PIN", confirm, setConfirm],
            ] as const
          ).map(([label, value, set]) => (
            <Field key={label} label={label}>
              <Input
                className="h-10"
                type="password"
                inputMode="numeric"
                maxLength={4}
                autoComplete="new-password"
                value={value}
                onChange={(e) => set(e.target.value.replace(/\D+/g, ""))}
              />
            </Field>
          ))}
          {error && <p className="text-[12px] text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await changePin({ data: { current_pin: current, new_pin: next } });
                toast.success("PIN updated");
                reset();
                onOpenChange(false);
              } catch (e) {
                toast.error(friendlyError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save PIN"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangeHomeDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: (res: { label: string; lat: number; lng: number }) => void;
}) {
  const saveHome = useServerFn(setMyHomeAddress);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setUrl("");
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change home address</DialogTitle>
          <DialogDescription>
            Open the place in Google Maps, tap Share, and paste the link here.
          </DialogDescription>
        </DialogHeader>
        <Field label="Google Maps link">
          <Input
            className="h-10"
            placeholder="https://maps.app.goo.gl/…"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!url.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await saveHome({ data: { maps_url: url.trim() } });
                onSaved(res);
                toast.success("Home address updated");
                setUrl("");
                onOpenChange(false);
              } catch (e) {
                toast.error(friendlyError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save address"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditCalendarDialog({
  open,
  onOpenChange,
  current,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  current: string | null;
  onSaved: (url: string | null) => void;
}) {
  const saveCal = useServerFn(setMyCalendarUrl);
  const [url, setUrl] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (busy) return;
        if (v) setUrl(current ?? "");
        setError(null);
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Google Calendar link</DialogTitle>
          <DialogDescription>
            Paste your public iCal address from Google Calendar. Clear the box to disconnect.
          </DialogDescription>
        </DialogHeader>
        <Field label="Public iCal URL">
          <Input
            className="h-10"
            placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
          />
        </Field>
        {error && (
          <p role="alert" className="text-[12px] text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || url.trim() === (current ?? "")}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const res = await saveCal({ data: { url: url.trim() } });
                onSaved(res.icsUrl);
                toast.success(res.icsUrl ? "Calendar link updated" : "Calendar disconnected");
                onOpenChange(false);
              } catch (e) {
                setError(friendlyError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? (url.trim() ? "Verifying…" : "Saving…") : url.trim() ? "Save" : "Disconnect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangeUsernameDialog({
  open,
  onOpenChange,
  current,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  current: string;
  onSaved: (username: string) => void;
}) {
  const saveFn = useServerFn(updateMyProfile);
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const t = name.trim();
  const error = t && !USERNAME_RE.test(t) ? "Username must be 2–32 letters, numbers, . _ or -" : null;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (busy) return;
        if (v) setName(current);
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change username</DialogTitle>
          <DialogDescription>Use your new username at your next sign-in.</DialogDescription>
        </DialogHeader>
        <Field label="Username">
          <Input
            className="h-10"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {error && <p className="text-[12px] text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || !USERNAME_RE.test(t) || t === current}
            onClick={async () => {
              setBusy(true);
              try {
                await saveFn({ data: { username: t } });
                onSaved(t);
                toast.success("Username updated");
                onOpenChange(false);
              } catch (e) {
                toast.error(friendlyError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProfilePage() {
  const router = useRouter();
  const signOut = useServerFn(signOutUser);
  const releaseEndpoint = useServerFn(releasePushEndpoint);

  const {
    profile: initialProfile,
    icsUrl: initialIcs,
  } = Route.useLoaderData();
  const [profile, setProfile] = useState<OperatorProfile>(initialProfile);
  const [icsUrl, setIcsUrl] = useState<string | null>(initialIcs);
  const [pinOpen, setPinOpen] = useState(false);
  const [homeOpen, setHomeOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);

  const connected = Boolean(icsUrl);
  const actionBtn = "h-9 rounded-[10px] px-4";

  return (
    <AppShell>
      <Toaster richColors position="top-center" />
      <PageHeader eyebrow="Account" title="Profile" />

      <ResetPinDialog open={pinOpen} onOpenChange={setPinOpen} />
      <ChangeUsernameDialog
        open={nameOpen}
        onOpenChange={setNameOpen}
        current={profile.username}
        onSaved={(username) => {
          setProfile((p) => ({ ...p, username }));
          void router.invalidate();
        }}
      />
      <ChangeHomeDialog
        open={homeOpen}
        onOpenChange={setHomeOpen}
        onSaved={(res) =>
          setProfile((p) => ({ ...p, home_label: res.label, home_lat: res.lat, home_lng: res.lng }))
        }
      />
      <EditCalendarDialog
        open={calOpen}
        onOpenChange={setCalOpen}
        current={icsUrl}
        onSaved={setIcsUrl}
      />

      <div className="mx-auto max-w-[720px] space-y-4">
        <Panel title="Operator">
          <Row
            label="Username"
            action={
              <Button variant="outline" className={actionBtn} onClick={() => setNameOpen(true)}>
                Change
              </Button>
            }
          >
            <p className="truncate text-[16px] font-semibold">{profile.username}</p>
          </Row>
          <Row
            label="PIN"
            action={
              <Button variant="outline" className={actionBtn} onClick={() => setPinOpen(true)}>
                Reset PIN
              </Button>
            }
          >
            <p className="text-[16px] font-bold tracking-[0.2em]" aria-label="PIN hidden">
              ••••
            </p>
          </Row>
          <Row
            label="Home address"
            action={
              <Button variant="outline" className={actionBtn} onClick={() => setHomeOpen(true)}>
                Change
              </Button>
            }
          >
            <p className="truncate text-[15px]">
              {profile.home_label ?? <span className="text-muted-foreground">Not set</span>}
            </p>
          </Row>
        </Panel>

        <Panel title="Google Calendar">
          <Row
            label="Status"
            action={
              <Button variant="outline" className={actionBtn} onClick={() => setCalOpen(true)}>
                Edit
              </Button>
            }
          >
            <span
              className={cn(
                "inline-block rounded-full px-2.5 py-0.5 text-[12px] font-medium",
                connected ? "bg-done-soft text-done" : "bg-muted text-muted-foreground",
              )}
            >
              {connected ? "Connected" : "Not connected"}
            </span>
          </Row>
        </Panel>

        <Panel title="Notifications">
          <PushDeviceToggle />
        </Panel>

        <button
          type="button"
          onClick={async () => {
            clearAllCaches();
            // Release the push endpoint so the next operator on this device
            // doesn't inherit this session's reminders (matches sidebar logout).
            try {
              const endpoint = await unsubscribeFromPush();
              if (endpoint) await releaseEndpoint({ data: { endpoint } });
            } catch {
              /* ignore — sign-out must proceed regardless */
            }
            await signOut();
            await router.navigate({ to: "/unlock" });
          }}
          className="press !mt-6 w-full rounded-[18px] border border-border bg-card py-4 text-[16px] font-semibold text-destructive lg:hidden"
        >
          Log out
        </button>
      </div>
    </AppShell>
  );
}

function friendlyError(e: unknown): string {
  if (e instanceof Error) {
    const msg = e.message;
    if (/duplicate key|already in use|already exists/i.test(msg)) {
      return "This username is already in use.";
    }
    if (/network|fetch|failed to fetch/i.test(msg)) {
      return "Unable to contact the server. Please try again.";
    }
    return msg;
  }
  return "Something went wrong. Please try again.";
}
