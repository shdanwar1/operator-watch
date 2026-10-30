// Shared attendance PDF export.
//
// Used by the operator payroll page and the admin Shifts page so both
// produce exactly the same report from the same attendance calculations.
// A shift that crosses midnight stays a single row; the day/night/weekend
// split comes from `summarizeMonth` in @/lib/attendance.

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  CATEGORY_COLOR,
  buildAttendanceRows,
  formatHM,
  type AttendanceSummary,
} from "@/lib/attendance";
import type { ShiftRow, ScheduledShiftRow } from "@/lib/shifts.functions";


function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Rounds total accumulated worked minutes to the nearest 0.5 hour,
 * returned as decimal hours with one decimal place.
 *
 * Per-hour rules (applied once to the aggregated total, never per shift):
 *   0–14 minutes  → round down to the whole hour
 *   15–44 minutes → round to the half hour
 *   45–59 minutes → round up to the next whole hour
 */
export function roundedPayrollHours(totalWorkedMin: number): string {
  const roundedMin = Math.round(Math.max(0, totalWorkedMin) / 30) * 30;
  return (roundedMin / 60).toFixed(1);
}

/** Builds and downloads the monthly attendance report for one operator. */
export function downloadAttendancePdf(summary: AttendanceSummary, operatorName: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const opName = operatorName || "Operator";

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

  // Payroll Hours Summary: compact table at the top-right, beside the
  // report header. Rendered only here — never repeated at the bottom.
  const pageW = doc.internal.pageSize.getWidth();
  const summaryWidth = 300;
  const summaryX = pageW - 40 - summaryWidth;
  const categories: Array<{ label: string; min: number; color: [number, number, number] }> = [
    { label: "Day", min: summary.dayMin, color: rgb(CATEGORY_COLOR.day) },
    { label: "Night", min: summary.nightMin, color: rgb(CATEGORY_COLOR.night) },
    { label: "Weekend", min: summary.weekendMin, color: rgb(CATEGORY_COLOR.weekend) },
  ];
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Payroll Hours Summary", summaryX, 34);

  autoTable(doc, {
    startY: 42,
    margin: { left: summaryX, right: 40 },
    tableWidth: summaryWidth,
    head: [["", "Category", "Actual Hours", "Rounded"]],
    body: categories.map((c) => ["", c.label, formatHM(c.min), roundedPayrollHours(c.min)]),
    foot: [["", "Total", formatHM(summary.workedMin), roundedPayrollHours(summary.workedMin)]],
    styles: {
      font: "helvetica",
      fontSize: 9,
      cellPadding: 4,
      lineColor: [230, 230, 230],
      lineWidth: 0.5,
    },
    headStyles: { fillColor: [245, 245, 247], textColor: 30, fontStyle: "bold" },
    footStyles: { fillColor: [235, 235, 240], textColor: 20, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 18 },
      2: { cellWidth: 80, halign: "right" },
      3: { cellWidth: 60, halign: "right" },
    },
    didDrawCell: (data) => {
      if (data.section !== "body" || data.column.index !== 0) return;
      const row = categories[data.row.index];
      if (!row) return;
      const r = 4;
      const cx = data.cell.x + data.cell.width / 2;
      const cy = data.cell.y + data.cell.height / 2;
      doc.setFillColor(row.color[0], row.color[1], row.color[2]);
      doc.circle(cx, cy, r, "F");
    },
  });

  // @ts-expect-error jspdf-autotable augments doc at runtime
  const summaryBottom: number = doc.lastAutoTable?.finalY ?? 110;
  autoTable(doc, {
    startY: Math.max(120, summaryBottom + 24),
    head: [[
      "Date",
      "Scheduled",
      "Check In",
      "Check Out",
      "Worked",
      "Notes",
    ]],
    body: summary.rows.map((r) => [
      fmtDate(r.date),
      r.scheduledStart && r.scheduledEnd
        ? `${fmtTime(r.scheduledStart)}-${fmtTime(r.scheduledEnd)}`
        : "Unscheduled",
      fmtTime(r.checkIn),
      fmtTime(r.checkOut),
      formatHM(r.workedMin),
      r.notes && r.notes.trim() ? r.notes.trim() : "—",
    ]),
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      cellPadding: 5,
      lineColor: [230, 230, 230],
      lineWidth: 0.5,
      overflow: "linebreak",
    },
    headStyles: { fillColor: [245, 245, 247], textColor: 30, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [252, 252, 253] },
    columnStyles: {
      0: { cellWidth: 58 },
      1: { cellWidth: 108 },
      2: { cellWidth: 56 },
      3: { cellWidth: 56 },
      4: { cellWidth: 62, halign: "right" },
      5: { cellWidth: "auto" },
    },
  });

  doc.save(`attendance-${opName}-${summary.monthKey}.pdf`);
}

