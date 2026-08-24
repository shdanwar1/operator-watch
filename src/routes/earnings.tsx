import { PAGE_TITLES, pageMeta } from "@/lib/page-titles";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";
import { operatorNamespace, readCache, writeCache } from "@/lib/local-cache";

import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { getGateStatus } from "@/lib/gate.functions";
import {
  listShifts,
  listScheduledShifts,
  type ShiftRow,
  type ScheduledShiftRow,
} from "@/lib/shifts.functions";
import { getOperatorDisplayName } from "@/lib/operators.functions";
import {
  summarizeMonth,
  formatHM,
  formatDiff,
  CATEGORY_LABEL,
  CATEGORY_COLOR,
  type AttendanceRow,
} from "@/lib/attendance";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { downloadAttendancePdf } from "@/lib/attendance-pdf";

export const Route = createFileRoute("/earnings")({
  head: () => ({
    meta: pageMeta(
      PAGE_TITLES.attendance,
      "Attendance history, worked hours, and downloadable payroll report.",
    ),
  }),
  beforeLoad: async () => {
    const status = await getGateStatus();
    if (!status.unlocked) throw redirect({ to: "/unlock" });
    if (status.isAdmin) throw redirect({ to: "/admin" });
  },
  loader: async () => {
    const { username } = await getGateStatus();
    if (!username) return { username: null as string | null };
    const canonical = await getOperatorDisplayName({ data: { username } });
    return { username: canonical ?? username };
  },
  component: EarningsPage,
});

