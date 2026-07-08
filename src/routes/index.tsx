import { createFileRoute, redirect, useRouter, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { getGateStatus, lockSite } from "@/lib/gate.functions";
import {
  listShifts,
  listScheduledShifts,
  createShift,
  updateShift as updateShiftFn,
  type ShiftRow,
  type ScheduledShiftRow,
} from "@/lib/shifts.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast, Toaster } from "sonner";
import { Radio, LogOut, Plus, X, Clock, ListChecks, LogIn } from "lucide-react";
import { Hourglass, hourglassStateFor } from "@/components/Hourglass";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { unlocked } = await getGateStatus();
    if (!unlocked) throw redirect({ to: "/unlock" });
  },
  loader: async () => {
    const { username } = await getGateStatus();
    return { username };
  },
  component: Index,
});

export type ShiftClass = { class: string; teacher: string };

type Shift = ShiftRow;
type ScheduledShift = ScheduledShiftRow;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const OPERATOR_KEY = "lss_operator_name";

function fmtTime(t: string) {
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

function formatDuration(startISO: string, endISO: string | null) {
  const end = endISO ? new Date(endISO).getTime() : Date.now();
  const ms = Math.max(0, end - new Date(startISO).getTime());
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return {
    h,
    m,
    s,
    label: `${h}h ${m.toString().padStart(2, "0")}m`,
    long: `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`,
  };
}

function dateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function overrideDates(all: { specific_date: string | null }[]) {
  return new Set(all.map((s) => s.specific_date).filter((v): v is string => !!v));
}

// True if this scheduled shift applies to the given calendar date.
function shiftAppliesOn(
  s: { day_of_week: number; specific_date: string | null },
  day: Date,
  overrides: Set<string>,
) {
  if (s.specific_date) return s.specific_date === dateKey(day);
  return day.getDay() === s.day_of_week && !overrides.has(dateKey(day));
}

// Determines whether a scheduled shift can be started now.
// Only from 45 minutes before start until the shift's end.
// Checks yesterday/today/tomorrow instances so late-night shifts crossing
// midnight boundaries still open correctly.
export function scheduledWindow(
  s: { day_of_week: number; start_time: string; end_time: string; specific_date: string | null },
  all: { day_of_week: number; specific_date: string | null }[],
  now = new Date(),
) {
  const [sh, sm] = s.start_time.split(":").map((n) => parseInt(n, 10));
  const [eh, em] = s.end_time.split(":").map((n) => parseInt(n, 10));
  const overrides = overrideDates(all);

  let nearestFutureOpen: Date | null = null;
  for (let offset = -1; offset <= 1; offset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + offset);
    if (!shiftAppliesOn(s, day, overrides)) continue;
    const start = new Date(day);
    start.setHours(sh, sm, 0, 0);
    const end = new Date(day);
    end.setHours(eh, em, 0, 0);
    const openAt = new Date(start.getTime() - 45 * 60 * 1000);
    if (now >= openAt && now <= end) {
      return { canStart: true, reason: "" };
    }
    if (openAt > now && (!nearestFutureOpen || openAt < nearestFutureOpen)) {
      nearestFutureOpen = openAt;
    }
  }

  if (nearestFutureOpen) {
    const mins = Math.round((nearestFutureOpen.getTime() - now.getTime()) / 60000);
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    const wait = hrs > 0 ? `${hrs}h ${rem}m` : `${mins}m`;
    return { canStart: false, reason: `Opens in ${wait}` };
  }
  return { canStart: false, reason: `Only on ${DAY_NAMES[s.day_of_week]}` };
}

