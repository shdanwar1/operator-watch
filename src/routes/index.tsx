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
import { ARRIVAL_BUFFER_MIN } from "@/lib/travel.functions";
import { useTravelPlan } from "@/hooks/useTravelPlan";
import { snapshotMapsUrl, type TimeToLeaveSnapshot } from "@/lib/travel-snapshot";
import { getMyPrefs, DEFAULT_PREFS, type OperatorPrefs } from "@/lib/prefs.functions";
import { useReminders, type Reminder } from "@/hooks/useReminders";
import { useCachedResource } from "@/hooks/useCachedResource";
import { operatorNamespace, readCache, writeCache } from "@/lib/local-cache";
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
import { Plus, X, Clock, LogIn, CalendarDays, Train, Home, MapPin, AlertTriangle, Lock, Navigation, ArrowRight, Briefcase, ChevronDown } from "lucide-react";
import { RouteMapPreview } from "@/components/RouteMapPreview";
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
import { AppShell, PageHeader, SectionTitle } from "@/components/AppShell";
import { HoldButton } from "@/components/HoldButton";
import { StudioActivation } from "@/components/StudioActivation";
import {
  buildDisplayShifts,
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
  const [departureIso, setDepartureIso] = useState<string | null>(null);
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

  // Continuous "display shifts": raw rows split at midnight are merged back
  // into the single operator shift they represent.
  const displayShifts = buildDisplayShifts(scheduled, now);
  const upcomingDisplay = displayShifts.filter((s) => s.endAt.getTime() > now.getTime());
  const nextDisplay = upcomingDisplay[0] ?? null;

  // Time to Leave shows for the entire runway up to the shift starting —
  // not just the last hour — since sign-in itself is no longer gated to a
  // narrow window either. It's still tied to having an actual upcoming
  // scheduled shift; once that shift starts, there's nothing left to count
  // down to and Check In (always available below) takes over.
  const minutesToNext = nextDisplay
    ? Math.round((nextDisplay.startAt.getTime() - now.getTime()) / 60000)
    : Infinity;
  const showTimeToLeave = !active && nextDisplay !== null && minutesToNext > 0;

  // Reminders — only for the next shift, and only while it is still ahead.
  const reminders: Reminder[] = [];
  if (prefsLoaded && nextDisplay && !active) {
    const startAt = nextDisplay.startAt;
    const stamp = startAt.toISOString();
    if (prefs.notifyShiftStart) {
      reminders.push({
        key: `shift-start:${stamp}`,
        at: new Date(startAt.getTime() - 15 * 60_000),
        title: "Shift starts in 15 minutes",
        body: `${fmtHM(startAt)} — get ready to check in.`,
      });
    }
    if (prefs.notifyTimeToLeave && departureIso) {
      reminders.push({
        key: `leave:${stamp}`,
        at: new Date(departureIso),
        title: "Time to leave",
        body: `Leave now to arrive before your ${fmtHM(startAt)} shift.`,
      });
    }
  }
  useReminders(reminders, prefsLoaded && (prefs.notifyShiftStart || prefs.notifyTimeToLeave));



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
      toast.success("Match saved — future syncs will use it");
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
      const patch: Partial<Shift> = { check_out_at: new Date().toISOString() };
      if (completed.length) patch.classes = completed;
      await updateShiftServer({
        data: { id: active.id, patch },
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

      <PageHeader eyebrow="Operator dashboard" title={`${greeting(now)}, ${username}.`} />

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
              onSetClassStatus={setClassStatus}
              onCorrectClassMatch={correctClassMatch}
            />
          ) : (
            <>
              {showTimeToLeave &&
                prefs.showTimeToLeave &&
                (checkInLocked ? (
                  <LockedFeatureCard
                    icon={<Train className="h-4 w-4" />}
                    title="Time to Leave"
                    reason="Complete your profile to enable Time to Leave."
                    hero
                  />
                ) : (
                  <TimeToLeaveCard
                    username={username}
                    scheduled={scheduled}
                    now={now}
                    homeLat={profileStatus?.home_lat ?? null}
                    homeLng={profileStatus?.home_lng ?? null}
                    variant="hero"
                    onDeparture={setDepartureIso}
                  />
                ))}

              {/* Check In is always present — only its state changes. */}
              <div className="max-w-sm">
                {checkInLocked ? (
                  <LockedFeatureCard
                    icon={<LogIn className="h-4 w-4" />}
                    title="Check In"
                    reason="Complete your profile to enable Check In."
                  />
                ) : (
                  <CheckInPanel
                    openScheduled={openScheduled}
                    nextShift={nextDisplay}
                    now={now}
                    onCheckIn={checkIn}
                    checkingIn={checkingIn}
                  />
                )}
              </div>
            </>
          )}
        </div>

        <aside className="xl:sticky xl:top-24 xl:self-start">
          {!loading && (
            <UpcomingShifts shifts={upcomingDisplay} now={now} calendarClasses={calendarClasses} />
          )}
        </aside>
      </div>
    </AppShell>
  );
}