function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function EarningsPage() {
  const { username } = Route.useLoaderData();
  const fetchShifts = useServerFn(listShifts);
  const fetchScheduled = useServerFn(listScheduledShifts);
  type EarningsSnapshot = { shifts: ShiftRow[]; scheduled: ScheduledShiftRow[] };
  const earningsCacheKey = username ? `${operatorNamespace(username)}earnings` : null;
  const [cachedEarnings] = useState<EarningsSnapshot | null>(() =>
    earningsCacheKey ? readCache<EarningsSnapshot>(earningsCacheKey) : null,
  );

  const [shifts, setShifts] = useState<ShiftRow[]>(cachedEarnings?.shifts ?? []);
  const [scheduled, setScheduled] = useState<ScheduledShiftRow[]>(cachedEarnings?.scheduled ?? []);
  const [loading, setLoading] = useState(!cachedEarnings);

  // Only the very first load shows the full-page "Loading…" state. Every
  // later refresh updates the already-visible content in place instead of
  // blanking the page on every event.
  const hasLoadedOnce = useRef(!!cachedEarnings);
  async function load() {
    if (!hasLoadedOnce.current) setLoading(true);
    try {
      const [s, sc] = await Promise.all([fetchShifts(), fetchScheduled()]);
      setShifts(s);
      setScheduled(sc);
      if (earningsCacheKey)
        writeCache<EarningsSnapshot>(earningsCacheKey, { shifts: s, scheduled: sc });
    } finally {
      setLoading(false);
      hasLoadedOnce.current = true;
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Shift tables are not exposed to client realtime (per-operator data locked
  // down by RLS); refresh on a timer and when the tab regains focus instead.
  // Debounced so a burst of triggers collapses into one refresh.
  const debouncedLoad = useDebouncedCallback(() => load(), 700);
  useEffect(() => {
    const t = setInterval(() => debouncedLoad(), 30_000);
    const onFocus = () => debouncedLoad();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [debouncedLoad]);


  const [monthStart, setMonthStart] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const isCurrentMonth = useMemo(() => {
    const n = new Date();
    return (
      monthStart.getFullYear() === n.getFullYear() && monthStart.getMonth() === n.getMonth()
    );
  }, [monthStart]);
  const shiftMonth = (delta: number) =>
    setMonthStart((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  const summary = useMemo(
    () => summarizeMonth(shifts, scheduled, monthStart),
    [shifts, scheduled, monthStart],
  );

  const progressPct =
    summary.scheduledMin > 0
      ? Math.min(100, (summary.workedMin / summary.scheduledMin) * 100)
      : 0;


  function exportPdf() {
    downloadAttendancePdf(summary, username ?? "Operator");
  }

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader eyebrow="Attendance" title={summary.monthLabel} />
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[9rem] text-center text-sm font-medium tabular-nums">
            {summary.monthLabel}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => shiftMonth(1)}
            disabled={isCurrentMonth}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>


        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-6">
            {/* Overview */}
            <Card className="border-border/60 shadow-sm max-lg:glass max-lg:rounded-[22px]">
              <CardContent className="p-6 sm:p-8 max-lg:p-4">
                <div className="grid gap-6 sm:grid-cols-2 max-lg:grid-cols-2 max-lg:gap-2">
                  <StatBlock label="Worked hours" value={formatHM(summary.workedMin)} />
                  <StatBlock label="Scheduled hours" value={formatHM(summary.scheduledMin)} />
                </div>
                <div className="mt-6 max-lg:mt-4">
                  <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Progress against schedule</span>
                    <span className="tabular-nums">{Math.round(progressPct)}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted max-lg:h-1">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-700"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-3 gap-3 max-lg:mt-4 max-lg:gap-2">
                  <CategoryTile category="day" mins={summary.dayMin} />
                  <CategoryTile category="night" mins={summary.nightMin} />
                  <CategoryTile category="weekend" mins={summary.weekendMin} />
                </div>
              </CardContent>
            </Card>


            {/* Attendance history */}
            <Card className="border-border/60 shadow-sm max-lg:glass max-lg:rounded-[22px]">
              <CardContent className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b p-6 max-lg:p-4">
                  <div>
                    <h2 className="text-sm font-semibold">Attendance · {summary.monthLabel}</h2>
                    <p className="text-xs text-muted-foreground">
                      {summary.rows.length} shift{summary.rows.length === 1 ? "" : "s"} this month
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={exportPdf}
                    disabled={summary.rows.length === 0}
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Export PDF
                  </Button>
                </div>

                {/* Mobile: one row per shift instead of a horizontally scrolling table. */}
                <div className="md:hidden">
                  {summary.rows.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No completed shifts yet this month.
                    </p>
                  ) : (
                    <>
                      <ul>
                        {summary.rows.map((r) => (
                          <AttendanceMobileRow key={r.id} row={r} />
                        ))}
                      </ul>
                      <div className="flex items-center justify-between border-t border-border px-4 py-3 text-[12px] font-semibold">
                        <span>Total</span>
                        <span className="tabular-nums">{formatHM(summary.workedMin)}</span>
                      </div>
                    </>
                  )}
                </div>

                <div className="hidden overflow-x-auto md:block">

                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-5 py-3 text-left">Date</th>
                        <th className="px-5 py-3 text-left">Scheduled</th>
                        <th className="px-5 py-3 text-left">Check in</th>
                        <th className="px-5 py-3 text-left">Check out</th>
                        <th className="px-5 py-3 text-right">Worked</th>
                        <th className="px-5 py-3 text-right">Diff</th>
                        <th className="px-5 py-3 text-center">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {summary.rows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-5 py-10 text-center text-sm text-muted-foreground"
                          >
                            No completed shifts yet this month.
                          </td>
                        </tr>
                      ) : (
                        summary.rows.map((r) => <AttendanceTableRow key={r.id} row={r} />)
                      )}
                    </tbody>
                    {summary.rows.length > 0 && (
                      <tfoot>
                        <tr className="bg-muted/30 font-semibold">
                          <td colSpan={4} className="px-5 py-3 text-right">Total</td>
                          <td className="px-5 py-3 text-right tabular-nums">
                            {formatHM(summary.workedMin)}
                          </td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
      )}
    </AppShell>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground max-lg:text-[9px]">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums tracking-tight max-lg:text-[26px] max-lg:tracking-[-0.03em] sm:text-4xl">
        {value}
      </div>

    </div>
  );
}

function CategoryTile({
  category,
  mins,
}: {
  category: "day" | "night" | "weekend";
  mins: number;
}) {
  return (
    <div className="rounded-lg border border-border/60 p-3 max-lg:glass-tile max-lg:rounded-[14px] max-lg:p-2.5">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground max-lg:gap-1.5 max-lg:text-[8.5px]">
        <span
          className="inline-block h-2.5 w-2.5 rounded-sm max-lg:h-2 max-lg:w-2"
          style={{ backgroundColor: CATEGORY_COLOR[category] }}
        />
        {CATEGORY_LABEL[category]}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums max-lg:text-[15px]">{formatHM(mins)}</div>

    </div>
  );
}

function AttendanceTableRow({ row }: { row: AttendanceRow }) {
  const diffColor =
    row.diffMin == null
      ? "text-muted-foreground"
      : row.diffMin > 0
        ? "text-emerald-600"
        : row.diffMin < 0
          ? "text-rose-600"
          : "text-muted-foreground";
  return (
    <tr>
      <td className="px-5 py-3">{fmtDate(row.date)}</td>
      <td className="px-5 py-3 tabular-nums text-muted-foreground">
        {row.scheduledStart && row.scheduledEnd
          ? `${fmtTime(row.scheduledStart)}–${fmtTime(row.scheduledEnd)}`
          : "—"}
      </td>
      <td className="px-5 py-3 tabular-nums">{fmtTime(row.checkIn)}</td>
      <td className="px-5 py-3 tabular-nums">{fmtTime(row.checkOut)}</td>
      <td className="px-5 py-3 text-right tabular-nums">{formatHM(row.workedMin)}</td>
      <td className={`px-5 py-3 text-right tabular-nums ${diffColor}`}>
        {row.diffMin != null ? formatDiff(row.diffMin) : "—"}
      </td>
      <td className="px-5 py-3">
        <div className="flex flex-wrap items-center justify-center gap-1">
          {(row.categories.length ? row.categories : [row.primary]).map((c) => (
            <Badge
              key={c}
              variant="secondary"
              className="border-0 text-white"
              style={{ backgroundColor: CATEGORY_COLOR[c] }}
            >
              {CATEGORY_LABEL[c]}
            </Badge>
          ))}
        </div>
      </td>

    </tr>
  );
}

/** Mobile attendance row: date + times on the left, worked hours on the right. */
function AttendanceMobileRow({ row }: { row: AttendanceRow }) {
  const diffColor =
    row.diffMin == null
      ? "text-muted-foreground"
      : row.diffMin > 0
        ? "text-done"
        : row.diffMin < 0
          ? "text-alert"
          : "text-muted-foreground";
  return (
    <li className="grid grid-cols-[62px_1fr_auto] items-center gap-2.5 border-t border-border px-4 py-3">
      <div className="text-[10px] font-semibold tabular-nums">{fmtDate(row.date)}</div>
      <div className="min-w-0">
        <div className="text-[10px] tabular-nums text-muted-foreground">
          {fmtTime(row.checkIn)} – {fmtTime(row.checkOut)}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {(row.categories.length ? row.categories : [row.primary]).map((c) => (
            <span
              key={c}
              className="rounded-full px-1.5 py-0.5 text-[7px] font-medium uppercase tracking-wide text-white"
              style={{ backgroundColor: CATEGORY_COLOR[c] }}
            >
              {CATEGORY_LABEL[c]}
            </span>
          ))}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[12px] font-semibold tabular-nums">{formatHM(row.workedMin)}</div>
        <div className={`text-[9px] tabular-nums ${diffColor}`}>
          {row.diffMin != null ? formatDiff(row.diffMin) : "—"}
        </div>
      </div>
    </li>
  );
}
