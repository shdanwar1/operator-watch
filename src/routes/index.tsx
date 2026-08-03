import { createFileRoute, redirect, useRouter, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { getGateStatus, signOutUser } from "@/lib/gate.functions";
import {
  listShifts,
  listScheduledShifts,
  createShift,
  updateShift as updateShiftFn,
  type ShiftRow,
  type ScheduledShiftRow,
} from "@/lib/shifts.functions";
import {
  listTeachers,
  listClasses,
  recordDirectoryUsage,
  type DirectoryItem,
} from "@/lib/directories.functions";
import { getTimeToLeave, ARRIVAL_BUFFER_MIN, type TimeToLeaveResult } from "@/lib/travel.functions";
import { getOperatorDisplayName } from "@/lib/operators.functions";
import { getMyProfileStatus, type MyProfileStatus } from "@/lib/profile.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast, Toaster } from "sonner";
import { Plus, X, Clock, LogIn, CalendarDays, Train, Home, MapPin, AlertTriangle, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Hourglass, hourglassStateFor } from "@/components/Hourglass";
import { DirectoryCombobox } from "@/components/DirectoryCombobox";
import { ClassScheduleCard } from "@/components/ClassScheduleCard";
import { listMyCalendarClasses, type CalendarClassRow } from "@/lib/gcal.functions";
import { AppShell, SectionTitle } from "@/components/AppShell";
import { HoldButton } from "@/components/HoldButton";
import { StudioActivation } from "@/components/StudioActivation";




export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const status = await getGateStatus();
    if (!status.unlocked) throw redirect({ to: "/unlock" });
    if (status.isAdmin) throw redirect({ to: "/admin" });
  },
  loader: async () => {
    const { username } = await getGateStatus();
    if (!username) return { username: null as string | null, profile: null as MyProfileStatus | null };
    const [canonical, profile] = await Promise.all([
      getOperatorDisplayName({ data: { username } }),
      getMyProfileStatus().catch(() => null),
    ]);
    return { username: canonical ?? username, profile };
  },
  component: Index,
});

export type ShiftClass = { class: string; teacher: string };

type Shift = ShiftRow;
type ScheduledShift = ScheduledShiftRow;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** How long after the scheduled end a shift can still be started (late check-in). */
const LATE_GRACE_MS = 4 * 60 * 60 * 1000;

