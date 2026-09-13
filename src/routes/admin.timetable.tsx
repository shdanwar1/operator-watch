import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TimetableWeek, TimetableWeekSkeleton } from "@/components/admin/TimetableWeek";
import { formatBerlinTimestamp } from "@/domain/timetable-view";
import {
  berlinDate,
  buildOperatorBoard,
  weekDatesAtOffset,
  weekMonthTitle,
  weekRangeCompactLabel,
} from "@/domain/timetable-week";
import { getTimetableMonthBoard, refreshLiveTimetable } from "@/lib/timetable.functions";
import { PAGE_TITLES, pageMeta } from "@/lib/page-titles";

export const Route = createFileRoute("/admin/timetable")({
  head: () => ({
    meta: pageMeta(
      PAGE_TITLES.timetable,
      "The DMC class week, with the operator responsible for each class this month.",
    ),
  }),
  component: AdminTimetable,
});

function AdminTimetable() {
  const qc = useQueryClient();
  const load = useServerFn(getTimetableMonthBoard);
  const refresh = useServerFn(refreshLiveTimetable);
  // Whole weeks away from the week containing today (Europe/Berlin).
  const [weekOffset, setWeekOffset] = useState(0);

  const { data, isPending, error } = useQuery({
    queryKey: ["admin", "timetable-month"],
    queryFn: () => load(),
  });

  const refreshMutation = useMutation({
    mutationFn: () => refresh(),
    onSuccess: async (result) => {
      if (!result.ok) {
        // The stored timetable is untouched when a refresh fails.
        toast.error(result.error);
        return;
      }
      await qc.invalidateQueries({ queryKey: ["admin", "timetable-month"] });
      const skipped = result.anomalies.length;
      toast.success(
        `Timetable updated — ${result.slots} classes` +
          (skipped > 0 ? ` · ${skipped} entr${skipped === 1 ? "y" : "ies"} skipped` : ""),
      );
      if (skipped > 0) {
        for (const a of result.anomalies.slice(0, 3)) {
          toast.warning(`Slot ${a.sourceSlotId ?? "(no id)"}: ${a.reason}`);
        }
      }
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Could not refresh the timetable.");
    },
  });

  // The displayed Monday–Sunday week, which may cross the month boundary.
  const weekDates = useMemo(
    () => weekDatesAtOffset(berlinDate(), weekOffset),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekOffset],
  );

  // Operator assignments come only from the current operational month.
  const selected = useMemo(
    () =>
      buildOperatorBoard({
        weekDates,
        slots: data?.timetable.slots ?? [],
        classes: data?.timetable.classes ?? [],
        instructors: data?.timetable.instructors ?? [],
        occurrences: data?.occurrences ?? [],
        shifts: data?.shifts ?? [],
        classIdBySource: data?.classIdBySource ?? {},
        assignmentMonth: data?.month ?? null,
      }),
    [data, weekDates],
  );

  const lastUpdated = formatBerlinTimestamp(data?.timetable.lastRefreshedAt ?? null);
  const isEmpty = !isPending && !error && (data?.timetable.slots.length ?? 0) === 0;
  const busy = refreshMutation.isPending;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Timetable</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {weekMonthTitle(weekDates)}
            <span className="mx-1.5 text-muted-foreground/60">·</span>
            <span className="tabular-nums">{weekRangeCompactLabel(weekDates)}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">Last updated {lastUpdated}</span>
          )}
          <Button
            type="button"
            size="sm"
            onClick={() => refreshMutation.mutate()}
            disabled={busy}
            aria-label="Refresh the timetable from the studio schedule"
          >
            <RefreshCw className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {busy ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </header>

      {!error && !isEmpty && (
        <div role="tablist" aria-label="Week of the month" className="flex flex-wrap gap-1.5">
          {weeks.map((week, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === weekIndex}
              onClick={() => setWeekIndex(i)}
              className={cn(
                "press rounded-lg border px-3 py-1.5 text-left text-[12px] leading-tight transition-colors",
                i === weekIndex
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:bg-muted/50",
              )}
            >
              <span className="font-medium">Week {i + 1}</span>
              <span
                className={cn(
                  "ml-2 tabular-nums",
                  i === weekIndex ? "opacity-70" : "text-muted-foreground",
                )}
              >
                {weekRangeShortLabel(week.map((d) => d.date))}
              </span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          Could not load this month. {error instanceof Error ? error.message : ""}
        </p>
      )}

      {!error && (
        <div className="overflow-x-auto pb-2">
          {isPending ? (
            <TimetableWeekSkeleton />
          ) : isEmpty ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No timetable stored yet — press Refresh to load the current schedule.
            </p>
          ) : (
            <TimetableWeek week={selected} />
          )}
        </div>
      )}
    </div>
  );
}
