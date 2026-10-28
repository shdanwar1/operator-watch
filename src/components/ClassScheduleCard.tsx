import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExternalLink, CalendarDays, MoreHorizontal, Check, X, Copy, Timer } from "lucide-react";
import { isBalletClass } from "@/lib/timecode";
import { toast } from "sonner";
import { Link, useNavigate } from "@tanstack/react-router";
import { temporaryClassSearch } from "@/lib/studio-presets";
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

/** Duration is derived from the stored start/end times, never duplicated. */
export function durationOf(c: { start_time: string; end_time: string }): number {
  const [sh, sm] = c.start_time.split(":").map(Number);
  const [eh, em] = c.end_time.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return mins;
}

function atDate(date: string, time: string) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

export type ClassStatus = "completed" | "live" | "upcoming" | "cancelled";

/** YYMMDD_HH-MM_Teacher Name_Class Name — no file extension. */
export function classFilenameOf(c: {
  specific_date: string;
  start_time: string;
  teacherName: string;
  className: string;
}): string {
  const [y, m, d] = c.specific_date.split("-");
  const [h, min] = c.start_time.split(":");
  return `${y.slice(2)}${m}${d}_${h}-${min}_${c.teacherName}_${c.className}`;
}

/** Clipboard write with a legacy fallback; returns whether it succeeded. */
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

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
  footer,
  renderClassExtra,
}: {
  classes: CalendarClassRow[];
  now: Date;
  title?: string;
  /** When provided, each row exposes Mark as Completed / Cancel Class. */
  onSetStatus?: (id: string, status: "scheduled" | "completed" | "cancelled") => void;
  /** Optional action area rendered at the bottom of the card, e.g. a check-out control. */
  footer?: React.ReactNode;
  /** Extra content rendered on its own line inside a class row (e.g. its checklist). */
  renderClassExtra?: (c: CalendarClassRow, status: ClassStatus) => React.ReactNode;
}) {
  const navigate = useNavigate();
  if (classes.length === 0) return null;

  const states = classes.map((c) => classStatusOf(c, now));

  return (
    <Card className="max-lg:glass max-lg:rounded-[22px]">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">{title}</h3>
          <Badge variant="secondary" className="text-[10px]">
            {classes.length} {classes.length === 1 ? "class" : "classes"}
          </Badge>
        </div>

        <div className="relative">
          {classes.map((c, i) => {
            const st = states[i];
            const isCancelled = st === "cancelled";
            const done = st === "completed";
            const prevDone = i > 0 && states[i - 1] === "completed";
            return (
              <div key={c.id} className="flex gap-3">
                <div className="relative flex w-6 shrink-0 items-center justify-center">
                  {i > 0 && (
                    <span
                      className={cn(
                        "absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2",
                        prevDone && done ? "bg-done" : "bg-border",
                      )}
                    />
                  )}
                  {i < classes.length - 1 && (
                    <span
                      className={cn(
                        "absolute bottom-0 left-1/2 h-1/2 w-px -translate-x-1/2",
                        done && states[i + 1] === "completed" ? "bg-done" : "bg-border",
                      )}
                    />
                  )}
                  <span
                    aria-hidden
                    className={cn(
                      "relative z-10 flex h-5 w-5 items-center justify-center rounded-full",
                      done
                        ? "bg-done text-background"
                        : st === "live"
                          ? "bg-live ring-4 ring-live/20"
                          : st === "cancelled"
                            ? "bg-alert text-background"
                            : "border-2 border-muted-foreground/40 bg-background",
                    )}
                  >
                    {done && <Check className="h-3 w-3" strokeWidth={3} />}
                    {isCancelled && <X className="h-3 w-3" strokeWidth={3} />}
                  </span>
                </div>

                <div
                  className={cn(
                    "my-1 flex flex-1 flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors",
                    isCancelled && "opacity-50",
                  )}
                >
                  <div className="w-[92px] shrink-0 text-xs tabular-nums">
                    <div className="font-medium">{fmt(c.start_time)}</div>
                    <div className="text-muted-foreground">– {fmt(c.end_time)}</div>
                  </div>
                  {/* `grow` + a real basis (not flex-1's 0% basis) so the row
                      wraps instead of squeezing the name into a sliver. */}
                  <div className="min-w-0 grow basis-[160px]">
                    <div
                      title={c.className}
                      className={cn(
                        "line-clamp-2 break-words text-sm leading-snug font-medium",
                        isCancelled && "line-through",
                      )}
                    >
                      {c.className}
                    </div>
                    <div title={c.teacherName} className="truncate text-xs text-muted-foreground">
                      {c.teacherName}
                    </div>
                  </div>
                  <div className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                    {durationOf(c)} min
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 text-[10px]",
                      st === "completed" && "border-done/70 bg-done/10 text-done hover:bg-done/15",
                      st === "live" && "border-live/70 bg-live text-background hover:bg-live",
                      st === "upcoming" && "border-border bg-background text-foreground",
                      st === "cancelled" && "border-alert/50 bg-alert/10 text-alert",
                    )}
                  >
                    {STATUS_LABEL[st]}
                  </Badge>
                  {(st === "upcoming" || st === "live") && (
                    <Button
                      size="sm"
                      variant={st === "live" ? "default" : "outline"}
                      className="shrink-0 max-lg:hidden"
                      asChild
                    >
                      {/* The class is handed to the Studio Display control page,
                          which owns the live session and its notes. */}
                      <Link
                        to="/studio-display"
                        search={temporaryClassSearch({
                          classId: c.id,
                          className: c.className,
                          teacherName: c.teacherName,
                          date: c.specific_date,
                          startTime: c.start_time,
                          endTime: c.end_time,
                        })}
                      >
                        Studio Display
                        <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  )}

                  {!isCancelled &&
                    isBalletClass({ className: c.className, durationMinutes: durationOf(c) }) && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0 max-lg:hidden"
                        aria-label="Open timecode"
                        title="Open timecode"
                        onClick={() => {
                          const q = new URLSearchParams({
                            cid: c.id,
                            cn: c.className,
                            tn: c.teacherName,
                            cd: c.specific_date,
                            cs: c.start_time.slice(0, 5),
                            ce: c.end_time.slice(0, 5),
                          });
                          void navigate({ href: `/timecode?${q.toString()}` });
                        }}
                      >
                        <Timer className="h-4 w-4" />
                      </Button>
                    )}

                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    aria-label="Copy class filename"
                    title="Copy class filename"
                    onClick={async () => {
                      const ok = await copyText(classFilenameOf(c));
                      if (ok) toast.success("Filename copied");
                      else toast.error("Could not copy filename");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>

                  {onSetStatus && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0"
                          aria-label="Class actions"
                        >
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

                  {renderClassExtra
                    ? (() => {
                        const extra = renderClassExtra(c, st);
                        return extra ? (
                          <div className="w-full basis-full border-t border-border pt-2">
                            {extra}
                          </div>
                        ) : null;
                      })()
                    : null}
                </div>
              </div>
            );
          })}
        </div>

        {footer ? <div className="border-t border-border pt-4">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}
