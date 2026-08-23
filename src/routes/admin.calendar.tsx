import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShiftCard, ShiftEditSheet, CreateShiftDialog } from "@/components/admin/ShiftDialogs";
import {
  createScheduledShift,
  deleteScheduledShift,
  listScheduledShifts,
  updateScheduledShift,
  type ScheduledShiftRow,
} from "@/lib/shifts.functions";
import { adminListOperators } from "@/lib/operators.functions";
import {
  addDays,
  addMonths,
  fmtRange,
  opColor,
  sameDay,
  startOfWeek,
  toAssignment,
  ymd,
} from "@/lib/admin-utils";

export const Route = createFileRoute("/admin/calendar")({
  head: () => ({
    meta: [
      { title: "Schedule Calendar — Dance Masterclass Admin" },
      {
        name: "description",
        content: "Month and week scheduling overview for every studio operator, with filters and colour coding.",
      },
      { property: "og:title", content: "Schedule Calendar — Dance Masterclass Admin" },
      {
        property: "og:description",
        content: "Month and week scheduling overview for every studio operator.",
      },
    ],
  }),
  component: AdminCalendar,
});

function AdminCalendar() {
  const qc = useQueryClient();
  const fetchScheduled = useServerFn(listScheduledShifts);
  const fetchOps = useServerFn(adminListOperators);
  const createFn = useServerFn(createScheduledShift);
  const updateFn = useServerFn(updateScheduledShift);
  const deleteFn = useServerFn(deleteScheduledShift);

  const [view, setView] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [filterOp, setFilterOp] = useState("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ScheduledShiftRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState<Date | null>(null);

  const { data: rows } = useQuery({
    queryKey: ["admin", "scheduled"],
    queryFn: () => fetchScheduled(),
  });
  const { data: operators } = useQuery({
    queryKey: ["admin", "operators"],
    queryFn: () => fetchOps(),
  });

  const all = useMemo(() => (rows ?? []).map(toAssignment), [rows]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "scheduled"] });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((s) => {
      if (filterOp === "unassigned" && s.assigned_operator) return false;
      if (filterOp !== "all" && filterOp !== "unassigned" && s.assigned_operator !== filterOp)
        return false;
      if (!q) return true;
      return (
        (s.assigned_operator ?? "unassigned").toLowerCase().includes(q) ||
        (s.label ?? "").toLowerCase().includes(q)
      );
    });
  }, [all, filterOp, search]);

  const days = useMemo(() => {
    if (view === "week") {
      const start = startOfWeek(anchor);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [anchor, view]);

  const byDate = useMemo(() => {
    const m = new Map<string, ReturnType<typeof toAssignment>[]>();
    for (const s of filtered) {
      const list = m.get(s.specific_date) ?? [];
      list.push(s);
      m.set(s.specific_date, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.start_time.localeCompare(b.start_time));
    return m;
  }, [filtered]);

  const step = (dir: 1 | -1) =>
    setAnchor((d) => (view === "week" ? addDays(d, dir * 7) : addMonths(d, dir)));

  const title =
    view === "week"
      ? fmtRange(startOfWeek(anchor), addDays(startOfWeek(anchor), 6))
      : anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const sameDayShifts = editing ? all.filter((s) => s.specific_date === editing.specific_date) : [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="mt-1 text-sm text-muted-foreground">Click any date to create a shift.</p>
        </div>
      </header>


      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => step(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[150px] text-center text-sm font-medium">{title}</span>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => step(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAnchor(new Date())}>
          Today
        </Button>
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
          {(["month", "week"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 text-xs capitalize transition-colors ${
                view === v ? "bg-accent font-medium" : "text-muted-foreground"
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search operator or label"
              className="h-9 w-56 pl-8"
            />
          </div>
          <Select value={filterOp} onValueChange={setFilterOp}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All operators</SelectItem>
              <SelectItem value="unassigned">Unassigned only</SelectItem>
              {(operators ?? []).map((o) => (
                <SelectItem key={o.id} value={o.username}>
                  {o.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        {(operators ?? []).map((o) => {
          const c = opColor(o.username);
          return (
            <span key={o.id} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${c?.dot}`} />
              {o.username}
            </span>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-7 gap-2">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="pb-1 text-center text-[11px] font-medium text-muted-foreground">
                {d}
              </div>
            ))}
            {days.map((d) => {
              const key = ymd(d);
              const list = byDate.get(key) ?? [];
              const isCurrentMonth = view === "week" || d.getMonth() === anchor.getMonth();
              const isToday = sameDay(d, new Date());
              const openCreate = () => {
                setCreateDate(d);
                setCreateOpen(true);
              };
              return (
                <div
                  key={key}
                  role="button"
                  tabIndex={0}
                  onClick={openCreate}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      openCreate();
                    }
                  }}
                  aria-label={`Create shift on ${key}`}
                  className={`group min-h-[104px] cursor-pointer rounded-lg border p-1.5 transition-colors hover:bg-accent/40 ${
                    isCurrentMonth ? "border-border" : "border-transparent opacity-40"
                  } ${isToday ? "ring-1 ring-primary/50" : ""}`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={`text-[11px] tabular-nums ${
                        isToday ? "font-semibold text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {d.getDate()}
                    </span>
                    <Plus
                      className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden
                    />
                  </div>
                  <div className="space-y-1">
                    {list.map((s) => (
                      <div key={s.id} onClick={(e) => e.stopPropagation()}>
                        <ShiftCard shift={s} onClick={() => setEditing(s)} />
                      </div>
                    ))}
                  </div>
                </div>
              );

            })}
          </div>
        </CardContent>
      </Card>

      <ShiftEditSheet
        shift={editing}
        operators={operators ?? []}
        sameDayShifts={sameDayShifts}
        canReassign
        onClose={() => setEditing(null)}
        onAssign={async (id, op, status) => {
          await updateFn({ data: { id, patch: { assigned_operator: op, status } } });
          setEditing(null);
          refresh();
        }}
        onDelete={async (id) => {
          await deleteFn({ data: { id } });
          setEditing(null);
          refresh();
          toast.success("Shift deleted");
        }}
        onSave={async (patch) => {
          if (!editing) return;
          await updateFn({ data: { id: editing.id, patch } });
          setEditing(null);
          refresh();
          toast.success("Shift updated");
        }}
      />

      <CreateShiftDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        selectedDate={createDate}
        operators={operators ?? []}
        onCreate={async (input, dates) => {
          for (const date of dates) {
            await createFn({ data: { ...input, specific_date: date } });
          }
          refresh();
          toast.success(dates.length > 1 ? `${dates.length} shifts created` : "Shift created");
        }}
      />
    </div>
  );
}
