import type { ScheduledShiftRow } from "@/lib/shifts.functions";

/** Shared date/time + colour helpers for the Admin application. */

export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  x.setDate(x.getDate() - ((day + 6) % 7));
  return x;
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  return x;
}
export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
export function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
export function fmtDayShort(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
export function fmtRange(start: Date, end: Date) {
  const sameMonth = start.getMonth() === end.getMonth();
  const s = start.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const e = end.toLocaleDateString(undefined, {
    day: "numeric",
    month: sameMonth ? undefined : "short",
    year: end.getFullYear() !== start.getFullYear() ? "numeric" : undefined,
  });
  return `${s} – ${e}`;
}
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
export function minutesBetween(start: string, end: string): number {
  const a = timeToMinutes(start);
  const b = timeToMinutes(end);
  // Overnight shifts wrap past midnight.
  return b >= a ? b - a : 24 * 60 - a + b;
}
export function fmtHours(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
export function fmtTime12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export const OP_COLORS = [
  { name: "blue", bg: "bg-blue-500/10", border: "border-blue-500/40", text: "text-blue-600 dark:text-blue-400", dot: "bg-blue-500" },
  { name: "green", bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
  { name: "orange", bg: "bg-orange-500/10", border: "border-orange-500/40", text: "text-orange-600 dark:text-orange-400", dot: "bg-orange-500" },
  { name: "purple", bg: "bg-purple-500/10", border: "border-purple-500/40", text: "text-purple-600 dark:text-purple-400", dot: "bg-purple-500" },
  { name: "pink", bg: "bg-pink-500/10", border: "border-pink-500/40", text: "text-pink-600 dark:text-pink-400", dot: "bg-pink-500" },
  { name: "cyan", bg: "bg-cyan-500/10", border: "border-cyan-500/40", text: "text-cyan-600 dark:text-cyan-400", dot: "bg-cyan-500" },
  { name: "amber", bg: "bg-amber-500/10", border: "border-amber-500/40", text: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
  { name: "rose", bg: "bg-rose-500/10", border: "border-rose-500/40", text: "text-rose-600 dark:text-rose-400", dot: "bg-rose-500" },
];

export function opColor(name: string | null) {
  if (!name) return null;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return OP_COLORS[hash % OP_COLORS.length];
}

export type EffectiveStatus = "assigned" | "unassigned" | "completed" | "cancelled";
export type Assignment = ScheduledShiftRow & { effective_status: EffectiveStatus };

export function normalizeStatus(row: ScheduledShiftRow): EffectiveStatus {
  const s = (row.status ?? "").toLowerCase();
  if (s === "completed" || s === "cancelled" || s === "unassigned") return s;
  if (!row.assigned_operator) return "unassigned";
  return "assigned";
}

export function toAssignment(row: ScheduledShiftRow): Assignment {
  return { ...row, effective_status: normalizeStatus(row) };
}