function UpcomingShifts({
  shifts,
  now,
  calendarClasses = [],
}: {
  /** Continuous (midnight-merged) shifts, already filtered to the future. */
  shifts: DisplayShift[];
  now: Date;
  /** Used to show how many classes a continuous shift contains. */
  calendarClasses?: CalendarClassRow[];
}) {
  const instances = shifts.slice(0, 6);
  return (
    <Card className="rise-in max-lg:glass max-lg:rounded-[22px]">
      <CardContent className="p-5">

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
      </CardContent>
    </Card>
  );
}





function CheckInPanel({
  openScheduled,
  nextShift,
  now,
  onCheckIn,
  checkingIn,
}: {
  openScheduled: ScheduledShift | null;
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
  const openStart = openScheduled ? instanceTimes(openScheduled, now).startAt : null;
  const lateMin = openStart ? minutesLate(openStart, now) : 0;
  const classCount = scheduledClassCount(openScheduled?.label);

  return (
    <Card className="rise-in overflow-hidden max-lg:glass max-lg:rounded-[22px]">
      <CardContent className="flex flex-col items-center gap-5 px-5 py-6 text-center max-lg:py-7">

        {hasShift ? (
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {openScheduled ? "Ready for check-in" : "Next scheduled shift"}
            </span>
            <p className="text-xs text-muted-foreground">
              {openScheduled ? (
                <>
                  {fmtTime(openScheduled.start_time)} – {fmtTime(openScheduled.end_time)}
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
      </CardContent>

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
            <div className="flex items-center justify-end">
              <HoldButton
                label="Hold to check out"
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

            <div className="flex items-center justify-end border-t border-border pt-4">
              <HoldButton
                label="Hold to check out"
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





/** Time-of-day greeting shown on the dashboard header. */
function greeting(d: Date) {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function fmtHM(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Time to Leave.
 *
 * The route comes from a persisted travel snapshot (calculated once per plan
 * identity); everything time-based below is derived locally from that
 * snapshot plus `now`, so the live clock never causes a network request.
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
  variant?: "default" | "hero";
  /** Reports the planned departure time so the dashboard can remind about it. */
  onDeparture?: (iso: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);

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
      username && shiftIso && shiftEndIso
        ? {
            username,
            shiftStartIso: shiftIso,
            shiftEndIso,
            homeLat: homeLat ?? null,
            homeLng: homeLng ?? null,
          }
        : null,
    [username, shiftIso, shiftEndIso, homeLat, homeLng],
  );

  const { snapshot, status, reason } = useTravelPlan(identity);

  const departureIso = snapshot?.departure_iso ?? null;
  const reportDeparture = onDeparture;
  useEffect(() => {
    reportDeparture?.(departureIso);
  }, [departureIso, reportDeparture]);

  if (!next) return null;

  const shiftStart = next.startAt;
  const departure = snapshot ? new Date(snapshot.departure_iso) : null;
  const minutesUntilLeave = departure
    ? Math.round((departure.getTime() - now.getTime()) / 60_000)
    : null;
  const urgent = minutesUntilLeave !== null && minutesUntilLeave <= 10;
  const hero = variant === "hero";

  return (
    <Card
      className={`overflow-hidden max-lg:glass max-lg:rounded-[22px] ${
        hero ? "border-primary/40" : ""
      }`}
    >
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide travel details" : "Show travel details"}
          className="flex w-full items-center gap-4 px-5 py-5 text-left transition-colors hover:bg-muted/40 sm:px-6"
        >
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Next shift
              </span>
              <span className="text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">
                {fmtHM(shiftStart)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span
                className={`text-xs font-medium uppercase tracking-[0.14em] ${
                  urgent ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                Time to leave
              </span>
              <span
                className={`text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl ${
                  urgent ? "text-destructive" : ""
                }`}
              >
                {departure ? fmtHM(departure) : status === "loading" ? "…" : "—"}
              </span>
            </div>
          </div>
          <ChevronDown
            className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300 ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </button>

        <div
          className={`grid transition-all duration-300 ease-out ${
            expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <div className="border-t border-border">
              {snapshot ? (
                <TimeToLeaveDetails snapshot={snapshot} now={now} />
              ) : (
                <div className="space-y-3 px-5 py-5 sm:px-6">
                  {reason === "no_home" ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Add your home address in Profile to enable navigation.
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

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function TimeToLeaveDetails({
  snapshot,
  now,
}: {
  snapshot: TimeToLeaveSnapshot;
  now: Date;
}) {
  const departure = new Date(snapshot.departure_iso);
  const arrival = new Date(snapshot.arrival_iso);
  const minutesUntilLeave = Math.round((departure.getTime() - now.getTime()) / 60_000);
  const leaveIn =
    minutesUntilLeave <= 0
      ? "Now"
      : minutesUntilLeave < 60
        ? `${minutesUntilLeave} min`
        : `${Math.floor(minutesUntilLeave / 60)}h ${minutesUntilLeave % 60}m`;

  return (
    <div className="space-y-5 px-5 py-5 sm:px-6">
      {/* Secondary timings */}
      <div className="space-y-2">
        <DetailRow label="Leave in" value={leaveIn} />
        <DetailRow label="Arrive by" value={fmtHM(arrival)} />
        <DetailRow
          label="Journey time"
          value={`${snapshot.travel_minutes} min`}
        />
        <DetailRow label="Transfers" value={snapshot.transfers} />
        <p className="text-[11px] text-muted-foreground">
          Includes a {ARRIVAL_BUFFER_MIN} min arrival buffer.
        </p>
      </div>

      {/* Route endpoints */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-border bg-muted/30 p-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Home className="h-3 w-3" /> Home
          </div>
          <div className="mt-1 truncate text-sm">{snapshot.home_label}</div>
        </div>
        <div className="min-w-0 rounded-2xl border border-border bg-muted/30 p-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Briefcase className="h-3 w-3" /> Studio
          </div>
          <div className="mt-1 truncate text-sm">{snapshot.office_label}</div>
        </div>
      </div>

      <Button className="w-full" asChild>
        <a href={snapshotMapsUrl(snapshot)} target="_blank" rel="noopener noreferrer">
          <Navigation className="mr-2 h-4 w-4" /> Start Navigation
        </a>
      </Button>

      {/* Route map — geometry comes from the stored snapshot. */}
      <div className="relative isolate h-[220px] overflow-hidden rounded-2xl border border-border sm:h-[260px]">
        <RouteMapPreview
          home={{ lat: snapshot.home_lat, lng: snapshot.home_lng }}
          office={{ lat: snapshot.office_lat, lng: snapshot.office_lng }}
          geometry={snapshot.route_geometry}
          className="absolute inset-0"
        />
        <div className="absolute right-3 top-3 z-[2] rounded-xl border border-border bg-background/90 px-3 py-2 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2">
            <Train className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold tabular-nums">
              {snapshot.travel_minutes} min
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {snapshot.transfers > 0
              ? `${snapshot.transfers} transfer${snapshot.transfers === 1 ? "" : "s"}`
              : "No transfer"}
          </div>
        </div>
      </div>

      {snapshot.direct_options.length > 0 ? (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Direct options
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {snapshot.direct_options.map((o) => (
              <div
                key={o.line + o.departure_iso}
                className="rounded-2xl border border-border bg-background/60 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Train className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 text-sm font-semibold text-primary">
                      {o.line}
                    </span>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {o.duration_minutes} min
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Leaves</div>
                    <div className="tabular-nums">{fmtHM(new Date(o.departure_iso))}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Arrives</div>
                    <div className="tabular-nums">{fmtHM(new Date(o.arrival_iso))}</div>
                  </div>
                </div>
                <div className="mt-2 truncate text-xs text-muted-foreground">
                  From {o.from_stop}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {o.walk_minutes} min walk · No transfer
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
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
