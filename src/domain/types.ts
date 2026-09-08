/**
 * Core domain types (Operation 4).
 *
 * Pure types only — no runtime dependencies, no database, no provider
 * specifics. Everything here describes what the application *means*, so that
 * external systems (Google Calendar today, the DMC timetable later) can supply
 * data without owning the business rules.
 */

/* ───────────────────────── Operator identity ───────────────────────── */

export type OperatorId = string;

export type OperatorIdentity = {
  id: OperatorId;
  /** Canonical stored spelling. Comparisons are always case-insensitive. */
  username: string;
  isAdmin: boolean;
  isActive: boolean;
};

/* ───────────────────── External calendar observation ───────────────────── */

/**
 * A normalized observation from an *external* calendar.
 *
 * This is deliberately NOT a shift and NOT a Dance Masterclass class: it is
 * only evidence that a block of time is committed. Domain logic decides what
 * (if anything) it means. `raw` carries the provider's own record for code
 * that still needs provider detail during the migration.
 */
export type CalendarCommitmentSource = "google-ics";

export type CalendarCommitment<TRaw = unknown> = {
  source: CalendarCommitmentSource;
  /** Provider event id (ICS UID, recurrence instance included). */
  externalEventId: string;
  /** Berlin wall-clock date, YYYY-MM-DD. */
  date: string;
  /** HH:MM:SS Berlin wall clock. */
  startTime: string;
  endTime: string;
  allDay: boolean;
  status: "confirmed" | "cancelled";
  /** Empty for Free/Busy calendars. */
  title: string;
  raw: TRaw;
};

/* ───────────────────────────── Classes ───────────────────────────── */

/** A class as the application knows it, independent of any calendar event. */
export type ClassDefinition = {
  classId: string | null;
  className: string;
  teacherId: string | null;
  teacherName: string;
};

/** A dated occurrence of a class definition. */
export type ClassInstance = ClassDefinition & {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  shiftId: string | null;
};

/** The narrow contract the teacher-facing Studio Display consumes. */
export type DisplayClass = {
  className: string;
  teacherName: string;
  date: string;
  startTime: string;
  endTime: string;
};

/* ───────────────────────────── Assignment ───────────────────────────── */

/**
 * Which operator owns a shift.
 *
 * Storage today is a plain `assigned_operator` text column; the mapping helpers
 * below are the only place that knows that, so business logic can talk about
 * assignment instead of passing raw names around. The column format is
 * unchanged.
 */
export type OperatorAssignment = {
  operatorName: string | null;
};

export const UNASSIGNED: OperatorAssignment = { operatorName: null };

export function assignmentFrom(row: { assigned_operator?: string | null }): OperatorAssignment {
  const name = row.assigned_operator ?? null;
  return { operatorName: name && name.trim() !== "" ? name : null };
}

export function assignmentToColumn(assignment: OperatorAssignment): string | null {
  const name = assignment.operatorName;
  return name && name.trim() !== "" ? name : null;
}

export function isAssigned(assignment: OperatorAssignment): boolean {
  return assignment.operatorName !== null;
}

/* ─────────────────────────────── Shift ─────────────────────────────── */

export type ShiftStatus = "assigned" | "unassigned" | "completed" | "cancelled";

/**
 * Application-level view of a scheduled shift. Maps 1:1 onto the current
 * `scheduled_shifts` row — no schema change, just a name for the concept.
 */
export type DomainShift = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  label: string | null;
  notes: string | null;
  assignment: OperatorAssignment;
  /** Stable external identity string (see domain/shift-identity). */
  identity: string | null;
};

export type ScheduledShiftRecord = {
  id: string;
  specific_date: string;
  start_time: string;
  end_time: string;
  status: string;
  label: string | null;
  notes: string | null;
  assigned_operator: string | null;
  external_event_id: string | null;
};

export function toDomainShift(row: ScheduledShiftRecord): DomainShift {
  return {
    id: row.id,
    date: row.specific_date,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    label: row.label ?? null,
    notes: row.notes ?? null,
    assignment: assignmentFrom(row),
    identity: row.external_event_id ?? null,
  };
}
