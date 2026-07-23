import { createFileRoute, redirect, useRouter, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getGateStatus } from "@/lib/gate.functions";
import {
  getMyProfileStatus,
  completeMyProfile,
  type MyProfileStatus,
} from "@/lib/profile.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { toast, Toaster } from "sonner";
import { Home, CalendarDays, Info, Save, ArrowRight, ShieldCheck, User, KeyRound } from "lucide-react";

export const Route = createFileRoute("/complete-profile")({
  beforeLoad: async () => {
    const status = await getGateStatus();
    if (!status.unlocked) throw redirect({ to: "/unlock" });
    if (status.isAdmin) throw redirect({ to: "/admin" });
  },
  loader: async (): Promise<{ profile: MyProfileStatus }> => {
    const profile = await getMyProfileStatus();
    return { profile };
  },
  head: () => ({
    meta: [
      { title: "Complete your profile — Studio Operator" },
      {
        name: "description",
        content:
          "Finish setting up your operator profile to enable travel time, check-in, and calendar availability.",
      },
    ],
  }),
  component: CompleteProfile,
});

function CompleteProfile() {
  const { profile: initial } = Route.useLoaderData();
  const router = useRouter();
  const saveFn = useServerFn(completeMyProfile);
  const refetch = useServerFn(getMyProfileStatus);

  const [profile, setProfile] = useState<MyProfileStatus>(initial);
  const [mapsUrl, setMapsUrl] = useState("");
  const [calUrl, setCalUrl] = useState("");
  const [magic, setMagic] = useState("");
  const [saving, setSaving] = useState(false);

  const needsHome = profile.missing.includes("home");
  const needsCal = profile.missing.includes("calendar");
  const needsMagic = profile.missing.includes("magic");
  const allDone = profile.complete;

  async function save() {
    if (needsHome && !mapsUrl.trim()) return toast.error("Add your home address");
    if (needsCal && !calUrl.trim()) return toast.error("Add your Google Calendar URL");
    if (needsMagic && !magic.trim()) return toast.error("Set your magic word");
    setSaving(true);
    try {
      await saveFn({
        data: {
          maps_url: needsHome ? mapsUrl.trim() : undefined,
          calendar_ics_url: needsCal ? calUrl.trim() : undefined,
          magic_word: needsMagic ? magic.trim() : undefined,
        },
      });
      const fresh = await refetch();
      setProfile(fresh);
      setMapsUrl("");
      setCalUrl("");
      setMagic("");
      toast.success("Profile updated");
      if (fresh.complete) await router.navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function skip() {
    await router.navigate({ to: "/" });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster richColors position="top-center" />
      <div className="mx-auto flex min-h-screen max-w-lg items-center justify-center px-4 py-10">
        <Card className="w-full border-border/60 shadow-xl">
          <CardContent className="space-y-6 p-6 sm:p-8">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <User className="h-6 w-6" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {allDone ? "You're all set" : "Complete your profile"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {allDone
                  ? "Your profile is complete. Head to the dashboard."
                  : "We need a few details to unlock travel time, check-in, and calendar features."}
              </p>
            </div>

            {!allDone && (
              <div className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  You can skip for now and continue with limited access. You'll be
                  reminded on your dashboard.
                </div>
              </div>
            )}

            {needsHome && (
              <div className="space-y-2 rounded-xl border border-border/60 p-4">
                <div className="flex items-center gap-2">
                  <Home className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-medium">
                    Home address <span className="text-destructive">*</span>
                  </h2>
                </div>
                <p className="text-xs text-muted-foreground">
                  Used to calculate your travel time to the studio so we can tell you exactly
                  when to leave for every shift.
                </p>
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
              </div>
            )}

            {needsCal && (
              <div className="space-y-2 rounded-xl border border-border/60 p-4">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-medium">
                    Google Calendar URL <span className="text-destructive">*</span>
                  </h2>
                </div>
                <p className="text-xs text-muted-foreground">
                  Used to show your Time to Leave, prevent shift conflicts, and enable Check In
                  when you're available.
                </p>
                <Input
                  placeholder="https://calendar.google.com/calendar/..."
                  value={calUrl}
                  onChange={(e) => setCalUrl(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
            )}

            {needsMagic && (
              <div className="space-y-2 rounded-xl border border-border/60 p-4">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-medium">
                    Magic word <span className="text-destructive">*</span>
                  </h2>
                </div>
                <p className="text-xs text-muted-foreground">
                  Used to confirm your identity when checking in for a shift. Choose
                  something only you would know.
                </p>
                <Input
                  type="password"
                  placeholder="Your secret magic word"
                  value={magic}
                  onChange={(e) => setMagic(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="new-password"
                />
              </div>
            )}

            {!needsHome && profile.home_label && (
              <CompletedRow
                icon={<Home className="h-4 w-4" />}
                title="Home address"
                value={profile.home_label}
              />
            )}
            {!needsCal && profile.calendar_ics_url && (
              <CompletedRow
                icon={<CalendarDays className="h-4 w-4" />}
                title="Google Calendar"
                value="Connected"
              />
            {!needsMagic && profile.has_magic_word && (
              <CompletedRow
                icon={<KeyRound className="h-4 w-4" />}
                title="Magic word"
                value="Set"
              />
            )}


            <div className="space-y-2 pt-2">
              {!allDone ? (
                <>
                  <Button
                    size="lg"
                    className="h-12 w-full text-base"
                    onClick={save}
                    disabled={saving}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? "Saving…" : "Finish Setup"}
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full text-muted-foreground"
                    onClick={skip}
                    disabled={saving}
                  >
                    Skip for now
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <Button size="lg" className="h-12 w-full text-base" asChild>
                  <Link to="/">Go to dashboard</Link>
                </Button>
              )}
            </div>

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" />
              Your information is stored securely and only used to power studio features.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CompletedRow({
  icon,
  title,
  value,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">
      <div className="text-emerald-500">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="truncate">{value}</div>
      </div>
      <div className="text-[11px] font-medium text-emerald-500">Done</div>
    </div>
  );
}
