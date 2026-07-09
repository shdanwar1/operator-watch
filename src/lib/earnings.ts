// Payroll calculations for the Dance Masterclass operator contract.
//
// Contract summary:
//  - Fixed 20h/week ≈ 86.67 contracted hours per month.
//  - Guaranteed monthly gross: €1,733.33 (paid regardless of distribution).
//  - Overtime: hours beyond 86.67 in the month, €20/h.
//  - Night window: 00:00–06:00 any day, €20/h bonus (stacks with overtime).
//  - Sunday daytime: 06:00–24:00 Sunday, €10/h bonus (stacks with overtime).
//  - Sunday 00:00–06:00 is counted as night only (no Sunday bonus stacked).

import type { ShiftRow } from "@/lib/shifts.functions";

export const CONTRACT_MONTHLY_HOURS = 86.67;
export const FIXED_MONTHLY_GROSS = 1733.33;
export const OVERTIME_RATE = 20;
export const NIGHT_BONUS_RATE = 20;
export const SUNDAY_BONUS_RATE = 10;

export type ShiftBreakdown = {
  id: string;
  operator_name: string;
  check_in_at: string;
  check_out_at: string;
  totalHours: number;
  dayHours: number;
  nightHours: number;
  sundayDayHours: number;
  overtimeHours: number;
  contributesToOvertime: boolean;
  grossExtras: number; // overtime + night + sunday bonuses for this shift
};

export type MonthlyEarnings = {
  monthKey: string; // YYYY-MM
  totalHours: number;
  contractedHours: number; // capped at CONTRACT_MONTHLY_HOURS
  overtimeHours: number;
  nightHours: number;
  sundayHours: number;
  fixedSalary: number;
  overtimePay: number;
  nightBonus: number;
  sundayBonus: number;
  grossSalary: number;
  netSalary: number;
  shifts: ShiftBreakdown[];
};

function isNightMinute(d: Date): boolean {
  return d.getHours() < 6;
}
function isSundayDayMinute(d: Date): boolean {
  return d.getDay() === 0 && d.getHours() >= 6;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Walk a shift minute by minute and classify each minute. Cheap enough
// (a 6h shift = 360 iterations) and avoids DST/edge headaches.
function classifyShift(startISO: string, endISO: string) {
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  const totalMin = Math.max(0, Math.floor((end - start) / 60000));
  const minutes: { at: Date; night: boolean; sundayDay: boolean }[] = [];
  for (let i = 0; i < totalMin; i++) {
    const d = new Date(start + i * 60000 + 30000); // midpoint of the minute
    minutes.push({ at: d, night: isNightMinute(d), sundayDay: isSundayDayMinute(d) });
  }
  return { totalMin, minutes };
}

// Build monthly payroll from completed shifts (any month) for a given month.
export function computeMonthly(shifts: ShiftRow[], month: Date): MonthlyEarnings {
  const key = monthKey(month);
  const inMonth = shifts
    .filter((s) => s.check_out_at)
    .filter((s) => monthKey(new Date(s.check_in_at)) === key)
    .sort((a, b) => new Date(a.check_in_at).getTime() - new Date(b.check_in_at).getTime());

  const contractedMinutes = Math.round(CONTRACT_MONTHLY_HOURS * 60);

  let cumulativeMin = 0;
  let totalMin = 0;
  let overtimeMin = 0;
  let nightMin = 0;
  let sundayDayMin = 0;
  const breakdowns: ShiftBreakdown[] = [];

  for (const s of inMonth) {
    const { totalMin: shiftMin, minutes } = classifyShift(s.check_in_at, s.check_out_at!);
    let shiftDay = 0;
    let shiftNight = 0;
    let shiftSundayDay = 0;
    let shiftOvertime = 0;
    let shiftExtras = 0;

    for (const m of minutes) {
      cumulativeMin++;
      const isOvertime = cumulativeMin > contractedMinutes;
      if (isOvertime) {
        overtimeMin++;
        shiftOvertime++;
        shiftExtras += OVERTIME_RATE / 60;
      }
      if (m.night) {
        nightMin++;
        shiftNight++;
        shiftExtras += NIGHT_BONUS_RATE / 60;
      } else if (m.sundayDay) {
        sundayDayMin++;
        shiftSundayDay++;
        shiftExtras += SUNDAY_BONUS_RATE / 60;
      } else {
        shiftDay++;
      }
    }

    totalMin += shiftMin;
    breakdowns.push({
      id: s.id,
      operator_name: s.operator_name,
      check_in_at: s.check_in_at,
      check_out_at: s.check_out_at!,
      totalHours: shiftMin / 60,
      dayHours: shiftDay / 60,
      nightHours: shiftNight / 60,
      sundayDayHours: shiftSundayDay / 60,
      overtimeHours: shiftOvertime / 60,
      contributesToOvertime: shiftOvertime > 0,
      grossExtras: round2(shiftExtras),
    });
  }

  const overtimeHours = overtimeMin / 60;
  const nightHours = nightMin / 60;
  const sundayHours = sundayDayMin / 60;

  const overtimePay = overtimeHours * OVERTIME_RATE;
  const nightBonus = nightHours * NIGHT_BONUS_RATE;
  const sundayBonus = sundayHours * SUNDAY_BONUS_RATE;
  const grossSalary = FIXED_MONTHLY_GROSS + overtimePay + nightBonus + sundayBonus;

  return {
    monthKey: key,
    totalHours: totalMin / 60,
    contractedHours: Math.min(totalMin / 60, CONTRACT_MONTHLY_HOURS),
    overtimeHours,
    nightHours,
    sundayHours,
    fixedSalary: FIXED_MONTHLY_GROSS,
    overtimePay: round2(overtimePay),
    nightBonus: round2(nightBonus),
    sundayBonus: round2(sundayBonus),
    grossSalary: round2(grossSalary),
    netSalary: round2(estimateNetSalary(grossSalary)),
    shifts: breakdowns,
  };
}

// German 2024 Einkommensteuertarif (§32a EStG) — annual income tax for a
// single tax class I payer.
function annualIncomeTax(y: number): number {
  if (y <= 11604) return 0;
  if (y <= 17005) {
    const y1 = (y - 11604) / 10000;
    return (922.98 * y1 + 1400) * y1;
  }
  if (y <= 66760) {
    const y1 = (y - 17005) / 10000;
    return (181.19 * y1 + 2397) * y1 + 1025.38;
  }
  if (y <= 277825) return 0.42 * y - 10602.13;
  return 0.45 * y - 18936.88;
}

// Rough monthly net for tax class I, single, no church tax, statutory
// health insurance. Uses standard ~20.925% employee social contributions
// and the annual income-tax tariff divided by 12.
export function estimateNetSalary(monthlyGross: number): number {
  const social = monthlyGross * 0.20925;
  const taxableAnnual = Math.max(0, (monthlyGross - social) * 12);
  const monthlyTax = annualIncomeTax(taxableAnnual) / 12;
  const solidarity = monthlyTax > 1512 ? monthlyTax * 0.055 : 0;
  return Math.max(0, monthlyGross - social - monthlyTax - solidarity);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatEUR(n: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatHours(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}h ${String(mm).padStart(2, "0")}m`;
}

// History window: last N months (including current), oldest first.
export function computeHistory(shifts: ShiftRow[], months: number): MonthlyEarnings[] {
  const now = new Date();
  const out: MonthlyEarnings[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(computeMonthly(shifts, d));
  }
  return out;
}
