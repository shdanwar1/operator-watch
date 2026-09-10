/**
 * Retention rules for `calendar_classes` (Operation 9).
 *
 * `calendar_classes` is the live operational schedule, not the historical
 * archive — completed Records (`shifts.classes`) hold the history. A past class
 * row may therefore be dropped, but only once it is provably no longer needed.
 *
 * Nothing is deleted on date alone: every uncertain case is retained.
 */

export type RetentionDecision = "keep" | "delete";

export type RetentionReason =
  /** Today or later — the live schedule. */
  | "future-or-today"
  /** Inside the safety window right after a class (display/checkout tail). */
  | "grace-window"
  /** Attached to a shift that has not been completed yet. */
  | "shift-incomplete"
  /** Attached shift or Record could not be resolved — never guess. */
  | "unresolved"
  /** Record exists but its class snapshot is empty: this row is the only copy. */
  | "record-snapshot-empty"
  /** Past, finished and already captured in a Record snapshot. */
  | "obsolete";

/** Days after the class date during which a row is always kept. */
export const RETENTION_GRACE_DAYS = 2;

export type ClassRetentionRow = {
  id: string;
  /** "YYYY-MM-DD" (Berlin wall-clock date of the class). */
  specificDate: string;
  scheduledShiftId: string | null;
};

/** The attendance Record belonging to a scheduled shift, when one exists. */
export type ShiftRecordFacts = {
  checkedOut: boolean;
  /** Number of entries in the `shifts.classes` snapshot. */
  snapshotCount: number;
};

export type RetentionContext = {
  /** Today's Berlin date key, "YYYY-MM-DD". */
  today: string;
  /** Scheduled shift ids that exist (any shift not in here is unresolved). */
  knownShiftIds: Set<string>;
  /** Record facts keyed by scheduled shift id. */
  recordsByShiftId: Map<string, ShiftRecordFacts>;
};

export type RetentionVerdict = {
  row: ClassRetentionRow;
  decision: RetentionDecision;
  reason: RetentionReason;
};

/** Adds `days` to a "YYYY-MM-DD" key without touching local time zones. */
export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** The oldest date that is still unconditionally retained. */
export function retentionCutoff(today: string): string {
  return shiftDateKey(today, -RETENTION_GRACE_DAYS);
}

export function classifyClassRow(
  row: ClassRetentionRow,
  ctx: RetentionContext,
): RetentionVerdict {
  const verdict = (decision: RetentionDecision, reason: RetentionReason) => ({
    row,
    decision,
    reason,
  });

  if (row.specificDate >= ctx.today) return verdict("keep", "future-or-today");
  if (row.specificDate >= retentionCutoff(ctx.today)) return verdict("keep", "grace-window");

  // Detached rows have no shift, no Record and no UI pointing at them.
  if (!row.scheduledShiftId) return verdict("delete", "obsolete");

  if (!ctx.knownShiftIds.has(row.scheduledShiftId)) return verdict("keep", "unresolved");

  const record = ctx.recordsByShiftId.get(row.scheduledShiftId);
  if (!record) return verdict("keep", "shift-incomplete");
  if (!record.checkedOut) return verdict("keep", "shift-incomplete");
  if (record.snapshotCount === 0) return verdict("keep", "record-snapshot-empty");

  return verdict("delete", "obsolete");
}

export type RetentionReport = {
  total: number;
  deletableIds: string[];
  keptByReason: Record<RetentionReason, number>;
};

export function classifyClassRows(
  rows: ClassRetentionRow[],
  ctx: RetentionContext,
): RetentionReport {
  const keptByReason: Record<RetentionReason, number> = {
    "future-or-today": 0,
    "grace-window": 0,
    "shift-incomplete": 0,
    unresolved: 0,
    "record-snapshot-empty": 0,
    obsolete: 0,
  };
  const deletableIds: string[] = [];
  for (const row of rows) {
    const v = classifyClassRow(row, ctx);
    if (v.decision === "delete") deletableIds.push(row.id);
    else keptByReason[v.reason] += 1;
  }
  return { total: rows.length, deletableIds, keptByReason };
}
