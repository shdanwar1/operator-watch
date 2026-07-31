import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, CalendarDays } from "lucide-react";
import { buildClassDisplayUrl } from "@/lib/studio-display";
import type { CalendarClassRow } from "@/lib/gcal.functions";

function fmt(t: string) {
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

function atDate(date: string, time: string) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

type Status = "completed" | "live" | "upcoming";

function statusOf(c: CalendarClassRow, now: Date): Status {
  const start = atDate(c.specific_date, c.start_time).getTime();
  const end = atDate(c.specific_date, c.end_time).getTime();
  const t = now.getTime();
  if (t >= end) return "completed";
  if (t >= start) return "live";
  return "upcoming";
}

export function ClassScheduleCard({
  classes,
  now,
  title = "Today's classes",
}: {
  classes: CalendarClassRow[];
  now: Date;
  title?: string;
}) {
  if (classes.length === 0) return null;

  const done = classes.filter((c) => statusOf(c, now) === "completed").length;
  const pct = Math.round((done / classes.length) * 100);

  const openDisplay = (c: CalendarClassRow) => {
    window.open(
      buildClassDisplayUrl({
        className: c.class_name,
        teacherName: c.teacher_name,
        startTime: c.start_time,
        durationMin: c.duration_min || 60,
      }),
      `studio-display-${c.id}`,
      "popup,width=1280,height=800",
    );
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">{title}</h3>
          <Badge variant="secondary" className="text-[10px]">
            {classes.length} {classes.length === 1 ? "class" : "classes"}
          </Badge>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {done} / {classes.length} completed
            </span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          {classes.map((c) => {
            const st = statusOf(c, now);
            return (
              <div
                key={c.id}
                className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 transition-colors ${
                  st === "live" ? "border-primary/60 bg-primary/5" : "border-border/60"
                }`}
              >
                <div className="w-[92px] shrink-0 text-xs tabular-nums">
                  <div className="font-medium">{fmt(c.start_time)}</div>
                  <div className="text-muted-foreground">– {fmt(c.end_time)}</div>
                </div>
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    st === "completed"
                      ? "bg-emerald-500"
                      : st === "live"
                        ? "bg-primary animate-pulse"
                        : "border border-muted-foreground/40"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.class_name}</div>
                  <div className="truncate text-xs text-muted-foreground">{c.teacher_name}</div>
                </div>
                <div className="hidden text-xs text-muted-foreground sm:block">
                  {c.duration_min} min
                </div>
                <Badge
                  variant={st === "live" ? "default" : "outline"}
                  className="text-[10px] capitalize"
                >
                  {st === "live" ? "In progress" : st}
                </Badge>
                <Button size="sm" variant={st === "live" ? "default" : "outline"} onClick={() => openDisplay(c)}>
                  Open Studio Display
                  <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
