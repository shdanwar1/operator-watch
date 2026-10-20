import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ChecklistRecords } from "./ChecklistRecords";
import { adminOperatorChecklistRecords } from "@/lib/checklist-records.functions";
import { scoreTone, type OperatorScore, type ScorePeriod } from "@/domain/checklist-scoring";

const TONE_BAR: Record<ReturnType<typeof scoreTone>, string> = {
  done: "bg-done",
  warn: "bg-warn",
  destructive: "bg-destructive",
};
const TONE_TEXT: Record<ReturnType<typeof scoreTone>, string> = {
  done: "text-done",
  warn: "text-warn",
  destructive: "text-destructive",
};

/** Deterministic avatar gradient from the operator name. */
const AVATAR_GRADIENTS = [
  "from-sky-500 to-blue-600",
  "from-violet-500 to-purple-600",
  "from-amber-500 to-orange-600",
  "from-teal-500 to-emerald-600",
  "from-rose-500 to-pink-600",
  "from-indigo-500 to-blue-600",
];

function avatarGradient(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? "");
}

function ScoreBar({ pct, late }: { pct: number; late?: number }) {
  const tone = scoreTone(pct);
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <div className="h-[7px] w-full max-w-[130px] overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${TONE_BAR[tone]}`}
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>
        <span className={`text-sm font-semibold tabular-nums ${TONE_TEXT[tone]}`}>{pct}%</span>
      </div>
      {late !== undefined && (
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">{late} late</p>
      )}
    </div>
  );
}

function OperatorDrillDown({
  operator,
  period,
  onClose,
}: {
  operator: string;
  period: ScorePeriod;
  onClose: () => void;
}) {
  const fetchRecords = useServerFn(adminOperatorChecklistRecords);
  const query = useQuery({
    queryKey: ["admin", "checklist-records", "operator", period, operator],
    queryFn: () => fetchRecords({ data: { period, operator } }),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{operator}</DialogTitle>
          <DialogDescription>
            {period === "30d" ? "Last 30 days" : "All time"} · closed shifts with checklist
            activity
          </DialogDescription>
        </DialogHeader>
        {query.isError ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>Could not load checklist records.</p>
            <Button variant="outline" onClick={() => query.refetch()}>
              Try again
            </Button>
          </div>
        ) : query.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading records…
          </p>
        ) : query.data.length ? (
          <ChecklistRecords records={query.data} />
        ) : (
          <p className="text-sm text-muted-foreground">No checklist records found.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ChecklistScorecard({
  scores,
  period,
}: {
  scores: OperatorScore[];
  period: ScorePeriod;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="hidden grid-cols-[1.2fr_1fr_1fr] gap-4 border-b border-border bg-muted/40 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
        <span>Operator</span>
        <span>Completeness</span>
        <span>Punctuality</span>
      </div>
      {scores.map((score) => (
        <button
          key={score.operator}
          type="button"
          onClick={() => setSelected(score.operator)}
          className="grid w-full grid-cols-1 gap-2 border-b border-border px-4 py-3.5 text-left transition-colors last:border-b-0 hover:bg-muted/40 sm:grid-cols-[1.2fr_1fr_1fr] sm:items-center sm:gap-4"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xs font-semibold text-white ${avatarGradient(score.operator)}`}
            >
              {initials(score.operator)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{score.operator}</span>
              <span className="block text-xs text-muted-foreground tabular-nums">
                {score.shifts} shifts
              </span>
            </span>
          </span>
          <span className="pl-11 sm:pl-0">
            <ScoreBar pct={score.completenessPct} />
          </span>
          <span className="pl-11 sm:pl-0">
            <ScoreBar pct={score.punctualityPct} late={score.lateUnits} />
          </span>
        </button>
      ))}
      {selected && (
        <OperatorDrillDown operator={selected} period={period} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