/** One month's aggregated payroll hours. */
export type MonthlyPayrollRow = {
  key: string; // YYYY-MM
  label: string;
  dayMin: number;
  nightMin: number;
  weekendMin: number;
  workedMin: number;
};

/**
 * Groups completed shifts by the month their check-in falls in (so an
 * overnight shift stays in its starting month) and sums the same day/night/
 * weekend minutes the attendance page uses.
 */
export function buildMonthlyPayroll(
  shifts: ShiftRow[],
  scheduled: ScheduledShiftRow[],
): MonthlyPayrollRow[] {
  const byMonth = new Map<string, MonthlyPayrollRow>();
  for (const r of buildAttendanceRows(shifts, scheduled)) {
    const key = `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, "0")}`;
    let m = byMonth.get(key);
    if (!m) {
      m = {
        key,
        label: r.date.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
        dayMin: 0,
        nightMin: 0,
        weekendMin: 0,
        workedMin: 0,
      };
      byMonth.set(key, m);
    }
    m.dayMin += r.dayMin;
    m.nightMin += r.nightMin;
    m.weekendMin += r.weekendMin;
    m.workedMin += r.workedMin;
  }
  return Array.from(byMonth.values()).sort((a, b) => a.key.localeCompare(b.key));
}

/** Builds and downloads an all-time monthly payroll-hours summary. */
export function downloadPayrollSummaryPdf(
  months: MonthlyPayrollRow[],
  operatorName: string,
) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const opName = operatorName || "Operator";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(`Payroll Hours — ${opName}`, 40, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text("All recorded months", 40, 70);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 84);
  doc.setTextColor(20);

  const total = months.reduce(
    (a, m) => ({
      dayMin: a.dayMin + m.dayMin,
      nightMin: a.nightMin + m.nightMin,
      weekendMin: a.weekendMin + m.weekendMin,
      workedMin: a.workedMin + m.workedMin,
    }),
    { dayMin: 0, nightMin: 0, weekendMin: 0, workedMin: 0 },
  );

  autoTable(doc, {
    startY: 110,
    head: [["Month", "Daytime", "Night", "Weekend", "Total"]],
    body: months.map((m) => [
      m.label,
      formatHM(m.dayMin),
      formatHM(m.nightMin),
      formatHM(m.weekendMin),
      formatHM(m.workedMin),
    ]),
    styles: {
      font: "helvetica",
      fontSize: 10,
      cellPadding: 7,
      lineColor: [230, 230, 230],
      lineWidth: 0.5,
    },
    headStyles: { fillColor: [245, 245, 247], textColor: 30, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [252, 252, 253] },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right", fontStyle: "bold" },
    },
  });

  // @ts-expect-error jspdf-autotable augments doc at runtime
  const y = (doc.lastAutoTable?.finalY ?? 110) + 32;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("All-Time Total", 40, y);

  const totalRows: Array<{ label: string; value: string; color: [number, number, number] }> = [
    { label: "Daytime Hours", value: formatHM(total.dayMin), color: rgb(CATEGORY_COLOR.day) },
    { label: "Night Hours", value: formatHM(total.nightMin), color: rgb(CATEGORY_COLOR.night) },
    {
      label: "Weekend Hours",
      value: formatHM(total.weekendMin),
      color: rgb(CATEGORY_COLOR.weekend),
    },
  ];

  autoTable(doc, {
    startY: y + 10,
    head: [["", "Category", "Hours"]],
    body: totalRows.map((r) => ["", r.label, r.value]),
    foot: [["", "Total Worked Hours", formatHM(total.workedMin)]],
    styles: { font: "helvetica", fontSize: 11, cellPadding: 8 },
    headStyles: { fillColor: [245, 245, 247], textColor: 30, fontStyle: "bold" },
    footStyles: { fillColor: [235, 235, 240], textColor: 20, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 22 }, 2: { halign: "right" } },
    tableWidth: 340,
    didDrawCell: (data) => {
      if (data.section !== "body" || data.column.index !== 0) return;
      const row = totalRows[data.row.index];
      if (!row) return;
      const size = 10;
      const cx = data.cell.x + (data.cell.width - size) / 2;
      const cy = data.cell.y + (data.cell.height - size) / 2;
      doc.setFillColor(row.color[0], row.color[1], row.color[2]);
      doc.rect(cx, cy, size, size, "F");
    },
  });

  doc.save(`payroll-summary-${opName}.pdf`);
}
