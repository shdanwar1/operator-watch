import { PAGE_TITLES, pageMeta } from "@/lib/page-titles";
import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGateStatus } from "@/lib/gate.functions";
import {
  listScheduledShifts,
  listShifts,
  createScheduledShift,
  updateScheduledShift,
  deleteScheduledShift,
  type ScheduledShiftRow,
  type ShiftRow,
} from "@/lib/shifts.functions";
import {
  getMyCalendarUrl,
  checkMyCalendarHealth,
  getMyCalendarSyncStatus,
} from "@/lib/gcal.functions";

import { useCalendarSync, useSyncListener } from "@/hooks/useCalendarSync";
import { operatorNamespace, readCache, writeCache } from "@/lib/local-cache";
import { AppShell, PageHeader } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Trash2, Save, RefreshCw } from "lucide-react";
import { ShiftOverviewDialog } from "@/components/ShiftOverviewDialog";
import { toast, Toaster } from "sonner";
import { MobileCalendar } from "@/components/MobileCalendar";
import { buildDisplayShifts, currentOrNextShift } from "@/lib/display-shifts";

export const Route = createFileRoute("/calendar")({
  beforeLoad: async () => {
    const status = await getGateStatus();
    if (!status.unlocked) throw redirect({ to: "/unlock" });
    if (status.isAdmin) throw redirect({ to: "/admin" });
    return { username: status.username ?? "" };
  },
  loader: ({ context }) => ({ username: (context as { username: string }).username }),
  head: () => ({
    meta: pageMeta(
      PAGE_TITLES.calendar,
      "Month view of your scheduled studio operator shifts and classes.",
    ),
  }),
  component: CalendarPage,
});

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeek(d: Date) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  const offset = (c.getDay() + 6) % 7;
  c.setDate(c.getDate() - offset);
  return c;
}

