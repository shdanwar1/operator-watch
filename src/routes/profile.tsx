import { PAGE_TITLES, pageMeta } from "@/lib/page-titles";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import { getGateStatus, signOutUser } from "@/lib/gate.functions";
import { releasePushEndpoint } from "@/lib/push.functions";
import { unsubscribeFromPush } from "@/lib/push-client";
import { clearAllCaches } from "@/lib/local-cache";
import {
  updateMyProfile,
  setMyHomeAddress,
  changeMyPin,
  getMyOperatorProfile,
  type OperatorProfile,
} from "@/lib/operators.functions";
import { getMyCalendarUrl, setMyCalendarUrl } from "@/lib/gcal.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { USERNAME_RE, PIN_RE } from "@/lib/validation";
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

function Panel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.03)] max-lg:glass max-lg:rounded-[18px]">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>
        {aside}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
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

function ProfilePage() {
  const router = useRouter();
  const signOut = useServerFn(signOutUser);
  const releaseEndpoint = useServerFn(releasePushEndpoint);

  const {
    profile: initialProfile,
    icsUrl: initialIcs,
  } = Route.useLoaderData();

  const saveProfileFn = useServerFn(updateMyProfile);
  const saveCalFn = useServerFn(setMyCalendarUrl);
  const reloadProfile = useServerFn(getMyOperatorProfile);

  const [profile, setProfile] = useState<OperatorProfile>(initialProfile);
  const [icsUrl, setIcsUrl] = useState<string | null>(initialIcs);

  const [username, setUsername] = useState(profile.username);
  const [calDraft, setCalDraft] = useState(icsUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [homeOpen, setHomeOpen] = useState(false);

  async function saveAll() {
    const nameChanged = username.trim() !== "" && username.trim() !== profile.username;
    if (nameChanged && !USERNAME_RE.test(username.trim())) {
      return toast.error("Username must be 2–32 letters, numbers, . _ or -");
    }

    setSaving(true);
    try {
      if (nameChanged) {
        await saveProfileFn({ data: { username: username.trim() } });
      }

      if (calDraft.trim() !== (icsUrl ?? "")) {
        const res = await saveCalFn({ data: { url: calDraft } });
        setIcsUrl(res.icsUrl);
        setCalDraft(res.icsUrl ?? "");
      }

      if (nameChanged) {
        const fresh = await reloadProfile();
        setProfile(fresh);
        setUsername(fresh.username);
        await router.invalidate();
      }

      toast.success("Changes saved");
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  const connected = Boolean(icsUrl);

  return (
    <AppShell>
      <Toaster richColors position="top-center" />
      <PageHeader
        eyebrow="Account"
        title="Profile"
        action={
          <Button size="sm" className="h-9 px-4" onClick={saveAll} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        }
      />

      <ResetPinDialog open={pinOpen} onOpenChange={setPinOpen} />
      <ChangeHomeDialog
        open={homeOpen}
        onOpenChange={setHomeOpen}
        onSaved={(res) =>
          setProfile((p) => ({ ...p, home_label: res.label, home_lat: res.lat, home_lng: res.lng }))
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Operator">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Username">
              <Input
                className="h-10"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>
            <Field label="PIN">
              <Button
                variant="outline"
                className="h-10 w-full justify-center"
                onClick={() => setPinOpen(true)}
              >
                Reset PIN
              </Button>
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Home address">
              <div className="flex items-center gap-3">
                <p className="min-w-0 flex-1 truncate text-[13px]">
                  {profile.home_label ?? <span className="text-muted-foreground">Not set</span>}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0"
                  onClick={() => setHomeOpen(true)}
                >
                  Change
                </Button>
              </div>
            </Field>
          </div>
        </Panel>

        <Panel
          title="Google Calendar"
          aside={
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                connected ? "bg-done-soft text-done" : "bg-muted text-muted-foreground",
              )}
            >
              {connected ? "Connected" : "Not connected"}
            </span>
          }
        >
          <div>
            <Field label="Public iCal URL">
              <Input
                className="h-10"
                placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={calDraft}
                onChange={(e) => setCalDraft(e.target.value)}
              />
            </Field>
          </div>
        </Panel>

        <Panel title="Notifications">
          <PushDeviceToggle />
        </Panel>

      </div>

      {/* Mobile: logout lives here since the bottom tab bar has no room for it. */}
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
        className="press mt-4 w-full rounded-[18px] border border-border py-3.5 text-[15px] font-medium text-destructive glass lg:hidden"
      >
        Log out
      </button>
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
