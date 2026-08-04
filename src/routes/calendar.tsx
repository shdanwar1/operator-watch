import { createFileRoute, redirect } from "@tanstack/react-router";
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
import type { MatchLog } from "@/lib/gcal-match";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Trash2, Save, RefreshCw, Settings2 } from "lucide-react";
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
      { title: "Monthly Schedule — Studio Operator" },
      {
        name: "description",
        content: "Month view of your scheduled studio operator shifts and classes.",
      },
      { property: "og:title", content: "Monthly Schedule — Studio Operator" },
      { property: "og:description", content: "Month view of your scheduled studio operator shifts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
  const [monthOffset, setMonthOffset] = useState(0);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [icsUrl, setIcsUrl] = useState<string | null>(null);
  const [calDialogOpen, setCalDialogOpen] = useState(false);
  const [calDraft, setCalDraft] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);
  const [syncNextMonth, setSyncNextMonth] = useState(false);
  const [matchLogs, setMatchLogs] = useState<MatchLog[]>([]);
  const [debug, setDebug] = useState(false);

  // Sync scope preference is a per-device setting; current month is always on.
  useEffect(() => {
    if (typeof window !== "undefined") {
      setSyncNextMonth(window.localStorage.getItem("gcal:syncNextMonth") === "1");
    }
  }, []);

  // Match trace is a debug-only surface: opt in with ?debug=1.
  useEffect(() => {
    if (typeof window !== "undefined") {
      setDebug(new URLSearchParams(window.location.search).get("debug") === "1");
    }
  }, []);

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

  const runSync = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!hasGoogleCalendar) return;
      setSyncing(true);
      try {
        const res = await syncFn({ data: { includeNextMonth: syncNextMonth } });
        setLastSync(new Date());
        setMatchLogs(res.logs ?? []);
        if (!res.ok) {
          if (!opts?.silent) toast.error(res.error ?? "Sync failed");
        } else if (!opts?.silent) {
          const parts: string[] = [];
          if (res.shifts) parts.push(`${res.shifts} shift${res.shifts === 1 ? "" : "s"}`);
          if (res.removed) parts.push(`${res.removed} removed`);
          toast.success(
            parts.length
              ? `Calendar synced — ${parts.join(", ")} from ${res.fetched} classes`
              : `Calendar synced — no shifts (${res.fetched} classes)`,
          );
        }
        await load();
      } catch (e) {
        if (!opts?.silent) toast.error(e instanceof Error ? e.message : "Sync failed");
      } finally {
        setSyncing(false);
      }
    },
    [hasGoogleCalendar, syncFn, load, syncNextMonth],
  );

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
        subtitle="Your monthly schedule"
        action={
          <div className="flex items-center gap-1.5">
            {lastSync && hasGoogleCalendar ? (
              <span className="mr-1 hidden text-xs text-muted-foreground sm:inline">
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
              title={hasGoogleCalendar ? "Sync shifts from your Google Calendar" : "Set your Google Calendar link"}
            >
              <RefreshCw className={`h-4 w-4 sm:mr-1 ${syncing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">
                {syncing ? "Syncing…" : hasGoogleCalendar ? "Sync" : "Connect calendar"}
              </span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCalDraft(icsUrl ?? "");
                setCalDialogOpen(true);
              }}
              title="Update Google Calendar link"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
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
                  <span className="ml-auto tabular-nums text-muted-foreground">{l.confidence}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-4 flex items-center gap-2">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonthOffset((n) => n - 1)} aria-label="Previous month">
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
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonthOffset((n) => n + 1)} aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Card className="rise-in overflow-hidden">
          <CardContent className="p-0">
            <div className="grid grid-cols-7 border-b border-border/60">
              {DAY_LABELS.map((d) => (
                <div
                  key={d}
                  className="px-3 py-2 text-center text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
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
                        className={`group relative min-h-[104px] border-border/60 p-1.5 sm:min-h-[124px] sm:border-r sm:last:border-r-0 ${
                          inMonth ? "" : "opacity-40"
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span
                            className={`text-xs tabular-nums ${
                              isToday
                                ? "flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background font-medium"
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
                            const hasLog = dayLogged.some((l) => l.scheduled_shift_id === inst.shift.id);
                            const n = classCount(inst.shift.label);
                            const tone = hasLog
                              ? "border-done/40 bg-done/10"
                              : past
                                ? "border-border/60 bg-muted/50 text-muted-foreground"
                                : "border-live/40 bg-live/10 hover:bg-live/20";
                            return (
                              <button
                                key={`${inst.shift.id}-${i}`}
                                type="button"
                                onClick={() => setEditor({ mode: "edit", date: day, instance: inst })}
                                className={`press w-full rounded-lg border px-2 py-1 text-left text-[11px] leading-tight transition ${tone}`}
                                title={inst.shift.label ?? ""}
                              >
                                <div className="truncate font-medium tabular-nums">
                                  {fmtTime(inst.shift.start_time)} – {fmtTime(inst.shift.end_time)}
                                  {inst.shift.end_time <= inst.shift.start_time ? " (+1)" : ""}
                                </div>

                                <div className="truncate text-muted-foreground">
                                  {n ? `${n} ${n === 1 ? "class" : "classes"}` : (inst.shift.label ?? "Shift")}
                                </div>
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

      <ShiftEditorDialog
        state={editor}
        onClose={() => setEditor(null)}
        onSave={handleSave}
        onDelete={handleDelete}
      />

      <Dialog open={calDialogOpen} onOpenChange={setCalDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Google Calendar link</DialogTitle>
            <DialogDescription>
              Paste the public iCal URL from Google Calendar → Settings → Integrate calendar → “Public
              address in iCal format” (ends in <code>.ics</code>). Shifts refresh here every 5 minutes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ics-url">Calendar link</Label>
            <Input
              id="ics-url"
              value={calDraft}
              onChange={(e) => setCalDraft(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/…/public/basic.ics"
              autoFocus
            />
            {icsUrl && <p className="break-all text-xs text-muted-foreground">Current: {icsUrl}</p>}
          </div>

          <div className="space-y-3 rounded-lg border border-border/60 p-4">
            <div>
              <p className="text-sm font-medium">Calendar sync scope</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Current month is always synchronized. Enable next month once the new schedule has
                been published.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="scope-current" checked disabled />
              <Label htmlFor="scope-current" className="text-sm font-normal opacity-70">
                Sync current month
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="scope-next"
                checked={syncNextMonth}
                onCheckedChange={(v) => {
                  const on = v === true;
                  setSyncNextMonth(on);
                  if (typeof window !== "undefined") {
                    window.localStorage.setItem("gcal:syncNextMonth", on ? "1" : "0");
                  }
                }}
              />
              <Label htmlFor="scope-next" className="text-sm font-normal">
                Sync next month
              </Label>
            </div>
          </div>
          <DialogFooter className="flex-row justify-between">
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setCalDraft("")}
              disabled={savingUrl || !calDraft}
            >
              Clear
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setCalDialogOpen(false)} disabled={savingUrl}>
                Cancel
              </Button>
              <Button onClick={handleSaveCalendarUrl} disabled={savingUrl}>
                <Save className="mr-1 h-4 w-4" /> {savingUrl ? "Saving…" : "Save & sync"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
