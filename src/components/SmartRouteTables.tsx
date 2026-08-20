import { Bus, TrainFront, Train, Ship, Clock } from "lucide-react";
import { modeLabel, type SmartRoute, type SmartRouteSet } from "@/lib/smart-routes";

function fmt(d: Date) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function ModeIcon({ mode, className }: { mode: string; className?: string }) {
  if (mode === "bus") return <Bus className={className} />;
  if (mode === "ferry") return <Ship className={className} />;
  if (mode === "subway" || mode === "tram") return <TrainFront className={className} />;
  return <Train className={className} />;
}

function RouteTable({
  route,
  fastest,
  now,
  selectedDepartureIso,
}: {
  route: SmartRoute;
  fastest: boolean;
  now: Date;
  selectedDepartureIso?: string | null;
}) {
  const upcoming = route.departures.filter(
    (d) => Date.parse(d.leave_iso) >= now.getTime() - 5 * 60_000,
  );
  const list = (upcoming.length > 0 ? upcoming : route.departures).slice(0, 4);
  const next = list[0] ?? null;

  return (
    <div className="rounded-2xl border border-border bg-muted/20 p-3.5">
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-lg bg-primary/12 px-2 py-1 text-sm font-semibold text-primary">
          <ModeIcon mode={route.mode} className="h-3.5 w-3.5" />
          {route.line}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {modeLabel(route.mode)}
          {route.direction ? ` · ${route.direction}` : ""}
        </span>
        {fastest ? (
          <span className="ml-auto shrink-0 rounded-md bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
            Fastest
          </span>
        ) : null}
      </div>

      {route.from_stop || route.to_stop ? (
        <div className="mt-1.5 truncate text-xs text-muted-foreground">
          {route.from_stop} → {route.to_stop}
        </div>
      ) : null}

      <div className="mt-3 space-y-1.5 text-sm">
        {next ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Next departure</span>
              <span className="font-medium tabular-nums">
                {fmt(new Date(next.departure_iso))}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Travel time</span>
              <span className="font-medium tabular-nums">{next.total_minutes} min</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Arrival</span>
              <span className="font-medium tabular-nums">
                {fmt(new Date(next.arrival_iso))}
              </span>
            </div>
          </>
        ) : null}
      </div>

      {list.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-2.5">
          {list.map((d) => {
            const selected = selectedDepartureIso === d.leave_iso;
            return (
              <span
                key={d.leave_iso}
                className={`rounded-md px-1.5 py-0.5 text-xs tabular-nums ${
                  selected
                    ? "bg-primary/15 font-semibold text-primary"
                    : "text-muted-foreground"
                }`}
              >
                {fmt(new Date(d.departure_iso))}
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="mt-2 text-[11px] text-muted-foreground">
        {route.walk_to_minutes} min walk to stop · {route.walk_from_minutes} min to studio
      </div>
    </div>
  );
}

/**
 * The local transit intelligence view: at most two direct options, fastest
 * first, rendered from the cached route set (never from a live request).
 */
export function SmartRouteTables({
  set,
  now,
  stale,
  selectedDepartureIso,
  className,
}: {
  set: SmartRouteSet;
  now: Date;
  stale?: boolean;
  selectedDepartureIso?: string | null;
  className?: string;
}) {
  if (set.routes.length === 0) return null;
  const updated = new Date(set.fetched_at);
  const sameDay = updated.toDateString() === now.toDateString();

  return (
    <div className={className}>
      <div className="grid gap-3 sm:grid-cols-2">
        {set.routes.map((r, i) => (
          <RouteTable
            key={r.id}
            route={r}
            fastest={i === 0 && set.routes.length > 1}
            now={now}
            selectedDepartureIso={selectedDepartureIso}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Clock className="h-3 w-3" />
        {stale ? "Using latest saved timetable · " : ""}
        Updated {sameDay ? "today" : updated.toLocaleDateString()} ·{" "}
        <span className="tabular-nums">{fmt(updated)}</span>
      </div>
    </div>
  );
}