/** Reads the number of classes scheduled from the scheduled shift's label. */
function scheduledClassCount(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = label.match(/(\d+)\s*(?:x\s*)?class/i) ?? label.match(/^\s*(\d+)\s*$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 && n <= 20 ? n : null;
}

/** Minutes the operator checked in after the scheduled start (0 when on time). */
function minutesLate(scheduledStart: Date | null, checkInAt: Date): number {
  if (!scheduledStart) return 0;
  return Math.max(0, Math.round((checkInAt.getTime() - scheduledStart.getTime()) / 60000));
}

/** Resolves the concrete start/end Date for a scheduled shift nearest to `at`. */
function instanceTimes(s: ScheduledShift, at: Date): { startAt: Date; endAt: Date } {
  const [sh, sm] = s.start_time.split(":").map((n) => parseInt(n, 10));
  const [eh, em] = s.end_time.split(":").map((n) => parseInt(n, 10));
  let best: { startAt: Date; endAt: Date } | null = null;
  for (let offset = -1; offset <= 1; offset++) {
    const day = new Date(at);
    day.setDate(day.getDate() + offset);
    const startAt = new Date(day);
    startAt.setHours(sh, sm, 0, 0);
    const endAt = new Date(day);
    endAt.setHours(eh, em, 0, 0);
    if (endAt.getTime() <= startAt.getTime()) endAt.setDate(endAt.getDate() + 1);
    if (
      !best ||
      Math.abs(startAt.getTime() - at.getTime()) < Math.abs(best.startAt.getTime() - at.getTime())
    ) {
      best = { startAt, endAt };
    }
  }
  return best!;
}

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
    if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
    const openAt = new Date(start.getTime() - 45 * 60 * 1000);
    // Late check-in is always allowed: the window stays open for a few hours
    // after the scheduled end so nobody is ever blocked from starting a shift.
    const closeAt = new Date(end.getTime() + LATE_GRACE_MS);
    if (now >= openAt && now <= closeAt) {
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
  const { username, profile } = Route.useLoaderData();
  const router = useRouter();
  const signOut = useServerFn(signOutUser);
  const fetchProfile = useServerFn(getMyProfileStatus);
  const [profileStatus, setProfileStatus] = useState<MyProfileStatus | null>(profile);
  const profileComplete = profileStatus?.complete ?? true;
  const needsHome = profileStatus?.missing.includes("home") ?? false;
  const needsCal = profileStatus?.missing.includes("calendar") ?? false;
  // Magic word is no longer part of the attendance flow.
  const checkInLocked = needsHome || needsCal;

  // Re-sync profile status when the tab regains focus (user may return
  // from /complete-profile or /profile with new information).
  useEffect(() => {
    const onFocus = () => {
      fetchProfile().then(setProfileStatus).catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchProfile]);

  const fetchShifts = useServerFn(listShifts);
  const fetchScheduled = useServerFn(listScheduledShifts);
  const fetchTeachers = useServerFn(listTeachers);
  const fetchClasses = useServerFn(listClasses);
  const fetchCalendarClasses = useServerFn(listMyCalendarClasses);
  const recordUsage = useServerFn(recordDirectoryUsage);
  const createShiftFn = useServerFn(createShift);
  const updateShiftServer = useServerFn(updateShiftFn);

  const [showActivation, setShowActivation] = useState(false);
  const [active, setActive] = useState<Shift | null>(null);
  const [history, setHistory] = useState<Shift[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledShift[]>([]);
  const [teachers, setTeachers] = useState<DirectoryItem[]>([]);
  const [classes, setClasses] = useState<DirectoryItem[]>([]);
  const [calendarClasses, setCalendarClasses] = useState<CalendarClassRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    load();
  }, []);

  // Live sync: refetch whenever admin (or anyone) changes shifts/scheduled shifts.
  useEffect(() => {
    const ch = supabase
      .channel("operator-shift-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "shifts" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "scheduled_shifts" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [rows, sched, tRows, cRows, calRows] = await Promise.all([
        fetchShifts(),
        fetchScheduled(),
        fetchTeachers(),
        fetchClasses(),
        fetchCalendarClasses().catch(() => [] as CalendarClassRow[]),
      ]);
      setActive(rows.find((r) => !r.check_out_at) ?? null);
      setHistory(rows.filter((r) => r.check_out_at));
      setScheduled(sched);
      setTeachers(tRows);
      setClasses(cRows);
      setCalendarClasses(calRows);
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

  // Focus mode:
  //  - More than 45 min before the next shift → "Time to leave" is the hero
  //  - 45 min or less before the next shift (or during the shift) → check-in is the hero
  const nextInstance = nextShiftInstance(scheduled, now);
  const minutesToNext = nextInstance
    ? Math.round((nextInstance.startAt.getTime() - now.getTime()) / 60000)
    : Infinity;
  const focus: "check_in" | "time_to_leave" =
    !active && minutesToNext > 60 ? "time_to_leave" : "check_in";

  // The scheduled shift the active attendance record belongs to.
  const activeScheduled =
    (active?.scheduled_shift_id
      ? scheduled.find((s) => s.id === active.scheduled_shift_id)
      : null) ?? null;

  // Classes imported from Google Calendar (Detailed Mode). Empty in Busy Mode,
  // where the dashboard keeps showing shift times only.
  const todayKey = (() => {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  })();
  const activeShiftClasses = activeScheduled
    ? calendarClasses.filter(
        (c) =>
          c.scheduled_shift_id === activeScheduled.id ||
          c.specific_date === activeScheduled.specific_date,
      )
    : calendarClasses.filter((c) => c.specific_date === todayKey);
  const todayClasses = calendarClasses.filter((c) => c.specific_date === todayKey);




  async function checkIn() {
    setCheckingIn(true);
    try {
      const row = await createShiftFn({
        data: { scheduled_shift_id: openScheduled?.id ?? null },
      });
      setActive(row);
      setShowActivation(true);
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
      // Best-effort: record used teachers/classes in the directories.
      try {
        await recordUsage({
          data: {
            teachers: active.classes.map((c) => c.teacher).filter(Boolean),
            classes: active.classes.map((c) => c.class).filter(Boolean),
          },
        });
      } catch { /* non-fatal */ }
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
    <AppShell username={username} onAir={!!active} onSignOut={handleSignOut}>
      <Toaster richColors position="top-center" />
      {showActivation && (
        <StudioActivation
          onDone={() => {
            setShowActivation(false);
            toast.success("Studio live — you're checked in");
          }}
        />
      )}

      {!profileComplete && !active && (
        <ProfileIncompleteBanner missing={profileStatus?.missing ?? []} />
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : active ? (
            <ActiveShiftPanel
              shift={active}
              scheduledShift={activeScheduled}
              now={now}
              onCheckOut={checkOut}
              onAddClass={addClassRow}
              onUpdateClass={updateClassRow}
              onRemoveClass={removeClassRow}
              checkingOut={checkingOut}
              teachers={teachers}
              classes={classes}
              importedClasses={activeShiftClasses}
            />
          ) : (
            <>
              {focus === "time_to_leave" ? (
                checkInLocked ? (
                  <LockedFeatureCard
                    icon={<Train className="h-4 w-4" />}
                    title="Time to Leave"
                    reason="Complete your profile to enable Time to Leave."
                    hero
                  />
                ) : (
                  <TimeToLeaveCard scheduled={scheduled} now={now} variant="hero" />
                )
              ) : checkInLocked ? (
                <LockedFeatureCard
                  icon={<LogIn className="h-4 w-4" />}
                  title="Check In"
                  reason="Complete your profile to enable Check In."
                  hero
                />
              ) : (
                <CheckInPanel
                  openScheduled={openScheduled}
                  scheduled={scheduled}
                  now={now}
                  onCheckIn={checkIn}
                  checkingIn={checkingIn}
                />
              )}

              {todayClasses.length > 0 && (
                <ClassScheduleCard classes={todayClasses} now={now} title="Today's overview" />
              )}
            </>
          )}
        </div>

        <aside className="xl:sticky xl:top-24 xl:self-start">
          {!loading && <UpcomingShifts scheduled={scheduled} now={now} />}
        </aside>
      </div>
    </AppShell>
  );
}



function UpcomingShifts({ scheduled, now }: { scheduled: ScheduledShift[]; now: Date }) {
  const instances = upcomingInstances(scheduled, now, 6);
  return (
    <Card className="rise-in">
      <CardContent className="p-5">
        <SectionTitle title="Upcoming shifts" />
        {instances.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No upcoming shifts scheduled.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {instances.map(({ shift, startAt }, i) => {
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
                <li key={`${shift.id}-${i}`} className="flex items-baseline justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium">{dayLabel}</div>
                    <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                      {fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}
                    </div>
                  </div>
                  {shift.label && (
                    <span className="shrink-0 text-xs text-muted-foreground">{shift.label}</span>
                  )}
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
  openScheduled,
  scheduled,
  now,
  onCheckIn,
  checkingIn,
}: {
  openScheduled: ScheduledShift | null;
  scheduled: ScheduledShift[];
  now: Date;
  onCheckIn: () => void;
  checkingIn: boolean;
}) {
  const canCheckIn = !!openScheduled;
  const next = openScheduled ? null : nextShiftInstance(scheduled, now);
  const opensAt = next ? new Date(next.startAt.getTime() - 45 * 60 * 1000) : null;
  const msUntilOpen = opensAt ? Math.max(0, opensAt.getTime() - now.getTime()) : 0;

  // How late we are relative to the scheduled start (informational only).
  const openStart = openScheduled ? instanceTimes(openScheduled, now).startAt : null;
  const lateMin = openStart ? minutesLate(openStart, now) : 0;
  const classCount = scheduledClassCount(openScheduled?.label);

  // Anchor the "total" duration to the first render where this target became
  // active, so the hourglass level maps to the real countdown.
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
      ? "text-alert"
      : state === "fast" || state === "warm"
        ? "text-warn"
        : state === "ready"
          ? "text-done"
          : "text-foreground";

  return (
    <Card className="rise-in hero-aurora overflow-hidden">
      <CardContent className="flex flex-col items-center gap-8 px-5 py-14 text-center">
        {showCountdownCard ? (
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-2.5">
              <Hourglass percent={percent} state={state} className="h-8 w-8" />
              <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {state === "ready" ? "Ready for check-in" : "Check-in opens in"}
              </span>
            </div>
            {state !== "ready" && (
              <div
                className={`text-5xl font-semibold tabular-nums tracking-tight transition-colors ${countdownColor}`}
              >
                {formatCountdown(msUntilOpen)}
              </div>
            )}
            <p className="text-[13px] text-muted-foreground">
              {openScheduled ? (
                <>
                  {fmtTime(openScheduled.start_time)} – {fmtTime(openScheduled.end_time)}
                  {classCount ? ` · ${classCount} ${classCount === 1 ? "class" : "classes"}` : ""}
                </>
              ) : (
                <>
                  {DAY_NAMES[next!.shift.day_of_week]} · {fmtTime(next!.shift.start_time)} –{" "}
                  {fmtTime(next!.shift.end_time)}
                </>
              )}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Clock className="h-6 w-6 text-muted-foreground" />
            <h2 className="text-lg font-medium tracking-tight">No scheduled shifts</h2>
          </div>
        )}

        <HoldButton
          label="Hold to Check In"
          successLabel="Checked in"
          disabled={!canCheckIn}
          busy={checkingIn}
          onComplete={onCheckIn}
          size={240}
        />

        {canCheckIn && lateMin > 0 ? (
          <div className="flex max-w-sm items-start gap-2.5 rounded-xl bg-warn-soft px-4 py-3 text-left">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
            <p className="text-xs text-muted-foreground">
              Your shift started{" "}
              {lateMin >= 60 ? `${Math.floor(lateMin / 60)}h ${lateMin % 60}m` : `${lateMin}m`} ago.
              The actual time is recorded for attendance.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}


function ActiveShiftPanel({
  shift,
  scheduledShift,
  now,
  onCheckOut,
  onAddClass,
  onUpdateClass,
  onRemoveClass,
  checkingOut,
  teachers,
  classes,
  importedClasses,
}: {
  shift: Shift;
  scheduledShift: ScheduledShift | null;
  now: Date;
  onCheckOut: () => void;
  onAddClass: () => void;
  onUpdateClass: (i: number, patch: Partial<ShiftClass>) => void;
  onRemoveClass: (i: number) => void;
  checkingOut: boolean;
  teachers: DirectoryItem[];
  classes: DirectoryItem[];
  importedClasses: CalendarClassRow[];
}) {
  const d = formatDuration(shift.check_in_at, null);
  const checkInAt = new Date(shift.check_in_at);

  const times = scheduledShift ? instanceTimes(scheduledShift, checkInAt) : null;
  const lateMin = minutesLate(times?.startAt ?? null, checkInAt);
  const expected = scheduledClassCount(scheduledShift?.label);
  const hasImported = importedClasses.length > 0;

  // Pre-generate the scheduled number of empty class rows once. In Detailed
  // Mode the classes already come from the calendar, so nothing is seeded.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (hasImported || !expected || shift.classes.length > 0) return;
    seededRef.current = true;
    for (let i = 0; i < expected; i++) onAddClass();
  }, [expected, hasImported, shift.classes.length, onAddClass]);


  const filled = shift.classes.filter((c) => c.class.trim() || c.teacher.trim()).length;
  const target = Math.max(expected ?? 0, shift.classes.length);
  const progressPct = target > 0 ? Math.min(100, (filled / target) * 100) : 0;

  const earlyMin = times ? Math.max(0, Math.round((times.endAt.getTime() - now.getTime()) / 60000)) : 0;
  const early = earlyMin > 0;

  return (
    <div className="space-y-6">
      <Card className="rise-in hero-aurora overflow-hidden">
        <CardContent className="flex flex-col items-center gap-3 px-5 py-14 text-center">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            <span className="status-dot bg-live" />
            Checked in
          </div>
          <div className="text-7xl font-semibold tabular-nums tracking-tight">{d.long}</div>
          <div className="text-[13px] text-muted-foreground">
            Started {checkInAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            {times ? ` · Ends ${fmtTime(scheduledShift!.end_time)}` : ""}
            {lateMin > 0 ? ` · ${lateMin}m late` : ""}
          </div>
        </CardContent>
      </Card>

      {hasImported ? (
        <ClassScheduleCard classes={importedClasses} now={now} title="Today's schedule" />
      ) : (
        <Card>
          <CardContent className="space-y-5 p-5">
            <SectionTitle
              title="Today's schedule"
              meta={
                target > 0
                  ? `${target} ${target === 1 ? "class" : "classes"} scheduled`
                  : "No classes scheduled"
              }
              action={
                <Button variant="secondary" size="sm" onClick={onAddClass}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add
                </Button>
              }
            />

            {target > 0 ? (
              <div>
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Completed</span>
                  <span className="tabular-nums">
                    {filled} / {target}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-done transition-[width] duration-700 ease-out"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            ) : null}

            {shift.classes.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No classes yet. Add a class name and the teacher running it.
              </p>
            ) : (
              <div className="space-y-2">
                {shift.classes.map((c, i) => (
                  <div key={i} className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2">
                    <span className="w-5 text-center text-xs tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <DirectoryCombobox
                      value={c.class}
                      onChange={(v) => onUpdateClass(i, { class: v })}
                      options={classes}
                      placeholder="Class"
                    />
                    <DirectoryCombobox
                      value={c.teacher}
                      onChange={(v) => onUpdateClass(i, { teacher: v })}
                      options={teachers}
                      placeholder="Teacher"
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
      )}

      <Card>
        <CardContent className="flex flex-col items-center gap-4 px-5 py-10">
          <HoldButton
            label="Hold to Check Out"
            successLabel="Checked out"
            tone="danger"
            busy={checkingOut}
            onComplete={onCheckOut}
            size={200}
          />
          {early ? (
            <p className="max-w-sm text-center text-xs text-muted-foreground">
              Scheduled until {fmtTime(scheduledShift!.end_time)} — checking out now records an early
              finish of{" "}
              {earlyMin >= 60 ? `${Math.floor(earlyMin / 60)}h ${earlyMin % 60}m` : `${earlyMin}m`}.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}





function fmtHM(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function TimeToLeaveCard({
  scheduled,
  now,
  variant = "default",
}: {
  scheduled: ScheduledShift[];
  now: Date;
  variant?: "default" | "hero";
}) {

  const fetchPlan = useServerFn(getTimeToLeave);
  const next = useMemo(() => nextShiftInstance(scheduled, now), [scheduled, now]);
  const shiftIso = next?.startAt.toISOString() ?? null;

  const [plan, setPlan] = useState<TimeToLeaveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (!shiftIso) {
      setPlan(null);
      return;
    }
    let alive = true;
    const load = async () => {
      setLoading(true);
      setErrored(false);
      try {
        const p = await fetchPlan({ data: { shift_start_iso: shiftIso } });
        if (alive) setPlan(p);
      } catch {
        if (alive) {
          setPlan(null);
          setErrored(true);
        }
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    // Refresh every 3 minutes so the departure recalculates with fresh transit data.
    const t = setInterval(load, 3 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [shiftIso, fetchPlan]);

  if (!next) return null;

  const shiftStart = next.startAt;

  const hero = variant === "hero";

  return (
    <Card className={hero ? "border-primary/40" : undefined}>
      <CardContent className={hero ? "p-6 sm:p-8" : "p-5"}>
        <div className="mb-3 flex items-center gap-2">
          <Train className={hero ? "h-5 w-5 text-primary" : "h-4 w-4 text-muted-foreground"} />
          <h2
            className={
              hero
                ? "text-sm font-semibold uppercase tracking-wider text-primary"
                : "text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            }
          >
            Time to leave
          </h2>
        </div>

        <p className={hero ? "text-sm text-muted-foreground" : "text-xs text-muted-foreground"}>
          Next shift{" "}
          <span className="font-medium text-foreground">
            {shiftStart.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
          </span>{" "}
          at <span className="font-medium text-foreground">{fmtHM(shiftStart)}</span>
        </p>

        {loading && !plan ? (
          <p className="mt-3 text-sm text-muted-foreground">Planning your trip…</p>
        ) : plan && plan.ok ? (
          <TimeToLeaveDetails plan={plan} now={now} hero={hero} />
        ) : plan && plan.reason === "no_home" ? (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-muted-foreground">
              Add your home address to see when you should leave.
            </p>
            <Button size="sm" variant="outline" asChild>
              <Link to="/profile">
                <Home className="mr-1.5 h-3.5 w-3.5" /> Set home in profile
              </Link>
            </Button>
          </div>
        ) : plan && plan.reason === "no_route" ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Could not find a public transport route right now.
          </p>
        ) : errored ? (
          <p className="mt-3 text-sm text-destructive">
            Could not reach the transit service. Retrying automatically.
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Preparing…</p>
        )}
      </CardContent>
    </Card>
  );
}



function TimeToLeaveDetails({
  plan,
  now,
  hero = false,
}: {
  plan: Extract<TimeToLeaveResult, { ok: true }>;
  now: Date;
  hero?: boolean;
}) {
  const departure = new Date(plan.departure_iso);
  const arrival = new Date(plan.arrival_iso);
  const minutesUntilLeave = Math.round((departure.getTime() - now.getTime()) / 60_000);

  const leaveLabel =
    minutesUntilLeave <= 0
      ? "Leave now"
      : minutesUntilLeave < 60
        ? `Leave in ${minutesUntilLeave}m`
        : `Leave in ${Math.floor(minutesUntilLeave / 60)}h ${minutesUntilLeave % 60}m`;

  const urgent = minutesUntilLeave <= 10;

  return (
    <div className={hero ? "mt-5 space-y-5" : "mt-3 space-y-3"}>
      <div
        className={`rounded-lg border ${hero ? "p-5 sm:p-6" : "p-3"} ${
          urgent ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/40"
        }`}
      >
        <div
          className={`font-medium uppercase tracking-wider ${
            hero ? "text-sm" : "text-xs"
          } ${urgent ? "text-destructive" : "text-muted-foreground"}`}
        >
          {leaveLabel}
        </div>
        <div
          className={`mt-1 font-semibold tabular-nums ${
            hero ? "text-5xl sm:text-6xl" : "text-2xl"
          }`}
        >
          {fmtHM(departure)}
        </div>
        <div className={hero ? "mt-2 text-sm text-muted-foreground" : "mt-1 text-xs text-muted-foreground"}>
          Arrive {fmtHM(arrival)} · {plan.travel_minutes}m by public transport
          {plan.transfers > 0 ? ` · ${plan.transfers} transfer${plan.transfers === 1 ? "" : "s"}` : ""}
        </div>
        <div className={hero ? "mt-1 text-xs text-muted-foreground" : "mt-1 text-[11px] text-muted-foreground"}>
          Plan arrives {ARRIVAL_BUFFER_MIN} min before shift starts.
        </div>
      </div>


      {plan.direct_options.length > 0 ? (
        <div className="space-y-2">
          <div className={hero ? "text-xs font-semibold uppercase tracking-wider text-muted-foreground" : "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"}>
            Direct options
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {plan.direct_options.map((o) => (
              <div key={o.line + o.departure_iso} className="rounded-md border border-border bg-background/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                    {o.line}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {fmtHM(new Date(o.departure_iso))} → {fmtHM(new Date(o.arrival_iso))}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  From <span className="text-foreground">{o.from_stop}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {o.duration_minutes} min ride · ~{o.walk_minutes} min walk to office
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-1 text-xs text-muted-foreground">
        <div className="flex items-start gap-1.5">
          <Home className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="truncate">{plan.home_label}</span>
        </div>
        <div className="flex items-start gap-1.5">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="truncate">{plan.office_label}</span>
        </div>
      </div>
    </div>
  );
}


function ProfileIncompleteBanner({ missing }: { missing: string[] }) {
  const parts: string[] = [];
  if (missing.includes("home")) parts.push("Time to Leave");
  if (missing.includes("home") || missing.includes("calendar")) parts.push("Check In");
  if (missing.includes("calendar")) parts.push("Google Calendar availability");
  const list = Array.from(new Set(parts));
  const featureText =
    list.length === 0
      ? "additional features"
      : list.length === 1
        ? list[0]
        : `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 sm:mb-8 sm:flex-row sm:items-center sm:gap-4">
      <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">
          Your profile isn't complete
        </div>
        <div className="text-xs text-muted-foreground">
          Complete your profile to enable {featureText}.
        </div>
      </div>
      <Button size="sm" asChild className="shrink-0">
        <Link to="/complete-profile">Complete Profile</Link>
      </Button>
    </div>
  );
}

function LockedFeatureCard({
  icon,
  title,
  reason,
  hero = false,
}: {
  icon: React.ReactNode;
  title: string;
  reason: string;
  hero?: boolean;
}) {
  return (
    <Card className="border-dashed">
      <CardContent
        className={
          hero
            ? "flex flex-col items-center gap-4 px-4 py-10 text-center sm:py-12"
            : "space-y-3 p-4"
        }
      >
        <div
          className={`flex items-center gap-2 ${hero ? "justify-center" : ""} text-muted-foreground`}
        >
          {icon}
          <h2
            className={
              hero
                ? "text-sm font-semibold uppercase tracking-wider"
                : "text-xs font-semibold uppercase tracking-wider"
            }
          >
            {title}
          </h2>
          <Lock className={hero ? "h-4 w-4" : "h-3 w-3"} />
        </div>
        <p
          className={
            hero
              ? "max-w-xs text-sm text-muted-foreground"
              : "text-xs text-muted-foreground"
          }
        >
          {reason}
        </p>
        <Button size={hero ? "lg" : "sm"} asChild className={hero ? "mt-1" : "w-full"}>
          <Link to="/complete-profile">Complete Profile</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
