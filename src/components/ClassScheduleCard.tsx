import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExternalLink, CalendarDays, MoreHorizontal, Check, X } from "lucide-react";
import { buildClassDisplayUrl } from "@/lib/studio-display";
import { cn } from "@/lib/utils";
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

export type ClassStatus = "completed" | "live" | "upcoming" | "cancelled";

/**
 * Effective lifecycle state of a class row: the operator's explicit state wins,
 * otherwise the state is derived from the clock.
 */
export function classStatusOf(c: CalendarClassRow, now: Date): ClassStatus {
  if (c.status === "cancelled") return "cancelled";
  if (c.status === "completed") return "completed";
  const start = atDate(c.specific_date, c.start_time).getTime();
  let end = atDate(c.specific_date, c.end_time).getTime();
  if (end <= start) end += 24 * 3600 * 1000;
  const t = now.getTime();
  if (t >= end) return "completed";
  if (t >= start) return "live";
  return "upcoming";
}

const STATUS_LABEL: Record<ClassStatus, string> = {
  completed: "Completed",
  live: "In Progress",
  upcoming: "Upcoming",
  cancelled: "Cancelled",
};

export function ClassScheduleCard({
  classes,
  now,
  title = "Shift Overview",
  onSetStatus,
}: {
  classes: CalendarClassRow[];
  now: Date;
  title?: string;
  /** When provided, each row exposes Mark as Completed / Cancel Class. */
  onSetStatus?: (id: string, status: "scheduled" | "completed" | "cancelled") => void;
}) {
  if (classes.length === 0) return null;

  const states = classes.map((c) => classStatusOf(c, now));
  const completed = states.filter((s) => s === "completed").length;
  const cancelled = states.filter((s) => s === "cancelled").length;
  const upcoming = states.filter((s) => s === "upcoming").length;
  const processed = completed + cancelled;
  const pct = Math.round((processed / classes.length) * 100);

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
              {completed} completed · {cancelled} cancelled · {upcoming} upcoming
            </span>
            <span className="tabular-nums">
              {pct}% ({processed} / {classes.length} processed)
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-done transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          {classes.map((c, i) => {
            const st = states[i];
            const isCancelled = st === "cancelled";
            return (
              <div
                key={c.id}
                className={cn(
                  "flex flex-wrap items-center gap-3 rounded-xl border p-3 transition-colors",
                  st === "live" ? "border-live/60 bg-live/5" : "border-border/60",
                  isCancelled && "opacity-50",
                )}
              >
                <div className="w-[92px] shrink-0 text-xs tabular-nums">
                  <div className="font-medium">{fmt(c.start_time)}</div>
                  <div className="text-muted-foreground">– {fmt(c.end_time)}</div>
                </div>
                <span
                  aria-hidden
                  className={cn(
                    "h-2.5 w-2.5 shrink-0 rounded-full",
                    st === "completed"
                      ? "bg-done"
                      : st === "live"
                        ? "bg-live animate-pulse"
                        : st === "cancelled"
                          ? "bg-alert"
                          : "border border-muted-foreground/40",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "truncate text-sm font-medium",
                      isCancelled && "line-through",
                    )}
                  >
                    {c.class_name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{c.teacher_name}</div>
                </div>
                <div className="hidden text-xs text-muted-foreground sm:block">
                  {c.duration_min} min
                </div>
                <Badge
                  variant={st === "live" ? "default" : "outline"}
                  className={cn("text-[10px]", isCancelled && "text-alert")}
                >
                  {STATUS_LABEL[st]}
                </Badge>
                <Button
                  size="sm"
                  variant={st === "live" ? "default" : "outline"}
                  disabled={isCancelled}
                  onClick={() => openDisplay(c)}
                >
                  {isCancelled ? "Cancelled" : "Open Studio Display"}
                  {!isCancelled && <ExternalLink className="ml-1.5 h-3.5 w-3.5" />}
                </Button>
                {onSetStatus && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Class actions">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {isCancelled ? (
                        <DropdownMenuItem onClick={() => onSetStatus(c.id, "scheduled")}>
                          Restore class
                        </DropdownMenuItem>
                      ) : (
                        <>
                          <DropdownMenuItem onClick={() => onSetStatus(c.id, "completed")}>
                            <Check className="mr-2 h-4 w-4 text-done" /> Mark as Completed
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onSetStatus(c.id, "cancelled")}>
                            <X className="mr-2 h-4 w-4 text-alert" /> Cancel Class
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-done" /> Completed</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-live" /> In Progress</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-alert" /> Cancelled</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-muted-foreground/40" /> Upcoming</span>
        </div>
      </CardContent>
    </Card>
  );
}
