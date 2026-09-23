import { PAGE_TITLES, pageMeta } from "@/lib/page-titles";
import { createFileRoute, redirect, useRouter, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { getGateStatus, signOutUser } from "@/lib/gate.functions";
import {
  listShifts,
  listScheduledShifts,
  createShift,
  autoCheckInShift,
  checkOutShift,
  updateShift as updateShiftFn,
  type ShiftRow,
  type ScheduledShiftRow,
} from "@/lib/shifts.functions";
import { listDmcDirectory, type DmcOption } from "@/lib/dmc-directory.functions";
import { useTimeToLeave } from "@/hooks/useTimeToLeave";

import { clearAllCaches, operatorNamespace, readCache, writeCache } from "@/lib/local-cache";
import { getOperatorDisplayName } from "@/lib/operators.functions";
import { getMyProfileStatus, type MyProfileStatus } from "@/lib/profile.functions";
import { getAppSettings } from "@/lib/settings.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast, Toaster } from "sonner";
import { Plus, X, Clock, LogIn, AlertTriangle, Lock } from "lucide-react";
import { DmcPicker } from "@/components/DmcPicker";
import { ClassScheduleCard, classStatusOf, durationOf } from "@/components/ClassScheduleCard";
import { ChecklistPanel } from "@/components/checklist/ChecklistPanel";
import { useShiftChecklists } from "@/components/checklist/useShiftChecklists";
import { isEndChecklistComplete } from "@/domain/checklists";
import { useCalendarSync, useSyncListener } from "@/hooks/useCalendarSync";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";

import { publishSync } from "@/lib/sync-bus";
import { captureAutoCheckInIntent, consumeAutoCheckInIntent } from "@/lib/auto-checkin-intent";
import {
  listMyCalendarClasses,
  setMyClassStatus,
  type CalendarClassRow,
} from "@/lib/gcal.functions";
import { AppShell, SectionTitle } from "@/components/AppShell";
import { HoldButton } from "@/components/HoldButton";
import { StudioActivation } from "@/components/StudioActivation";
import { MonthlyHours } from "@/components/MonthlyHours";
import {
  buildDisplayShifts,
  resolveCheckInTarget,
  classesForShift,
  classStartAt,
  formatShiftRange,
  type DisplayShift,
} from "@/lib/display-shifts";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const status = await getGateStatus();
    if (!status.unlocked) throw redirect({ to: "/unlock" });
    if (status.isAdmin) throw redirect({ to: "/admin" });
  },
  loader: async () => {
    const { username } = await getGateStatus();
    if (!username)
      return { username: null as string | null, profile: null as MyProfileStatus | null };
    const [canonical, profile] = await Promise.all([
      getOperatorDisplayName({ data: { username } }),
      getMyProfileStatus().catch(() => null),
    ]);
    return { username: canonical ?? username, profile };
  },
  head: () => ({
    meta: pageMeta(PAGE_TITLES.dashboard, "Your next shift, time to leave, and monthly hours."),
  }),
  component: Index,
});

