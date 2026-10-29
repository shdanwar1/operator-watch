import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, CalendarClock, Bell, LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminGetAutomationHealth } from "@/lib/automation-health.functions";
import { AUTOMATION_PROCESSES, automationStatus, healthError } from "@/domain/automation-health";

const titles = { timetable_sync: "Timetable & shifts", push_dispatch: "Shift reminders", auto_checkout: "Automatic checkout" };
const icons = { timetable_sync: CalendarClock, push_dispatch: Bell, auto_checkout: LogOut };
// Routine scans run often and usually find nothing to do; name them so an idle scan never reads as an action on a live shift.
const labels = { timetable_sync: ["Last sync run", "Last sync completed"], push_dispatch: ["Last reminder check", "Last successful check"], auto_checkout: ["Last routine scan", "Last successful scan"] } as const;
function dateLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "Not yet observed";
}
export function AutomationHealth() {
  const load = useServerFn(adminGetAutomationHealth);
  const query = useQuery({ queryKey: ["admin-automation-health"], queryFn: () => load(), refetchInterval: 60_000, refetchIntervalInBackground: false });
  return <section aria-labelledby="automation-health-title" className="space-y-2">
    <div className="flex items-center justify-between gap-3">
      <h2 id="automation-health-title" className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"><Activity className="size-3.5" />Automation health</h2>
      <Button variant="ghost" size="icon" title="Refresh automation health" aria-label="Refresh automation health" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw className={`size-4 ${query.isFetching ? "animate-spin motion-reduce:animate-none" : ""}`} /></Button>
    </div>
    {query.isPending ? <p role="status" className="py-5 text-sm text-muted-foreground">Loading automation health…</p> : query.isError && !query.data ? <div role="alert" className="flex flex-wrap items-center gap-3 py-4 text-sm"><span>Automation health unavailable.</span><Button variant="outline" size="sm" onClick={() => query.refetch()}>Retry</Button></div> : <>
      {query.isError && <p role="alert" className="text-sm text-warn">Refresh failed. Showing the last available results.</p>}
      <div className="divide-y divide-border border-y border-border">
        {AUTOMATION_PROCESSES.map(process => {
          const row = query.data?.rows.find(r => r.process === process);
          const status = automationStatus(row, query.data?.now ?? Date.now(), query.data?.dispatchDue ?? null);
          const Icon = icons[process];
          const problem = status === "Failed" || status === "Partial failure";
          const warning = ["Out of date", "Awaiting check", "Freshness unavailable"].includes(status);
          return <div key={process} className="py-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-medium"><Icon className="size-4 shrink-0 text-muted-foreground" />{titles[process]}</h3>
              <span className={`flex items-center gap-1.5 text-xs ${problem ? "text-alert" : warning ? "text-warn" : row ? "text-done" : "text-muted-foreground"}`}><span className="size-1.5 rounded-full bg-current" />{status}</span>
            </div>
            <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              <span>{labels[process][0]}: {dateLabel(row?.attempted_at ?? null)}</span>
              <span>{labels[process][1]}: {dateLabel(row?.last_success_at ?? null)}</span>
            </div>
            {row && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{(row.duration_ms / 1000).toFixed(1)}s</span>
              {Object.entries(row.counters).map(([key, value]) => <span key={key}>{key.replaceAll("_", " ")}: {value}</span>)}
              {Object.entries(row.stages).map(([key, value]) => <span key={key}>{key.replaceAll("_", " ")}: {value}</span>)}
            </div>}
            {process === "push_dispatch" && row && <p className="mt-2 text-xs text-muted-foreground">Sent counts reflect push-service acceptance, not confirmed phone delivery.</p>}
            {row?.last_error_code && <details className="mt-3 text-xs"><summary className="cursor-pointer text-muted-foreground">Last reported issue · {dateLabel(row.last_error_at)}</summary><p className="pt-2 text-alert">{healthError(row.last_error_code)}</p></details>}
          </div>;
        })}
      </div>
    </>}
  </section>;
}