function Index() {
  const { username } = Route.useLoaderData();
  const router = useRouter();
  const signOut = useServerFn(lockSite);
  const fetchShifts = useServerFn(listShifts);
  const fetchScheduled = useServerFn(listScheduledShifts);
  const createShiftFn = useServerFn(createShift);
  const updateShiftServer = useServerFn(updateShiftFn);

  const [operatorName, setOperatorName] = useState("");
  const [active, setActive] = useState<Shift | null>(null);
  const [history, setHistory] = useState<Shift[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(OPERATOR_KEY) : null;
    if (saved) setOperatorName(saved);
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [rows, sched] = await Promise.all([fetchShifts(), fetchScheduled()]);
      setActive(rows.find((r) => !r.check_out_at) ?? null);
      setHistory(rows.filter((r) => r.check_out_at));
      setScheduled(sched);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    await router.navigate({ to: "/unlock" });
  }

  // NOTE: not memoized — the parent re-renders every second (setTick),
  // so this recomputes and the check-in window actually opens live.
  const now = new Date();
  const openScheduled =
    scheduled
      .filter((s) => scheduledWindow(s, scheduled, now).canStart)
      .sort((a, b) => a.start_time.localeCompare(b.start_time))[0] ?? null;

  async function checkIn() {
    const name = operatorName.trim();
    if (!name) return toast.error("Enter your name first");
    localStorage.setItem(OPERATOR_KEY, name);
    setCheckingIn(true);
    try {
      const row = await createShiftFn({
        data: { operator_name: name, scheduled_shift_id: openScheduled?.id ?? null },
      });
      setActive(row);
      toast.success(`Checked in — welcome, ${name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check-in failed");
    } finally {
      setCheckingIn(false);
    }
  }

  async function updateActive(patch: Partial<Shift>) {
    if (!active) return;
    const optimistic = { ...active, ...patch } as Shift;
    setActive(optimistic);
    try {
      await updateShiftServer({ data: { id: active.id, patch } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
      load();
    }
  }

  function addClassRow() {
    if (!active) return;
    updateActive({ classes: [...(active.classes ?? []), { class: "", teacher: "" }] });
  }
  function updateClassRow(idx: number, patch: Partial<ShiftClass>) {
    if (!active) return;
    updateActive({
      classes: active.classes.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    });
  }
  function removeClassRow(idx: number) {
    if (!active) return;
    updateActive({ classes: active.classes.filter((_, i) => i !== idx) });
  }

  async function checkOut() {
    if (!active) return;
    setCheckingOut(true);
    try {
      await updateShiftServer({
        data: { id: active.id, patch: { check_out_at: new Date().toISOString() } },
      });
      toast.success("Checked out");
      setActive(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check-out failed");
    } finally {
      setCheckingOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster richColors position="top-center" />
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-10">
        <header className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 sm:mb-10">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground sm:h-11 sm:w-11">
            <Radio className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight sm:text-2xl">Studio Operator</h1>
            <p className="text-xs text-muted-foreground sm:text-sm">Live stream shift tracker</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            {active && (
              <Badge className="animate-pulse px-2 py-0.5 text-[10px] sm:text-xs" variant="destructive">
                ● ON AIR
              </Badge>
            )}
            {username && (
              <span className="hidden text-xs text-muted-foreground sm:inline">{username}</span>
            )}
            <Button variant="outline" size="sm" className="h-8 px-2 sm:h-9 sm:px-3" asChild>
              <Link to="/shifts">
                <ListChecks className="h-3.5 w-3.5 sm:mr-1" />
                <span className="hidden sm:inline">Shifts</span>
              </Link>
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-2 sm:h-9 sm:px-3" onClick={handleSignOut}>
              <LogOut className="h-3.5 w-3.5 sm:mr-1" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </header>

        <div className="grid gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : active ? (
              <ActiveShiftPanel
                shift={active}
                onCheckOut={checkOut}
                onAddClass={addClassRow}
                onUpdateClass={updateClassRow}
                onRemoveClass={removeClassRow}
                checkingOut={checkingOut}
              />
            ) : (
              <CheckInPanel
                operatorName={operatorName}
                setOperatorName={setOperatorName}
                openScheduled={openScheduled}
                scheduled={scheduled}
                onCheckIn={checkIn}
                checkingIn={checkingIn}
              />
            )}

            {!active && history.length > 0 && (
              <section className="mt-8 sm:mt-12">
                <div className="mb-3 flex items-center justify-between sm:mb-4">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Last 30 days
                  </h2>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to="/shifts">View all</Link>
                  </Button>
                </div>
                <MonthlySummary shifts={history} />
              </section>
            )}
          </div>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            {!loading && <UpcomingShifts scheduled={scheduled} now={now} />}
          </aside>
        </div>
      </div>
    </div>
  );
}

function UpcomingShifts({ scheduled, now }: { scheduled: ScheduledShift[]; now: Date }) {
  const instances = upcomingInstances(scheduled, now, 6);
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Upcoming shifts
          </h2>
        </div>
        {instances.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming shifts scheduled.</p>
        ) : (
          <ul className="space-y-3">
            {instances.map(({ shift, startAt, endAt }, i) => {
              const isToday = startAt.toDateString() === now.toDateString();
              const tomorrow = new Date(now);
              tomorrow.setDate(tomorrow.getDate() + 1);
              const isTomorrow = startAt.toDateString() === tomorrow.toDateString();
              const dayLabel = isToday
                ? "Today"
                : isTomorrow
                  ? "Tomorrow"
                  : startAt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
              return (
                <li
                  key={`${shift.id}-${i}`}
                  className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{dayLabel}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}
                    </div>
                    {shift.label && (
                      <div className="mt-0.5 truncate text-xs text-muted-foreground/80">
                        {shift.label}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function upcomingInstances(
  scheduled: ScheduledShift[],
  now: Date,
  limit: number,
): { shift: ScheduledShift; startAt: Date; endAt: Date }[] {
  const overrides = overrideDates(scheduled);
  const out: { shift: ScheduledShift; startAt: Date; endAt: Date }[] = [];
  for (let offset = 0; offset < 21 && out.length < limit * 3; offset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + offset);
    for (const s of scheduled) {
      if (!shiftAppliesOn(s, day, overrides)) continue;
      const [sh, sm] = s.start_time.split(":").map((n) => parseInt(n, 10));
      const [eh, em] = s.end_time.split(":").map((n) => parseInt(n, 10));
      const startAt = new Date(day);
      startAt.setHours(sh, sm, 0, 0);
      const endAt = new Date(day);
      endAt.setHours(eh, em, 0, 0);
      if (endAt.getTime() <= now.getTime()) continue;
      out.push({ shift: s, startAt, endAt });
    }
  }
  return out.sort((a, b) => a.startAt.getTime() - b.startAt.getTime()).slice(0, limit);
}

function nextShiftInstance(
  scheduled: ScheduledShift[],
  now: Date,
): { shift: ScheduledShift; startAt: Date } | null {
  const overrides = overrideDates(scheduled);
  let best: { shift: ScheduledShift; startAt: Date } | null = null;
  for (const s of scheduled) {
    const [sh, sm] = s.start_time.split(":").map((n) => parseInt(n, 10));
    for (let offset = 0; offset < 21; offset++) {
      const d = new Date(now);
      d.setDate(d.getDate() + offset);
      if (!shiftAppliesOn(s, d, overrides)) continue;
      d.setHours(sh, sm, 0, 0);
      if (d.getTime() <= now.getTime()) continue;
      if (!best || d.getTime() < best.startAt.getTime()) {
        best = { shift: s, startAt: d };
      }
      break;
    }
  }
  return best;
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

function CheckInPanel({
  operatorName,
  setOperatorName,
  openScheduled,
  scheduled,
  onCheckIn,
  checkingIn,
}: {
  operatorName: string;
  setOperatorName: (v: string) => void;
  openScheduled: ScheduledShift | null;
  scheduled: ScheduledShift[];
  onCheckIn: () => void;
  checkingIn: boolean;
}) {
  const canCheckIn = operatorName.trim().length > 0 && !!openScheduled;
  const now = new Date();
  const next = openScheduled ? null : nextShiftInstance(scheduled, now);
  const opensAt = next ? new Date(next.startAt.getTime() - 45 * 60 * 1000) : null;
  const msUntilOpen = opensAt ? Math.max(0, opensAt.getTime() - now.getTime()) : 0;

  // Anchor the "total" duration to the first render where this target became
  // active. Percent = remaining / total, so the sand level actually maps to
  // the real countdown instead of resetting or looping.
  const anchorRef = useRef<{ targetMs: number; anchoredAt: number; totalMs: number } | null>(null);
  if (opensAt) {
    const targetMs = opensAt.getTime();
    if (!anchorRef.current || anchorRef.current.targetMs !== targetMs) {
      anchorRef.current = {
        targetMs,
        anchoredAt: now.getTime(),
        totalMs: Math.max(1, targetMs - now.getTime()),
      };
    }
  } else if (!openScheduled) {
    anchorRef.current = null;
  }

  const total = anchorRef.current?.totalMs ?? 1;
  const percent = openScheduled ? 0 : Math.max(0, Math.min(1, msUntilOpen / total));
  const state = openScheduled ? "ready" : hourglassStateFor(msUntilOpen);

  const showCountdownCard = !!next || !!openScheduled;

  const countdownColor =
    state === "urgent"
      ? "text-red-500"
      : state === "fast"
        ? "text-amber-400"
        : state === "warm"
          ? "text-amber-300"
          : state === "ready"
            ? "text-emerald-400"
            : "text-foreground";

  return (
    <Card className="border-border/60">
      <CardContent className="flex flex-col items-center gap-5 px-4 py-8 text-center sm:gap-6 sm:px-6 sm:py-10">
        {showCountdownCard ? (
          <>
            <Hourglass
              percent={percent}
              state={state}
              className="w-32 sm:w-40 md:w-44"
            />
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                {state === "ready" ? "Ready for Check-In" : "Check-in opens in"}
              </div>
              {state !== "ready" && (
                <div
                  className={`font-mono text-3xl font-semibold tabular-nums tracking-tight transition-colors sm:text-4xl ${countdownColor}`}
                >
                  {formatCountdown(msUntilOpen)}
                </div>
              )}
              <p className="pt-1 text-xs text-muted-foreground sm:text-sm">
                {openScheduled ? (
                  <>
                    {openScheduled.label ?? "Scheduled shift"} ·{" "}
                    {fmtTime(openScheduled.start_time)} — {fmtTime(openScheduled.end_time)}
                  </>
                ) : (
                  <>
                    {next!.shift.label ?? "Scheduled shift"} ·{" "}
                    {DAY_NAMES[next!.shift.day_of_week]} at {fmtTime(next!.shift.start_time)}
                  </>
                )}
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted sm:h-16 sm:w-16">
              <Clock className="h-6 w-6 text-muted-foreground sm:h-7 sm:w-7" />
            </div>
            <h2 className="text-lg font-semibold tracking-tight sm:text-xl">No scheduled shifts yet</h2>
          </>
        )}

        <div className="w-full max-w-xs space-y-2 text-left">
          <Label htmlFor="op" className="text-xs uppercase tracking-wide text-muted-foreground">
            Your name
          </Label>
          <Input
            id="op"
            placeholder="e.g. Alex"
            value={operatorName}
            onChange={(e) => setOperatorName(e.target.value)}
          />
        </div>

        <Button
          size="lg"
          className="h-12 w-full max-w-xs text-base sm:h-14"
          onClick={onCheckIn}
          disabled={!canCheckIn || checkingIn}
        >
          <LogIn className="mr-2 h-5 w-5" />
          {checkingIn ? "Checking in…" : "Check in"}
        </Button>
      </CardContent>
    </Card>
  );
}

function ActiveShiftPanel({
  shift,
  onCheckOut,
  onAddClass,
  onUpdateClass,
  onRemoveClass,
  checkingOut,
}: {
  shift: Shift;
  onCheckOut: () => void;
  onAddClass: () => void;
  onUpdateClass: (i: number, patch: Partial<ShiftClass>) => void;
  onRemoveClass: (i: number) => void;
  checkingOut: boolean;
}) {
  const d = formatDuration(shift.check_in_at, null);

  return (
    <div className="space-y-5 sm:space-y-6">
      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="flex flex-col items-center gap-3 px-4 py-8 text-center sm:px-6 sm:py-10">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground sm:text-xs">
            Checked in as {shift.operator_name}
          </div>
          <div className="font-mono text-4xl font-semibold tabular-nums tracking-tight sm:text-6xl">
            {d.long}
          </div>
          <div className="text-[11px] text-muted-foreground sm:text-xs">
            Since{" "}
            {new Date(shift.check_in_at).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Classes & teachers</h3>
            <Button variant="secondary" size="sm" onClick={onAddClass}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add
            </Button>
          </div>
          {shift.classes.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No classes yet. Add a class name and the teacher running it.
            </p>
          ) : (
            <div className="space-y-2">
              {shift.classes.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <Input
                    placeholder="Class name"
                    value={c.class}
                    onChange={(e) => onUpdateClass(i, { class: e.target.value })}
                  />
                  <Input
                    placeholder="Teacher name"
                    value={c.teacher}
                    onChange={(e) => onUpdateClass(i, { teacher: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onRemoveClass(i)}
                    aria-label="Remove row"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Button
        onClick={onCheckOut}
        variant="destructive"
        size="lg"
        className="h-12 w-full text-base sm:h-14"
        disabled={checkingOut}
      >
        <LogOut className="mr-2 h-5 w-5" />
        {checkingOut ? "Checking out…" : "Check out"}
      </Button>
    </div>
  );
}

function durationMinutes(startISO: string, endISO: string | null) {
  const end = endISO ? new Date(endISO).getTime() : Date.now();
  return Math.max(0, Math.floor((end - new Date(startISO).getTime()) / 60000));
}

function MonthlySummary({ shifts }: { shifts: Shift[] }) {
  const summary = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    const recent = shifts.filter((s) => s.check_out_at && new Date(s.check_out_at) >= cutoff);
    const totalMinutes = recent.reduce(
      (sum, s) => sum + durationMinutes(s.check_in_at, s.check_out_at),
      0,
    );
    return {
      totalHours: Math.floor(totalMinutes / 60),
      remMinutes: totalMinutes % 60,
      count: recent.length,
    };
  }, [shifts]);

  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Hours worked</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">
            {summary.totalHours}h {summary.remMinutes.toString().padStart(2, "0")}m
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          {summary.count} shift{summary.count === 1 ? "" : "s"}
        </div>
      </CardContent>
    </Card>
  );
}
