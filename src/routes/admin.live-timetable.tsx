import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TimetableWeek, TimetableWeekSkeleton } from "@/components/admin/TimetableWeek";
import { buildTimetableWeek, formatBerlinTimestamp } from "@/domain/timetable-view";
import { getLiveTimetable, refreshLiveTimetable } from "@/lib/timetable.functions";
import { PAGE_TITLES, pageMeta } from "@/lib/page-titles";

export const Route = createFileRoute("/admin/live-timetable")({
  head: () => ({
    meta: pageMeta(PAGE_TITLES.liveTimetable, "Current DMC weekly class schedule."),
  }),
  component: AdminLiveTimetable,
});

function AdminLiveTimetable() {
  const qc = useQueryClient();
  const load = useServerFn(getLiveTimetable);
  const refresh = useServerFn(refreshLiveTimetable);

  const { data, isPending, error } = useQuery({
    queryKey: ["admin", "live-timetable"],
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
      await qc.invalidateQueries({ queryKey: ["admin", "live-timetable"] });
      const skipped = result.anomalies.length;
      toast.success(
        `Timetable updated — ${result.slots} classes this week` +
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

  const week = useMemo(
    () =>
      buildTimetableWeek({
        slots: data?.slots ?? [],
        classes: data?.classes ?? [],
        instructors: data?.instructors ?? [],
      }),
    [data],
  );

  const lastUpdated = formatBerlinTimestamp(data?.lastRefreshedAt ?? null);
  const isEmpty = !isPending && (data?.slots.length ?? 0) === 0;
  const busy = refreshMutation.isPending;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Live Timetable</h1>
          <p className="mt-1 text-sm text-muted-foreground">Current DMC weekly class schedule.</p>
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

      {error && (
        <p role="alert" className="text-sm text-destructive">
          Could not load the stored timetable. {error instanceof Error ? error.message : ""}
        </p>
      )}

      <div className="overflow-x-auto pb-2">
        {isPending ? (
          <TimetableWeekSkeleton />
        ) : isEmpty ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No timetable stored yet — press Refresh to load the current schedule.
          </p>
        ) : (
          <TimetableWeek week={week} />
        )}
      </div>
    </div>
  );
}
