import { createFileRoute, useRouter, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  getGateStatus,
  unlockSite,
  listOperatorProfiles,
  signInWithPin,
  lockSite,
} from "@/lib/gate.functions";
import { getMyProfileStatus } from "@/lib/profile.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ThemeToggle } from "@/components/ThemeToggle";
import { toast, Toaster } from "sonner";
import {
  Lock,
  Radio,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  Delete,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";

type Profile = { id: string; username: string; is_admin: boolean };

export const Route = createFileRoute("/unlock")({
  beforeLoad: async () => {
    const status = await getGateStatus();
    if (status.unlocked) {
      throw redirect({ to: status.isAdmin ? "/admin/timetable" : "/" });
    }
    return { status };
  },
  loader: async () => {
    const status = await getGateStatus();
    let profiles: Profile[] = [];
    if (status.siteUnlocked) {
      try {
        profiles = await listOperatorProfiles();
      } catch {
        profiles = [];
      }
    }
    return { siteUnlocked: status.siteUnlocked, profiles };
  },
  component: Unlock,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive">{error.message}</div>
  ),
});

// Deterministic avatar accent per profile
const AVATAR_COLORS = [
  "from-indigo-500 to-violet-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-sky-500 to-blue-500",
  "from-pink-500 to-rose-500",
  "from-fuchsia-500 to-purple-500",
];
function avatarClass(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name: string) {
  return name.trim().slice(0, 1).toUpperCase();
}
function displayName(p: Profile) {
  return p.is_admin ? "Administrator" : p.username;
}
function roleLabel(p: Profile) {
  return p.is_admin ? "Studio Administrator" : "Studio Operator";
}

