import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronLeft, ChevronRight, ChevronRight as Chev } from "lucide-react";
import { cn } from "@/lib/utils";
import { classifyMinute, type HourCategory } from "@/lib/attendance";
import { listMyShiftClasses, type CalendarClassRow } from "@/lib/gcal.functions";
import type { ScheduledShiftRow, ShiftRow } from "@/lib/shifts.functions";

type Instance = { shift: ScheduledShiftRow; startAt: Date; endAt: Date };

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DOT: Record<HourCategory, string> = {
  day: "bg-hours-day",
  night: "bg-hours-night",
  weekend: "bg-hours-weekend",
};

const key = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return time(d);
};

/** Real end (overnight-aware) of an instance. */
function endOf(i: Instance) {
  if (i.endAt.getTime() > i.startAt.getTime()) return i.endAt;
  const e = new Date(i.endAt);
  e.setDate(e.getDate() + 1);
  return e;
}

type Status = "completed" | "live" | "today" | "tomorrow" | "future";

function statusOf(i: Instance, now: Date): Status {
  const end = endOf(i);
  if ((i.shift.status ?? "").toLowerCase() === "completed" || end.getTime() < now.getTime())
    return "completed";
  if (i.startAt.getTime() <= now.getTime()) return "live";
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (i.startAt.toDateString() === now.toDateString()) return "today";
  if (i.startAt.toDateString() === tomorrow.toDateString()) return "tomorrow";
  return "future";
}

export function MobileCalendar(props: {
  weeks: Date[][];
  monthStart: Date;
  monthLabel: string;
  today: Date;
  now: Date;
  selectedKey: string | null;
  onSelect: (k: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  instancesOn: (day: Date) => Instance[];
  loggedOn: (day: Date) => ShiftRow[];
  onOpenShift: (s: ScheduledShiftRow) => void;
}) {
  const { weeks, monthStart, today, now, selectedKey } = props;
  const selectedDay = weeks.flat().find((d) => key(d) === selectedKey) ?? null;
  const selectedInsts = selectedDay ? props.instancesOn(selectedDay) : [];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={props.onPrev}
          aria-label="Previous month"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 pl-1 text-lg font-semibold tracking-tight">{props.monthLabel}</div>
        <button
          type="button"
          onClick={props.onToday}
          className="h-10 rounded-full border border-border px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Today
        </button>
        <button
          type="button"
          onClick={props.onNext}
          aria-label="Next month"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-4 px-1 text-sm text-muted-foreground">
        {(["day", "night", "weekend"] as const).map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5 capitalize">
            <span className={cn("h-2 w-2 rounded-full", DOT[c])} />
            {c}
          </span>
        ))}
      </div>

      <div className="rounded-[22px] border border-border bg-card p-3">
        <div className="mb-1 grid grid-cols-7">
          {DAY_LABELS.map((d) => (
            <div key={d} className="py-2 text-center text-xs text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {weeks.flat().map((day) => {
            const k = key(day);
            const inMonth = day.getMonth() === monthStart.getMonth();
            const isToday = day.getTime() === today.getTime();
            const selected = k === selectedKey;
            const insts = props.instancesOn(day);
            const worked = props.loggedOn(day).length > 0;
            const cats = Array.from(new Set(insts.map((i) => classifyMinute(i.startAt))));
            return (
              <button
                key={k}
                type="button"
                onClick={() => props.onSelect(k)}
                aria-pressed={selected}
                aria-label={day.toDateString()}
                className={cn(
                  "relative mx-auto flex h-14 w-full max-w-[52px] flex-col items-center justify-center gap-1 rounded-2xl border border-transparent tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  !inMonth && "opacity-30",
                  selected && "border-foreground bg-background",
                  isToday && "font-bold",
                )}
              >
                {worked && (
                  <span className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-muted-foreground/60 text-background">
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                  </span>
                )}
                <span className={cn("text-base", isToday && !selected && "underline underline-offset-4")}>
                  {day.getDate()}
                </span>
                <span className="flex h-1.5 gap-0.5">
                  {cats.map((c) => (
                    <span key={c} className={cn("h-1.5 w-1.5 rounded-full", DOT[c])} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selectedDay && (
        <div className="space-y-3">
          {selectedInsts.length === 0 ? (
            <div className="rounded-[22px] border border-border bg-card p-5">
              <div className="text-lg font-semibold">{fmtDay(selectedDay)}</div>
              <div className="mt-1 text-sm text-muted-foreground">No shift</div>
            </div>
          ) : (
            selectedInsts.map((inst, i) => (
              <ShiftDetail
                key={`${inst.shift.id}-${i}`}
                inst={inst}
                status={statusOf(inst, now)}
                onOpen={() => props.onOpenShift(inst.shift)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

const fmtDay = (d: Date) =>
  d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

const LABEL: Record<Status, string | null> = {
  completed: "Completed",
  live: "In progress",
  today: "Today",
  tomorrow: "Tomorrow",
  future: null,
};

function ShiftDetail({
  inst,
  status,
  onOpen,
}: {
  inst: Instance;
  status: Status;
  onOpen: () => void;
}) {
  const fetchClasses = useServerFn(listMyShiftClasses);
  const [classes, setClasses] = useState<CalendarClassRow[] | null>(null);
  useEffect(() => {
    let cancel = false;
    fetchClasses({ data: { shiftId: inst.shift.id } })
      .then((r) => !cancel && setClasses(r))
      .catch(() => !cancel && setClasses([]));
    return () => {
      cancel = true;
    };
  }, [fetchClasses, inst.shift.id]);

  const cat = classifyMinute(inst.startAt);
  const label = LABEL[status];
  const editable = status !== "completed";

  return (
    <div
      className={cn(
        "rounded-[22px] border border-border bg-card p-5",
        status === "completed" && "opacity-80",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[cat])} />
        <span className="flex-1 text-lg font-semibold">{fmtDay(inst.startAt)}</span>
        {label && (
          <span
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium",
              status === "live" && "bg-live/15 text-live",
              status === "completed" && "bg-done/15 text-done",
              (status === "today" || status === "tomorrow") && "bg-muted text-foreground",
            )}
          >
            {label}
          </span>
        )}
      </div>
      <div className="mt-1 pl-5 text-base tabular-nums text-muted-foreground">
        {time(inst.startAt)} → {time(endOf(inst))}
      </div>

      {classes && classes.length > 0 && (
        <div className="mt-4 space-y-2">
          {classes.map((c) => (
            <div key={c.id} className="rounded-2xl bg-muted/50 px-4 py-3">
              <div className="text-xs tabular-nums text-muted-foreground">
                {clock(c.start_time)} – {clock(c.end_time)}
              </div>
              <div className="font-semibold">{c.className}</div>
              <div className="text-sm text-muted-foreground">{c.teacherName}</div>
            </div>
          ))}
        </div>
      )}
      {classes === null && <div className="mt-4 text-sm text-muted-foreground">Loading classes…</div>}

      {editable && (
        <button
          type="button"
          onClick={onOpen}
          className="mt-4 inline-flex h-10 items-center gap-1 rounded-full border border-border px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Details & edit <Chev className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
