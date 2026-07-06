import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast, Toaster } from "sonner";
import { Radio, LogIn, LogOut, Plus, X, Clock, Video, Users, Trash2, Calendar, Play } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

type Shift = {
  id: string;
  operator_name: string;
  check_in_at: string;
  check_out_at: string | null;
  live_streams_count: number;
  dance_teachers: string[];
  notes: string | null;
  scheduled_shift_id: string | null;
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

function Index() {
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
      const rows = (shiftsRes.data ?? []) as Shift[];
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
    setActive(data as Shift);
    toast.success(`Checked in — welcome, ${name}`);
  }

  async function updateActive(patch: Partial<Shift>) {
    if (!active) return;
    const optimistic = { ...active, ...patch } as Shift;
    setActive(optimistic);
    const { error } = await supabase.from("shifts").update(patch).eq("id", active.id);
    if (error) {
      toast.error(error.message);
      load();
    }
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
          {active && (
            <Badge className="ml-auto animate-pulse" variant="destructive">
              ● ON AIR
            </Badge>
          )}
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
            <div className="grid gap-2 sm:grid-cols-2">
              {scheduled.map((s) => {
                const today = new Date().getDay();
                const isToday = s.day_of_week === today;
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
                      </div>
                      <Button
                        size="sm"
                        onClick={() => checkIn(s.id)}
                        disabled={!operatorName.trim()}
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
                Enter your name below to enable starting a scheduled shift.
              </p>
            )}
          </section>
        )}

        {/* Active / Check-in card */}
        {!active ? (
          <Card>
            <CardHeader>
              <CardTitle>Start a shift</CardTitle>
              <CardDescription>Check in to begin tracking your session.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="op">Operator name</Label>
                <Input
                  id="op"
                  placeholder="e.g. Alex"
                  value={operatorName}
                  onChange={(e) => setOperatorName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && checkIn()}
                />
              </div>
              <Button onClick={() => checkIn()} className="w-full" size="lg">
                <LogIn className="mr-2 h-4 w-4" /> Check in (no schedule)
              </Button>
            </CardContent>
          </Card>
        ) : (
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
