import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, Download, Printer, Wallet, Moon, Sun, Clock, TrendingUp } from "lucide-react";
import { getGateStatus } from "@/lib/gate.functions";
import { listShifts } from "@/lib/shifts.functions";
import {
  CONTRACT_MONTHLY_HOURS,
  FIXED_MONTHLY_GROSS,
  NIGHT_BONUS_RATE,
  OVERTIME_RATE,
  SUNDAY_BONUS_RATE,
  computeHistory,
  computeMonthly,
  estimateNetSalary,
  formatEUR,
  formatHours,
  type MonthlyEarnings,
} from "@/lib/earnings";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/earnings")({
  head: () => ({
    meta: [
      { title: "Estimated Earnings · Studio Operator" },
      {
        name: "description",
        content:
          "Personal payroll dashboard: gross salary, overtime, night and Sunday bonuses, estimated net for the Dance Masterclass operator contract.",
      },
    ],
  }),
  beforeLoad: async () => {
    const { unlocked } = await getGateStatus();
    if (!unlocked) throw redirect({ to: "/unlock" });
  },
  component: EarningsPage,
});

function EarningsPage() {
  const fetchShifts = useServerFn(listShifts);
  const [shifts, setShifts] = useState<Awaited<ReturnType<typeof listShifts>>>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0); // 0 = current month

  useEffect(() => {
    (async () => {
      try {
        setShifts(await fetchShifts());
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchShifts]);

  const selectedMonth = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + offset, 1);
  }, [offset]);

  const monthly = useMemo(() => computeMonthly(shifts, selectedMonth), [shifts, selectedMonth]);
  const history = useMemo(() => computeHistory(shifts, 6), [shifts]);

  // Previous month's extras get paid THIS month.
  const previousMonth = useMemo(() => {
    const d = new Date(selectedMonth);
    d.setMonth(d.getMonth() - 1);
    return computeMonthly(shifts, d);
  }, [shifts, selectedMonth]);

  const progressPct = Math.min(100, (monthly.totalHours / CONTRACT_MONTHLY_HOURS) * 100);
  const overtimeActive = monthly.totalHours > CONTRACT_MONTHLY_HOURS;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-10 print:py-2">
        <header className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/"><ArrowLeft className="mr-1 h-4 w-4" /> Back</Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight sm:text-2xl">Estimated Earnings</h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              Dance Masterclass · 20h/week contract · €{FIXED_MONTHLY_GROSS.toFixed(2)} base
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setOffset((o) => o - 1)}>‹</Button>
            <div className="min-w-[8rem] text-center text-sm font-medium tabular-nums">
              {selectedMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset((o) => Math.min(0, o + 1))}
              disabled={offset >= 0}
            >›</Button>
          </div>
        </header>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-8">
            {/* Progress toward contract */}
            <Card>
              <CardContent className="space-y-3 p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Monthly contract progress
                    </div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums">
                      {monthly.totalHours.toFixed(2)}{" "}
                      <span className="text-base font-normal text-muted-foreground">
                        / {CONTRACT_MONTHLY_HOURS} hrs
                      </span>
                    </div>
                  </div>
                  {overtimeActive && (
                    <Badge variant="destructive" className="animate-pulse">Overtime Active</Badge>
                  )}
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      overtimeActive
                        ? "bg-destructive"
                        : progressPct >= 90
                          ? "bg-amber-500"
                          : "bg-primary"
                    }`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Dashboard cards */}
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard label="Worked Hours" value={`${monthly.totalHours.toFixed(2)}`} sub={`/ ${CONTRACT_MONTHLY_HOURS} hrs`} icon={Clock} />
              <StatCard label="Overtime" value={`${monthly.overtimeHours.toFixed(2)} h`} icon={TrendingUp} />
              <StatCard label="Night Hours" value={`${monthly.nightHours.toFixed(2)} h`} icon={Moon} />
              <StatCard label="Sunday Hours" value={`${monthly.sundayHours.toFixed(2)} h`} icon={Sun} />
              <StatCard label="Gross Salary" value={formatEUR(monthly.grossSalary)} icon={Wallet} accent />
              <StatCard label="Estimated Net" value={`≈ ${formatEUR(monthly.netSalary)}`} icon={Wallet} accent />
            </section>

            {/* Payment timeline */}
            <section className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardContent className="space-y-2 p-5">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    This month's bank payment
                  </div>
                  <div className="text-3xl font-semibold tabular-nums">
                    {formatEUR(FIXED_MONTHLY_GROSS + previousMonth.overtimePay + previousMonth.nightBonus + previousMonth.sundayBonus)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Base salary {formatEUR(FIXED_MONTHLY_GROSS)}
                    {(previousMonth.overtimePay + previousMonth.nightBonus + previousMonth.sundayBonus) > 0 && (
                      <> + last month's extras {formatEUR(previousMonth.overtimePay + previousMonth.nightBonus + previousMonth.sundayBonus)}</>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="space-y-2 p-5">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Next month's extras (from {selectedMonth.toLocaleDateString(undefined, { month: "long" })})
                  </div>
                  <div className="text-3xl font-semibold tabular-nums">
                    {formatEUR(monthly.overtimePay + monthly.nightBonus + monthly.sundayBonus)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Overtime {formatEUR(monthly.overtimePay)} · Night {formatEUR(monthly.nightBonus)} · Sunday {formatEUR(monthly.sundayBonus)}
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* Breakdown table */}
            <Card>
              <CardContent className="p-0">
                <div className="border-b p-5">
                  <h2 className="text-sm font-semibold">Salary breakdown</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-5 py-3 text-left">Category</th>
                        <th className="px-5 py-3 text-right">Hours</th>
                        <th className="px-5 py-3 text-right">Rate</th>
                        <th className="px-5 py-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      <tr>
                        <td className="px-5 py-3">Base salary (contract)</td>
                        <td className="px-5 py-3 text-right tabular-nums">{monthly.contractedHours.toFixed(2)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">fixed</td>
                        <td className="px-5 py-3 text-right tabular-nums">{formatEUR(FIXED_MONTHLY_GROSS)}</td>
                      </tr>
                      <tr>
                        <td className="px-5 py-3">Overtime</td>
                        <td className="px-5 py-3 text-right tabular-nums">{monthly.overtimeHours.toFixed(2)}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{formatEUR(OVERTIME_RATE)}/h</td>
                        <td className="px-5 py-3 text-right tabular-nums">{formatEUR(monthly.overtimePay)}</td>
                      </tr>
                      <tr>
                        <td className="px-5 py-3">Night bonus (00:00–06:00)</td>
                        <td className="px-5 py-3 text-right tabular-nums">{monthly.nightHours.toFixed(2)}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{formatEUR(NIGHT_BONUS_RATE)}/h</td>
                        <td className="px-5 py-3 text-right tabular-nums">{formatEUR(monthly.nightBonus)}</td>
                      </tr>
                      <tr>
                        <td className="px-5 py-3">Sunday bonus (06:00–24:00)</td>
                        <td className="px-5 py-3 text-right tabular-nums">{monthly.sundayHours.toFixed(2)}</td>
                        <td className="px-5 py-3 text-right tabular-nums">{formatEUR(SUNDAY_BONUS_RATE)}/h</td>
                        <td className="px-5 py-3 text-right tabular-nums">{formatEUR(monthly.sundayBonus)}</td>
                      </tr>
                      <tr className="bg-muted/30 font-semibold">
                        <td className="px-5 py-3">Total gross</td>
                        <td className="px-5 py-3 text-right tabular-nums">{monthly.totalHours.toFixed(2)}</td>
                        <td className="px-5 py-3" />
                        <td className="px-5 py-3 text-right tabular-nums">{formatEUR(monthly.grossSalary)}</td>
                      </tr>
                      <tr className="bg-muted/20">
                        <td className="px-5 py-3">Estimated net (tax class I, single, no church)</td>
                        <td className="px-5 py-3" />
                        <td className="px-5 py-3" />
                        <td className="px-5 py-3 text-right tabular-nums">≈ {formatEUR(monthly.netSalary)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Shift-level analysis */}
            <Card>
              <CardContent className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b p-5">
                  <h2 className="text-sm font-semibold">Shift analysis</h2>
                  <div className="flex gap-2 print:hidden">
                    <Button variant="outline" size="sm" onClick={() => exportCSV(monthly)}>
                      <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => window.print()}>
                      <Printer className="mr-1.5 h-3.5 w-3.5" /> Print / PDF
                    </Button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-5 py-3 text-left">Date</th>
                        <th className="px-5 py-3 text-right">Total</th>
                        <th className="px-5 py-3 text-right">Day</th>
                        <th className="px-5 py-3 text-right">Night</th>
                        <th className="px-5 py-3 text-right">Sunday</th>
                        <th className="px-5 py-3 text-right">OT</th>
                        <th className="px-5 py-3 text-right">Extras</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {monthly.shifts.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-5 py-6 text-center text-sm text-muted-foreground">
                            No completed shifts this month yet.
                          </td>
                        </tr>
                      ) : (
                        monthly.shifts.map((s) => (
                          <tr key={s.id}>
                            <td className="px-5 py-3">
                              {new Date(s.check_in_at).toLocaleDateString(undefined, {
                                weekday: "short",
                                day: "numeric",
                                month: "short",
                              })}
                              <span className="ml-2 text-xs text-muted-foreground">
                                {new Date(s.check_in_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                                {" – "}
                                {new Date(s.check_out_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums">{s.totalHours.toFixed(2)}</td>
                            <td className="px-5 py-3 text-right tabular-nums">{s.dayHours.toFixed(2)}</td>
                            <td className="px-5 py-3 text-right tabular-nums">{s.nightHours.toFixed(2)}</td>
                            <td className="px-5 py-3 text-right tabular-nums">{s.sundayDayHours.toFixed(2)}</td>
                            <td className="px-5 py-3 text-right tabular-nums">
                              {s.overtimeHours > 0 ? (
                                <span className="font-medium text-destructive">{s.overtimeHours.toFixed(2)}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums">{formatEUR(s.grossExtras)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Analytics */}
            <section className="grid gap-4 lg:grid-cols-2 print:hidden">
              <ChartCard title="Monthly gross vs. net (6 months)">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={history.map((h) => ({ name: h.monthKey.slice(5), gross: h.grossSalary, net: h.netSalary }))}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="name" fontSize={12} />
                    <YAxis fontSize={12} tickFormatter={(v) => `€${v}`} />
                    <Tooltip formatter={(v: number) => formatEUR(v)} />
                    <Line type="monotone" dataKey="gross" stroke="hsl(var(--primary))" strokeWidth={2} />
                    <Line type="monotone" dataKey="net" stroke="hsl(var(--muted-foreground))" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Hours by type (6 months)">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={history.map((h) => ({
                    name: h.monthKey.slice(5),
                    day: h.totalHours - h.nightHours - h.sundayHours,
                    night: h.nightHours,
                    sunday: h.sundayHours,
                    overtime: h.overtimeHours,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="name" fontSize={12} />
                    <YAxis fontSize={12} />
                    <Tooltip formatter={(v: number) => `${v.toFixed(1)} h`} />
                    <Bar dataKey="day" stackId="a" fill="hsl(var(--primary))" />
                    <Bar dataKey="night" stackId="a" fill="#6366f1" />
                    <Bar dataKey="sunday" stackId="a" fill="#f59e0b" />
                    <Bar dataKey="overtime" stackId="b" fill="hsl(var(--destructive))" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Effective hourly rate">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={history.map((h) => ({
                    name: h.monthKey.slice(5),
                    rate: h.totalHours > 0 ? h.grossSalary / h.totalHours : 0,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="name" fontSize={12} />
                    <YAxis fontSize={12} tickFormatter={(v) => `€${v.toFixed(0)}`} />
                    <Tooltip formatter={(v: number) => `${formatEUR(v)}/h`} />
                    <Line type="monotone" dataKey="rate" stroke="hsl(var(--primary))" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Earnings by shift (this month)">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={monthly.shifts.map((s, i) => ({
                    name: `#${i + 1}`,
                    extras: s.grossExtras,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="name" fontSize={12} />
                    <YAxis fontSize={12} tickFormatter={(v) => `€${v}`} />
                    <Tooltip formatter={(v: number) => formatEUR(v)} />
                    <Bar dataKey="extras" fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </section>

            <p className="text-xs text-muted-foreground">
              Net salary is an estimate using the 2024 German income-tax tariff (§32a EStG), assuming
              tax class I, single, statutory health insurance, no church tax. Your actual payslip may differ.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label, value, sub, icon: Icon, accent,
}: {
  label: string; value: string; sub?: string; icon: React.ComponentType<{ className?: string }>; accent?: boolean;
}) {
  return (
    <Card className={accent ? "border-primary/40 bg-primary/5" : undefined}>
      <CardContent className="space-y-1 p-4">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3 w-3" />
          {label}
        </div>
        <div className="text-lg font-semibold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {children}
      </CardContent>
    </Card>
  );
}

