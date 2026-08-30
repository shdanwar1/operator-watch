import { PAGE_TITLES, pageMeta } from "@/lib/page-titles";
import { createFileRoute, redirect, useRouter, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { getGateStatus, signOutUser } from "@/lib/gate.functions";
import {
  listShifts,
  listScheduledShifts,
  createShift,
  checkOutShift,
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
import { ARRIVAL_BUFFER_MIN } from "@/lib/travel.functions";
import { useTravelPlan } from "@/hooks/useTravelPlan";
import { type TimeToLeaveSnapshot } from "@/lib/travel-snapshot";
import { modeLabel, type DirectPlan, type JourneyPlan } from "@/lib/journey-plan";

import { getMyPrefs, DEFAULT_PREFS, type OperatorPrefs } from "@/lib/prefs.functions";
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
import { Plus, X, Clock, LogIn, CalendarDays, Ship, Footprints, Home, MapPin, AlertTriangle, Lock, ArrowRight, Briefcase, ChevronDown, Building2 } from "lucide-react";
import { transitIconFor } from "@/components/TransitIcons";
import { DirectoryCombobox } from "@/components/DirectoryCombobox";
import { ClassScheduleCard, classStatusOf, durationOf } from "@/components/ClassScheduleCard";
import { useCalendarSync, useSyncListener } from "@/hooks/useCalendarSync";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";

import { publishSync } from "@/lib/sync-bus";
import {
  listMyCalendarClasses,
  setMyClassStatus,
  correctMyClassMatch,
  type CalendarClassRow,
} from "@/lib/gcal.functions";
import { AppShell, SectionTitle } from "@/components/AppShell";
import { HoldButton } from "@/components/HoldButton";
import { CHECK_IN_WINDOW_MS, LEAVE_WINDOW_MS } from "@/lib/shift-phase";
import { StudioActivation } from "@/components/StudioActivation";
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
    if (!username) return { username: null as string | null, profile: null as MyProfileStatus | null };
    const [canonical, profile] = await Promise.all([
      getOperatorDisplayName({ data: { username } }),
      getMyProfileStatus().catch(() => null),
    ]);
    return { username: canonical ?? username, profile };
  },
  head: () => ({
    meta: pageMeta(PAGE_TITLES.dashboard, "Your next shift, travel plan and check-in for today."),
  }),
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

/** True when two timestamps fall on the same calendar day. */
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
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
  const checkOutShiftServer = useServerFn(checkOutShift);
  const updateShiftServer = useServerFn(updateShiftFn);
  const setClassStatusFn = useServerFn(setMyClassStatus);
  const correctClassMatchFn = useServerFn(correctMyClassMatch);

  type DashboardSnapshot = {
    shifts: Shift[];
    scheduled: ScheduledShift[];
    teachers: DirectoryItem[];
    classes: DirectoryItem[];
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
  const [teachers, setTeachers] = useState<DirectoryItem[]>(cachedDashboard?.teachers ?? []);
  const [classes, setClasses] = useState<DirectoryItem[]>(cachedDashboard?.classes ?? []);
  const [calendarClasses, setCalendarClasses] = useState<CalendarClassRow[]>(
    cachedDashboard?.calendarClasses ?? [],
  );

  // Only true when there was nothing cached to paint immediately.
  const [loading, setLoading] = useState(!cachedDashboard);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [, setTick] = useState(0);

  // Personal preferences (calendar sync, notifications, dashboard cards),
  // cached so a returning device knows the real saved autoSync value
  // immediately instead of assuming the default.
  const prefsCacheKey = username ? `${operatorNamespace(username)}prefs` : null;
  const loadPrefs = useServerFn(getMyPrefs);
  const [prefs, setPrefs] = useState<OperatorPrefs>(
    () => (prefsCacheKey && readCache<OperatorPrefs>(prefsCacheKey)) || DEFAULT_PREFS,
  );
  const [prefsLoaded, setPrefsLoaded] = useState(
    () => !!(prefsCacheKey && readCache<OperatorPrefs>(prefsCacheKey)),
  );
  useEffect(() => {
    let cancelled = false;
    loadPrefs()
      .then((p) => {
        if (cancelled) return;
        setPrefs(p);
        setPrefsLoaded(true);
        if (prefsCacheKey) writeCache(prefsCacheKey, p);
      })
      .catch(() => {
        /* defaults are fine, but don't block auto-sync forever */
        if (!cancelled) setPrefsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loadPrefs, prefsCacheKey]);



  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    load();
  }, []);

  // Google Calendar stays in sync from the dashboard too, so the operator
  // never has to open the calendar page (or refresh) to see new classes.
  const { syncing } = useCalendarSync({
    enabled: !!profileStatus && !needsCal,
    onSynced: () => load(),
    auto: prefsLoaded && prefs.autoSync,
    includeNextMonth: prefs.syncNextMonth,
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
    const t = setInterval(() => debouncedLoad(), 30_000);
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
        className: c.class_name,
        teacherName: c.teacher_name,
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

  // Daily-view priority: today's shift comes first, then tomorrow, then the
  // next known shift. Time to Leave and the check-in fingerprint only surface
  // for a shift that is today; everything else is read-only context.
  const todayShift =
    upcomingDisplay.find((s) => sameDay(s.startAt, now)) ?? null;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowShift = todayShift
    ? null
    : (upcomingDisplay.find((s) => sameDay(s.startAt, tomorrow)) ?? null);
  const nextShift = upcomingDisplay[0] ?? null;
  const hasAnyScheduled = scheduled.length > 0;

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

  /** Operator fixes a mis-matched class; the server remembers it as an alias. */
  async function correctClassMatch(id: string, classId: string, teacherId: string | null) {
    try {
      const row = await correctClassMatchFn({ data: { id, classId, teacherId } });
      setCalendarClasses((prev) => prev.map((c) => (c.id === id ? row : c)));
      toast.success(
        row.alias_saved
          ? "Match saved — future syncs will use it"
          : "Match saved for this class only",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the match");
    }
  }

  async function checkOut() {
    if (!active) return;
    setCheckingOut(true);
    try {
      // Only classes that were actually taught go into permanent shift history.
      const completed = activeShiftClasses
        .filter((c) => classStatusOf(c, new Date()) === "completed")
        .map((c) => ({ class: c.class_name, teacher: c.teacher_name }));
      await checkOutShiftServer({
        data: {
          id: active.id,
          ...(completed.length ? { classes: completed } : {}),
        },
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
            onCorrectClassMatch={correctClassMatch}
          />
        ) : checkInLocked ? (
          <LockedFeatureCard
            icon={<LogIn className="h-4 w-4" />}
            title="Check In"
            reason="Complete your profile to enable Check In and Time to Leave."
            hero
          />
        ) : todayShift ? (
          <TodayShiftCard
            shift={todayShift}
            now={now}
            openScheduled={openScheduled}
            openShift={openTarget}
            nextShift={nextDisplay}
            checkingIn={checkingIn}
            onCheckIn={checkIn}
            showTravel={prefs.showTimeToLeave && !needsHome}
            username={username}
            scheduled={scheduled}
            homeLat={profileStatus?.home_lat ?? null}
            homeLng={profileStatus?.home_lng ?? null}
            calendarClasses={calendarClasses}
          />
        ) : tomorrowShift ? (
          <NoShiftTodayCard shift={tomorrowShift} now={now} />
        ) : nextShift ? (
          <NoShiftSoonCard shift={nextShift} now={now} />
        ) : (
          <NoShiftsBookedCard hasScheduled={hasAnyScheduled} />
        )}
      </div>

    </AppShell>
  );
}



/**
 * The Shift Card — the dashboard's single operational surface.
 *
 * Fixed anatomy in every phase: a status strip, one primary action, and a
 * detail region. Only the content changes as the clock moves, so the operator
 * never has to re-orient.
 */
function ShiftCard({
  phase,
  next,
  now,
  action,
  detail,
}: {
  phase: ShiftPhase;
  next: DisplayShift | null;
  now: Date;
  action: React.ReactNode;
  detail?: React.ReactNode;
}) {
  const range = next ? formatShiftRange(next, now) : null;
  const dot =
    phase === "on-air" ? "bg-live" : phase === "check-in" ? "bg-primary" : "bg-muted-foreground";
  return (
    <Card className="rise-in overflow-hidden max-lg:glass max-lg:rounded-[22px]">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
          <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <span className={`status-dot ${dot}`} />
            {phaseLabel(phase)}
          </span>
          {range && (
            <span className="text-[13px] tabular-nums text-muted-foreground">
              {range.dayLabel} · {range.range}
            </span>
          )}
        </div>

        {action}

        {detail && <div className="border-t border-border">{detail}</div>}
      </CardContent>
    </Card>
  );
}

function UpcomingShifts({
  shifts,
  now,
  calendarClasses = [],
  embedded = false,
  limit = 6,
}: {
  /** Rendered without its own card shell (inside the Shift Card). */
  embedded?: boolean;
  limit?: number;
  /** Continuous (midnight-merged) shifts, already filtered to the future. */
  shifts: DisplayShift[];
  now: Date;
  /** Used to show how many classes a continuous shift contains. */
  calendarClasses?: CalendarClassRow[];
}) {
  const instances = shifts.slice(0, limit);
  const body = (
    <>

        <SectionTitle title="Upcoming shifts" />
        {instances.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No upcoming shifts scheduled.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {instances.map((shift, i) => {
              const { dayLabel, range } = formatShiftRange(shift, now);
              const classCount = classesForShift(calendarClasses, shift).length;
              const live =
                now.getTime() >= shift.startAt.getTime() && now.getTime() < shift.endAt.getTime();
              return (
                <li
                  key={`${shift.id}-${i}`}
                  className="flex items-baseline justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium">
                      {dayLabel}
                      {live && <span className="ml-2 text-[11px] text-live">In progress</span>}
                    </div>
                    <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">{range}</div>
                    {classCount > 0 && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {classCount} {classCount === 1 ? "class" : "classes"}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
    </>
  );
  if (embedded) return <div className="px-5 py-5">{body}</div>;
  return (
    <Card className="rise-in max-lg:glass max-lg:rounded-[22px]">
      <CardContent className="p-5">{body}</CardContent>
    </Card>
  );
}





function CheckInPanel({
  openScheduled,
  openShift,
  nextShift,
  now,
  onCheckIn,
  checkingIn,
}: {
  openScheduled: ScheduledShift | null;
  /** The resolved check-in target as a continuous (midnight-merged) shift. */
  openShift: DisplayShift | null;
  /** Next continuous shift (midnight-merged), used for the countdown. */
  nextShift: DisplayShift | null;
  now: Date;
  onCheckIn: () => void;
  checkingIn: boolean;
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

        {hasShift ? (
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
  onCorrectClassMatch,
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
  onSetClassStatus: (id: string, status: "scheduled" | "completed" | "cancelled") => void;
  onCorrectClassMatch: (id: string, classId: string, teacherId: string | null) => void;
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

  const pendingClasses = importedClasses.filter((c) => {
    const st = classStatusOf(c, now);
    return st === "upcoming" || st === "live";
  }).length;

  const earlyMin = times ? Math.max(0, Math.round((times.endAt.getTime() - now.getTime()) / 60000)) : 0;
  // Only material when the finish is more than 15 minutes early.
  const early = earlyMin > 15;

  // Confirmation flow: nothing is shown until the 3s hold actually completes.
  const [confirm, setConfirm] = useState<"incomplete" | "early" | "camera" | null>(null);
  const [resetSignal, setResetSignal] = useState(0);

  // Admin-managed, system-wide check-out reminder.
  const loadSettings = useServerFn(getAppSettings);
  const [checkoutPrompt, setCheckoutPrompt] = useState<{ message: string; enabled: boolean } | null>(
    null,
  );
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
            Started {checkInAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
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

      {hasImported ? (
        <ClassScheduleCard
          classes={importedClasses}
          now={now}
          title="Shift Overview"
          onSetStatus={onSetClassStatus}
          onCorrect={onCorrectClassMatch}
          classOptions={classes}
          teacherOptions={teachers}
            footer={
              <div className="flex flex-col items-center gap-2">
                <HoldButton
                  label="Hold to check out"
                  hint="Hold for check out"
                  tone="danger"
                  busy={checkingOut}
                  onComplete={handleHoldComplete}
                  size={84}
                  resetSignal={resetSignal}
                />
              </div>
            }
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

            <div className="flex flex-col items-center gap-2 border-t border-border pt-4">
              <HoldButton
                label="Hold to check out"
                hint="Hold for check out"
                tone="danger"
                busy={checkingOut}
                onComplete={handleHoldComplete}
                size={84}
                resetSignal={resetSignal}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirm === "incomplete"} onOpenChange={(o) => !o && closeConfirm()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Incomplete Shift</AlertDialogTitle>
            <AlertDialogDescription>
              Some scheduled classes have not been marked as Completed or Cancelled. What would you
              like to do?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeConfirm}>Continue Working</AlertDialogCancel>
            <AlertDialogAction onClick={proceedCheckOut}>Check Out Anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm === "early"} onOpenChange={(o) => !o && closeConfirm()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Early Check-Out</AlertDialogTitle>
            <AlertDialogDescription>
              You are checking out before your scheduled shift has ended. Are you sure you want to
              check out early?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeConfirm}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={proceedCheckOut}>Check Out Anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm === "camera"} onOpenChange={(o) => !o && closeConfirm()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Before you go</AlertDialogTitle>
            <AlertDialogDescription>
              {checkoutPrompt?.message ?? "Did you turn the security camera back ON?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeConfirm}>Not yet</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirm(null);
                onCheckOut();
              }}
            >
              Yes, camera is ON
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}






function fmtHM(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Splits "07:30 AM" into value + meridiem so the suffix can be de-emphasised. */
function splitClock(d: Date) {
  const s = fmtHM(d);
  const m = s.match(/^(.*?)\s*([AaPp][Mm])$/);
  return m ? { time: m[1], suffix: m[2].toUpperCase() } : { time: s, suffix: "" };
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Day context for a shift, derived from its actual timestamp (never from a
 * manually offset weekday), so midnight and week boundaries stay correct.
 *
 * today → "Today", tomorrow → "Tomorrow", within 6 days → "Wed, Aug 19",
 * beyond → "Mon, Aug 24".
 */
function shiftDayLabel(shiftStart: Date, now: Date) {
  const days = Math.round(
    (startOfDay(shiftStart).getTime() - startOfDay(now).getTime()) / 86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return shiftStart.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fullDateLabel(d: Date) {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function IconTile({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">
      {children}
    </div>
  );
}

function BigClock({ date, tone }: { date: Date; tone?: "urgent" | "go" }) {
  const { time, suffix } = splitClock(date);
  return (
    <span
      className={`text-3xl font-semibold tabular-nums tracking-tight sm:text-[2.35rem] ${
        tone === "urgent" ? "text-destructive" : tone === "go" ? "text-primary" : ""
      }`}
    >
      {time}
      {suffix ? (
        <span className="ml-1 align-baseline text-lg font-medium text-muted-foreground sm:text-xl">
          {suffix}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Time to Leave.
 *
 * The route comes from a persisted travel snapshot (calculated once per plan
 * identity); everything time-based below is derived locally from that
 * snapshot plus `now`, so the live clock never causes a network request.
 *
 * Compact view: the departure clock only.
 * Detailed view: at most three sections — the fastest overall route and the
 * two fastest direct alternatives.
 */
function TimeToLeaveCard({
  username,
  scheduled,
  now,
  homeLat,
  homeLng,
  variant = "default",
  onDeparture,
}: {
  username: string | null;
  scheduled: ScheduledShift[];
  now: Date;
  homeLat?: number | null;
  homeLng?: number | null;
  variant?: "default" | "hero" | "embedded";
  /** Reports the planned departure time so the dashboard can remind about it. */
  onDeparture?: (iso: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // The studio (destination) is an admin-managed setting: a plan calculated to
  // the old address must never be reused after it moves, so its coordinates
  // are part of the plan identity.
  const loadSettings = useServerFn(getAppSettings);
  const [studio, setStudio] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    let alive = true;
    loadSettings()
      .then((s) => {
        if (alive) setStudio({ lat: s.studio.lat, lng: s.studio.lng });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [loadSettings]);

  const next = useMemo(() => {
    const upcoming = buildDisplayShifts(scheduled, now).filter(
      (s) => s.endAt.getTime() > now.getTime(),
    );
    return upcoming[0] ?? null;
    // `now` ticks every second; only the shift set actually matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduled]);

  const shiftIso = next?.startAt.toISOString() ?? null;
  const shiftEndIso = next?.endAt.toISOString() ?? null;

  const identity = useMemo(
    () =>
      username && shiftIso && shiftEndIso && studio
        ? {
            username,
            shiftStartIso: shiftIso,
            shiftEndIso,
            homeLat: homeLat ?? null,
            homeLng: homeLng ?? null,
            studioLat: studio.lat,
            studioLng: studio.lng,
          }
        : null,
    [username, shiftIso, shiftEndIso, homeLat, homeLng, studio],
  );

  const { snapshot, status, reason } = useTravelPlan(identity);

  // Time to leave always follows Option 1 (the fastest overall route).
  const departureIso = snapshot?.best.leave_iso ?? snapshot?.departure_iso ?? null;
  const reportDeparture = onDeparture;
  useEffect(() => {
    reportDeparture?.(departureIso);
  }, [departureIso, reportDeparture]);

  if (!next) return null;

  const shiftStart = next.startAt;
  const shiftClock = splitClock(shiftStart);
  const departure = departureIso ? new Date(departureIso) : null;
  const minutesUntilLeave = departure
    ? Math.round((departure.getTime() - now.getTime()) / 60_000)
    : null;
  const urgent = minutesUntilLeave !== null && minutesUntilLeave <= 10;
  const hero = variant === "hero";
  const embedded = variant === "embedded";

  return (
    <Card
      className={
        embedded
          ? "overflow-hidden rounded-none border-0 bg-transparent shadow-none"
          : `overflow-hidden max-lg:glass max-lg:rounded-[22px] ${hero ? "border-primary/40" : ""}`
      }
    >
      <CardContent className="p-0">
        {/* ── Header: shift context + the one number that matters ───────── */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide travel details" : "Show travel details"}
          className="flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-muted/30 sm:px-6 sm:py-5"
        >
          <IconTile>
            <CalendarDays className="h-5 w-5" />
          </IconTile>

          <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <div className="min-w-0 sm:flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Next shift
              </div>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
                <span className="truncate">{shiftDayLabel(shiftStart, now)}</span>
                <span className="text-muted-foreground">·</span>
                <span className="tabular-nums">{shiftClock.time}</span>
                {shiftClock.suffix ? (
                  <span className="text-base font-medium text-muted-foreground">
                    {shiftClock.suffix}
                  </span>
                ) : null}
              </div>
              {expanded ? (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {fullDateLabel(shiftStart)}
                </div>
              ) : null}
            </div>

            <div className="min-w-0 sm:border-l sm:border-border sm:pl-5">
              <div
                className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${
                  urgent ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                Time to leave
              </div>
              <div className="mt-0.5">
                {departure ? (
                  <BigClock date={departure} tone={urgent ? "urgent" : "go"} />
                ) : (
                  <span className="text-3xl font-semibold tracking-tight text-muted-foreground">
                    {status === "loading" ? "…" : "—"}
                  </span>
                )}
              </div>
            </div>
          </div>

          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground">
            <ChevronDown
              className={`h-4.5 w-4.5 transition-transform duration-300 ${
                expanded ? "rotate-180" : ""
              }`}
            />
          </span>
        </button>

        {/* ── Expanded detail: best option + up to two direct options ───── */}
        <div
          className={`grid transition-all duration-300 ease-out ${
            expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <div className="border-t border-border">
              {snapshot ? (
                <TimeToLeaveDetails snapshot={snapshot} />
              ) : (
                <div className="space-y-3 px-5 py-5 sm:px-6">
                  {reason === "no_home" ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Add your home address in Profile to plan your trip.
                      </p>
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/profile">
                          <Home className="mr-1.5 h-3.5 w-3.5" /> Open Profile
                        </Link>
                      </Button>
                    </>
                  ) : status === "loading" ? (
                    <p className="text-sm text-muted-foreground">Planning your trip…</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Route information is currently unavailable.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ModeIcon({
  mode,
  size = 14,
  variant = "outline",
}: {
  mode: string;
  size?: number;
  variant?: "filled" | "outline";
}) {
  // Ferry has no dedicated glyph — keep the lucide ship.
  if (mode === "ferry") return <Ship className="h-3.5 w-3.5" />;
  const Icon = transitIconFor(mode);
  return <Icon size={size} variant={variant} />;
}

/** Small low-emphasis label carrying the line number. */
function LineLabel({ line }: { line: string }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded border border-border px-1.5 text-[11px] font-semibold leading-none text-foreground">
      {line}
    </span>
  );
}

/** Timeline marker: the official mode mark. */
function ModeMarker({ mode }: { mode: string }) {
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-background text-foreground">
      <ModeIcon mode={mode} size={22} />
    </span>
  );
}


/** "S+U Gesundbrunnen Bhf (Berlin)" → "Gesundbrunnen" */
function cleanStop(name: string): string {
  return (
    name
      .replace(/\s*\([^)]*\)\s*$/, "")
      .replace(/,\s*Berlin\s*$/i, "")
      .replace(/^(S\+U|U\+S|S|U)\s+/i, "")
      .replace(/\s+(Bhf|Bahnhof)\.?$/i, "")
      .trim() || name
  );
}

function SectionShell({
  title,
  badge,
  total,
  children,
}: {
  title: string;
  badge?: string;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-muted/20 p-4">
      <header className="flex items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {title}
        </h3>
        {badge ? (
          <span className="rounded-md bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
            {badge}
          </span>
        ) : null}
        <span className="ml-auto text-sm font-semibold tabular-nums">{total} min</span>
      </header>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** One row of the vertical journey timeline. */
function StepRow({
  marker,
  children,
  last = false,
}: {
  marker: React.ReactNode;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        {marker}
        {last ? null : <span className="w-px flex-1 bg-border" />}
      </div>
      <div className={`min-w-0 flex-1 ${last ? "pb-0" : "pb-4"}`}>{children}</div>
    </div>
  );
}

function EndpointMarker({ kind = "home" }: { kind?: "home" | "studio" }) {
  const Icon = kind === "home" ? Home : Building2;
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-background text-foreground">
      <Icon className="h-4 w-4" strokeWidth={1.6} />
    </span>
  );
}


type TransitLeg = Extract<JourneyPlan["legs"][number], { kind: "transit" }>;

/**
 * Turns the raw leg list into display rows: a transit row per service, with
 * same-station transfers and adjoining walks folded into a single note line.
 */
function buildRows(plan: JourneyPlan) {
  const legs = plan.legs;
  const rows: { leg: TransitLeg; note: string | null }[] = [];
  let leadNote: string | null = null;

  const nextTransit = (from: number): TransitLeg | null => {
    for (let i = from; i < legs.length; i++) {
      const l = legs[i];
      if (l.kind === "transit") return l;
    }
    return null;
  };

  legs.forEach((leg, i) => {
    if (leg.kind === "transit") {
      rows.push({ leg, note: null });
      return;
    }
    const upcoming = nextTransit(i + 1);
    let note: string | null;
    if (!upcoming) {
      note = `${leg.minutes} min walk to studio`;
    } else if (leg.kind === "transfer" || leg.minutes <= 2 || !leg.to_label) {
      note = `Transfer to ${upcoming.line}`;
    } else {
      note = `${leg.minutes} min walk to ${cleanStop(leg.to_label)}`;
    }
    if (rows.length === 0) {
      const fallback = leg.kind === "walk" ? (leg.to_label ?? "") : "";
      const target = upcoming ? cleanStop(upcoming.from_stop || fallback) : "";
      leadNote = target ? `${leg.minutes} min walk to ${target}` : `${leg.minutes} min walk`;
    } else {
      rows[rows.length - 1].note = note;
    }
  });

  return { rows, leadNote };
}

function Endpoint({
  time,
  label,
  address,
  last = false,
}: {
  time: string;
  label: string;
  address?: string | null;
  last?: boolean;
}) {
  return (
    <StepRow marker={<EndpointMarker kind="studio" />} last={last}>
      <div className="text-xs text-muted-foreground tabular-nums">{time}</div>
      <div className="text-sm">
        <span className="font-semibold">{label}</span>
        {address ? <span className="text-muted-foreground"> · {address}</span> : null}
      </div>
    </StepRow>
  );
}

function BestOptionSection({
  plan,
  alsoDirect,
  homeAddress,
  studioAddress,
}: {
  plan: JourneyPlan;
  alsoDirect: boolean;
  homeAddress?: string | null;
  studioAddress?: string | null;
}) {
  const { rows, leadNote } = buildRows(plan);
  return (
    <SectionShell
      title="Best option"
      badge={alsoDirect ? "Fastest · direct" : "Fastest"}
      total={plan.total_minutes}
    >
      <div>
        <StepRow marker={<EndpointMarker />}>
          <div className="text-xs text-muted-foreground tabular-nums">
            {fmtHM(new Date(plan.leave_iso))}
          </div>
          <div className="text-sm">
            <span className="font-semibold">Home</span>
            {homeAddress ? <span className="text-muted-foreground"> · {homeAddress}</span> : null}
          </div>
          {leadNote ? (
            <div className="mt-0.5 text-sm text-muted-foreground">{leadNote}</div>
          ) : null}
        </StepRow>

        {rows.map(({ leg, note }, i) => (
          <StepRow key={i} marker={<ModeMarker mode={leg.mode} />}>
            <div className="text-xs text-muted-foreground tabular-nums">
              {fmtHM(new Date(leg.departure_iso))}
            </div>
            <div className="flex items-start gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <LineLabel line={leg.line} />
                <span className="min-w-0 truncate text-sm font-semibold">
                  {cleanStop(leg.from_stop)} → {cleanStop(leg.to_stop)}
                </span>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {leg.minutes} min
              </span>
            </div>
            {note ? <div className="mt-0.5 text-sm text-muted-foreground">{note}</div> : null}
          </StepRow>
        ))}


        <Endpoint
          time={fmtHM(new Date(plan.arrive_iso))}
          label="Studio"
          address={studioAddress}
          last
        />
      </div>
    </SectionShell>
  );
}

function DirectOptionSection({ title, route }: { title: string; route: DirectPlan }) {
  return (
    <SectionShell title={title} total={route.total_minutes}>
      <div className="flex items-start gap-3">
        <ModeMarker mode={route.mode} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <LineLabel line={route.line} />
            <span className="min-w-0 truncate font-medium">
              {cleanStop(route.from_stop)} → {cleanStop(route.to_stop)}
            </span>
          </div>
          <div className="text-sm text-muted-foreground tabular-nums">
            {fmtHM(new Date(route.departure_iso))}–{fmtHM(new Date(route.arrival_iso))}
          </div>

          <div className="mt-0.5 text-sm text-muted-foreground tabular-nums">
            {route.walk_to_minutes} min walk · {modeLabel(route.mode).toLowerCase()}{" "}
            {route.ride_minutes} min · {route.walk_from_minutes} min walk — leave{" "}
            {fmtHM(new Date(route.leave_iso))}, arrive {fmtHM(new Date(route.arrive_iso))}
          </div>
        </div>
      </div>
    </SectionShell>
  );
}

function TimeToLeaveDetails({ snapshot }: { snapshot: TimeToLeaveSnapshot }) {
  const best = snapshot.best;
  const bestLine = best.legs.find((l): l is TransitLeg => l.kind === "transit") ?? null;

  // A direct route identical to the best option is labelled, never duplicated.
  const sameAsBest = (r: DirectPlan) =>
    best.direct && bestLine?.line === r.line && bestLine?.departure_iso === r.departure_iso;
  const directs = snapshot.direct_routes.filter((r) => !sameAsBest(r)).slice(0, 2);
  const alsoDirect = best.direct && snapshot.direct_routes.some(sameAsBest);

  const homeAddress =
    snapshot.home_label && snapshot.home_label.trim().toLowerCase() !== "home"
      ? snapshot.home_label.trim()
      : null;
  const studioAddress =
    snapshot.office_label && snapshot.office_label.trim().toLowerCase() !== "studio"
      ? snapshot.office_label.trim()
      : null;

  return (
    <div className="space-y-3 px-4 py-4 sm:px-6 sm:py-5">
      <BestOptionSection
        plan={best}
        alsoDirect={alsoDirect}
        homeAddress={homeAddress}
        studioAddress={studioAddress}
      />
      {directs[0] ? <DirectOptionSection title="Direct option 1" route={directs[0]} /> : null}
      {directs[1] ? <DirectOptionSection title="Direct option 2" route={directs[1]} /> : null}
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
