import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { syncGoogleCalendar, getMyCalendarUrl, setMyCalendarUrl } from "@/lib/gcal.functions";
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
import { ChevronLeft, ChevronRight, CalendarDays, ArrowLeft, Plus, Trash2, Save, RefreshCw, Settings2 } from "lucide-react";
import { toast, Toaster } from "sonner";

export const Route = createFileRoute("/calendar")({
  beforeLoad: async () => {
    const status = await getGateStatus();
    if (!status.unlocked) throw redirect({ to: "/unlock" });
    if (status.isAdmin) throw redirect({ to: "/admin" });
    return { username: status.username ?? "" };
  },
  loader: ({ context }) => ({ username: (context as { username: string }).username }),
  head: () => ({
    meta: [
      { title: "Shift Calendar — Studio Operator" },
      { name: "description", content: "Four-week calendar view of upcoming and past studio operator shifts." },
    ],
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
  // Monday-start week: Sunday (0) is 6 days after Monday, others shift by 1.
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

type Instance = {
  shift: ScheduledShiftRow;
  startAt: Date;
  endAt: Date;
};

function instancesFor(day: Date, scheduled: ScheduledShiftRow[], overrides: Set<string>): Instance[] {
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
  const syncFn = useServerFn(syncGoogleCalendar);
  const getUrlFn = useServerFn(getMyCalendarUrl);
  const setUrlFn = useServerFn(setMyCalendarUrl);

  const [scheduled, setScheduled] = useState<ScheduledShiftRow[]>([]);
  const [logged, setLogged] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [icsUrl, setIcsUrl] = useState<string | null>(null);
  const [calDialogOpen, setCalDialogOpen] = useState(false);
  const [calDraft, setCalDraft] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);

  const hasGoogleCalendar = !!icsUrl;
  void username;

  const load = useCallback(async () => {
    try {
      const [sched, rows] = await Promise.all([fetchScheduled(), fetchShifts()]);
      setScheduled(sched);
      setLogged(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [fetchScheduled, fetchShifts]);

  useEffect(() => {
    load();
  }, [load]);

  // Load the operator's saved calendar URL once.
  useEffect(() => {
    let cancelled = false;
    getUrlFn()
      .then((r) => { if (!cancelled) setIcsUrl(r.icsUrl); })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [getUrlFn]);

  async function handleSaveCalendarUrl() {
    setSavingUrl(true);
    try {
      const res = await setUrlFn({ data: { url: calDraft } });
      setIcsUrl(res.icsUrl);
      toast.success(res.icsUrl ? "Calendar link updated" : "Calendar link removed");
      setCalDialogOpen(false);
      if (res.icsUrl) runSync();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save link");
    } finally {
      setSavingUrl(false);
    }
  }

  const runSync = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!hasGoogleCalendar) return;
      setSyncing(true);
      try {
        const res = await syncFn();
        setLastSync(new Date());
        if (!res.ok) {
          if (!opts?.silent) toast.error(res.error ?? "Sync failed");
        } else if (!opts?.silent) {
          const parts: string[] = [];
          if (res.created) parts.push(`${res.created} new`);
          if (res.updated) parts.push(`${res.updated} updated`);
          if (res.cancelled) parts.push(`${res.cancelled} cancelled`);
          toast.success(
            parts.length
              ? `Google Calendar synced — ${parts.join(", ")}`
              : `Google Calendar synced — no changes (${res.fetched} events)`,
          );
        }
        await load();
      } catch (e) {
        if (!opts?.silent) toast.error(e instanceof Error ? e.message : "Sync failed");
      } finally {
        setSyncing(false);
      }
    },
    [hasGoogleCalendar, syncFn, load],
  );

  // Auto-sync on mount and every 5 minutes for operators with a linked calendar.
  useEffect(() => {
    if (!hasGoogleCalendar) return;
    runSync({ silent: true });
    const t = setInterval(() => runSync({ silent: true }), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [hasGoogleCalendar, runSync]);


  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const firstWeekStart = useMemo(() => addDays(startOfWeek(now), weekOffset * 7), [weekOffset]);

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

  const weeks: Date[][] = useMemo(() => {
    const w: Date[][] = [];
    for (let i = 0; i < 4; i++) {
      const start = addDays(firstWeekStart, i * 7);
      w.push(Array.from({ length: 7 }, (_, d) => addDays(start, d)));
    }
    return w;
  }, [firstWeekStart]);

  const rangeLabel = `${firstWeekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(firstWeekStart, 27).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

  async function handleSave(payload: {
    start_time: string;
    end_time: string;
    label: string;
  }) {
    if (!editor) return;
    try {
      if (editor.mode === "create") {
        await createSched({
          data: {
            day_of_week: editor.date.getDay(),
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
    <div className="min-h-screen bg-background text-foreground">
      <Toaster richColors position="top-center" />
      <div className="mx-auto max-w-7xl px-3 py-5 sm:px-5 sm:py-8">
        <header className="mb-5 flex flex-wrap items-center gap-2 sm:mb-8 sm:gap-3">
          <Button variant="ghost" size="sm" asChild className="h-8 px-2 sm:h-9">
            <Link to="/">
              <ArrowLeft className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Home</span>
            </Link>
          </Button>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground sm:h-11 sm:w-11">
            <CalendarDays className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight sm:text-2xl">Upcoming shifts</h1>
            <p className="text-xs text-muted-foreground sm:text-sm">Four-week calendar view</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            {lastSync && hasGoogleCalendar ? (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                Synced {lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!hasGoogleCalendar) {
                  setCalDraft(icsUrl ?? "");
                  setCalDialogOpen(true);
                } else {
                  runSync();
                }
              }}
              disabled={syncing}
              className="h-8 px-2 sm:h-9"
              title={hasGoogleCalendar ? "Sync shifts from your Google Calendar" : "Set your Google Calendar link"}
            >
              <RefreshCw className={`h-4 w-4 sm:mr-1 ${syncing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">
                {syncing ? "Syncing…" : hasGoogleCalendar ? "Sync calendar" : "Connect calendar"}
              </span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCalDraft(icsUrl ?? "");
                setCalDialogOpen(true);
              }}
              className="h-8 px-2 sm:h-9"
              title="Update Google Calendar link"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setWeekOffset((n) => n - 1)} className="h-8 px-2 sm:h-9">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setWeekOffset(0)}
              disabled={weekOffset === 0}
              className="h-8 px-3 text-xs sm:h-9 sm:text-sm"
            >
              Today
            </Button>
            <Button variant="outline" size="sm" onClick={() => setWeekOffset((n) => n + 1)} className="h-8 px-2 sm:h-9">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium sm:text-base">{rangeLabel}</div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground sm:text-xs">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-muted-foreground/30" />
              Past
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-primary" />
              Upcoming
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />
              Logged
            </span>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="hidden grid-cols-7 border-b border-border/60 sm:grid">
                {DAY_LABELS.map((d) => (
                  <div
                    key={d}
                    className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {d}
                  </div>
                ))}
              </div>
              <div className="divide-y divide-border/60">
                {weeks.map((week, wi) => (
                  <div key={wi} className="grid grid-cols-1 sm:grid-cols-7">
                    {week.map((day) => {
                      const key = dateKey(day);
                      const isPastDay = day.getTime() < today.getTime();
                      const isToday = day.getTime() === today.getTime();
                      const insts = instancesFor(day, scheduled, overrides);
                      const dayLogged = loggedByDay.get(key) ?? [];
                      return (
                        <div
                          key={key}
                          className={`group relative min-h-[92px] border-border/60 p-2 sm:min-h-[120px] sm:border-r sm:last:border-r-0 ${
                            isPastDay ? "bg-muted/30" : ""
                          } ${isToday ? "bg-primary/5" : ""}`}
                        >
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-semibold uppercase text-muted-foreground sm:hidden">
                                {DAY_LABELS[(day.getDay() + 6) % 7]}
                              </span>
                              <span
                                className={`text-xs font-semibold sm:text-sm ${
                                  isToday
                                    ? "flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground"
                                    : isPastDay
                                      ? "text-muted-foreground"
                                      : "text-foreground"
                                }`}
                              >
                                {day.getDate()}
                              </span>
                              {day.getDate() === 1 && (
                                <span className="text-[10px] text-muted-foreground">
                                  {day.toLocaleDateString(undefined, { month: "short" })}
                                </span>
                              )}
                            </div>
                            {!isPastDay && (
                              <button
                                type="button"
                                onClick={() => setEditor({ mode: "create", date: day })}
                                className="rounded-md p-0.5 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                                aria-label="Add shift"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          <div className="space-y-1">
                            {insts.map((inst, i) => {
                              const past = inst.endAt.getTime() < now.getTime();
                              const hasLog = dayLogged.some(
                                (l) => l.scheduled_shift_id === inst.shift.id,
                              );
                              const cls = hasLog
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                : past
                                  ? "border-border/60 bg-muted/60 text-muted-foreground"
                                  : "border-primary/40 bg-primary/10 text-foreground hover:bg-primary/20";
                              const clickable = !past;
                              return (
                                <button
                                  key={`${inst.shift.id}-${i}`}
                                  type="button"
                                  disabled={!clickable}
                                  onClick={() =>
                                    clickable && setEditor({ mode: "edit", date: day, instance: inst })
                                  }
                                  className={`w-full rounded-md border px-1.5 py-1 text-left text-[10px] leading-tight transition sm:text-[11px] ${cls} ${
                                    clickable ? "cursor-pointer" : "cursor-default"
                                  }`}
                                  title={inst.shift.label ?? ""}
                                >
                                  <div className="font-medium">{fmtTime(inst.shift.start_time)}</div>
                                  {inst.shift.label && (
                                    <div className="truncate opacity-80">{inst.shift.label}</div>
                                  )}
                                </button>
                              );
                            })}
                            {insts.length === 0 && !isPastDay && (
                              <button
                                type="button"
                                onClick={() => setEditor({ mode: "create", date: day })}
                                className="w-full rounded-md border border-dashed border-border/60 px-1.5 py-1 text-left text-[10px] text-muted-foreground/70 transition hover:border-primary/40 hover:text-foreground sm:text-[11px]"
                              >
                                + Add shift
                              </button>
                            )}
                            {insts.length === 0 && isPastDay && (
                              <div className="text-[10px] text-muted-foreground/50 sm:text-[11px]">—</div>
                            )}
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

      <ShiftEditorDialog
        state={editor}
        onClose={() => setEditor(null)}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </div>
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
          <DialogTitle>{isEdit ? "Edit shift" : "Add shift"}</DialogTitle>
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
              placeholder="e.g. Morning shift"
            />
          </div>
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          {isEdit ? (
            <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive">
              <Trash2 className="mr-1 h-4 w-4" /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit}>
              <Save className="mr-1 h-4 w-4" /> Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
