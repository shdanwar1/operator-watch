import { berlinDateKey } from "./gcal-core";
import { berlinClock } from "./push-time";
import type { ShiftChecklists, ChecklistSnapshotItem } from "@/domain/checklists";

export type ChecklistRecord = {
  id: string;
  operator_name: string;
  check_in_at: string;
  check_out_at: string | null;
  checklists: ShiftChecklists | null;
};

export function assertChecklistAdmin(session: { siteUnlocked?: boolean; username?: string; isAdmin?: boolean }) {
  if (!session.siteUnlocked || !session.username || !session.isAdmin) {
    throw new Response("Admin access required", { status: 403 });
  }
}

/** Each midnight is resolved independently, including 23/25-hour DST days. */
export function checklistDateBounds(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date");
  const anchor = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(anchor.getTime()) || anchor.toISOString().slice(0, 10) !== date) throw new Error("Invalid date");
  const midnight = (day: string) => {
    const utc = Date.parse(`${day}T00:00:00Z`);
    const clock = berlinClock(new Date(utc)).split(":").map(Number);
    return new Date(utc - (clock[0] * 60 + clock[1]) * 60000).toISOString();
  };
  anchor.setUTCDate(anchor.getUTCDate() + 1);
  return { from: midnight(date), to: midnight(anchor.toISOString().slice(0, 10)) };
}
export function recordDate(iso: string) {
  return berlinDateKey(new Date(iso));
}
export function completionLabel(item: ChecklistSnapshotItem) {
  if (!item.completed) return "Not completed";
  return item.completedAt && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.completedAt)
    ? item.completedAt : "Time not recorded";
}
export function filterChecklistRecords(records: ChecklistRecord[], operator: string) {
  return operator === "all" ? records : records.filter((record) => record.operator_name === operator);
}