function Unlock() {
  const router = useRouter();
  const { siteUnlocked, profiles: initialProfiles } = Route.useLoaderData();

  const unlock = useServerFn(unlockSite);
  const listFn = useServerFn(listOperatorProfiles);
  const signIn = useServerFn(signInWithPin);

  const [stage, setStage] = useState<"site" | "select" | "pin">(
    siteUnlocked ? "select" : "site",
  );
  const [profiles, setProfiles] = useState<Profile[]>(initialProfiles);
  const [selected, setSelected] = useState<Profile | null>(null);

  const [sitePw, setSitePw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [siteErr, setSiteErr] = useState(false);
  const [siteLoading, setSiteLoading] = useState(false);

  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);

  async function refreshProfiles() {
    try {
      const list = await listFn();
      setProfiles(list);
    } catch {
      /* ignore */
    }
  }

  async function onUnlockSite(e: React.FormEvent) {
    e.preventDefault();
    setSiteLoading(true);
    setSiteErr(false);
    try {
      const res = await unlock({ data: { password: sitePw } });
      if (res.ok) {
        setSitePw("");
        setStage("select");
        await refreshProfiles();
      } else {
        setSiteErr(true);
      }
    } finally {
      setSiteLoading(false);
    }
  }

  function pickProfile(p: Profile) {
    setSelected(p);
    setPin("");
    setPinErr(false);
    setStage("pin");
  }

  async function submitPin(value: string) {
    if (!selected) return;
    setPinLoading(true);
    setPinErr(false);
    try {
      const res = await signIn({
        data: { username: selected.username, pin: value },
      });
      if (res.ok) {
        if (res.isAdmin) {
          await router.navigate({ to: "/admin/timetable" });
        } else {
          try {
            const status = await getMyProfileStatus();
            await router.navigate({
              to: status.complete ? "/" : "/complete-profile",
            });
          } catch {
            await router.navigate({ to: "/" });
          }
        }
      } else {
        setPinErr(true);
        setPin("");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
      setPin("");
    } finally {
      setPinLoading(false);
    }
  }

  // Auto-submit at 4 digits
  useEffect(() => {
    if (stage === "pin" && pin.length === 4 && !pinLoading) {
      submitPin(pin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, stage]);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4 py-10">
      <Toaster richColors position="top-center" />
      <div className="fixed right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">
        {stage === "site" && (
          <SiteStage
            value={sitePw}
            setValue={setSitePw}
            show={showPw}
            toggleShow={() => setShowPw((v) => !v)}
            error={siteErr}
            loading={siteLoading}
            onSubmit={onUnlockSite}
          />
        )}
        {stage === "select" && (
          <SelectStage
            profiles={profiles}
            onPick={pickProfile}
            onLock={async () => {
              await lockSite();
              setStage("site");
              setProfiles([]);
              setSelected(null);
              setPin("");
              setSitePw("");
              toast.success("Studio locked");
            }}
          />
        )}
        {stage === "pin" && selected && (
          <PinStage
            profile={selected}
            pin={pin}
            setPin={setPin}
            loading={pinLoading}
            error={pinErr}
            onBack={() => {
              setStage("select");
              setSelected(null);
              setPin("");
              setPinErr(false);
            }}
            onSubmit={() => submitPin(pin)}
          />
        )}
      </div>
    </div>
  );
}

/* ---------- Stage 1 — Unlock Studio ---------- */

function SiteStage(props: {
  value: string;
  setValue: (v: string) => void;
  show: boolean;
  toggleShow: () => void;
  error: boolean;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur-xl p-8 shadow-2xl animate-in fade-in-0 zoom-in-95 duration-300">
      <div className="flex flex-col items-center text-center">
        <div className="relative mb-5">
          <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl" />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-primary/40 bg-black/50">
            <Lock className="h-8 w-8 text-primary" />
          </div>
        </div>
        <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Radio className="h-3.5 w-3.5" />
          DANCE MASTERCLASS
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Unlock Studio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {" "}
        </p>
      </div>

      <form onSubmit={props.onSubmit} className="mt-8 space-y-4">
        <div className="space-y-2">
          <label className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Site Password
          </label>
          <div className="relative">
            <Input
              type={props.show ? "text" : "password"}
              value={props.value}
              onChange={(e) => props.setValue(e.target.value)}
              autoFocus
              autoComplete="current-password"
              className="h-12 pr-11 text-base"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={props.toggleShow}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-2"
              tabIndex={-1}
              aria-label={props.show ? "Hide password" : "Show password"}
            >
              {props.show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {props.error && (
            <p className="text-sm text-destructive">Incorrect site password.</p>
          )}
        </div>
        <Button
          type="submit"
          size="lg"
          className="w-full h-12 text-base"
          disabled={props.loading || !props.value}
        >
          {props.loading ? "Unlocking…" : "Unlock"}
        </Button>
      </form>

    </Card>
  );
}

/* ---------- Stage 2 — Select User ---------- */

function SelectStage({
  profiles,
  onPick,
  onLock,
}: {
  profiles: Profile[];
  onPick: (p: Profile) => void;
  onLock: () => void | Promise<void>;
}) {
  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur-xl p-6 shadow-2xl animate-in fade-in-0 zoom-in-95 duration-300">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Select User</h1>
      </div>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
        {profiles.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-6">
            No profiles available.
          </p>
        )}
        {profiles.map((p) => (
          <button
            key={p.id}
            onClick={() => onPick(p)}
            className="group flex w-full items-center gap-4 rounded-xl border border-border/60 bg-background/40 p-3.5 text-left transition-all hover:border-primary/60 hover:bg-background/70 hover:scale-[1.01] active:scale-[0.99]"
          >
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white text-lg font-semibold ${avatarClass(p.username)}`}
            >
              {initials(displayName(p))}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{displayName(p)}</div>
              <div className="text-xs text-muted-foreground">{roleLabel(p)}</div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition" />
          </button>
        ))}
      </div>
      <div className="mt-5 flex flex-col items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void onLock()}
          className="gap-1.5"
        >
          <Lock className="h-3.5 w-3.5" />
          Lock studio
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          Locking requires the site password to re-enter.
        </p>
      </div>
    </Card>
  );
}

/* ---------- Stage 3 — Enter PIN ---------- */

function PinStage(props: {
  profile: Profile;
  pin: string;
  setPin: (v: string) => void;
  loading: boolean;
  error: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const { profile, pin, setPin, loading, error, onBack, onSubmit } = props;

  function press(d: string) {
    if (loading) return;
    if (pin.length >= 4) return;
    props.setPin(pin + d);
  }
  function backspace() {
    if (loading) return;
    setPin(pin.slice(0, -1));
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") backspace();
      else if (e.key === "Enter" && pin.length === 4) onSubmit();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, loading]);

  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur-xl p-6 shadow-2xl animate-in fade-in-0 zoom-in-95 duration-300">
      <div className="flex items-center justify-between mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-muted-foreground -ml-2"
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="text-xs text-muted-foreground">Enter PIN</div>
        <div className="w-14" />
      </div>

      <div className="flex flex-col items-center text-center">
        <div
          className={`mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br text-white text-3xl font-semibold shadow-lg ${avatarClass(profile.username)}`}
        >
          {initials(displayName(profile))}
        </div>
        <h2 className="text-xl font-semibold tracking-tight">
          {displayName(profile)}
        </h2>
        <p className="text-sm text-muted-foreground">{roleLabel(profile)}</p>
      </div>

      <div className="mt-6 flex justify-center gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-3.5 w-3.5 rounded-full border transition-all ${
              i < pin.length
                ? "bg-primary border-primary scale-110"
                : "border-muted-foreground/40"
            } ${error ? "border-destructive" : ""}`}
          />
        ))}
      </div>
      {error && (
        <p className="mt-3 text-center text-sm text-destructive">
          Incorrect PIN. Try again.
        </p>
      )}

      <div className="mx-auto mt-6 grid max-w-[260px] grid-cols-3 gap-2.5">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <PinKey key={d} onClick={() => press(d)} disabled={loading}>
            {d}
          </PinKey>
        ))}
        <PinKey onClick={backspace} disabled={loading} aria-label="Delete">
          <Delete className="h-5 w-5" />
        </PinKey>
        <PinKey onClick={() => press("0")} disabled={loading}>
          0
        </PinKey>
        <div />
      </div>
    </Card>
  );
}

function PinKey({
  children,
  onClick,
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-14 items-center justify-center rounded-full border border-border/60 bg-background/40 text-xl font-medium transition-all hover:border-primary/60 hover:bg-background/70 active:scale-95 disabled:opacity-50"
      {...rest}
    >
      {children}
    </button>
  );
}

// helper to satisfy `UserIcon` import used only for defensive typing
void UserIcon;
