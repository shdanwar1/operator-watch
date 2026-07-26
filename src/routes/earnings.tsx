import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download } from "lucide-react";
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
  CATEGORY_EMOJI,
  type AttendanceRow,
} from "@/lib/attendance";
import { supabase } from "@/integrations/supabase/client";
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

  async function load() {
    setLoading(true);
    try {
      const [s, sc] = await Promise.all([fetchShifts(), fetchScheduled()]);
      setShifts(s);
      setScheduled(sc);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Live sync — reflect any admin/operator edits without manual refresh.
  useEffect(() => {
    const ch = supabase
      .channel("payroll-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "shifts" }, () => load())
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scheduled_shifts" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const now = new Date();
  const monthStart = useMemo(() => new Date(now.getFullYear(), now.getMonth(), 1), []);
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
          ? `${fmtTime(r.scheduledStart)}–${fmtTime(r.scheduledEnd)}`
          : "—",
        fmtTime(r.checkIn),
        fmtTime(r.checkOut),
        formatHM(r.workedMin),
        r.diffMin != null ? formatDiff(r.diffMin) : "—",
        CATEGORY_LABEL[r.primary],
      ]),
      styles: { fontSize: 10, cellPadding: 6, lineColor: [230, 230, 230], lineWidth: 0.5 },
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
      didParseCell2: undefined,
    });

    // Summary section
    // @ts-expect-error jspdf-autotable augments doc at runtime
    const y = (doc.lastAutoTable?.finalY ?? 120) + 32;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Payroll Hours Summary", 40, y);

    autoTable(doc, {
      startY: y + 10,
      head: [["Category", "Hours"]],
      body: [
        [`${CATEGORY_EMOJI.day}  Daytime Hours`, formatHM(summary.dayMin)],
        [`${CATEGORY_EMOJI.night}  Night Hours`, formatHM(summary.nightMin)],
        [`${CATEGORY_EMOJI.weekend}  Weekend Hours`, formatHM(summary.weekendMin)],
      ],
      foot: [["Total Worked Hours", formatHM(summary.workedMin)]],
      styles: { fontSize: 11, cellPadding: 8 },
      headStyles: { fillColor: [245, 245, 247], textColor: 30, fontStyle: "bold" },
      footStyles: { fillColor: [235, 235, 240], textColor: 20, fontStyle: "bold" },
      columnStyles: { 1: { halign: "right" } },
      tableWidth: 320,
    });

    doc.save(
      `attendance-${opName}-${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}.pdf`,
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="mb-8 flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Payroll</h1>
            <p className="text-sm text-muted-foreground">{summary.monthLabel}</p>
          </div>
        </header>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-6">
            {/* Overview */}
            <Card className="border-border/60 shadow-sm">
              <CardContent className="p-6 sm:p-8">
                <div className="grid gap-6 sm:grid-cols-2">
                  <StatBlock label="Worked hours" value={formatHM(summary.workedMin)} />
                  <StatBlock label="Scheduled hours" value={formatHM(summary.scheduledMin)} />
                </div>
                <div className="mt-6">
                  <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Progress against schedule</span>
                    <span className="tabular-nums">{Math.round(progressPct)}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-700"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-3 gap-3">
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
      </div>
    </div>
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
      <td className="px-5 py-3 text-center">
        <Badge
          variant="secondary"
          className="border-0 text-white"
          style={{ backgroundColor: CATEGORY_COLOR[row.primary] }}
        >
          {CATEGORY_LABEL[row.primary]}
        </Badge>
      </td>
    </tr>
  );
}
