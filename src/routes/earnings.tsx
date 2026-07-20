import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, Download, Wallet } from "lucide-react";
import { getGateStatus } from "@/lib/gate.functions";
import { listShifts, type ShiftRow } from "@/lib/shifts.functions";
import { getOperatorDisplayName } from "@/lib/operators.functions";
import {
  CONTRACT_MONTHLY_HOURS,
  computeHistory,
  computeMonthly,
  formatEUR,
} from "@/lib/earnings";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export const Route = createFileRoute("/earnings")({
  head: () => ({
    meta: [
      { title: "Payroll · Studio Operator" },
      {
        name: "description",
        content: "Monthly salary estimate, hours worked, and downloadable work log.",
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

type Row = {
  id: string;
  date: Date;
  start: Date;
  end: Date;
  hours: number;
};

function toRows(shifts: ShiftRow[]): Row[] {
  return shifts
    .filter((s) => s.check_out_at)
    .map((s) => {
      const start = new Date(s.check_in_at);
      const end = new Date(s.check_out_at!);
      const hours = Math.max(0, (end.getTime() - start.getTime()) / 3600000);
      return { id: s.id, date: start, start, end, hours };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function fmtHours(h: number) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}h ${String(mm).padStart(2, "0")}m`;
}

function EarningsPage() {
  const { username } = Route.useLoaderData();
  const fetchShifts = useServerFn(listShifts);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setShifts(await fetchShifts());
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchShifts]);

  const now = new Date();
  const monthStart = useMemo(() => new Date(now.getFullYear(), now.getMonth(), 1), []);
  const nextMonth = useMemo(() => new Date(now.getFullYear(), now.getMonth() + 1, 1), []);

  const monthly = useMemo(() => computeMonthly(shifts, monthStart), [shifts, monthStart]);
  const history = useMemo(() => computeHistory(shifts, 6), [shifts]);

  const currentMonthRows = useMemo(
    () =>
      toRows(shifts).filter((r) => r.start >= monthStart && r.start < nextMonth),
    [shifts, monthStart, nextMonth],
  );

  const remaining = Math.max(0, CONTRACT_MONTHLY_HOURS - monthly.totalHours);
  const monthLabel = monthStart.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  function exportPdf() {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const opName = username ?? "Operator";
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Monthly Work Log", 40, 50);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(`Operator: ${opName}`, 40, 72);
    doc.text(`Period: ${monthLabel}`, 40, 88);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 104);

    autoTable(doc, {
      startY: 128,
      head: [["Date", "Shift start", "Shift end", "Check-in", "Check-out", "Hours"]],
      body: currentMonthRows.map((r) => [
        fmtDate(r.date),
        fmtTime(r.start),
        fmtTime(r.end),
        fmtTime(r.start),
        fmtTime(r.end),
        fmtHours(r.hours),
      ]),
      styles: { fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [30, 30, 30], textColor: 255 },
      alternateRowStyles: { fillColor: [246, 246, 246] },
      foot: [[
        "Total",
        "",
        "",
        "",
        "",
        fmtHours(monthly.totalHours),
      ]],
      footStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: "bold" },
    });

    doc.save(`work-log-${opName}-${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}.pdf`);
  }

  const chartData = history.map((h) => {
    const [y, m] = h.monthKey.split("-").map((n) => parseInt(n, 10));
    const d = new Date(y, m - 1, 1);
    return {
      label: d.toLocaleDateString(undefined, { month: "short" }),
      hours: Number(h.totalHours.toFixed(2)),
    };
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="mb-8 flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Payroll</h1>
            <p className="text-sm text-muted-foreground">{monthLabel}</p>
          </div>
        </header>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-8">
            {/* Salary estimate — primary */}
            <Card className="border-border/60 shadow-sm">
              <CardContent className="p-6 sm:p-8">
                <div className="mb-6 flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-primary" />
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Salary estimate
                  </h2>
                </div>

                <div className="grid gap-6 sm:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Estimated gross
                    </div>
                    <div className="mt-1 text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl">
                      {formatEUR(monthly.grossSalary)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Estimated net
                    </div>
                    <div className="mt-1 text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl">
                      ≈ {formatEUR(monthly.netSalary)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Hours worked
                    </div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums">
                      {fmtHours(monthly.totalHours)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Remaining contracted
                    </div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums">
                      {fmtHours(remaining)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      of {CONTRACT_MONTHLY_HOURS.toFixed(2)}h/month
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 6-month working hours graph */}
            <Card className="border-border/60 shadow-sm">
              <CardContent className="p-6">
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Working hours · last 6 months
                </h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                    <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}h`} />
                    <Tooltip formatter={(v: number) => `${v.toFixed(2)} h`} cursor={{ fill: "hsl(var(--muted) / 0.4)" }} />
                    <Bar dataKey="hours" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Current month work log */}
            <Card className="border-border/60 shadow-sm">
              <CardContent className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b p-6">
                  <div>
                    <h2 className="text-sm font-semibold">Work log · {monthLabel}</h2>
                    <p className="text-xs text-muted-foreground">
                      {currentMonthRows.length} shift{currentMonthRows.length === 1 ? "" : "s"} this month
                    </p>
                  </div>
                  <Button size="sm" onClick={exportPdf} disabled={currentMonthRows.length === 0}>
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Export PDF
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-5 py-3 text-left">Date</th>
                        <th className="px-5 py-3 text-left">Start</th>
                        <th className="px-5 py-3 text-left">End</th>
                        <th className="px-5 py-3 text-left">Check-in</th>
                        <th className="px-5 py-3 text-left">Check-out</th>
                        <th className="px-5 py-3 text-right">Hours</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {currentMonthRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-5 py-10 text-center text-sm text-muted-foreground">
                            No completed shifts yet this month.
                          </td>
                        </tr>
                      ) : (
                        currentMonthRows.map((r) => (
                          <tr key={r.id}>
                            <td className="px-5 py-3">{fmtDate(r.date)}</td>
                            <td className="px-5 py-3 tabular-nums">{fmtTime(r.start)}</td>
                            <td className="px-5 py-3 tabular-nums">{fmtTime(r.end)}</td>
                            <td className="px-5 py-3 tabular-nums">{fmtTime(r.start)}</td>
                            <td className="px-5 py-3 tabular-nums">{fmtTime(r.end)}</td>
                            <td className="px-5 py-3 text-right tabular-nums">{fmtHours(r.hours)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    {currentMonthRows.length > 0 && (
                      <tfoot>
                        <tr className="bg-muted/30 font-semibold">
                          <td colSpan={5} className="px-5 py-3 text-right">Total hours</td>
                          <td className="px-5 py-3 text-right tabular-nums">{fmtHours(monthly.totalHours)}</td>
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
