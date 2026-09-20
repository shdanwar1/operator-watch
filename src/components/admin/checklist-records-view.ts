import type { ChecklistRecord } from "@/lib/checklist-records";

export type RecordState = "complete" | "in-progress" | "not-started";

const allRecordItems = (record: ChecklistRecord) => {
  const snapshot = record.checklists;
  if (!snapshot) return [];
  return [
    ...snapshot.start.items,
    ...snapshot.classes.flatMap((classChecklist) => classChecklist.items),
    ...snapshot.end.items,
  ];
};

export function recordState(record: ChecklistRecord): RecordState {
  const items = allRecordItems(record);
  if (!items.some((item) => item.completed)) return "not-started";
  return items.length > 0 && items.every((item) => item.completed) ? "complete" : "in-progress";
}

export function visibleChecklistRecords(records: ChecklistRecord[]) {
  return records
    .filter((record) => recordState(record) !== "not-started")
    .sort((a, b) => Date.parse(b.check_in_at) - Date.parse(a.check_in_at));
}