function exportCSV(m: MonthlyEarnings) {
  const rows: (string | number)[][] = [
    ["Studio Operator Payroll", m.monthKey],
    [],
    ["Date", "Check-in", "Check-out", "Total h", "Day h", "Night h", "Sunday h", "Overtime h", "Extras (€)"],
    ...m.shifts.map((s) => [
      new Date(s.check_in_at).toISOString().slice(0, 10),
      new Date(s.check_in_at).toISOString().slice(11, 16),
      new Date(s.check_out_at).toISOString().slice(11, 16),
      s.totalHours.toFixed(2),
      s.dayHours.toFixed(2),
      s.nightHours.toFixed(2),
      s.sundayDayHours.toFixed(2),
      s.overtimeHours.toFixed(2),
      s.grossExtras.toFixed(2),
    ]),
    [],
    ["Category", "Hours", "Amount (€)"],
    ["Base salary", m.contractedHours.toFixed(2), m.fixedSalary.toFixed(2)],
    ["Overtime", m.overtimeHours.toFixed(2), m.overtimePay.toFixed(2)],
    ["Night bonus", m.nightHours.toFixed(2), m.nightBonus.toFixed(2)],
    ["Sunday bonus", m.sundayHours.toFixed(2), m.sundayBonus.toFixed(2)],
    ["Gross total", m.totalHours.toFixed(2), m.grossSalary.toFixed(2)],
    ["Estimated net", "", m.netSalary.toFixed(2)],
  ];
  const csv = rows
    .map((r) => r.map((cell) => {
      const s = String(cell);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payroll-${m.monthKey}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Re-export unused helpers so tree-shaking doesn't drop warnings.
void formatHours;
void estimateNetSalary;
