import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CATEGORY_LABEL, formatHM, summarizeMonth } from "@/lib/attendance";
import type { ScheduledShiftRow, ShiftRow } from "@/lib/shifts.functions";
import { Link } from "@tanstack/react-router";

export function MonthlyHours({
  shifts,
  scheduled,
}: {
  shifts: ShiftRow[];
  scheduled: ScheduledShiftRow[];
}) {
  const summary = summarizeMonth(shifts, scheduled, new Date());
  // Bar segments show how worked hours split across categories,
  // scaled against scheduled (or worked, if it exceeds scheduled).
  const barDenominator = Math.max(summary.scheduledMin, summary.workedMin);
  const segments = (["day", "night", "weekend"] as const).map((category) => ({
    category,
    pct: barDenominator > 0 ? Math.min(100, (summary[`${category}Min`] / barDenominator) * 100) : 0,
  }));
  const monthName = new Date().toLocaleDateString(undefined, { month: "long" });

  return (
    <section>
      <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h2 className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {monthName} hours
        </h2>
        <Button asChild variant="outline" size="sm" className="h-7 rounded-full px-3 text-[11px]">
          <Link to="/record">All records <span aria-hidden>›</span></Link>
        </Button>
      </div>
      <Card className="rounded-[22px] shadow-none">
        <CardContent className="p-5 sm:p-6">
          <div className="grid grid-cols-2 gap-5">
            <HourValue label="Worked" minutes={summary.workedMin} prominent />
            <HourValue label="Scheduled" minutes={summary.scheduledMin} prominent />
          </div>
          <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="flex h-full">
              {segments.map((segment) => (
                <div
                  key={segment.category}
                  className={
                    segment.category === "day"
                      ? "bg-hours-day"
                      : segment.category === "night"
                        ? "bg-hours-night"
                        : "bg-hours-weekend"
                  }
                  style={{ width: `${segment.pct}%` }}
                />
              ))}
            </div>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4">
            {(["day", "night", "weekend"] as const).map((category) => (
              <div key={category} className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      category === "day"
                        ? "bg-hours-day"
                        : category === "night"
                          ? "bg-hours-night"
                          : "bg-hours-weekend"
                    }`}
                  />
                  {CATEGORY_LABEL[category]}
                </div>
                <div className="mt-1 text-sm font-semibold tabular-nums">
                  {formatHM(summary[`${category}Min`])}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function HourValue({
  label,
  minutes,
  prominent = false,
}: {
  label: string;
  minutes: number;
  prominent?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div
        className={
          prominent
            ? "mt-1 text-[28px] font-semibold tabular-nums"
            : "mt-1 text-sm font-semibold tabular-nums"
        }
      >
        {formatHM(minutes)}
      </div>
    </div>
  );
}