function addDays(d: Date, n: number) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function fmtTime(t: string) {
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

function formatTime24(t: string) {
  const [h, m] = t.split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}

/** Number of classes encoded in the shift label, when present. */
function classCount(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = label.match(/(\d+)\s*(?:x\s*)?class/i) ?? label.match(/^\s*(\d+)\s*$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 && n <= 20 ? n : null;
}

type Instance = {
  shift: ScheduledShiftRow;
  startAt: Date;
  endAt: Date;
};

function instancesFor(
  day: Date,
  scheduled: ScheduledShiftRow[],
  overrides: Set<string>,
): Instance[] {
  const out: Instance[] = [];
  for (const s of scheduled) {
    const applies = s.specific_date
      ? s.specific_date === dateKey(day)
      : day.getDay() === s.day_of_week && !overrides.has(dateKey(day));
    if (!applies) continue;
    const [sh, sm] = s.start_time.split(":").map((n) => parseInt(n, 10));
    const [eh, em] = s.end_time.split(":").map((n) => parseInt(n, 10));
    const startAt = new Date(day);
    startAt.setHours(sh, sm, 0, 0);
    const endAt = new Date(day);
    endAt.setHours(eh, em, 0, 0);
    out.push({ shift: s, startAt, endAt });
  }
  return out.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

type EditorState =
  | { mode: "create"; date: Date }
  | { mode: "edit"; date: Date; instance: Instance };

function CalendarPage() {
  const { username } = Route.useLoaderData();
  const fetchScheduled = useServerFn(listScheduledShifts);
  const fetchShifts = useServerFn(listShifts);
  const createSched = useServerFn(createScheduledShift);
  const updateSched = useServerFn(updateScheduledShift);
  const deleteSched = useServerFn(deleteScheduledShift);
  const getUrlFn = useServerFn(getMyCalendarUrl);

  type CalendarSnapshot = { scheduled: ScheduledShiftRow[]; logged: ShiftRow[] };
  const calendarCacheKey = username ? `${operatorNamespace(username)}calendar` : null;
  const [cachedCalendar] = useState<CalendarSnapshot | null>(() =>
    calendarCacheKey ? readCache<CalendarSnapshot>(calendarCacheKey) : null,
  );

  const [scheduled, setScheduled] = useState<ScheduledShiftRow[]>(cachedCalendar?.scheduled ?? []);
  const [logged, setLogged] = useState<ShiftRow[]>(cachedCalendar?.logged ?? []);
  const [loading, setLoading] = useState(!cachedCalendar);
  const [monthOffset, setMonthOffset] = useState(0);
  const [editor, setEditor] = useState<EditorState | null>(null);
  // Clicking an existing shift opens the read-only overview first.
  const [overview, setOverview] = useState<ScheduledShiftRow | null>(null);
  const [icsUrl, setIcsUrl] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);

  // Google Calendar import is manual-only and current-month-only; there are
  // no operator sync preferences to load here anymore.

  // Match trace is a debug-only surface: opt in with ?debug=1.
  useEffect(() => {
    if (typeof window !== "undefined") {
      setDebug(new URLSearchParams(window.location.search).get("debug") === "1");
    }
  }, []);

  const hasGoogleCalendar = !!icsUrl;

  const hasLoadedOnce = useRef(!!cachedCalendar);
  const load = useCallback(async () => {
    if (!hasLoadedOnce.current) setLoading(true);
    try {
      const [sched, rows] = await Promise.all([fetchScheduled(), fetchShifts()]);
      setScheduled(sched);
      setLogged(rows);
      if (calendarCacheKey)
        writeCache<CalendarSnapshot>(calendarCacheKey, { scheduled: sched, logged: rows });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      hasLoadedOnce.current = true;
    }
  }, [fetchScheduled, fetchShifts, calendarCacheKey]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    getUrlFn()
      .then((r) => {
        if (!cancelled) setIcsUrl(r.icsUrl);
      })
      .catch(() => {
        /* non-fatal */
      });
    return () => {
      cancelled = true;
    };
  }, [getUrlFn]);

  // Link health drives the status dot, independently of automatic sync.
  const healthFn = useServerFn(checkMyCalendarHealth);
  type Health = { connected: boolean; ok: boolean; error?: string };
  const healthCacheKey = username ? `${operatorNamespace(username)}calendar-health` : null;
  const [health, setHealth] = useState<Health | null>(() =>
    healthCacheKey ? readCache<Health>(healthCacheKey) : null,
  );
  const refreshHealth = useCallback(() => {
    healthFn()
      .then((h) => {
        setHealth(h);
        if (healthCacheKey) writeCache<Health>(healthCacheKey, h);
      })
      .catch(() => {
        /* keep the last known state rather than flashing an error */
      });
  }, [healthFn, healthCacheKey]);
  useEffect(() => {
    refreshHealth();
  }, [refreshHealth, icsUrl]);

  const {
    syncing,
    lastSync,
    setLastSync,
    logs: matchLogs,
    runSync,
  } = useCalendarSync({
    enabled: hasGoogleCalendar,
    onSynced: load,
    announce: true,
    cacheKey: username ? `${operatorNamespace(username)}calendar-sync` : null,
  });

  // Cross-device "Last synced": poll the authoritative server value while the
  // page is visible. This reads one operator column and never triggers an
  // import — a sync performed on another device shows up here on its own.
  const syncStatusFn = useServerFn(getMyCalendarSyncStatus);
  const syncCacheKey = username ? `${operatorNamespace(username)}calendar-sync` : null;
  const lastSyncRef = useRef<number | null>(lastSync ? lastSync.getTime() : null);
  lastSyncRef.current = lastSync ? lastSync.getTime() : null;
  useEffect(() => {
    if (!hasGoogleCalendar) return;
    let cancelled = false;
    const check = () => {
      syncStatusFn()
        .then((res) => {
          if (cancelled) return;
          const iso = res.calendarLastSyncAt;
          const ms = iso ? new Date(iso).getTime() : null;
          if (ms === lastSyncRef.current) return;
          setLastSync(ms ? new Date(ms) : null);
          if (syncCacheKey && ms) writeCache<number>(syncCacheKey, ms);
        })
        .catch(() => {
          /* keep the last known value */
        });
    };
    check();

    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!interval) interval = setInterval(check, 60_000);
    };
    const stop = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        check();
        start();
      } else {
        stop();
      }
    };
    if (typeof document !== "undefined" && document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hasGoogleCalendar, syncStatusFn, syncCacheKey, setLastSync]);

  // Another view finished a sync — pull the newly generated shifts in.
  useSyncListener(() => {
    load();
  });


  const now = new Date();
  const confirmedError = health !== null && !health.ok;
  const showSyncStatus = true;
  const syncStatusLabel = confirmedError
    ? health?.connected
      ? "Link error"
      : "Not connected"
    : lastSync
      ? `Last synced ${formatLastSynced(lastSync, now)}`
      : health === null
        ? "Checking…"
        : "Not synced yet";

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const monthStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);

  const overrides = useMemo(
    () => new Set(scheduled.map((s) => s.specific_date).filter((v): v is string => !!v)),
    [scheduled],
  );

  const loggedByDay = useMemo(() => {
    const map = new Map<string, ShiftRow[]>();
    for (const r of logged) {
      const k = dateKey(new Date(r.check_in_at));
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return map;
  }, [logged]);

  // Full weeks covering the visible month (Apple Calendar style grid).
  const weeks: Date[][] = useMemo(() => {
    const gridStart = startOfWeek(monthStart);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    const w: Date[][] = [];
    let cursor = gridStart;
    while (cursor <= monthEnd || w.length < 5) {
      w.push(Array.from({ length: 7 }, (_, d) => addDays(cursor, d)));
      cursor = addDays(cursor, 7);
      if (w.length >= 6) break;
    }
    return w;
  }, [monthStart]);

  // Mobile: default selection follows the existing next-shift rule.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const didDefault = useRef(false);
  useEffect(() => {
    if (didDefault.current || loading) return;
    didDefault.current = true;
    const n = new Date();
    const next = currentOrNextShift(buildDisplayShifts(scheduled, n), n);
    const target = next ? next.startAt : n;
    setSelectedKey(dateKey(target));
    setMonthOffset(
      (target.getFullYear() - n.getFullYear()) * 12 + target.getMonth() - n.getMonth(),
    );
  }, [loading, scheduled]);

  const monthLabel = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  async function handleSave(payload: { start_time: string; end_time: string; label: string }) {
    if (!editor) return;
    try {
      if (editor.mode === "create") {
        await createSched({
          data: {
            start_time: payload.start_time,
            end_time: payload.end_time,
            label: payload.label,
            specific_date: dateKey(editor.date),
          },
        });
        toast.success("Shift added");
      } else {
        await updateSched({
          data: {
            id: editor.instance.shift.id,
            patch: {
              start_time: payload.start_time,
              end_time: payload.end_time,
              label: payload.label,
            },
          },
        });
        toast.success("Shift updated");
      }
      setEditor(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function handleDelete() {
    if (!editor || editor.mode !== "edit") return;
    try {
      await deleteSched({ data: { id: editor.instance.shift.id } });
      toast.success("Shift removed");
      setEditor(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <AppShell>
      <Toaster richColors position="top-center" />

      <PageHeader
        title="Calendar"
        action={
          <div className="flex items-center gap-1.5">
            {showSyncStatus && (
              <span
                className="mr-1 hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex"
                title={
                  confirmedError
                    ? (health?.error ??
                      (health?.connected
                        ? "Google Calendar link error"
                        : "Google Calendar not connected"))
                    : undefined
                }
              >
                <span
                  aria-hidden
                  className={cn(
                    "inline-block size-2 rounded-full",
                    confirmedError
                      ? "bg-red-500"
                      : health === null
                        ? "bg-muted-foreground/40"
                        : "bg-emerald-500",
                  )}
                />
                {syncStatusLabel}
              </span>
            )}

            {hasGoogleCalendar ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => runSync()}
                disabled={syncing}
                title="Sync shifts from your Google Calendar"
              >
                <RefreshCw className={`h-4 w-4 sm:mr-1 ${syncing ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">{syncing ? "Syncing…" : "Sync"}</span>
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm" title="Set up your Google Calendar link">
                <Link to="/profile">
                  <RefreshCw className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Connect calendar</span>
                </Link>
              </Button>
            )}
          </div>
        }
      />

      {debug && matchLogs.length ? (
        <Card className="mb-4">
          <CardContent className="p-4">
            <h2 className="mb-2 text-sm font-semibold">Calendar match log (debug)</h2>
            <div className="max-h-72 space-y-1 overflow-auto text-xs">
              {matchLogs.map((l, i) => (
                <div
                  key={`${l.title}-${i}`}
                  className="flex flex-wrap items-baseline gap-x-2 border-b border-border/60 py-1"
                >
                  <span className={l.accepted ? "font-medium text-done" : "text-muted-foreground"}>
                    {l.accepted ? "Imported" : "Ignored"}
                  </span>
                  <span className="font-medium">{l.title}</span>
                  {l.accepted ? (
                    <span className="text-muted-foreground">
                      → {l.className} · {l.teacherName}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground">{l.reason}</span>
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {l.confidence}%
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="lg:hidden">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <MobileCalendar
            weeks={weeks}
            monthStart={monthStart}
            monthLabel={monthLabel}
            today={today}
            now={now}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            onPrev={() => setMonthOffset((n) => n - 1)}
            onNext={() => setMonthOffset((n) => n + 1)}
            onToday={() => {
              setMonthOffset(0);
              setSelectedKey(dateKey(new Date()));
            }}
            instancesOn={(day) => instancesFor(day, scheduled, overrides)}
            loggedOn={(day) => loggedByDay.get(dateKey(day)) ?? []}
            onOpenShift={(s) => setOverview(s)}
          />
        )}
      </div>

      <div className="hidden lg:block">
      <div className="mb-4 flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => setMonthOffset((n) => n - 1)}
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-[180px] text-[15px] font-medium tracking-tight">{monthLabel}</div>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => setMonthOffset(0)}
          disabled={monthOffset === 0}
        >
          Today
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => setMonthOffset((n) => n + 1)}
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Card className="rise-in overflow-hidden max-lg:glass max-lg:rounded-[22px]">
          <CardContent className="p-0">
            <div className="grid grid-cols-7 border-b border-border/60">
              {DAY_LABELS.map((d) => (
                <div
                  key={d}
                  className="px-3 py-2 text-center text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground max-lg:px-0 max-lg:text-[9px] max-lg:tracking-[0.1em]"
                >
                  {d}
                </div>
              ))}
            </div>

            <div className="divide-y divide-border/60">
              {weeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7">
                  {week.map((day) => {
                    const key = dateKey(day);
                    const inMonth = day.getMonth() === monthStart.getMonth();
                    const isPastDay = day.getTime() < today.getTime();
                    const isToday = day.getTime() === today.getTime();
                    const insts = instancesFor(day, scheduled, overrides);
                    const dayLogged = loggedByDay.get(key) ?? [];
                    return (
                      <div
                        key={key}
                        className={`group relative min-h-[104px] border-border/60 p-1.5 max-lg:min-h-[74px] max-lg:border-b max-lg:border-r max-lg:p-1 max-lg:[&:nth-child(7n)]:border-r-0 sm:min-h-[124px] sm:border-r sm:last:border-r-0 ${
                          inMonth ? "" : "opacity-40"
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span
                            className={`text-xs tabular-nums max-lg:text-[10px] ${
                              isToday
                                ? "flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background font-medium max-lg:h-[22px] max-lg:w-[22px]"
                                : isPastDay
                                  ? "text-muted-foreground"
                                  : "text-foreground"
                            }`}
                          >
                            {day.getDate()}
                          </span>
                          {!isPastDay && (
                            <button
                              type="button"
                              onClick={() => setEditor({ mode: "create", date: day })}
                              className="rounded-md px-1 text-xs text-muted-foreground opacity-0 transition hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                              aria-label="Add shift"
                            >
                              +
                            </button>
                          )}
                        </div>
                        <div className="space-y-1">
                          {insts.map((inst, i) => {
                            const past = inst.endAt.getTime() < now.getTime();
                            const hasLog = dayLogged.some(
                              (l) => l.scheduled_shift_id === inst.shift.id,
                            );
                            // Completion is written on checkout; operators see
                            // completed shifts as read-only history.
                            const completed =
                              (inst.shift.status ?? "").toLowerCase() === "completed";
                            const n = classCount(inst.shift.label);
                            const tone = completed
                              ? "border-border/50 bg-muted/40 text-muted-foreground opacity-60"
                              : hasLog
                                ? "border-done/40 bg-done/10"
                                : past
                                  ? "border-border/60 bg-muted/50 text-muted-foreground"
                                  : "border-live/40 bg-live/10 hover:bg-live/20";
                            const body = (
                              <>
                                {/* Desktop: 12-hour range + class count/label */}
                                <div className="hidden lg:block">
                                  <div className="truncate font-medium tabular-nums">
                                    {fmtTime(inst.shift.start_time)} –{" "}
                                    {fmtTime(inst.shift.end_time)}
                                    {inst.shift.end_time <= inst.shift.start_time ? " (+1)" : ""}
                                  </div>
                                  <div className="truncate text-muted-foreground">
                                    {completed
                                      ? "✓ Completed"
                                      : n
                                        ? `${n} ${n === 1 ? "class" : "classes"}`
                                        : (inst.shift.label ?? "Shift")}
                                  </div>
                                </div>

                                {/* Mobile: single-line 24-hour range only */}
                                <div className="whitespace-nowrap text-center text-[7px] font-medium tabular-nums tracking-tight leading-none lg:hidden">
                                  {completed ? "✓ " : ""}
                                  {formatTime24(inst.shift.start_time)}-
                                  {formatTime24(inst.shift.end_time)}
                                </div>
                              </>
                            );
                            const cls = `w-full rounded-lg border px-2 py-1 text-left text-[11px] leading-tight transition max-lg:rounded-[6px] max-lg:px-[2px] max-lg:py-[3px] ${tone}`;
                            return completed ? (
                              <div
                                key={`${inst.shift.id}-${i}`}
                                className={cls}
                                aria-label="Completed shift"
                                title="Completed"
                              >
                                {body}
                              </div>
                            ) : (
                              <button
                                key={`${inst.shift.id}-${i}`}
                                type="button"
                                onClick={() => setOverview(inst.shift)}
                                className={`press ${cls}`}
                                title={inst.shift.label ?? ""}
                              >
                                {body}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      </div>

      <ShiftOverviewDialog
        shift={overview}
        onClose={() => setOverview(null)}
        onChanged={load}
      />

      <ShiftEditorDialog
        state={editor}
        onClose={() => setEditor(null)}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </AppShell>
  );
}

function ShiftEditorDialog({
  state,
  onClose,
  onSave,
  onDelete,
}: {
  state: EditorState | null;
  onClose: () => void;
  onSave: (p: { start_time: string; end_time: string; label: string }) => void;
  onDelete: () => void;
}) {
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("13:00");
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!state) return;
    if (state.mode === "edit") {
      setStartTime(state.instance.shift.start_time.slice(0, 5));
      setEndTime(state.instance.shift.end_time.slice(0, 5));
      setLabel(state.instance.shift.label ?? "");
    } else {
      setStartTime("09:00");
      setEndTime("13:00");
      setLabel("");
    }
  }, [state]);

  if (!state) return null;

  const isEdit = state.mode === "edit";
  const dayLabel = state.date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  function submit() {
    if (!startTime || !endTime) return toast.error("Start and end times are required");
    if (endTime <= startTime) return toast.error("End must be after start");
    onSave({ start_time: startTime, end_time: endTime, label: label.trim() });
  }

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Shift details" : "Add shift"}</DialogTitle>
          <DialogDescription>{dayLabel}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Start</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>End</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Label (optional)</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. 4 classes"
            />
          </div>
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          {isEdit ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-1 h-4 w-4" /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit}>
              <Save className="mr-1 h-4 w-4" /> Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatLastSynced(synced: Date, now: Date): string {
  const time =
    `${String(synced.getHours()).padStart(2, "0")}:` +
    `${String(synced.getMinutes()).padStart(2, "0")}`;

  const startOfDay = (d: Date) => {
    const s = new Date(d);
    s.setHours(0, 0, 0, 0);
    return s;
  };

  const dayDiff = Math.round(
    (startOfDay(now).getTime() - startOfDay(synced).getTime()) / 86_400_000,
  );

  if (dayDiff <= 0) return `${time} today`;
  if (dayDiff < 7) return `${time} on ${synced.toLocaleDateString(undefined, { weekday: "long" })}`;
  return `${time} on ${synced.getDate()} ${synced.toLocaleDateString(undefined, { month: "long" })}`;
}
