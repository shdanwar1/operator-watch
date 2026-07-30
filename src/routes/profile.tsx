import { createFileRoute, redirect, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getGateStatus, signOutUser } from "@/lib/gate.functions";
import {
  updateMyProfile,
  setMyHomeAddress,
  getMyOperatorProfile,
  type OperatorProfile,
} from "@/lib/operators.functions";
import { getMyCalendarUrl, setMyCalendarUrl } from "@/lib/gcal.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast, Toaster } from "sonner";
import { ArrowLeft, Save, Home, MapPin, KeyRound, User, CalendarDays, LogOut } from "lucide-react";
import { USERNAME_RE, PIN_RE } from "@/lib/validation";

export const Route = createFileRoute("/profile")({
  beforeLoad: async () => {
    const status = await getGateStatus();
    if (!status.unlocked) throw redirect({ to: "/unlock" });
    if (status.isAdmin) throw redirect({ to: "/admin" });
  },
  loader: async (): Promise<{ profile: OperatorProfile; icsUrl: string | null }> => {
    const [profile, calRes] = await Promise.all([
      getMyOperatorProfile(),
      getMyCalendarUrl().catch(() => ({ icsUrl: null as string | null })),
    ]);
    return { profile, icsUrl: calRes.icsUrl };
  },
  head: () => ({
    meta: [
      { title: "Operator profile — Studio Operator" },
      {
        name: "description",
        content: "Edit your username, PIN, home address, and Google Calendar URL.",
      },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { profile: initialProfile, icsUrl: initialIcs } = Route.useLoaderData();
  const router = useRouter();
  const saveProfile = useServerFn(updateMyProfile);
  const saveHome = useServerFn(setMyHomeAddress);
  const saveCal = useServerFn(setMyCalendarUrl);
  const signOut = useServerFn(signOutUser);
  const reloadProfile = useServerFn(getMyOperatorProfile);

  const [profile, setProfile] = useState<OperatorProfile>(initialProfile);
  const [icsUrl, setIcsUrl] = useState<string | null>(initialIcs);

  const [username, setUsername] = useState(profile.username);
  const [pin, setPin] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const [calDraft, setCalDraft] = useState(icsUrl ?? "");

  const [savingCore, setSavingCore] = useState(false);
  const [savingHome, setSavingHome] = useState(false);
  const [savingCal, setSavingCal] = useState(false);

  function usernameChanged() {
    const t = username.trim();
    return t && t !== profile.username;
  }

  async function saveCore() {
    // Client-side validation with friendly messages.
    if (usernameChanged() && !USERNAME_RE.test(username.trim())) {
      return toast.error("Username must be 2–32 letters, numbers, . _ or -");
    }
    if (pin && !PIN_RE.test(pin)) {
      return toast.error("PIN must contain exactly 4 digits");
    }
    if (!usernameChanged() && !pin) {
      return toast.error("Nothing to save");
    }

    setSavingCore(true);
    try {
      const res = await saveProfile({
        data: {
          username: usernameChanged() ? username.trim() : undefined,
          pin: pin || undefined,
        },
      });
      toast.success("Profile updated");
      setPin("");
      const fresh = await reloadProfile();
      setProfile(fresh);
      setUsername(fresh.username);
      // If the username changed, refresh the router so the header greeting updates.
      if (res.username !== initialProfile.username) {
        await router.invalidate();
      }
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSavingCore(false);
    }
  }

  async function saveHomeAddress() {
    if (!mapsUrl.trim()) return toast.error("Paste a Google Maps link");
    setSavingHome(true);
    try {
      const res = await saveHome({ data: { maps_url: mapsUrl.trim() } });
      toast.success(`Home saved: ${res.label}`);
      setProfile({ ...profile, home_label: res.label, home_lat: res.lat, home_lng: res.lng });
      setMapsUrl("");
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSavingHome(false);
    }
  }

  async function saveCalendar() {
    setSavingCal(true);
    try {
      const res = await saveCal({ data: { url: calDraft } });
      setIcsUrl(res.icsUrl);
      setProfile({ ...profile, calendar_ics_url: res.icsUrl });
      toast.success(res.icsUrl ? "Calendar link updated" : "Calendar link removed");
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSavingCal(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    await router.navigate({ to: "/unlock" });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster richColors position="top-center" />
      <div className="mx-auto max-w-lg px-4 py-8 sm:py-12">
        <header className="mb-6 flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">
              <ArrowLeft className="mr-1 h-4 w-4" /> Home
            </Link>
          </Button>
          <div className="ml-auto">
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="mr-1 h-4 w-4" /> Sign out
            </Button>
          </div>
        </header>

        <Card>
          <CardContent className="space-y-6 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <User className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-lg font-semibold tracking-tight">
                  Editing {profile.username}
                </h1>
                <p className="text-xs text-muted-foreground">
                  Changes save immediately across the app.
                </p>
              </div>
            </div>

            {/* Username + PIN (grouped save) */}
            <section className="space-y-4">
              <div className="space-y-2">
                <Label>Username</Label>
                <Input
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Capitalization is preserved (e.g. <span className="font-medium">Shad</span>).
                </p>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5" /> PIN
                </Label>
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="Leave blank to keep current"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D+/g, ""))}
                  autoComplete="new-password"
                />
                <p className="text-[11px] text-muted-foreground">Exactly 4 digits.</p>
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={saveCore}
                disabled={savingCore}
              >
                <Save className="mr-2 h-4 w-4" />
                {savingCore ? "Saving…" : "Save changes"}
              </Button>
            </section>

            {/* Home address */}
            <section className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-4">
              <div className="flex items-center gap-2">
                <Home className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Home address</Label>
              </div>
              {profile.home_label ? (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{profile.home_label}</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Not set yet. Used to estimate your time to leave for the studio.
                </p>
              )}
              <Input
                placeholder="https://maps.app.goo.gl/..."
                value={mapsUrl}
                onChange={(e) => setMapsUrl(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
              />
              <p className="text-[11px] text-muted-foreground">
                Open your home in Google Maps → Share → Copy link, then paste it here.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={saveHomeAddress}
                disabled={savingHome}
              >
                <MapPin className="mr-2 h-4 w-4" />
                {savingHome
                  ? "Saving…"
                  : profile.home_label
                    ? "Update home address"
                    : "Save home address"}
              </Button>
            </section>

            {/* Google Calendar */}
            <section className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-4">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Google Calendar URL</Label>
              </div>
              <Input
                placeholder="https://calendar.google.com/calendar/..."
                value={calDraft}
                onChange={(e) => setCalDraft(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
              />
              <p className="text-[11px] text-muted-foreground">
                Used to sync your classes into shifts and calculate travel time.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={saveCalendar}
                disabled={savingCal}
              >
                <Save className="mr-2 h-4 w-4" />
                {savingCal ? "Saving…" : icsUrl ? "Update calendar link" : "Save calendar link"}
              </Button>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
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
