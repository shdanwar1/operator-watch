import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Clock, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listScheduledShifts } from "@/lib/shifts.functions";
import {
  addDays,
  fmtDayShort,
  fmtHours,
  fmtTime12,
  minutesBetween,
  opColor,
  toAssignment,
  ymd,
} from "@/lib/admin-utils";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Admin Control Center — Dance Masterclass" },
      {
        name: "description",
        content: "Administrative overview of today's studio shifts, operators on duty and upcoming coverage.",
      },
      { property: "og:title", content: "Admin Control Center — Dance Masterclass" },
      {
        property: "og:description",
        content: "Administrative overview of today's studio shifts, operators on duty and upcoming coverage.",
      },
    ],
  }),
  component: AdminDashboard,
});

function AdminDashboard() {
  const fetchScheduled = useServerFn(listScheduledShifts);
  const { data, isPending } = useQuery({
    queryKey: ["admin", "scheduled"],
    queryFn: () => fetchScheduled(),
    refetchInterval: 60_000,
  });

  const all = (data ?? []).map(toAssignment);
  const today = new Date();
  const todayKey = ymd(today);
  const todays = all
    .filter((s) => s.specific_date === todayKey)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const workingToday = Array.from(
    new Set(todays.filter((s) => s.assigned_operator).map((s) => s.assigned_operator as string)),
  );

  const horizon = ymd(addDays(today, 14));
  const upcoming = all
    .filter((s) => s.specific_date > todayKey && s.specific_date <= horizon)
    .sort((a, b) =>
      a.specific_date === b.specific_date
        ? a.start_time.localeCompare(b.start_time)
        : a.specific_date.localeCompare(b.specific_date),
    );

  const unassignedSoon = upcoming.filter((s) => s.effective_status === "unassigned").length;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Control Center</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {today.toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/admin/calendar"
            className="press rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
          >
            Open calendar
          </Link>
          <Link
            to="/admin/shifts"
            className="press rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
          >
            Manage shifts
          </Link>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={CalendarDays} label="Shifts today" value={String(todays.length)} />
        <StatCard icon={Users} label="Operators on duty" value={String(workingToday.length)} />
        <StatCard
          icon={Clock}
          label="Unassigned (next 14 days)"
          value={String(unassignedSoon)}
          tone={unassignedSoon > 0 ? "warn" : "ok"}
        />
      </div>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold tracking-tight">Today's shifts</h2>
            {isPending ? (
              <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
            ) : todays.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">No shifts scheduled today.</p>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {todays.map((s) => {
                  const c = opColor(s.assigned_operator);
                  return (
                    <li key={s.id} className="flex items-center gap-3 py-3">
                      <span className={`h-2 w-2 rounded-full ${c?.dot ?? "bg-muted-foreground/40"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {s.assigned_operator ?? "Unassigned"}
                        </div>
                        {s.label && (
                          <div className="truncate text-xs text-muted-foreground">{s.label}</div>
                        )}
                      </div>
                      <div className="text-right text-xs tabular-nums text-muted-foreground">
                        <div>
                          {fmtTime12(s.start_time)} – {fmtTime12(s.end_time)}
                        </div>
                        <div>{fmtHours(minutesBetween(s.start_time, s.end_time))}</div>
                      </div>
                      <Badge
                        variant={s.effective_status === "unassigned" ? "destructive" : "secondary"}
                        className="ml-2 text-[10px] capitalize"
                      >
                        {s.effective_status}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardContent className="p-5">
              <h2 className="text-sm font-semibold tracking-tight">Operators working today</h2>
              {workingToday.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">Nobody assigned today.</p>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  {workingToday.map((name) => {
                    const c = opColor(name);
                    return (
                      <span
                        key={name}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${c?.bg} ${c?.border} ${c?.text}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${c?.dot}`} />
                        {name}
                      </span>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <h2 className="text-sm font-semibold tracking-tight">Upcoming shifts</h2>
              {upcoming.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">Nothing scheduled ahead.</p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {upcoming.slice(0, 10).map((s) => (
                    <li key={s.id} className="flex items-center gap-3 text-sm">
                      <span className="w-24 shrink-0 text-xs text-muted-foreground">
                        {fmtDayShort(new Date(`${s.specific_date}T00:00:00`))}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {s.assigned_operator ?? (
                          <span className="text-muted-foreground">Unassigned</span>
                        )}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {fmtTime12(s.start_time)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
            tone === "warn"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-border bg-muted/50 text-muted-foreground"
          }`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <div className="text-2xl font-semibold tabular-nums leading-none">{value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
