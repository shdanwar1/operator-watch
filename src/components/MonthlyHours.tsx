import { Card, CardContent } from "@/components/ui/card";
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  formatHM,
  summarizeMonth,
} from "@/lib/attendance";
import type { ScheduledShiftRow, ShiftRow } from "@/lib/shifts.functions";

export function MonthlyHours({ shifts, scheduled }: { shifts: ShiftRow[]; scheduled: ScheduledShiftRow[] }) {
  const summary = summarizeMonth(shifts, scheduled, new Date());
  const progress = summary.scheduledMin > 0
    ? Math.min(100, (summary.workedMin / summary.scheduledMin) * 100)
    : 0;

  return (
    <section>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Monthly hours · {summary.monthLabel}
      </div>
      <Card className="max-lg:glass max-lg:rounded-[22px]">
        <CardContent className="p-5 sm:p-6">
          <div className="grid grid-cols-2 gap-5">
            <HourValue label="Worked" minutes={summary.workedMin} prominent />
            <HourValue label="Scheduled" minutes={summary.scheduledMin} prominent />
          </div>
          <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4">
            {(["day", "night", "weekend"] as const).map((category) => (
              <div key={category}>
                <div className="flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: CATEGORY_COLOR[category] }} />
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

function HourValue({ label, minutes, prominent = false }: { label: string; minutes: number; prominent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={prominent ? "mt-1 text-2xl font-semibold tabular-nums" : "mt-1 text-sm font-semibold tabular-nums"}>
        {formatHM(minutes)}
      </div>
    </div>
  );
}