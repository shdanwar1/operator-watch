import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState, useCallback } from "react";
import { getGateStatus, signOutUser } from "@/lib/gate.functions";
import {
  adminListShiftsForSession,
  adminListOperators,
  adminUpdateOperator,
  adminCreateOperator,
  type OperatorBasic,
} from "@/lib/operators.functions";
import {
  listScheduledShifts,
  createScheduledShift,
  updateScheduledShift,
  deleteScheduledShift,
  type ScheduledShiftRow,
  type ShiftRow,
} from "@/lib/shifts.functions";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast, Toaster } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Plus,
  Loader2,
  LogOut,
  Trash2,
  Users,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Sparkles,
  RefreshCw,
  Pencil,
  Save,
} from "lucide-react";
import { USERNAME_RE, PIN_RE } from "@/lib/validation";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin")({
  beforeLoad: async () => {
    const status = await getGateStatus();
    if (!status.unlocked) throw redirect({ to: "/unlock" });
    if (!status.isAdmin) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "Admin Dashboard — Scheduling" },
      { name: "description", content: "Weekly scheduling dashboard for shift assignment." },
    ],
  }),
  component: AdminDashboard,
});

// ---------- date utilities ----------

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0..6 (Sun..Sat)
  // Monday-start: shift so Mon=0
  const offset = (day + 6) % 7;
  x.setDate(x.getDate() - offset);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fmtDayShort(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
function fmtRange(start: Date, end: Date) {
  const sameMonth = start.getMonth() === end.getMonth();
  const s = start.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const e = end.toLocaleDateString(undefined, {
    day: "numeric",
    month: sameMonth ? undefined : "short",
    year: end.getFullYear() !== start.getFullYear() ? "numeric" : undefined,
  });
  return `${s} – ${e}`;
}
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minutesBetween(start: string, end: string): number {
  const a = timeToMinutes(start);
  const b = timeToMinutes(end);
  return Math.max(0, b - a);
}
function fmtHours(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
function fmtTime12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

// ---------- operator color palette ----------

const OP_COLORS = [
  { name: "blue", bg: "bg-blue-500/10", border: "border-blue-500/40", text: "text-blue-600 dark:text-blue-400", dot: "bg-blue-500" },
  { name: "green", bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
  { name: "orange", bg: "bg-orange-500/10", border: "border-orange-500/40", text: "text-orange-600 dark:text-orange-400", dot: "bg-orange-500" },
  { name: "purple", bg: "bg-purple-500/10", border: "border-purple-500/40", text: "text-purple-600 dark:text-purple-400", dot: "bg-purple-500" },
  { name: "pink", bg: "bg-pink-500/10", border: "border-pink-500/40", text: "text-pink-600 dark:text-pink-400", dot: "bg-pink-500" },
  { name: "cyan", bg: "bg-cyan-500/10", border: "border-cyan-500/40", text: "text-cyan-600 dark:text-cyan-400", dot: "bg-cyan-500" },
  { name: "amber", bg: "bg-amber-500/10", border: "border-amber-500/40", text: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
  { name: "rose", bg: "bg-rose-500/10", border: "border-rose-500/40", text: "text-rose-600 dark:text-rose-400", dot: "bg-rose-500" },
];

function opColor(name: string | null) {
  if (!name) return null;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return OP_COLORS[hash % OP_COLORS.length];
}

// ---------- data types ----------

type Assignment = ScheduledShiftRow & {
  effective_status: "assigned" | "unassigned" | "completed" | "cancelled";
};

function normalizeStatus(row: ScheduledShiftRow): Assignment["effective_status"] {
  const s = (row.status ?? "").toLowerCase();
  if (s === "completed" || s === "cancelled" || s === "unassigned") return s;
  if (!row.assigned_operator) return "unassigned";
  return "assigned";
}

// ---------- root component ----------

function AdminDashboard() {
  const fetchShifts = useServerFn(adminListShiftsForSession);
  const fetchOps = useServerFn(adminListOperators);
  const fetchScheduled = useServerFn(listScheduledShifts);
  const createFn = useServerFn(createScheduledShift);
  const updateFn = useServerFn(updateScheduledShift);
  const deleteFn = useServerFn(deleteScheduledShift);
  const lockFn = useServerFn(signOutUser);
  const updateOpFn = useServerFn(adminUpdateOperator);
  const createOpFn = useServerFn(adminCreateOperator);

  const [editingOp, setEditingOp] = useState<OperatorBasic | null>(null);
  const [createOpOpen, setCreateOpOpen] = useState(false);

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [scheduled, setScheduled] = useState<ScheduledShiftRow[]>([]);
  const [operators, setOperators] = useState<OperatorBasic[]>([]);
  const [actualShifts, setActualShifts] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<ScheduledShiftRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDayIndex, setCreateDayIndex] = useState<number | null>(null);

  const [operatorFilter, setOperatorFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(
    new Set(["assigned", "unassigned", "completed", "cancelled"]),
  );

  const refresh = useCallback(async () => {
    try {
      const [sch, ops, actual] = await Promise.all([
        fetchScheduled(),
        fetchOps(),
        fetchShifts(),
      ]);
      setScheduled(sch as ScheduledShiftRow[]);
      setOperators(ops as OperatorBasic[]);
      setActualShifts(actual as ShiftRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [fetchScheduled, fetchOps, fetchShifts]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live sync with operator check-ins/outs and any external edits.
  useEffect(() => {
    const ch = supabase
      .channel("admin-shift-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "shifts" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "scheduled_shifts" }, () => refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [refresh]);



  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const weekEnd = addDays(weekStart, 6);

  // Group shifts by day within visible week
  const shiftsByDay = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const d of weekDays) map.set(ymd(d), []);
    for (const s of scheduled) {
      // Determine which day-of-week bucket in this week
      // Convert JS Sunday=0..Sat=6 to Mon=0..Sun=6
      const dowMondayFirst = (s.day_of_week + 6) % 7;
      const target = weekDays[dowMondayFirst];
      // If specific_date set, only show on that date
      if (s.specific_date) {
        const sd = new Date(s.specific_date + "T00:00:00");
        const match = weekDays.find((d) => sameDay(d, sd));
        if (!match) continue;
        const key = ymd(match);
        map.get(key)?.push({ ...s, effective_status: normalizeStatus(s) });
      } else {
        map.get(ymd(target))?.push({ ...s, effective_status: normalizeStatus(s) });
      }
    }
    // sort by start time
    for (const [k, arr] of map) {
      arr.sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
      map.set(k, arr);
    }
    return map;
  }, [scheduled, weekDays]);

  // Filtered
  const visibleShiftsByDay = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const [k, arr] of shiftsByDay) {
      map.set(
        k,
        arr.filter((a) => {
          if (!statusFilter.has(a.effective_status)) return false;
          if (operatorFilter.size > 0) {
            if (!a.assigned_operator || !operatorFilter.has(a.assigned_operator)) return false;
          }
          return true;
        }),
      );
    }
    return map;
  }, [shiftsByDay, statusFilter, operatorFilter]);

  // Operator workload (this week)
  const operatorStats = useMemo(() => {
    const stats = new Map<string, { count: number; minutes: number; next?: Assignment; nextDate?: Date }>();
    for (const op of operators) stats.set(op.username, { count: 0, minutes: 0 });
    const now = new Date();
    for (const d of weekDays) {
      const key = ymd(d);
      for (const s of shiftsByDay.get(key) ?? []) {
        if (!s.assigned_operator) continue;
        const cur = stats.get(s.assigned_operator) ?? { count: 0, minutes: 0 };
        cur.count += 1;
        cur.minutes += minutesBetween(s.start_time, s.end_time);
        // next upcoming
        const startDt = new Date(d);
        const [h, m] = s.start_time.split(":").map(Number);
        startDt.setHours(h, m, 0, 0);
        if (startDt >= now && (!cur.nextDate || startDt < cur.nextDate)) {
          cur.next = s;
          cur.nextDate = startDt;
        }
        stats.set(s.assigned_operator, cur);
      }
    }
    return stats;
  }, [operators, shiftsByDay, weekDays]);

  // Side statistics
  const sideStats = useMemo(() => {
    const today = new Date();
    let todayCount = 0;
    let upcoming = 0;
    let unassigned = 0;
    let totalMinutes = 0;
    for (const d of weekDays) {
      const key = ymd(d);
      for (const s of shiftsByDay.get(key) ?? []) {
        totalMinutes += minutesBetween(s.start_time, s.end_time);
        if (s.effective_status === "unassigned") unassigned += 1;
        if (sameDay(d, today)) todayCount += 1;
        if (d > today) upcoming += 1;
      }
    }
    const currentlyWorking = actualShifts.filter((s) => !s.check_out_at).length;
    return { todayCount, upcoming, unassigned, totalMinutes, currentlyWorking };
  }, [weekDays, shiftsByDay, actualShifts]);

  const toggleOperatorFilter = (name: string) => {
    setOperatorFilter((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const toggleStatusFilter = (s: string) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const handleAssign = async (id: string, operator: string | null, status?: string) => {
    try {
      await updateFn({
        data: {
          id,
          patch: {
            assigned_operator: operator,
            status: status ?? (operator ? "assigned" : "unassigned"),
          },
        },
      });
      await refresh();
      toast.success("Shift updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteFn({ data: { id } });
      setSelected(null);
      await refresh();
      toast.success("Shift deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const handleCreate = async (input: {
    day_of_week: number;
    start_time: string;
    end_time: string;
    label: string;
    assigned_operator: string | null;
    notes: string | null;
    specific_date: string | null;
  }) => {
    try {
      await createFn({ data: input });
      setCreateOpen(false);
      setCreateDayIndex(null);
      await refresh();
      toast.success("Shift created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 text-foreground">
      <Toaster richColors position="top-center" />

      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <CalendarDays className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">Scheduling</div>
              <div className="text-xs text-muted-foreground">Admin dashboard</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/shifts">Shifts</Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await lockFn();
                window.location.href = "/unlock";
              }}
            >
              <LogOut className="mr-1 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px] gap-4 px-4 py-5 sm:px-6">
        {/* Left filters */}
        <aside className="hidden w-56 shrink-0 space-y-4 lg:block">
          <FilterCard title="Operators" icon={<Users className="h-3.5 w-3.5" />}>
            <div className="space-y-1.5">
              <button
                onClick={() => setOperatorFilter(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {operatorFilter.size === 0 ? "All operators" : "Show all"}
              </button>
              {operators.map((op) => {
                const c = opColor(op.username);
                const checked = operatorFilter.size === 0 || operatorFilter.has(op.username);
                return (
                  <label
                    key={op.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleOperatorFilter(op.username)}
                    />
                    <span className={`h-2 w-2 rounded-full ${c?.dot ?? "bg-muted-foreground"}`} />
                    <span className="truncate">{op.username}</span>
                  </label>
                );
              })}
            </div>
          </FilterCard>

          <FilterCard title="Status">
            <div className="space-y-1.5">
              {(["assigned", "unassigned", "completed", "cancelled"] as const).map((s) => (
                <label
                  key={s}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm capitalize hover:bg-muted"
                >
                  <Checkbox
                    checked={statusFilter.has(s)}
                    onCheckedChange={() => toggleStatusFilter(s)}
                  />
                  {s}
                </label>
              ))}
            </div>
          </FilterCard>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1 space-y-5">
          {/* Week nav */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Week of</div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {fmtRange(weekStart, weekEnd)}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>
                Today
              </Button>
              <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setCreateDayIndex(null);
                  setCreateOpen(true);
                }}
              >
                <Plus className="mr-1 h-4 w-4" /> New shift
              </Button>
            </div>
          </div>

          {/* Operator workload */}
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Operators
            </div>
            <Button size="sm" variant="outline" onClick={() => setCreateOpOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> New operator
            </Button>
          </div>
          {operators.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {operators.map((op) => {
                const s = operatorStats.get(op.username) ?? { count: 0, minutes: 0 };
                const c = opColor(op.username);
                return (
                  <Card key={op.id} className="group overflow-hidden">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${c?.dot ?? "bg-muted-foreground"}`} />
                        <span className="truncate text-sm font-medium">{op.username}</span>
                        <button
                          type="button"
                          onClick={() => setEditingOp(op)}
                          className="ml-auto rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover:opacity-100 focus:opacity-100"
                          aria-label={`Edit ${op.username}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-2 flex items-baseline gap-1">
                        <span className="text-xl font-semibold tabular-nums">{s.count}</span>
                        <span className="text-xs text-muted-foreground">shifts</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {fmtHours(s.minutes)} scheduled
                      </div>
                      {s.next && s.nextDate && (
                        <div className="mt-2 border-t pt-2 text-[11px] text-muted-foreground">
                          Next: {fmtDayShort(s.nextDate)} · {fmtTime12(s.next.start_time)}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Calendar grid */}
          {loading ? (
            <Card>
              <CardContent className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading schedule…
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Desktop weekly grid */}
              <div className="hidden lg:block">
                <div className="grid grid-cols-7 gap-2">
                  {weekDays.map((d, i) => {
                    const key = ymd(d);
                    const list = visibleShiftsByDay.get(key) ?? [];
                    const isToday = sameDay(d, new Date());
                    return (
                      <div
                        key={key}
                        className={`min-h-[420px] rounded-2xl border bg-background p-2 shadow-sm ${
                          isToday ? "ring-2 ring-primary/40" : ""
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between px-1">
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {d.toLocaleDateString(undefined, { weekday: "short" })}
                            </div>
                            <div className={`text-sm font-semibold ${isToday ? "text-primary" : ""}`}>
                              {d.getDate()}
                            </div>
                          </div>
                          <button
                            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                            onClick={() => {
                              setCreateDayIndex(i);
                              setCreateOpen(true);
                            }}
                            aria-label="Add shift"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="space-y-1.5">
                          {list.length === 0 ? (
                            <div className="rounded-lg border border-dashed p-3 text-center text-[11px] text-muted-foreground">
                              No shifts
                            </div>
                          ) : (
                            list.map((s) => (
                              <ShiftCard key={s.id} shift={s} onClick={() => setSelected(s)} />
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Mobile / tablet agenda */}
              <div className="space-y-3 lg:hidden">
                {weekDays.map((d) => {
                  const key = ymd(d);
                  const list = visibleShiftsByDay.get(key) ?? [];
                  const isToday = sameDay(d, new Date());
                  return (
                    <Card key={key} className={isToday ? "ring-2 ring-primary/40" : ""}>
                      <CardContent className="p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="text-sm font-semibold">
                            {d.toLocaleDateString(undefined, {
                              weekday: "long",
                              day: "numeric",
                              month: "short",
                            })}
                          </div>
                          <button
                            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                            onClick={() => {
                              const dayIdx = (d.getDay() + 6) % 7;
                              setCreateDayIndex(dayIdx);
                              setCreateOpen(true);
                            }}
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                        {list.length === 0 ? (
                          <div className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                            No shifts scheduled
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {list.map((s) => (
                              <ShiftCard key={s.id} shift={s} onClick={() => setSelected(s)} />
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </main>

        {/* Right stats */}
        <aside className="hidden w-64 shrink-0 space-y-3 xl:block">
          <StatCard
            icon={<CalendarDays className="h-4 w-4 text-primary" />}
            label="Today's shifts"
            value={sideStats.todayCount}
          />
          <StatCard
            icon={<Clock className="h-4 w-4 text-blue-500" />}
            label="Upcoming"
            value={sideStats.upcoming}
          />
          <StatCard
            icon={<AlertTriangle className="h-4 w-4 text-orange-500" />}
            label="Unassigned"
            value={sideStats.unassigned}
            accent={sideStats.unassigned > 0}
          />
          <StatCard
            icon={<Sparkles className="h-4 w-4 text-emerald-500" />}
            label="Hours this week"
            value={fmtHours(sideStats.totalMinutes)}
          />
          <StatCard
            icon={<Users className="h-4 w-4 text-purple-500" />}
            label="Now working"
            value={sideStats.currentlyWorking}
          />
        </aside>
      </div>

      {/* Floating add button (mobile) */}
      <button
        onClick={() => {
          setCreateDayIndex(null);
          setCreateOpen(true);
        }}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-105 lg:hidden"
        aria-label="Add shift"
      >
        <Plus className="h-6 w-6" />
      </button>

      {/* Side panel: edit */}
      <ShiftEditSheet
        shift={selected}
        operators={operators}
        weekDays={weekDays}
        shiftsByDay={shiftsByDay}
        onClose={() => setSelected(null)}
        onAssign={handleAssign}
        onDelete={handleDelete}
        onSave={async (patch) => {
          if (!selected) return;
          try {
            await updateFn({ data: { id: selected.id, patch } });
            await refresh();
            setSelected(null);
            toast.success("Saved");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed");
          }
        }}
      />

      {/* Create dialog */}
      <CreateShiftDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultDayIndex={createDayIndex}
        operators={operators}
        onCreate={handleCreate}
      />

      {/* Operator editor */}
      <OperatorEditorDialog
        operator={editingOp}
        onClose={() => setEditingOp(null)}
        onSave={async (patch) => {
          if (!editingOp) return;
          await updateOpFn({ data: { id: editingOp.id, ...patch } });
          await refresh();
          setEditingOp(null);
          toast.success("Operator updated");
        }}
      />

      {/* Create operator */}
      <CreateOperatorDialog
        open={createOpOpen}
        onOpenChange={setCreateOpOpen}
        onCreate={async ({ username, pin }) => {
          await createOpFn({ data: { username, pin } });
          await refresh();
          setCreateOpOpen(false);
          toast.success(`Operator ${username} created`);
        }}
      />
    </div>
  );
}

function CreateOperatorDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (data: { username: string; pin: string }) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setUsername("");
      setPin("");
      setSaving(false);
    }
  }, [open]);

  async function submit() {
    const u = username.trim();
    if (!USERNAME_RE.test(u)) {
      return toast.error("Username must be 2–32 letters, numbers, . _ or -");
    }
    if (!PIN_RE.test(pin)) {
      return toast.error("PIN must contain exactly 4 digits");
    }
    setSaving(true);
    try {
      await onCreate({ username: u, pin });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create operator");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New operator</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Only a username and 4-digit PIN are needed. The operator sets their home
            address, calendar, and magic word themselves on first login.
          </p>
          <div className="space-y-2">
            <Label>Username</Label>
            <Input
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="e.g. Alex"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">Capitalization is preserved.</p>
          </div>
          <div className="space-y-2">
            <Label>PIN</Label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={4}
              placeholder="4 digits"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D+/g, ""))}
              autoComplete="new-password"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            <Save className="mr-1 h-4 w-4" />
            {saving ? "Creating…" : "Create operator"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

function OperatorEditorDialog({
  operator,
  onClose,
  onSave,
}: {
  operator: OperatorBasic | null;
  onClose: () => void;
  onSave: (patch: { username?: string; pin?: string; magic_word?: string }) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [magic, setMagic] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (operator) {
      setUsername(operator.username);
      setPin("");
      setMagic("");
    }
  }, [operator]);

  if (!operator) return null;

  async function submit() {
    const changedName = username.trim() && username.trim() !== operator!.username;
    if (changedName && !USERNAME_RE.test(username.trim())) {
      return toast.error("Username must be 2–32 letters, numbers, . _ or -");
    }
    if (pin && !PIN_RE.test(pin)) {
      return toast.error("PIN must contain exactly 4 digits");
    }
    if (!changedName && !pin && !magic.trim()) {
      return toast.error("Nothing to save");
    }
    setSaving(true);
    try {
      await onSave({
        username: changedName ? username.trim() : undefined,
        pin: pin || undefined,
        magic_word: magic.trim() || undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      toast.error(
        /already in use|duplicate/i.test(msg) ? "This username is already in use." : msg,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!operator} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {operator.username}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Username</Label>
            <Input
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">Capitalization is preserved.</p>
          </div>
          <div className="space-y-2">
            <Label>New PIN</Label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={4}
              placeholder="Leave blank to keep current"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D+/g, ""))}
              autoComplete="new-password"
            />
            <p className="text-[11px] text-muted-foreground">Exactly 4 digits.</p>
          </div>
          <div className="space-y-2">
            <Label>New magic word</Label>
            <Input
              type="password"
              placeholder="Leave blank to keep current"
              value={magic}
              onChange={(e) => setMagic(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            <Save className="mr-1 h-4 w-4" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- subcomponents ----------

function FilterCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-background p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-background p-3 shadow-sm ${
        accent ? "ring-1 ring-orange-500/40" : ""
      }`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function ShiftCard({ shift, onClick }: { shift: Assignment; onClick: () => void }) {
  const c = opColor(shift.assigned_operator);
  const isUnassigned = shift.effective_status === "unassigned";
  const isCancelled = shift.effective_status === "cancelled";
  const isCompleted = shift.effective_status === "completed";

  const base = "w-full text-left rounded-lg border p-2 transition hover:shadow-md active:scale-[0.99]";
  const cls = isCancelled
    ? "border-destructive/40 bg-destructive/5"
    : isUnassigned
      ? "border-dashed border-muted-foreground/40 bg-muted/40"
      : `${c?.border ?? ""} ${c?.bg ?? ""}`;

  return (
    <button onClick={onClick} className={`${base} ${cls} ${isCompleted ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold tabular-nums">
          {fmtTime12(shift.start_time)} – {fmtTime12(shift.end_time)}
        </div>
        {isCancelled ? (
          <XCircle className="h-3.5 w-3.5 text-destructive" />
        ) : isUnassigned ? (
          <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
        ) : isCompleted ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        ) : (
          <CheckCircle2 className={`h-3.5 w-3.5 ${c?.text ?? ""}`} />
        )}
      </div>
      <div className="mt-1 truncate text-xs font-medium">
        {shift.assigned_operator ?? (
          <span className="italic text-muted-foreground">Unassigned</span>
        )}
      </div>
      {shift.label && (
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{shift.label}</div>
      )}
    </button>
  );
}

// ---------- edit sheet ----------

function ShiftEditSheet({
  shift,
  operators,
  weekDays,
  shiftsByDay,
  onClose,
  onAssign,
  onDelete,
  onSave,
}: {
  shift: ScheduledShiftRow | null;
  operators: OperatorBasic[];
  weekDays: Date[];
  shiftsByDay: Map<string, Assignment[]>;
  onClose: () => void;
  onAssign: (id: string, op: string | null, status?: string) => void;
  onDelete: (id: string) => void;
  onSave: (patch: {
    start_time?: string;
    end_time?: string;
    label?: string;
    assigned_operator?: string | null;
    status?: string;
    notes?: string | null;
    day_of_week?: number;
  }) => Promise<void>;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [op, setOp] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [dow, setDow] = useState<number>(0);

  useEffect(() => {
    if (shift) {
      setStart(shift.start_time.slice(0, 5));
      setEnd(shift.end_time.slice(0, 5));
      setLabel(shift.label ?? "");
      setNotes(shift.notes ?? "");
      setOp(shift.assigned_operator ?? "");
      setStatus(shift.status ?? "assigned");
      setDow(shift.day_of_week);
    }
  }, [shift]);

  // Overlap check for chosen operator on this day
  const conflictInfo = useMemo(() => {
    if (!shift || !op) return null;
    const dowMondayFirst = (dow + 6) % 7;
    const dayDate = weekDays[dowMondayFirst];
    if (!dayDate) return null;
    const list = shiftsByDay.get(ymd(dayDate)) ?? [];
    const startMin = timeToMinutes(start);
    const endMin = timeToMinutes(end);
    let opTotalMin = 0;
    let overlap: Assignment | null = null;
    for (const s of list) {
      if (s.id === shift.id) continue;
      if (s.assigned_operator !== op) continue;
      opTotalMin += minutesBetween(s.start_time, s.end_time);
      const sStart = timeToMinutes(s.start_time);
      const sEnd = timeToMinutes(s.end_time);
      if (startMin < sEnd && endMin > sStart) overlap = s;
    }
    return { overlap, opTotalMin };
  }, [shift, op, dow, start, end, weekDays, shiftsByDay]);

  if (!shift) return null;

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  return (
    <Sheet open={!!shift} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit shift</SheetTitle>
          <SheetDescription>
            {dayNames[shift.day_of_week]} · {fmtTime12(shift.start_time)}–{fmtTime12(shift.end_time)}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="mt-4 h-[calc(100vh-14rem)] pr-2">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Operator</Label>
              <Select value={op || "__none"} onValueChange={(v) => setOp(v === "__none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select operator" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— Unassigned —</SelectItem>
                  {operators.map((o) => {
                    const c = opColor(o.username);
                    return (
                      <SelectItem key={o.id} value={o.username}>
                        <span className="inline-flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${c?.dot}`} />
                          {o.username}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {op && conflictInfo && (
              <div
                className={`rounded-lg border p-3 text-xs ${
                  conflictInfo.overlap
                    ? "border-destructive/40 bg-destructive/5 text-destructive"
                    : "border-emerald-500/40 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {conflictInfo.overlap ? (
                  <>
                    <div className="flex items-center gap-1.5 font-semibold">
                      <AlertTriangle className="h-3.5 w-3.5" /> Overlaps another shift
                    </div>
                    <div className="mt-1">
                      {fmtTime12(conflictInfo.overlap.start_time)}–
                      {fmtTime12(conflictInfo.overlap.end_time)}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Good assignment
                  </div>
                )}
                <div className="mt-1 text-muted-foreground">
                  {op} total on this day (incl. this shift):{" "}
                  {fmtHours(conflictInfo.opTotalMin + minutesBetween(start, end))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Day</Label>
                <Select value={String(dow)} onValueChange={(v) => setDow(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                      <SelectItem key={d} value={String(d)}>{dayNames[d]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="assigned">Assigned</SelectItem>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start</Label>
                <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>End</Label>
                <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Label</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Morning shift" />
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>

            <Separator />

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() =>
                  onSave({
                    start_time: start,
                    end_time: end,
                    label,
                    notes: notes || null,
                    assigned_operator: op || null,
                    status,
                    day_of_week: dow,
                  })
                }
              >
                Save changes
              </Button>
              <Button size="sm" variant="outline" onClick={() => onAssign(shift.id, null, "unassigned")}>
                Unassign
              </Button>
              <Button size="sm" variant="destructive" onClick={() => onDelete(shift.id)}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ---------- create dialog ----------

function CreateShiftDialog({
  open,
  onOpenChange,
  defaultDayIndex,
  operators,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultDayIndex: number | null;
  operators: OperatorBasic[];
  onCreate: (input: {
    day_of_week: number;
    start_time: string;
    end_time: string;
    label: string;
    assigned_operator: string | null;
    notes: string | null;
    specific_date: string | null;
  }) => Promise<void>;
}) {
  const [day, setDay] = useState<number>(1); // Monday
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("13:00");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [op, setOp] = useState<string>("");

  useEffect(() => {
    if (open) {
      const idx = defaultDayIndex ?? 0;
      // idx is Monday=0..Sunday=6 → convert to Sun=0..Sat=6
      const jsDow = (idx + 1) % 7;
      setDay(jsDow);
    }
  }, [open, defaultDayIndex]);

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New shift</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Day of week</Label>
            <Select value={String(day)} onValueChange={(v) => setDay(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <SelectItem key={d} value={String(d)}>{dayNames[d]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start</Label>
              <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>End</Label>
              <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Operator</Label>
            <Select value={op || "__none"} onValueChange={(v) => setOp(v === "__none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— Unassigned —</SelectItem>
                {operators.map((o) => (
                  <SelectItem key={o.id} value={o.username}>{o.username}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Label (optional)</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Morning shift" />
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() =>
              onCreate({
                day_of_week: day,
                start_time: start,
                end_time: end,
                label,
                assigned_operator: op || null,
                notes: notes || null,
                specific_date: null,
              })
            }
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
