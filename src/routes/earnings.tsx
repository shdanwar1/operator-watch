import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";

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
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export const Route = createFileRoute("/earnings")({
  head: () => ({
    meta: [
      { title: "Payroll · Studio Operator" },
      {
        name: "description",
        content: "Attendance history, worked hours, and downloadable payroll report.",
      },
    ],
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
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledShiftRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Only the very first load shows the full-page "Loading…" state. Every
  // later refresh updates the already-visible content in place instead of
  // blanking the page on every event.
  const hasLoadedOnce = useRef(false);
  async function load() {
    if (!hasLoadedOnce.current) setLoading(true);
    try {
      const [s, sc] = await Promise.all([fetchShifts(), fetchScheduled()]);
      setShifts(s);
      setScheduled(sc);
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
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const opName = username ?? "Operator";

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Attendance Report", 40, 50);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(90);
    doc.text(`Operator: ${opName}`, 40, 70);
    doc.text(`Period: ${summary.monthLabel}`, 40, 84);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 98);
    doc.setTextColor(20);

    const rgb = (hex: string): [number, number, number] => {
      const h = hex.replace("#", "");
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
      ];
    };

    autoTable(doc, {
      startY: 120,
      head: [[
        "Date",
        "Scheduled",
        "Check In",
        "Check Out",
        "Worked",
        "Diff",
        "Type",
      ]],
      body: summary.rows.map((r) => [
        fmtDate(r.date),
        r.scheduledStart && r.scheduledEnd
          ? `${fmtTime(r.scheduledStart)}-${fmtTime(r.scheduledEnd)}`
          : "-",
        fmtTime(r.checkIn),
        fmtTime(r.checkOut),
        formatHM(r.workedMin),
        r.diffMin != null ? formatDiff(r.diffMin) : "-",
        r.categories.map((c) => CATEGORY_LABEL[c]).join(" • "),
      ]),
      styles: { font: "helvetica", fontSize: 10, cellPadding: 6, lineColor: [230, 230, 230], lineWidth: 0.5 },
      headStyles: { fillColor: [245, 245, 247], textColor: 30, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [252, 252, 253] },
      columnStyles: {
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "center" },
      },
      didParseCell: (data) => {
        if (data.section !== "body" || data.column.index !== 6) return;
        const row = summary.rows[data.row.index];
        if (!row) return;
        data.cell.styles.fillColor = rgb(CATEGORY_COLOR[row.primary]);
        data.cell.styles.textColor = 255;
        data.cell.styles.fontStyle = "bold";
      },
      
    });

    // Summary section
    // @ts-expect-error jspdf-autotable augments doc at runtime
    const y = (doc.lastAutoTable?.finalY ?? 120) + 32;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Payroll Hours Summary", 40, y);

    const summaryRows: Array<{ label: string; value: string; color: [number, number, number] }> = [
      { label: "Daytime Hours", value: formatHM(summary.dayMin), color: rgb(CATEGORY_COLOR.day) },
      { label: "Night Hours", value: formatHM(summary.nightMin), color: rgb(CATEGORY_COLOR.night) },
      { label: "Weekend Hours", value: formatHM(summary.weekendMin), color: rgb(CATEGORY_COLOR.weekend) },
    ];

    autoTable(doc, {
      startY: y + 10,
      head: [["", "Category", "Hours"]],
      body: summaryRows.map((r) => ["", r.label, r.value]),
      foot: [["", "Total Worked Hours", formatHM(summary.workedMin)]],
      styles: { font: "helvetica", fontSize: 11, cellPadding: 8 },
      headStyles: { fillColor: [245, 245, 247], textColor: 30, fontStyle: "bold" },
      footStyles: { fillColor: [235, 235, 240], textColor: 20, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 22 },
        2: { halign: "right" },
      },
      tableWidth: 340,
      didDrawCell: (data) => {
        if (data.section !== "body" || data.column.index !== 0) return;
        const row = summaryRows[data.row.index];
        if (!row) return;
        const size = 10;
        const cx = data.cell.x + (data.cell.width - size) / 2;
        const cy = data.cell.y + (data.cell.height - size) / 2;
        doc.setFillColor(row.color[0], row.color[1], row.color[2]);
        doc.rect(cx, cy, size, size, "F");
      },
    });


    doc.save(
      `attendance-${opName}-${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}.pdf`,
    );
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
            <Card className="border-border/60 shadow-sm">
              <CardContent className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b p-6">
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
                <div className="overflow-x-auto">
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
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl">
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
    <div className="rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span
          className="inline-block h-2.5 w-2.5 rounded-sm"
          style={{ backgroundColor: CATEGORY_COLOR[category] }}
        />
        {CATEGORY_LABEL[category]}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{formatHM(mins)}</div>
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
