import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExternalLink, CalendarDays, MoreHorizontal, Check, X, Wand2, AlertTriangle } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DirectoryCombobox } from "@/components/DirectoryCombobox";
import type { DirectoryItem } from "@/lib/directories.functions";
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
  onCorrect,
  classOptions = [],
  teacherOptions = [],
  footer,
}: {
  classes: CalendarClassRow[];
  now: Date;
  title?: string;
  /** When provided, each row exposes Mark as Completed / Cancel Class. */
  onSetStatus?: (id: string, status: "scheduled" | "completed" | "cancelled") => void;
  /** When provided, each row exposes "Fix class match" (saved as an alias). */
  onCorrect?: (id: string, classId: string, teacherId: string | null) => void;
  classOptions?: DirectoryItem[];
  teacherOptions?: DirectoryItem[];
  /** Optional action area rendered at the bottom of the card, e.g. a check-out control. */
  footer?: React.ReactNode;
}) {
  const [fixing, setFixing] = useState<CalendarClassRow | null>(null);
  const [fixClass, setFixClass] = useState("");
  const [fixTeacher, setFixTeacher] = useState("");

  if (classes.length === 0) return null;

  const states = classes.map((c) => classStatusOf(c, now));

  // A class is "unmatched" when it has no link to the class/teacher directory.
  // The name check is a safety net: a stale row can still carry an id that no
  // longer exists in the directory, and that is just as broken as a null id.
  const knownClass = new Set(classOptions.map((o) => o.name.trim().toLowerCase()));
  const knownTeacher = new Set(teacherOptions.map((o) => o.name.trim().toLowerCase()));
  const classUnmatched = (c: CalendarClassRow) =>
    !c.class_id || (knownClass.size > 0 && !knownClass.has(c.class_name.trim().toLowerCase()));
  const teacherUnmatched = (c: CalendarClassRow) =>
    !c.teacher_id ||
    (knownTeacher.size > 0 && !knownTeacher.has(c.teacher_name.trim().toLowerCase()));



  const openDisplay = (c: CalendarClassRow) => {
    window.open(
      buildClassDisplayUrl({
        id: c.id,
        className: c.class_name,
        teacherName: c.teacher_name,
        startTime: c.start_time,
        durationMin: durationOf(c) || 60,
      }),
      `studio-display-${c.id}`,
      "popup,width=1280,height=800",
    );
  };

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
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        "flex items-center gap-1.5 truncate text-sm font-medium",
                        isCancelled && "line-through",
                      )}
                    >
                      {c.class_name}
                      {!isCancelled && (classUnmatched(c) || teacherUnmatched(c)) && (
                        <button
                          type="button"
                          disabled={!onCorrect}
                          onClick={() => {
                            if (!onCorrect) return;
                            setFixing(c);
                            setFixClass(classUnmatched(c) ? "" : c.class_name);
                            setFixTeacher(teacherUnmatched(c) ? "" : c.teacher_name);
                          }}
                          className={cn(
                            "shrink-0 text-warn",
                            onCorrect && "cursor-pointer hover:text-warn/80",
                          )}
                          title={
                            classUnmatched(c) && teacherUnmatched(c)
                              ? "Class and teacher couldn't be matched automatically — tap to fix"
                              : classUnmatched(c)
                                ? "Class couldn't be matched automatically — tap to fix"
                                : "Teacher couldn't be matched automatically — tap to fix"
                          }
                        >
                          <AlertTriangle className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{c.teacher_name}</div>
                  </div>
                  <div className="hidden text-xs text-muted-foreground sm:block">
                    {durationOf(c)} min
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
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
                      onClick={() => openDisplay(c)}
                      className="max-lg:hidden"
                    >
                      Studio Display
                      <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                    </Button>
                  )}

                  {(onSetStatus || onCorrect) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Class actions">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {onCorrect && (
                          <DropdownMenuItem
                            onClick={() => {
                              setFixing(c);
                              setFixClass(classUnmatched(c) ? "" : c.class_name);
                              setFixTeacher(teacherUnmatched(c) ? "" : c.teacher_name);
                            }}
                          >
                            <Wand2 className="mr-2 h-4 w-4" /> Fix class match
                          </DropdownMenuItem>
                        )}
                        {!onSetStatus ? null : isCancelled ? (
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
              </div>
            );
          })}
        </div>

        {footer ? (
          <div className="border-t border-border pt-4">{footer}</div>
        ) : null}
      </CardContent>

      <Dialog open={!!fixing} onOpenChange={(o) => !o && setFixing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fix class match</DialogTitle>
            <DialogDescription>
              {fixing?.raw_title
                ? `Calendar title: "${fixing.raw_title}"`
                : "Pick the correct class and teacher."}{" "}
              This correction is remembered for future calendar syncs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Class</p>
              <DirectoryCombobox
                value={fixClass}
                onChange={setFixClass}
                options={classOptions}
                placeholder="Select class"
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Teacher (optional)</p>
              <DirectoryCombobox
                value={fixTeacher}
                onChange={setFixTeacher}
                options={teacherOptions}
                placeholder="Select teacher"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFixing(null)}>
              Cancel
            </Button>
            <Button
              disabled={!fixClass}
              onClick={() => {
                const cls = classOptions.find(
                  (o) => o.name.toLowerCase() === fixClass.trim().toLowerCase(),
                );
                if (!cls || !fixing || !onCorrect) return;
                const tea = teacherOptions.find(
                  (o) => o.name.toLowerCase() === fixTeacher.trim().toLowerCase(),
                );
                onCorrect(fixing.id, cls.id, tea?.id ?? null);
                setFixing(null);
              }}
            >
              Save match
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
