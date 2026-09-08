/**
 * Shift identity (Operation 4).
 *
 * The single place that mints and interprets `scheduled_shifts.external_event_id`.
 * The formats are exactly the ones already in production and are NOT changed
 * here — a timetable-backed deterministic identity is a later operation.
 *
 *   Google-derived : op:<operator lowercased>:shift:<YYYY-MM-DD>:<HHMM>
 *   App-created    : manual:<operator|unassigned>:shift:<YYYY-MM-DD>:<HHMM>:<rand>
 */

export const GOOGLE_IDENTITY_PREFIX = "op:";
export const MANUAL_IDENTITY_PREFIX = "manual:";

/** Operator key used inside identity strings. */
export function operatorKey(name: string | null | undefined): string {
  return (name ?? "unassigned").trim().toLowerCase() || "unassigned";
}

/** Google-derived shift identity, from a start expressed in minutes of day. */
export function googleShiftIdentity(opKey: string, date: string, startMin: number): string {
  const hh = String(Math.floor(startMin / 60)).padStart(2, "0");
  const mm = String(startMin % 60).padStart(2, "0");
  return `${GOOGLE_IDENTITY_PREFIX}${opKey}:shift:${date}:${hh}${mm}`;
}

/** Prefix matching every Google-derived shift of one operator. */
export function googleShiftPrefix(opKey: string): string {
  return `${GOOGLE_IDENTITY_PREFIX}${opKey}:shift:`;
}

/** Identity for a shift created inside the app; never touched by calendar sync. */
export function manualShiftIdentity(
  date: string,
  startTime: string,
  operator: string | null,
): string {
  const op = operatorKey(operator);
  const hhmm = startTime.slice(0, 5).replace(":", "");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${MANUAL_IDENTITY_PREFIX}${op}:shift:${date}:${hhmm}:${rand}`;
}

export function isGoogleIdentity(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(GOOGLE_IDENTITY_PREFIX);
}

export function isManualIdentity(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(MANUAL_IDENTITY_PREFIX);
}

/** Identity for a manually added class row (not a shift). */
export function manualClassUid(): string {
  return `${MANUAL_IDENTITY_PREFIX}${crypto.randomUUID()}`;
}
