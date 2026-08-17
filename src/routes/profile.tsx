import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import { getGateStatus, signOutUser } from "@/lib/gate.functions";
import { clearAllCaches } from "@/lib/local-cache";
import {
  updateMyProfile,
  setMyHomeAddress,
  getMyOperatorProfile,
  type OperatorProfile,
} from "@/lib/operators.functions";
import { getMyCalendarUrl, setMyCalendarUrl } from "@/lib/gcal.functions";
import { getMyPrefs, setMyPrefs, type OperatorPrefs } from "@/lib/prefs.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
    prefs: OperatorPrefs;
  }> => {
    const [profile, calRes, prefs] = await Promise.all([
      getMyOperatorProfile(),
      getMyCalendarUrl().catch(() => ({ icsUrl: null as string | null })),
      getMyPrefs(),
    ]);
    return { profile, icsUrl: calRes.icsUrl, prefs };
  },
  head: () => ({
    meta: [
      { title: "Profile — DMC Studio Operator" },
      {
        name: "description",
        content:
          "Manage your operator account, Google Calendar sync, notifications and dashboard preferences.",
      },
      { property: "og:title", content: "Profile — DMC Studio Operator" },
      {
        property: "og:description",
        content: "Operator account, calendar sync and notification settings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
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

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  last,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 py-3",
        !last && "border-b border-border",
      )}
    >
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ProfilePage() {
  const router = useRouter();
  const signOut = useServerFn(signOutUser);

  const {
    profile: initialProfile,
    icsUrl: initialIcs,
    prefs: initialPrefs,
  } = Route.useLoaderData();

  const saveProfileFn = useServerFn(updateMyProfile);
  const saveHomeFn = useServerFn(setMyHomeAddress);
  const saveCalFn = useServerFn(setMyCalendarUrl);
  const savePrefsFn = useServerFn(setMyPrefs);
  const reloadProfile = useServerFn(getMyOperatorProfile);

  const [profile, setProfile] = useState<OperatorProfile>(initialProfile);
  const [icsUrl, setIcsUrl] = useState<string | null>(initialIcs);
  const [prefs, setPrefs] = useState<OperatorPrefs>(initialPrefs);

  const [username, setUsername] = useState(profile.username);
  const [pin, setPin] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const [calDraft, setCalDraft] = useState(icsUrl ?? "");
  const [saving, setSaving] = useState(false);

  const setPref = (patch: Partial<OperatorPrefs>) => setPrefs((p) => ({ ...p, ...patch }));

  async function saveAll() {
    const nameChanged = username.trim() !== "" && username.trim() !== profile.username;
    if (nameChanged && !USERNAME_RE.test(username.trim())) {
      return toast.error("Username must be 2–32 letters, numbers, . _ or -");
    }
    if (pin && !PIN_RE.test(pin)) {
      return toast.error("PIN must contain exactly 4 digits");
    }

    setSaving(true);
    try {
      if (nameChanged || pin) {
        await saveProfileFn({
          data: { username: nameChanged ? username.trim() : undefined, pin: pin || undefined },
        });
        setPin("");
      }

      if (mapsUrl.trim()) {
        const res = await saveHomeFn({ data: { maps_url: mapsUrl.trim() } });
        setProfile((p) => ({ ...p, home_label: res.label, home_lat: res.lat, home_lng: res.lng }));
        setMapsUrl("");
      }

      if (calDraft.trim() !== (icsUrl ?? "")) {
        const res = await saveCalFn({ data: { url: calDraft } });
        setIcsUrl(res.icsUrl);
        setCalDraft(res.icsUrl ?? "");
      }

      await savePrefsFn({ data: prefs });

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
              <Input
                className="h-10"
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="••••"
                autoComplete="new-password"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D+/g, ""))}
              />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Home address">
              <Input
                className="h-10"
                placeholder="Paste a Google Maps link…"
                autoCapitalize="none"
                autoCorrect="off"
                value={mapsUrl}
                onChange={(e) => setMapsUrl(e.target.value)}
              />
            </Field>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {profile.home_label
                ? `Current: ${profile.home_label}`
                : "Not set — used to estimate your time to leave."}
            </p>
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
          <ToggleRow
            label="Automatic sync"
            checked={prefs.autoSync}
            onChange={(v) => setPref({ autoSync: v })}
          />
          <ToggleRow
            label="Next month"
            checked={prefs.syncNextMonth}
            onChange={(v) => setPref({ syncNextMonth: v })}
            last
          />
          <div className="mt-3">
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
          <ToggleRow
            label="Time to leave"
            checked={prefs.notifyTimeToLeave}
            onChange={(v) => setPref({ notifyTimeToLeave: v })}
          />
          <ToggleRow
            label="Shift start"
            checked={prefs.notifyShiftStart}
            onChange={(v) => setPref({ notifyShiftStart: v })}
          />
          <PushDeviceToggle />
        </Panel>

        <Panel title="Dashboard settings">
          <ToggleRow
            label="Time to leave card"
            checked={prefs.showTimeToLeave}
            onChange={(v) => setPref({ showTimeToLeave: v })}
            last
          />
        </Panel>
      </div>

      {/* Mobile: logout lives here since the bottom tab bar has no room for it. */}
      <button
        type="button"
        onClick={async () => {
          clearAllCaches();
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
