import { createFileRoute, redirect, useRouter, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getGateStatus, lockSite } from "@/lib/gate.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast, Toaster } from "sonner";
import { Radio, LogOut, Plus, X, Clock, Video, Users, Trash2, Calendar, Play, ListChecks, BookOpen } from "lucide-react";

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

type Shift = {
  id: string;
  operator_name: string;
  check_in_at: string;
  check_out_at: string | null;
  live_streams_count: number;
  dance_teachers: string[];
  notes: string | null;
  scheduled_shift_id: string | null;
  classes: ShiftClass[];
};

type ScheduledShift = {
  id: string;
  day_of_week: number;
  start_time: string; // "HH:MM:SS"
  end_time: string;
  label: string | null;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function fmtTime(t: string) {
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

const OPERATOR_KEY = "lss_operator_name";

function formatDuration(startISO: string, endISO: string | null) {
  const end = endISO ? new Date(endISO).getTime() : Date.now();
  const ms = Math.max(0, end - new Date(startISO).getTime());
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function formatDT(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Determines whether a scheduled shift can be started now.
// Rule: only from 45 minutes before start until the shift's end, and only today.
export function scheduledWindow(s: { day_of_week: number; start_time: string; end_time: string }, now = new Date()) {
  const today = now.getDay();
  if (s.day_of_week !== today) {
    return { canStart: false, reason: `Only on ${DAY_NAMES[s.day_of_week]}` as string };
  }
  const [sh, sm] = s.start_time.split(":").map((n) => parseInt(n, 10));
  const [eh, em] = s.end_time.split(":").map((n) => parseInt(n, 10));
  const start = new Date(now); start.setHours(sh, sm, 0, 0);
  const end = new Date(now); end.setHours(eh, em, 0, 0);
  const openAt = new Date(start.getTime() - 45 * 60 * 1000);
  if (now < openAt) {
    const mins = Math.round((openAt.getTime() - now.getTime()) / 60000);
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    const wait = hrs > 0 ? `${hrs}h ${rem}m` : `${mins}m`;
    return { canStart: false, reason: `Opens in ${wait}` };
  }
  if (now > end) {
    return { canStart: false, reason: "Shift ended" };
  }
  return { canStart: true, reason: "" };
}

function Index() {
  const { username } = Route.useLoaderData();
  const router = useRouter();
  const signOut = useServerFn(lockSite);
  async function handleSignOut() {
    await signOut();
    await router.navigate({ to: "/unlock" });
  }
  const [operatorName, setOperatorName] = useState("");
  const [active, setActive] = useState<Shift | null>(null);
  const [history, setHistory] = useState<Shift[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [teacherInput, setTeacherInput] = useState("");
  const [notes, setNotes] = useState("");
  const [_, setTick] = useState(0);

  // live timer
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(OPERATOR_KEY) : null;
    if (saved) setOperatorName(saved);
    load();
  }, []);

  useEffect(() => {
    if (active) {
      setNotes(active.notes ?? "");
    } else {
      setNotes("");
      setTeacherInput("");
    }
  }, [active?.id]);

  async function load() {
    setLoading(true);
    const [shiftsRes, schedRes] = await Promise.all([
      supabase.from("shifts").select("*").order("check_in_at", { ascending: false }),
      supabase.from("scheduled_shifts").select("*").order("day_of_week").order("start_time"),
    ]);
    if (shiftsRes.error) {
      toast.error(shiftsRes.error.message);
    } else {
      const rows = (shiftsRes.data ?? []).map((r) => ({
        ...r,
        classes: (Array.isArray((r as any).classes) ? (r as any).classes : []) as ShiftClass[],
      })) as Shift[];
      setActive(rows.find((r) => !r.check_out_at) ?? null);
      setHistory(rows.filter((r) => r.check_out_at));
    }
    if (schedRes.error) {
      toast.error(schedRes.error.message);
    } else {
      setScheduled((schedRes.data ?? []) as ScheduledShift[]);
    }
    setLoading(false);
  }

  async function checkIn(scheduledShiftId?: string) {
    const name = operatorName.trim();
    if (!name) {
      toast.error("Enter your name first");
      return;
    }
    localStorage.setItem(OPERATOR_KEY, name);
    const { data, error } = await supabase
      .from("shifts")
      .insert({ operator_name: name, scheduled_shift_id: scheduledShiftId ?? null })
      .select()
      .single();
    if (error) return toast.error(error.message);
    setActive({ ...(data as any), classes: (Array.isArray((data as any).classes) ? (data as any).classes : []) } as Shift);
    toast.success(`Checked in — welcome, ${name}`);
  }

  async function updateActive(patch: Partial<Shift>) {
    if (!active) return;
    const optimistic = { ...active, ...patch } as Shift;
    setActive(optimistic);
    const { error } = await supabase.from("shifts").update(patch as any).eq("id", active.id);
    if (error) {
      toast.error(error.message);
      load();
    }
  }

  function addClassRow() {
    if (!active) return;
    updateActive({ classes: [...(active.classes ?? []), { class: "", teacher: "" }] });
  }
  function updateClassRow(idx: number, patch: Partial<ShiftClass>) {
    if (!active) return;
    const next = active.classes.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    updateActive({ classes: next });
  }
  function removeClassRow(idx: number) {
    if (!active) return;
    updateActive({ classes: active.classes.filter((_, i) => i !== idx) });
  }

  function bumpStreams(delta: number) {
    if (!active) return;
    const next = Math.max(0, active.live_streams_count + delta);
    updateActive({ live_streams_count: next });
  }

  function addTeacher() {
    if (!active) return;
    const name = teacherInput.trim();
    if (!name) return;
    if (active.dance_teachers.includes(name)) {
      setTeacherInput("");
      return;
    }
    updateActive({ dance_teachers: [...active.dance_teachers, name] });
    setTeacherInput("");
  }

  function removeTeacher(name: string) {
    if (!active) return;
    updateActive({ dance_teachers: active.dance_teachers.filter((t) => t !== name) });
  }

  async function checkOut() {
    if (!active) return;
    const { error } = await supabase
      .from("shifts")
      .update({ check_out_at: new Date().toISOString(), notes: notes || null })
      .eq("id", active.id);
    if (error) return toast.error(error.message);
    toast.success("Shift closed");
    setActive(null);
    load();
  }

  async function deleteShift(id: string) {
    const { error } = await supabase.from("shifts").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  }

  const totals = useMemo(() => {
    const streams = history.reduce((s, r) => s + r.live_streams_count, 0);
    const teachers = new Set(history.flatMap((r) => r.dance_teachers));
    return { shifts: history.length, streams, teachers: teachers.size };
  }, [history]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster richColors position="top-center" />
      <div className="mx-auto max-w-4xl px-5 py-10">
        <header className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Radio className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Studio Operator</h1>
            <p className="text-sm text-muted-foreground">Live stream shift tracker</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {active && (
              <Badge className="animate-pulse" variant="destructive">
                ● ON AIR
              </Badge>
            )}
            {username && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {username}
              </span>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link to="/shifts">
                <ListChecks className="mr-1 h-3.5 w-3.5" /> Shifts
              </Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="mr-1 h-3.5 w-3.5" /> Sign out
            </Button>
          </div>
        </header>




        {/* Scheduled shifts this week */}
        {!active && scheduled.length > 0 && (
          <section className="mb-6">
            <div className="mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                This week's schedule
              </h2>
            </div>
            <Card className="mb-4">
              <CardContent className="p-4">
                <div className="space-y-2">
                  <Label htmlFor="op">Operator name</Label>
                  <Input
                    id="op"
                    placeholder="e.g. Alex"
                    value={operatorName}
                    onChange={(e) => setOperatorName(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>
            <div className="grid gap-2 sm:grid-cols-2">
              {scheduled.map((s) => {
                const today = new Date().getDay();
                const isToday = s.day_of_week === today;
                const win = scheduledWindow(s);
                return (
                  <Card
                    key={s.id}
                    className={isToday ? "border-primary/50 bg-primary/5" : ""}
                  >
                    <CardContent className="flex items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{DAY_NAMES[s.day_of_week]}</span>
                          {isToday && (
                            <Badge variant="default" className="text-[10px]">
                              TODAY
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {fmtTime(s.start_time)} — {fmtTime(s.end_time)}
                        </div>
                        {!win.canStart && (
                          <div className="mt-0.5 text-xs text-muted-foreground">{win.reason}</div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        onClick={() => checkIn(s.id)}
                        disabled={!operatorName.trim() || !win.canStart}
                        title={!win.canStart ? win.reason : "Start shift"}
                      >
                        <Play className="mr-1 h-3.5 w-3.5" /> Start
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            {!operatorName.trim() && (
              <p className="mt-2 text-xs text-muted-foreground">
                Enter your name above to enable starting a scheduled shift.
              </p>
            )}
          </section>
        )}

        {/* Active shift card */}
        {active && (
          <Card className="border-primary/40">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{active.operator_name}</CardTitle>
                  <CardDescription>
                    Since {formatDT(active.check_in_at)} • {formatDuration(active.check_in_at, null)}
                  </CardDescription>
                </div>
                <Clock className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Streams counter */}
              <div className="rounded-lg border p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <Video className="h-4 w-4" /> Live streams managed
                </div>
                <div className="flex items-center justify-between">
                  <Button variant="outline" size="lg" onClick={() => bumpStreams(-1)}>
                    −
                  </Button>
                  <div className="text-5xl font-bold tabular-nums">
                    {active.live_streams_count}
                  </div>
                  <Button size="lg" onClick={() => bumpStreams(1)}>
                    <Plus className="h-5 w-5" />
                  </Button>
                </div>
              </div>

              {/* Shift information: classes & teachers */}
              <div className="rounded-lg border p-4">
                <div className="mb-3 flex items-center justify-between gap-2 text-sm font-medium">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4" /> Shift information
                  </div>
                  <Button variant="secondary" size="sm" onClick={addClassRow}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add class
                  </Button>
                </div>
                {active.classes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No classes logged yet.</p>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      <span>Class</span>
                      <span>Teacher</span>
                      <span className="sr-only">Actions</span>
                    </div>
                    {active.classes.map((c, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                        <Input
                          placeholder={`Class ${i + 1}`}
                          value={c.class}
                          onChange={(e) => updateClassRow(i, { class: e.target.value })}
                        />
                        <Input
                          placeholder="Teacher"
                          value={c.teacher}
                          onChange={(e) => updateClassRow(i, { teacher: e.target.value })}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeClassRow(i)}
                          aria-label="Remove row"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Teachers */}
              <div className="rounded-lg border p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <Users className="h-4 w-4" /> Dance teachers encountered
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Add teacher name"
                    value={teacherInput}
                    onChange={(e) => setTeacherInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTeacher())}
                  />
                  <Button onClick={addTeacher} variant="secondary">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {active.dance_teachers.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {active.dance_teachers.map((t) => (
                      <Badge key={t} variant="secondary" className="gap-1 py-1.5 pl-3 pr-1.5">
                        {t}
                        <button
                          onClick={() => removeTeacher(t)}
                          className="ml-1 rounded-full p-0.5 hover:bg-background/60"
                          aria-label={`Remove ${t}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label htmlFor="notes">Notes (optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Anything worth remembering about this shift…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>

              <Button onClick={checkOut} variant="destructive" size="lg" className="w-full">
                <LogOut className="mr-2 h-4 w-4" /> Check out
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Totals */}
        <div className="mt-8 grid grid-cols-3 gap-3">
          <StatCard label="Shifts" value={totals.shifts} />
          <StatCard label="Streams" value={totals.streams} />
          <StatCard label="Teachers" value={totals.teachers} />
        </div>

        {/* History */}
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">History</h2>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No completed shifts yet.</p>
          ) : (
            <div className="space-y-3">
              {history.map((s) => (
                <Card key={s.id}>
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{s.operator_name}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDT(s.check_in_at)}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {formatDuration(s.check_in_at, s.check_out_at)} •{" "}
                        <span className="text-foreground">{s.live_streams_count}</span> streams •{" "}
                        <span className="text-foreground">{s.dance_teachers.length}</span> teachers
                      </div>
                      {s.dance_teachers.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {s.dance_teachers.map((t) => (
                            <Badge key={t} variant="outline" className="text-xs">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {s.notes && (
                        <p className="mt-2 text-sm text-muted-foreground italic">"{s.notes}"</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteShift(s.id)}
                      aria-label="Delete shift"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
