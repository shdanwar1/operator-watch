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
  currentBerlinMonth,
  monthNavigableWeekStarts,
  navigableWeekIndexForDate,
  weekDatesFrom,
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
  // Navigation is restricted to the weeks intersecting the current Berlin month.
  const today = berlinDate();
  const { year, month } = currentBerlinMonth();
  const weekStarts = useMemo(() => monthNavigableWeekStarts(year, month), [year, month]);
  const todayIndex = useMemo(
    () => navigableWeekIndexForDate(today, year, month),
    [today, year, month],
  );
  const [weekIndex, setWeekIndex] = useState(todayIndex);

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
  const clampedIndex = Math.min(Math.max(weekIndex, 0), weekStarts.length - 1);
  const weekDates = useMemo(
    () => weekDatesFrom(weekStarts[clampedIndex]),
    [weekStarts, clampedIndex],
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
        <nav aria-label="Week navigation" className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Previous week"
            disabled={clampedIndex === 0}
            onClick={() => setWeekIndex((i) => Math.max(0, i - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setWeekOffset(0)}
            disabled={weekOffset === 0}
          >
            Today
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Next week"
            onClick={() => setWeekOffset((o) => o + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 text-xs tabular-nums text-muted-foreground">
            {weekRangeCompactLabel(weekDates)}
          </span>
        </nav>
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