export type { ShiftClass } from "@/lib/shifts.functions";
import type { ShiftClass } from "@/lib/shifts.functions";

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
    const openAt = new Date(start.getTime() - 60 * 60 * 1000);
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
      fetchProfile()
        .then(setProfileStatus)
        .catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchProfile]);

  const fetchShifts = useServerFn(listShifts);
  const fetchScheduled = useServerFn(listScheduledShifts);
  const fetchDmcDirectory = useServerFn(listDmcDirectory);
  const fetchCalendarClasses = useServerFn(listMyCalendarClasses);
  const createShiftFn = useServerFn(createShift);
  const checkOutShiftServer = useServerFn(checkOutShift);
  const updateShiftServer = useServerFn(updateShiftFn);
  const setClassStatusFn = useServerFn(setMyClassStatus);

  type DashboardSnapshot = {
    shifts: Shift[];
    scheduled: ScheduledShift[];
    teachers: DmcOption[];
    classes: DmcOption[];
    calendarClasses: CalendarClassRow[];
  };
  const dashboardCacheKey = username ? `${operatorNamespace(username)}dashboard` : null;
  // Read once, on the very first render only — not on every re-render this
  // component does (it ticks every second for the countdown clock).
  const [cachedDashboard] = useState<DashboardSnapshot | null>(() =>
    dashboardCacheKey ? readCache<DashboardSnapshot>(dashboardCacheKey) : null,
  );

  const [showActivation, setShowActivation] = useState(false);
  const [active, setActive] = useState<Shift | null>(
    cachedDashboard?.shifts.find((r) => !r.check_out_at) ?? null,
  );
  const [history, setHistory] = useState<Shift[]>(
    cachedDashboard?.shifts.filter((r) => r.check_out_at) ?? [],
  );
  const [scheduled, setScheduled] = useState<ScheduledShift[]>(cachedDashboard?.scheduled ?? []);
  const [teachers, setTeachers] = useState<DmcOption[]>(cachedDashboard?.teachers ?? []);
  const [classes, setClasses] = useState<DmcOption[]>(cachedDashboard?.classes ?? []);
  const [calendarClasses, setCalendarClasses] = useState<CalendarClassRow[]>(
    cachedDashboard?.calendarClasses ?? [],
  );

  // Only true when there was nothing cached to paint immediately.
  const [loading, setLoading] = useState(!cachedDashboard);
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

  // Google Calendar import is manual-only; the dashboard never triggers it.
  const { syncing } = useCalendarSync({
    enabled: !!profileStatus && !needsCal,
    onSynced: () => load(),
  });

  // A sync that finished in another view (or another tab) refreshes us too.
  // Debounced: a single sync can land a burst of updates, so this collapses
  // them into one refresh.
  const debouncedLoad = useDebouncedCallback(() => load(), 700);
  useSyncListener((message) => {
    if (message.type === "data-synced") debouncedLoad();
  });

  // Shift tables are not exposed to client realtime (per-operator data locked
  // down by RLS); refresh on a timer and when the tab regains focus instead.
  useEffect(() => {
    const t = setInterval(() => debouncedLoad(), 90_000);
    const onFocus = () => debouncedLoad();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [debouncedLoad]);

  // Only the very first load shows the full-page "Loading…" state. Every
  // later refresh (auto-sync, cross-tab broadcast, timed/focus refresh)
  // updates the already-visible content in place instead of blanking the
  // page — that repeated blanking, not the sync itself, was the "freeze".
  const hasLoadedOnce = useRef(!!cachedDashboard);
  async function load() {
    if (!hasLoadedOnce.current) setLoading(true);
    try {
      const [rows, sched, dmc, calRows] = await Promise.all([
        fetchShifts(),
        fetchScheduled(),
        fetchDmcDirectory(),
        fetchCalendarClasses().catch(() => [] as CalendarClassRow[]),
      ]);
      const tRows = dmc.instructors;
      const cRows = dmc.classes;
      setActive(rows.find((r) => !r.check_out_at) ?? null);
      setHistory(rows.filter((r) => r.check_out_at));
      setScheduled(sched);
      setTeachers(tRows);
      setClasses(cRows);
      setCalendarClasses(calRows);
      if (dashboardCacheKey) {
        writeCache<DashboardSnapshot>(dashboardCacheKey, {
          shifts: rows as Shift[],
          scheduled: sched,
          teachers: tRows,
          classes: cRows,
          calendarClasses: calRows,
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      hasLoadedOnce.current = true;
    }
  }

  // Open Studio Display popups are refreshed with the latest class data
  // (name, teacher, start, duration) whenever the schedule changes.
  useEffect(() => {
    if (!calendarClasses.length) return;
    publishSync({
      type: "class-display",
      classes: calendarClasses.map((c) => ({
        id: c.id,
        className: c.className,
        teacherName: c.teacherName,
        startTime: c.start_time.slice(0, 5),
        durationMin: durationOf(c) || 60,
        status: c.status,
      })),
    });
  }, [calendarClasses]);

  async function handleSignOut() {
    clearAllCaches();
    await signOut();
    await router.navigate({ to: "/unlock" });
  }

  // NOTE: not memoized — the parent re-renders every second (setTick),
  // so this recomputes and the check-in target follows the clock live.
  const now = new Date();

  // Continuous "display shifts": raw rows split at midnight are merged back
  // into the single operator shift they represent.
  const displayShifts = buildDisplayShifts(scheduled, now);
  const upcomingDisplay = displayShifts.filter((s) => s.endAt.getTime() > now.getTime());
  const nextDisplay = upcomingDisplay[0] ?? null;

  // The check-in target is derived from the current time only: the running
  // shift, else the next one if it starts within two hours. A shift whose end
  // has passed is never resolved again, whatever was checked in before.
  const openTarget = resolveCheckInTarget(scheduled, now);
  const openScheduled = openTarget?.segments[0] ?? null;

  // Reminders are delivered by the server as background Web Push (see
  // /api/public/hooks/push-dispatch), so nothing fires from this page.

  // The scheduled shift the active attendance record belongs to.
  const activeScheduled =
    (active?.scheduled_shift_id
      ? scheduled.find((s) => s.id === active.scheduled_shift_id)
      : null) ?? null;

  // Classes imported from Google Calendar (Detailed Mode). Empty in Busy Mode,
  // where the dashboard keeps showing shift times only.
  //
  // Shift-centric, never day-centric: a shift that crosses midnight keeps every
  // one of its classes (including the ones dated "tomorrow") in one list.
  const classAt = (c: CalendarClassRow) => classStartAt(c);
  const activeDisplayShift = (() => {
    if (!active) return null;
    const t = new Date(active.check_in_at).getTime();
    return (
      displayShifts.find(
        (s) => t >= s.startAt.getTime() - 90 * 60_000 && t <= s.endAt.getTime() + 60 * 60_000,
      ) ?? nextDisplay
    );
  })();
  const activeShiftClasses = (() => {
    if (!active) return [] as CalendarClassRow[];
    if (activeDisplayShift) return classesForShift(calendarClasses, activeDisplayShift);
    const from = new Date(active.check_in_at).getTime() - 60 * 60 * 1000;
    const to = now.getTime() + 6 * 60 * 60 * 1000;
    return calendarClasses
      .filter((c) => classAt(c) >= from && classAt(c) <= to)
      .sort((a, b) => classAt(a) - classAt(b));
  })();

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

  // Automatic check-in from the "Shift starting now" notification. The URL
  // only names the shift; the server verifies ownership, state and the
  // 10-minute window, and is idempotent, so a repeat tap or refresh is safe.
  const autoCheckInFn = useServerFn(autoCheckInShift);
  const autoCheckInBusy = useRef(false);
  useEffect(() => {
    const run = () => {
      if (autoCheckInBusy.current) return;
      // The intent may still sit in the URL (direct open) or have been parked
      // before sign-in; either way it is taken exactly once.
      captureAutoCheckInIntent();
      const target = consumeAutoCheckInIntent();
      if (!target) return;
      autoCheckInBusy.current = true;

      autoCheckInFn({ data: { scheduled_shift_id: target } })
        .then((row) => {
          setActive(row);
          load();
        })
        .catch(() => {
          toast.error("Automatic check-in is no longer available — hold to check in.");
        })
        .finally(() => {
          autoCheckInBusy.current = false;
        });
    };

    run();
    // Fired by the root when the service worker reports a tap on an app that
    // is already open on the dashboard.
    window.addEventListener("auto-checkin-intent", run);
    return () => window.removeEventListener("auto-checkin-intent", run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheckInFn]);

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
    updateActive({
      classes: [
        ...(active.classes ?? []),
        { class: "", teacher: "", dmcClassId: null, dmcInstructorId: null },
      ],
    });
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

  /** Operator marks a class of the current shift completed / cancelled. */
  async function setClassStatus(id: string, status: "scheduled" | "completed" | "cancelled") {
    setCalendarClasses((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
    try {
      await setClassStatusFn({ data: { id, status } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the class");
      load();
    }
  }

  async function checkOut() {
    if (!active) return;
    setCheckingOut(true);
    try {
      // Only classes that were actually taught go into permanent shift history,
      // carrying their canonical DMC references with them.
      const completed = activeShiftClasses
        .filter((c) => classStatusOf(c, new Date()) === "completed")
        .map((c) => ({
          class: c.className,
          teacher: c.teacherName,
          dmcClassId: c.dmc_class_id,
          dmcInstructorId: c.dmc_instructor_id,
        }));
      await checkOutShiftServer({
        data: {
          id: active.id,
          ...(completed.length ? { classes: completed } : {}),
        },
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
    <AppShell username={username} onAir={!!active} onSignOut={handleSignOut}>
      <Toaster richColors position="top-center" />
      {syncing && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-border/60 bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          Syncing calendar…
        </div>
      )}
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

      <div className="mx-auto w-full max-w-3xl space-y-6">
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
            onSetClassStatus={setClassStatus}
          />
        ) : (
          <>
            <InactiveDashboard
              nextShift={nextDisplay}
              upcoming={upcomingDisplay.slice(1, 6)}
              now={now}
              calendarClasses={calendarClasses}
              shifts={history}
              scheduled={scheduled}
              showTimeToLeave={!needsHome}
            />
            {checkInLocked ? (
              <LockedFeatureCard
                icon={<LogIn className="h-4 w-4" />}
                title="Check In"
                reason="Complete your profile to enable Check In and Time to Leave."
              />
            ) : (
              <Card className="rise-in max-lg:glass max-lg:rounded-[22px]">
                <CardContent className="p-0">
                  <CheckInPanel
                    openScheduled={openScheduled}
                    openShift={openTarget}
                    nextShift={nextDisplay}
                    now={now}
                    checkingIn={checkingIn}
                    onCheckIn={checkIn}
                    hideShiftInfo
                  />
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function InactiveDashboard({
  nextShift,
  upcoming,
  now,
  calendarClasses,
  shifts,
  scheduled,
  showTimeToLeave,
}: {
  nextShift: DisplayShift | null;
  upcoming: DisplayShift[];
  now: Date;
  calendarClasses: CalendarClassRow[];
  shifts: Shift[];
  scheduled: ScheduledShift[];
  showTimeToLeave: boolean;
}) {
  return (
    <div className="space-y-6">
      <NextShiftSummary
        shift={nextShift}
        now={now}
        calendarClasses={calendarClasses}
        showTimeToLeave={showTimeToLeave}
      />
      <UpcomingShifts shifts={upcoming} now={now} />
      <MonthlyHours shifts={shifts} scheduled={scheduled} />
    </div>
  );
}

function NextShiftSummary({
  shift,
  now,
  calendarClasses,
  showTimeToLeave,
}: {
  shift: DisplayShift | null;
  now: Date;
  calendarClasses: CalendarClassRow[];
  showTimeToLeave: boolean;
}) {
  const { result, loading } = useTimeToLeave(shift?.startAt.toISOString() ?? null);
  if (!shift) {
    return (
      <Card className="rise-in max-lg:glass max-lg:rounded-[22px]">
        <CardContent className="flex items-center gap-3 p-5">
          <Clock className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-medium">No upcoming shifts</span>
        </CardContent>
      </Card>
    );
  }
  const range = formatShiftRange(shift, now);
  const count = classesForShift(calendarClasses, shift).length;
  const leave = result?.ok ? new Date(result.leave_iso) : null;
  return (
    <section>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Next shift
      </div>
      <Card className="rise-in max-lg:glass max-lg:rounded-[22px]">
        <CardContent className="grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
          <div>
            <div className="text-lg font-semibold">
              {shift.startAt.toLocaleDateString(undefined, { weekday: "long" })}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">{fullDateLabel(shift.startAt)}</div>
            <div className="mt-3 text-xl font-semibold tabular-nums">{range.range}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {count} {count === 1 ? "class" : "classes"}
            </div>
          </div>
          {showTimeToLeave ? (
            <div className="border-t border-border pt-4 sm:min-w-40 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Time to leave
              </div>
              <div className="mt-1 text-3xl font-semibold tabular-nums text-primary">
                {leave ? fmtHM(leave) : loading ? "…" : "Unavailable"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {leave ? `Leave at ${fmtHM(leave)}` : loading ? "Calculating…" : "Try again later"}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

function UpcomingShifts({ shifts, now }: { shifts: DisplayShift[]; now: Date }) {
  return (
    <section>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Upcoming shifts
      </div>
      <Card className="max-lg:glass max-lg:rounded-[22px]">
        <CardContent className="p-0">
          {shifts.length ? (
            shifts.map((shift) => {
              const range = formatShiftRange(shift, now);
              return (
                <div
                  key={`${shift.startAt.toISOString()}-${shift.endAt.toISOString()}`}
                  className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5 last:border-b-0"
                >
                  <span className="text-sm font-medium">
                    {shift.startAt.toLocaleDateString(undefined, {
                      weekday: "short",
                      day: "2-digit",
                      month: "short",
                    })}
                  </span>
                  <span className="text-sm tabular-nums text-muted-foreground">{range.range}</span>
                </div>
              );
            })
          ) : (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              No upcoming shifts.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function CheckInPanel({
  openScheduled,
  openShift,
  nextShift,
  now,
  onCheckIn,
  checkingIn,
  hideShiftInfo = false,
}: {
  openScheduled: ScheduledShift | null;
  /** The resolved check-in target as a continuous (midnight-merged) shift. */
  openShift: DisplayShift | null;
  /** Next continuous shift (midnight-merged), used for the countdown. */
  nextShift: DisplayShift | null;
  now: Date;
  onCheckIn: () => void;
  checkingIn: boolean;
  /** Hide the shift-context block — the parent card already shows it. */
  hideShiftInfo?: boolean;
}) {
  // Sign-in is available any time — an unexpected shift or covering for
  // someone shouldn't require a scheduled shift to exist first. When a
  // scheduled shift is open (starts within the hour, or already underway),
  // check-in still links to it automatically; otherwise it's recorded
  // unscheduled, after the operator confirms that's really what they want.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const next = openScheduled ? null : nextShift;
  const nextRange = next ? formatShiftRange(next, now) : null;
  const hasShift = !!next || !!openScheduled;

  function handleHoldComplete() {
    if (openScheduled) {
      onCheckIn();
    } else {
      setConfirmOpen(true);
    }
  }

  // How late we are relative to the scheduled start (informational only).
  const openStart = openShift?.startAt ?? null;
  const openRange = openShift ? formatShiftRange(openShift, now) : null;
  const lateMin = openStart ? minutesLate(openStart, now) : 0;
  const classCount = scheduledClassCount(openScheduled?.label);

  return (
    <>
      <div className="flex flex-col items-center gap-5 px-5 py-6 text-center max-lg:py-7">
        {hideShiftInfo ? null : hasShift ? (
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {openScheduled ? "Ready for check-in" : "Next scheduled shift"}
            </span>
            <p className="text-xs text-muted-foreground">
              {openScheduled ? (
                <>
                  {openRange!.range}
                  {classCount ? ` · ${classCount} ${classCount === 1 ? "class" : "classes"}` : ""}
                </>
              ) : (
                <>
                  {nextRange!.dayLabel} · {nextRange!.range}
                </>
              )}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-sm font-medium tracking-tight">No scheduled shifts</h2>
          </div>
        )}

        <HoldButton
          label="Hold to check in"
          busy={checkingIn}
          onComplete={handleHoldComplete}
          size={100}
          resetSignal={resetSignal}
        />

        {openScheduled && lateMin > 0 ? (
          <div className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2 text-left">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
            <p className="text-[11px] text-muted-foreground">
              Your shift started{" "}
              {lateMin >= 60 ? `${Math.floor(lateMin / 60)}h ${lateMin % 60}m` : `${lateMin}m`} ago.
              The actual time is recorded for attendance.
            </p>
          </div>
        ) : null}
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          setConfirmOpen(o);
          if (!o) setResetSignal((n) => n + 1);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>No shifts scheduled right now</AlertDialogTitle>
            <AlertDialogDescription>
              There are no shifts scheduled currently — would you still like to sign in?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                onCheckIn();
              }}
            >
              Sign in anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
  onSetClassStatus,
}: {
  shift: Shift;
  scheduledShift: ScheduledShift | null;
  now: Date;
  onCheckOut: () => void;
  onAddClass: () => void;
  onUpdateClass: (i: number, patch: Partial<ShiftClass>) => void;
  onRemoveClass: (i: number) => void;
  checkingOut: boolean;
  teachers: DmcOption[];
  classes: DmcOption[];
  importedClasses: CalendarClassRow[];
  onSetClassStatus: (id: string, status: "scheduled" | "completed" | "cancelled") => void;
}) {
  const d = formatDuration(shift.check_in_at, null);
  const checkInAt = new Date(shift.check_in_at);

  // Operator checklists for this shift (Operation 2). Loaded once per shift.
  const {
    checklists,
    loading: checklistsLoading,
    toggleItem,
    reload: reloadChecklists,
  } = useShiftChecklists(shift.id);
  // The server syncs class snapshots when classes change; pick the result up
  // when the shift's class set changes. No polling.
  const classKey = importedClasses.map((c) => c.id).join(",");
  const firstClassKey = useRef<string | null>(null);
  useEffect(() => {
    if (firstClassKey.current === null) {
      firstClassKey.current = classKey;
      return;
    }
    if (firstClassKey.current === classKey) return;
    firstClassKey.current = classKey;
    reloadChecklists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classKey]);
  const endComplete = checklists ? isEndChecklistComplete(checklists) : true;

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

  const pendingClasses = importedClasses.filter((c) => {
    const st = classStatusOf(c, now);
    return st === "upcoming" || st === "live";
  }).length;

  const earlyMin = times
    ? Math.max(0, Math.round((times.endAt.getTime() - now.getTime()) / 60000))
    : 0;
  // Only material when the finish is more than 15 minutes early.
  const early = earlyMin > 15;

  // Confirmation flow: nothing is shown until the 3s hold actually completes.
  const [confirm, setConfirm] = useState<"incomplete" | "early" | "camera" | null>(null);
  const [resetSignal, setResetSignal] = useState(0);

  // Admin-managed, system-wide check-out reminder.
  const loadSettings = useServerFn(getAppSettings);
  const [checkoutPrompt, setCheckoutPrompt] = useState<{
    message: string;
    enabled: boolean;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    loadSettings()
      .then((s) => {
        if (alive) setCheckoutPrompt(s.checkout);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [loadSettings]);

  const closeConfirm = () => {
    setConfirm(null);
    setResetSignal((n) => n + 1);
  };
  /** Last gate before the shift actually closes. */
  const proceedCheckOut = () => {
    if (checkoutPrompt?.enabled) {
      setConfirm("camera");
      return;
    }
    setConfirm(null);
    onCheckOut();
  };
  const handleHoldComplete = () => {
    if (!early) {
      proceedCheckOut();
      return;
    }
    setConfirm(pendingClasses > 0 ? "incomplete" : "early");
  };

  // Shift progress: from check-in (or scheduled start) to the scheduled end.
  const shiftStart = times?.startAt ?? checkInAt;
  const shiftEnd = times?.endAt ?? null;
  const shiftPct = shiftEnd
    ? Math.max(
        0,
        Math.min(
          100,
          ((now.getTime() - shiftStart.getTime()) /
            Math.max(1, shiftEnd.getTime() - shiftStart.getTime())) *
            100,
        ),
      )
    : 0;
  const remainingMin = shiftEnd
    ? Math.max(0, Math.round((shiftEnd.getTime() - now.getTime()) / 60000))
    : null;
  const remainingLabel =
    remainingMin == null
      ? null
      : remainingMin >= 60
        ? `${Math.floor(remainingMin / 60)}h ${remainingMin % 60}m left`
        : `${remainingMin}m left`;

  return (
    <div className="space-y-6">
      <Card className="rise-in hero-aurora overflow-hidden">
        <CardContent className="flex flex-col items-center gap-3 px-5 py-12 text-center">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            <span className="status-dot bg-live" />
            Checked in
          </div>
          <div className="text-7xl font-semibold tabular-nums tracking-tight">{d.long}</div>
          <div className="text-[13px] text-muted-foreground">
            Started{" "}
            {checkInAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            {times ? ` · Ends ${fmtTime(scheduledShift!.end_time)}` : ""}
            {lateMin > 0 ? ` · ${lateMin}m late` : ""}
          </div>
          {shiftEnd && (
            <div className="mt-3 w-full max-w-md">
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Shift progress</span>
                <span className="tabular-nums">{remainingLabel}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-live transition-[width] duration-700 ease-out"
                  style={{ width: `${shiftPct}%` }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ChecklistPanel
        title="Start Shift Checklist"
        items={checklists?.start.items ?? []}
        loading={checklistsLoading && !checklists}
        onToggleItem={(itemId, completed) => toggleItem({ section: "start" }, itemId, completed)}
      />

      {hasImported ? (
        <ClassScheduleCard
          classes={importedClasses}
          now={now}
          title="Shift Overview"
          onSetStatus={onSetClassStatus}
          renderClassExtra={(c, st) => {
            const entry = checklists?.classes.find((x) => x.classId === c.id);
            if (!entry) return null;
            return (
              <ChecklistPanel
                variant="inline"
                title={entry.type === "ballet" ? "Ballet Checklist" : "Workout Checklist"}
                items={entry.items}
                readOnly={st === "cancelled"}
                onToggleItem={(itemId, completed) =>
                  toggleItem({ section: "class", classId: c.id }, itemId, completed)
                }
              />
            );
          }}
        />
      ) : (
        <Card>
          <CardContent className="space-y-5 p-5">
            <SectionTitle
              title="Shift Overview"
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
                    <DmcPicker
                      value={c.dmcClassId}
                      onChange={(o) =>
                        onUpdateClass(i, { dmcClassId: o?.id ?? null, class: o?.name ?? "" })
                      }
                      options={classes}
                      placeholder="Class"
                      fallbackLabel={c.class}
                    />
                    <DmcPicker
                      value={c.dmcInstructorId}
                      onChange={(o) =>
                        onUpdateClass(i, {
                          dmcInstructorId: o?.id ?? null,
                          teacher: o?.name ?? "",
                        })
                      }
                      options={teachers}
                      placeholder="Teacher"
                      fallbackLabel={c.teacher}
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

      <ChecklistPanel
        title="End Shift Checklist"
        items={checklists?.end.items ?? []}
        loading={checklistsLoading && !checklists}
        onToggleItem={(itemId, completed) => toggleItem({ section: "end" }, itemId, completed)}
      />

      <Card className="max-lg:glass max-lg:rounded-[22px]">
        <CardContent className="flex flex-col items-center gap-2 p-5">
          <HoldButton
            label="Hold to check out"
            hint={endComplete ? "Hold for check out" : undefined}
            tone="danger"
            busy={checkingOut}
            disabled={!endComplete}
            onComplete={handleHoldComplete}
            size={84}
            resetSignal={resetSignal}
          />
          {!endComplete && (
            <p className="text-center text-xs text-muted-foreground">
              Complete the End Shift Checklist before checking out.
            </p>
          )}
        </CardContent>
      </Card>

      {/* One dialog instance for every confirmation step. Swapping between
          separate mounted dialogs (early → camera) left the modal layer in a
          non-interactive state, so a confirmed early check-out never ran. */}
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && closeConfirm()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "incomplete"
                ? "Incomplete Shift"
                : confirm === "early"
                  ? "Early Check-Out"
                  : "Before you go"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "incomplete"
                ? "Some scheduled classes have not been marked as Completed or Cancelled. What would you like to do?"
                : confirm === "early"
                  ? `You are checking out before your scheduled shift has ended${
                      scheduledShift ? ` (ends ${fmtTime(scheduledShift.end_time)})` : ""
                    }. Your actual check-out time is recorded.`
                  : (checkoutPrompt?.message ?? "Did you turn the security camera back ON?")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeConfirm}>
              {confirm === "incomplete"
                ? "Continue Working"
                : confirm === "early"
                  ? "Cancel"
                  : "Not yet"}
            </AlertDialogCancel>
            {confirm === "camera" ? (
              <AlertDialogAction
                onClick={() => {
                  setConfirm(null);
                  onCheckOut();
                }}
              >
                Yes, camera is ON
              </AlertDialogAction>
            ) : (
              <Button onClick={proceedCheckOut}>Check Out Anyway</Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function fmtHM(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function fullDateLabel(d: Date) {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
        <div className="text-sm font-medium text-foreground">Your profile isn't complete</div>
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
            hero ? "max-w-xs text-sm text-muted-foreground" : "text-xs text-muted-foreground"
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
