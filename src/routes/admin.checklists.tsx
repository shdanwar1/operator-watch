import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChecklistScorecard } from "@/components/admin/ChecklistScorecard";
import { ChecklistTemplateList } from "@/components/admin/ChecklistTemplateList";
import { adminChecklistScores } from "@/lib/checklist-records.functions";
import type { ScorePeriod } from "@/domain/checklist-scoring";
import { pageMeta } from "@/lib/page-titles";

export const Route = createFileRoute("/admin/checklists")({
  head: () => ({
    meta: pageMeta(
      "Checklists — Studio Admin",
      "Operator checklist completeness and punctuality scores, plus master checklist editing.",
    ),
  }),
  component: AdminChecklists,
});

const PERIODS: { value: ScorePeriod; label: string }[] = [
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

function AdminChecklists() {
  const [period, setPeriod] = useState<ScorePeriod>("30d");
  const fetchScores = useServerFn(adminChecklistScores);
  const query = useQuery({
    queryKey: ["admin", "checklist-scores", period],
    queryFn: () => fetchScores({ data: { period } }),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return (
    <section className="mx-auto max-w-4xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Checklists</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Operator completeness and punctuality
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Score period"
          className="flex rounded-lg border border-border bg-muted/40 p-0.5"
        >
          {PERIODS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={period === option.value}
              onClick={() => setPeriod(option.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                period === option.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {query.isError ? (
        <div role="alert" className="space-y-2 text-sm">
          <p>Could not load checklist scores.</p>
          <Button variant="outline" onClick={() => query.refetch()}>
            Try again
          </Button>
        </div>
      ) : query.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading scores…
        </p>
      ) : query.data.length ? (
        <ChecklistScorecard scores={query.data} period={period} />
      ) : (
        <p className="text-sm text-muted-foreground">
          No closed shifts with checklists in this period.
        </p>
      )}

      <div className="space-y-3 border-t border-border pt-6">
        <h2 className="text-xs font-semibold uppercase text-muted-foreground">Edit Checklists</h2>
        <ChecklistTemplateList />
      </div>
    </section>
  );
}
