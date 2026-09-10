/**
 * Google Calendar synchronisation engine (server only).
 *
 * One engine, two automatically detected modes:
 *  - Busy mode      → events carry no titles; shifts are generated from the raw
 *                     busy blocks exactly as before.
 *  - Detailed mode  → events carry "Class - Teacher" titles; only classes that
 *                     exist in the Dance Masterclass directories are imported,
 *                     stored individually and grouped into shifts.
 */
import {
  detectCalendarMode,
  minToTime,
  safeRemoteUrl,
  syncWindow,
  toMin,
  berlinDateKey,
  type CalendarMode,
  type MatchLog,
  type ParsedEvent,
} from "./gcal-core";
// Validation authority (Operation 6): the stored DMC Live Timetable. Google
// titles, teacher names, aliases and fuzzy matching no longer decide anything.
import {
  buildTimetableIndex,
  instructorDisplayName,
  resolveDmcTimetableSlot,
  type TimetableIndex,
} from "@/domain/timetable-resolver";
import { groupClassesIntoShifts, type ClassEvent } from "@/domain/shift-planning";
import {
  googleShiftIdentity,
  googleShiftPrefix,
  manualClassUid,
  operatorKey,
  isManualIdentity,
} from "@/domain/shift-identity";
import { googleIcsCalendarProvider } from "@/domain/calendar-provider.server";
import * as shiftRepo from "@/domain/shift-repository.server";
import { classifyClassRows, retentionCutoff } from "@/domain/class-retention";


export type GcalSyncResult = {
  ok: boolean;
  mode: CalendarMode;
  fetched: number; // classes imported (detailed) / busy blocks (busy)
  ignored: number; // events skipped (personal / unknown class or teacher)
  shifts: number;
  removed: number;
  /** Obsolete past class rows pruned during this sync (Operation 9). */
  pruned?: number;
  error?: string;
  /** Per-event accept/reject trace (admin/debug view only). */
  logs?: MatchLog[];
  /**
   * Server-authoritative time of the latest *successful* sync for this
   * operator. On failure this is the previous successful value (or null) —
   * never a freshly generated timestamp.
   */
  syncedAt?: string | null;
};


export type CalendarClassRow = {
  id: string;
  uid: string;
  /** Display snapshot. Identity lives in the DMC references below. */
  class_name: string;
  teacher_name: string;
  specific_date: string;
  start_time: string;
  end_time: string;
  status: string;
  /** Canonical DMC directory references (Operation 8). */
  dmc_class_id: string | null;
  dmc_instructor_id: string | null;
  raw_title: string | null;
  scheduled_shift_id: string | null;
};

export async function loadOperatorCalendar(username: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("operators")
    .select("username, calendar_ics_url, calendar_last_sync_at")
    .ilike("username", username)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Response("Operator not found", { status: 404 });
  return {
    displayName: data.username as string,
    icsUrl: (data.calendar_ics_url ?? null) as string | null,
    lastSyncAt: (data.calendar_last_sync_at ?? null) as string | null,
  };
}

/**
 * Reads the stored, server-authoritative last successful sync time.
 *
 * Only a real, completed sync ever writes this column. Nothing is inferred
 * from class rows: `calendar_classes.updated_at` records when a class row was
 * last written, which is not the same event as "the calendar was synced" and
 * would report a sync that never happened (or hide a failing one behind an
 * unrelated edit). No stamp means no sync yet — the UI says exactly that.
 */
export async function readCalendarSyncStatus(
  username: string,
): Promise<{ calendarLastSyncAt: string | null }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("operators")
    .select("calendar_last_sync_at")
    .ilike("username", username)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { calendarLastSyncAt: (data?.calendar_last_sync_at ?? null) as string | null };
}


/** Stamps the operator row after a fully successful sync; returns the stored value. */
async function stampCalendarSync(username: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const at = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("operators")
    .update({ calendar_last_sync_at: at })
    .ilike("username", username)
    .select("calendar_last_sync_at")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.calendar_last_sync_at ?? at) as string | null;
}

function fail(mode: CalendarMode, error: string): GcalSyncResult {
  return { ok: false, mode, fetched: 0, ignored: 0, shifts: 0, removed: 0, error };
}

/**
 * Public entry point. Runs the import, then records the successful sync time
 * on the operator row so every device reads the same value. A failed sync
 * leaves the previous timestamp untouched.
 */
export async function runCalendarSync(
  username: string,
  opts: { includeNextMonth?: boolean } = {},
): Promise<GcalSyncResult> {
  const previous = await readCalendarSyncStatus(username).catch(() => ({
    calendarLastSyncAt: null as string | null,
  }));
  const result = await runCalendarImport(username, opts);
  if (!result.ok) return { ...result, syncedAt: previous.calendarLastSyncAt };
  // Shifts are now current: bring the notification state in line with them
  // (new / retimed / removed / restored shifts). Idempotent, so repeated
  // syncs never duplicate anything. A reconciliation hiccup must not fail
  // an otherwise successful sync.
  try {
    const { reconcileShiftNotifications } = await import("./notifications.server");
    await reconcileShiftNotifications();
  } catch (err) {
    console.error("[gcal] notification reconciliation failed", err);
  }
  const syncedAt = await stampCalendarSync(username);
  return { ...result, syncedAt };
}

async function runCalendarImport(
  username: string,
  opts: { includeNextMonth?: boolean } = {},
): Promise<GcalSyncResult> {

  const includeNextMonth = opts.includeNextMonth === true;
  const { displayName, icsUrl } = await loadOperatorCalendar(username);
  if (!icsUrl) {
    return fail(
      "busy",
      "No calendar link set. Open your profile and paste your public Google Calendar ICS link.",
    );
  }

  const nowDate = new Date();
  const window = syncWindow(nowDate, includeNextMonth);

  // Everything ICS-specific (fetch, redirect guard, parsing) lives in the
  // calendar provider adapter; from here on the engine works on commitments.
  const fetched = await googleIcsCalendarProvider.fetchCommitments(icsUrl, window);
  if (!fetched.ok) return fail("busy", fetched.error);

  const events = fetched.commitments.map((c) => c.raw);

  // The timetable is loaded once per sync and validates every event. Without
  // it nothing can be validated, so the sync fails and writes nothing — the
  // gate is never widened when the authority is unavailable.
  let index: TimetableIndex;
  try {
    const { loadTimetableForMatching } = await import("@/domain/timetable-repository.server");
    index = buildTimetableIndex(await loadTimetableForMatching());
  } catch (err) {
    console.error("[gcal] timetable load failed", err);
    return fail("busy", "The DMC Live Timetable could not be loaded, so no classes were imported.");
  }
  if (index.activeSlots === 0) {
    return fail(
      "busy",
      "The DMC Live Timetable is empty. Refresh it in Admin → Live Timetable, then sync again.",
    );
  }

  // Mode is reported for diagnostics only: both visibilities are imported the
  // same way, because the timetable — not the title — decides validity.
  const mode = detectCalendarMode(events);
  return syncFromTimetable(displayName, events, window, index, mode);

}


/* ───────────────────────── shared shift writing ───────────────────────── */

/** Sync scope: shifts starting in [from, scopeEnd]; `to` covers overnight spill. */
type SyncWindow = { from: string; scopeEnd: string; to: string };

type ShiftPlan = {
  uid: string;
  date: string;
  startTime: string;
  endTime: string;
  label: string;
  classKeys: string[];
};

/**
 * Regenerates the operator's calendar-generated shifts inside the window.
 * Only future/today rows are ever touched — completed history is permanent.
 */
async function writeShifts(
  displayName: string,
  prefix: string,
  window: { from: string; to: string },
  plans: ShiftPlan[],
): Promise<{ removed: number; idByUid: Map<string, string> }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const todayStr = berlinDateKey();
  const from = window.from < todayStr ? todayStr : window.from;

  const existingRows = await shiftRepo.listByIdentityPrefix(prefix, from, window.to);


  // Never rebuild a shift the operator already worked (attendance recorded).
  const existingIds = (existingRows ?? []).map((r) => r.id as string);
  const workedIds = new Set<string>();
  if (existingIds.length) {
    const { data: worked } = await supabaseAdmin
      .from("shifts")
      .select("scheduled_shift_id")
      .in("scheduled_shift_id", existingIds);
    for (const w of worked ?? []) {
      if (w.scheduled_shift_id) workedIds.add(w.scheduled_shift_id as string);
    }
  }

  const mutable = (existingRows ?? []).filter(
    (r) => !workedIds.has(r.id as string) && r.status !== "completed",
  );

  // Shifts the operator deleted on purpose stay deleted: their calendar event
  // id is tombstoned and skipped until the event itself changes identity.
  const wantedUids = plans.filter((p) => p.date >= todayStr).map((p) => p.uid);
  const tombstoned = new Set<string>();
  if (wantedUids.length) {
    const { data: deletedRows } = await supabaseAdmin
      .from("deleted_shift_events")
      .select("external_event_id")
      .ilike("operator_name", displayName)
      .in("external_event_id", wantedUids);
    for (const r of deletedRows ?? []) tombstoned.add(r.external_event_id as string);
  }

  const desired = new Map(
    plans
      .filter((p) => p.date >= todayStr && !tombstoned.has(p.uid))
      .map((p) => [p.uid, p]),
  );

  const staleIds = mutable
    .filter((r) => !r.external_event_id || !desired.has(r.external_event_id as string))
    .map((r) => r.id as string);
  let removed = 0;
  if (staleIds.length) {
    removed = await shiftRepo.removeMany(staleIds);
  }

  const keptById = new Map<string, string>(); // uid → row id
  for (const r of existingRows ?? []) {
    const uid = r.external_event_id as string | null;
    if (uid && !staleIds.includes(r.id as string)) keptById.set(uid, r.id as string);
  }

  const idByUid = new Map<string, string>();
  for (const plan of desired.values()) {
    const payload = {
      start_time: plan.startTime,
      end_time: plan.endTime,
      label: plan.label,
      specific_date: plan.date,
      assigned_operator: displayName,
      status: "assigned",
      external_event_id: plan.uid,
    };
    const existingId = keptById.get(plan.uid);
    if (existingId) {
      if (workedIds.has(existingId)) {
        idByUid.set(plan.uid, existingId);
        continue; // worked shift — leave untouched
      }
      await shiftRepo.patch(existingId, payload);
      idByUid.set(plan.uid, existingId);
    } else {
      const inserted = await shiftRepo.insertOne({ ...payload, notes: null });
      idByUid.set(plan.uid, inserted.id);
    }
  }

  return { removed, idByUid };
}

/** Identity of a calendar-generated shift. Format owned by domain/shift-identity. */
function shiftUid(opKey: string, date: string, startMin: number) {
  return googleShiftIdentity(opKey, date, startMin);
}


/* ───────────────── Timetable-driven import (busy + detailed) ───────────────── */

/*
 * Both calendar visibilities take the same route.
 *
 * Since Operation 6 the DMC Live Timetable — not the Google title — decides
 * whether an event is a DMC class, so a Free/Busy calendar carries exactly the
 * information the resolver needs (Berlin date, start, end). The only thing
 * "busy" mode used to do differently was skipping the class rows entirely,
 * which left the operator's class overview empty even though the shift was
 * created. One shared importer removes that difference: class name, teacher
 * and timing always come from the matched timetable slot.
 */

async function syncFromTimetable(
  displayName: string,
  events: ParsedEvent[],
  window: SyncWindow,
  index: TimetableIndex,
  mode: CalendarMode,
): Promise<GcalSyncResult> {

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = new Date();
  const opKey = operatorKey(displayName);

  // Canonical DMC directory ids, read once per sync (Operation 8).
  const { loadDmcIdsBySourceId } = await import("@/domain/dmc-directory.server");
  const { classIdBySource, instructorIdBySource } = await loadDmcIdsBySourceId();

  const inWindow = events.filter(
    (e) => e.specific_date >= window.from && e.specific_date <= window.to,
  );

  type Imported = {
    event: ParsedEvent;
    className: string;
    teacherName: string;
    dmcClassId: string | null;
    dmcInstructorId: string | null;
  };

  const imported: Imported[] = [];
  const logs: MatchLog[] = [];
  let ignored = 0;
  for (const e of inWindow) {
    // The DMC Live Timetable decides, on time alone. The Google title is kept
    // for reference only and plays no part in this decision.
    const verdict = resolveDmcTimetableSlot(index, {
      date: e.specific_date,
      startTime: e.start_time,
      endTime: e.end_time,
      status: e.status,
      allDay: e.allDay,
    });

    const title = e.summary || "(no title)";
    if (verdict.status !== "matched") {
      ignored++;
      console.warn(`[gcal] Ignored event: "${title}" — reason: ${verdict.reason}`);
      logs.push({ title, accepted: false, confidence: 0, reason: verdict.reason });

      continue;
    }

    logs.push({ title, accepted: true, confidence: 1, reason: verdict.reason });
    imported.push({
      event: e,
      // Identity comes from the timetable, never from the Google title.
      className: verdict.classDef?.className ?? "Class",
      teacherName: instructorDisplayName(verdict.instructor),
      // Canonical directory references for the matched slot.
      dmcClassId: classIdBySource.get(verdict.slot.sourceClassId) ?? null,
      dmcInstructorId: instructorIdBySource.get(verdict.slot.sourceInstructorId) ?? null,
    });
  }



  // Build shifts from the validated classes only.
  const classEvents: ClassEvent[] = imported.map((i) => ({
    key: i.event.uid,
    date: i.event.specific_date,
    startMin: toMin(i.event.start_time),
    endMin: toMin(i.event.end_time),
  }));
  const grouped = groupClassesIntoShifts(classEvents).filter(
    (g) => g.date >= window.from && g.date <= window.scopeEnd,
  );
  const plans: ShiftPlan[] = grouped.map((g) => ({
    uid: shiftUid(opKey, g.date, g.startMin),
    date: g.date,
    startTime: minToTime(g.startMin),
    endTime: minToTime(g.endMin),
    label: g.classCount === 1 ? "1 class" : `${g.classCount} classes`,
    classKeys: g.classKeys,
  }));

  const { removed, idByUid } = await writeShifts(
    displayName,
    googleShiftPrefix(opKey),
    window,
    plans,
  );

  const inScopeKeys = new Set(grouped.flatMap((g) => g.classKeys));

  const shiftIdByClassKey = new Map<string, string>();
  for (const plan of plans) {
    const shiftId = idByUid.get(plan.uid);
    if (!shiftId) continue;
    for (const key of plan.classKeys) shiftIdByClassKey.set(key, shiftId);
  }

  // Persist the imported classes (Google UID is the permanent sync key).
  const todayStr = berlinDateKey(now);
  // Operator-set lifecycle states (completed / cancelled) must survive a resync.
  const { data: existingClassRows } = await supabaseAdmin
    .from("calendar_classes")
    .select("uid, status")
    .ilike("operator", displayName)
    .in("status", ["completed", "cancelled"]);
  const keptStatus = new Map<string, string>(
    (existingClassRows ?? []).map((r) => [r.uid as string, r.status as string]),
  );
  const rows = imported
    .filter((i) => inScopeKeys.has(i.event.uid))
    .map((i) => ({
      operator: displayName,
      uid: i.event.uid,
      dmc_class_id: i.dmcClassId,
      dmc_instructor_id: i.dmcInstructorId,
      class_name: i.className,
      teacher_name: i.teacherName,
      raw_title: (i.event.summary ?? "").slice(0, 500),
      specific_date: i.event.specific_date,
      start_time: i.event.start_time,
      end_time: i.event.end_time,
      status: keptStatus.get(i.event.uid) ?? i.event.status,
      scheduled_shift_id: shiftIdByClassKey.get(i.event.uid) ?? null,
    }));


  if (rows.length) {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabaseAdmin
        .from("calendar_classes")
        .upsert(rows.slice(i, i + 200), { onConflict: "operator,uid" });
      if (error) throw new Error(error.message);
    }
  }

  // Drop future classes that disappeared from the calendar. Past classes stay.
  const keepUids = new Set(rows.filter((r) => r.specific_date >= todayStr).map((r) => r.uid));
  const { data: futureRows } = await supabaseAdmin
    .from("calendar_classes")
    .select("id, uid")
    .ilike("operator", displayName)
    .gte("specific_date", todayStr)
    .lte("specific_date", window.to);
  // Manually added classes (uid prefix `manual:`) never came from the feed, so
  // they are not "disappeared" calendar events and must survive a resync.
  const staleClassIds = (futureRows ?? [])
    .filter((r) => !keepUids.has(r.uid as string) && !isManualIdentity(String(r.uid)))
    .map((r) => r.id as string);
  if (staleClassIds.length) {
    await supabaseAdmin.from("calendar_classes").delete().in("id", staleClassIds);
  }

  // The shift label is derived from the current valid class count, including
  // any manually added classes, so it can never go stale after a sync.
  await refreshShiftLabels([...idByUid.values()]);

  // `calendar_classes` is a rolling operational table: past rows whose history
  // already lives in a completed Record are pruned here (Operation 9).
  const pruned = await pruneObsoleteClasses(displayName, todayStr);

  return {
    ok: true,
    mode,
    fetched: rows.length,
    ignored,
    shifts: plans.length,
    removed,
    pruned,
    logs,
  };
}

/**
 * Removes the operator's obsolete past class rows.
 *
 * Only rows that are provably finished are dropped: older than the grace
 * window, and either detached from any shift or belonging to a shift whose
 * Record is checked out with a non-empty class snapshot. Anything that cannot
 * be resolved with certainty is kept.
 *
 * Studio Display sessions live in the browser (localStorage/BroadcastChannel)
 * and can only reference a class within a day of now, which the grace window
 * already protects, so no deletable row can be in use by a display.
 */
export async function pruneObsoleteClasses(
  displayName: string,
  today: string,
): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cutoff = retentionCutoff(today);

  const { data: pastRows, error } = await supabaseAdmin
    .from("calendar_classes")
    .select("id, specific_date, scheduled_shift_id")
    .ilike("operator", displayName)
    .lt("specific_date", cutoff);
  if (error) throw new Error(error.message);
  const rows = (pastRows ?? []).map((r) => ({
    id: r.id as string,
    specificDate: r.specific_date as string,
    scheduledShiftId: (r.scheduled_shift_id as string | null) ?? null,
  }));
  if (!rows.length) return 0;

  const shiftIds = [...new Set(rows.map((r) => r.scheduledShiftId).filter(Boolean))] as string[];
  const knownShiftIds = new Set<string>();
  const recordsByShiftId = new Map<
    string,
    { checkedOut: boolean; snapshotCount: number }
  >();

  if (shiftIds.length) {
    const { data: shiftRows, error: shiftErr } = await supabaseAdmin
      .from("scheduled_shifts")
      .select("id")
      .in("id", shiftIds);
    if (shiftErr) throw new Error(shiftErr.message);
    for (const s of shiftRows ?? []) knownShiftIds.add(s.id as string);

    const { data: recordRows, error: recErr } = await supabaseAdmin
      .from("shifts")
      .select("scheduled_shift_id, check_out_at, classes")
      .in("scheduled_shift_id", shiftIds);
    if (recErr) throw new Error(recErr.message);
    for (const r of recordRows ?? []) {
      const sid = r.scheduled_shift_id as string | null;
      if (!sid) continue;
      const snapshot = Array.isArray(r.classes) ? r.classes.length : 0;
      const prev = recordsByShiftId.get(sid);
      const next = { checkedOut: !!r.check_out_at, snapshotCount: snapshot };
      // Several Records can share a shift; the completed one with data wins.
      if (!prev || (next.checkedOut && next.snapshotCount > prev.snapshotCount)) {
        recordsByShiftId.set(sid, next);
      }
    }
  }

  const report = classifyClassRows(rows, { today, knownShiftIds, recordsByShiftId });
  if (!report.deletableIds.length) return 0;

  for (let i = 0; i < report.deletableIds.length; i += 200) {
    const { error: delErr } = await supabaseAdmin
      .from("calendar_classes")
      .delete()
      .in("id", report.deletableIds.slice(i, i + 200));
    if (delErr) throw new Error(delErr.message);
  }
  return report.deletableIds.length;
}

/* ───────────────────────── Reads ───────────────────────── */

export async function listClassesForOperator(
  displayName: string,
  fromDate: string,
  toDate: string,
): Promise<CalendarClassRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("calendar_classes")
    .select(
      "id, uid, dmc_class_id, dmc_instructor_id, class_name, teacher_name, raw_title, specific_date, start_time, end_time, status, scheduled_shift_id",
    )
    .ilike("operator", displayName)
    .gte("specific_date", fromDate)
    .lte("specific_date", toDate)
    .order("specific_date")
    .order("start_time");
  if (error) throw new Error(error.message);
  return (data ?? []) as CalendarClassRow[];
}

/** Operator-driven class lifecycle state (dashboard cancel / complete). */
export async function setClassStatus(
  displayName: string,
  id: string,
  status: "scheduled" | "completed" | "cancelled",
): Promise<CalendarClassRow> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row, error: readErr } = await supabaseAdmin
    .from("calendar_classes")
    .select("id, operator")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!row) throw new Response("Not found", { status: 404 });
  if ((row.operator as string).toLowerCase() !== displayName.toLowerCase()) {
    throw new Response("Forbidden", { status: 403 });
  }
  const { data, error } = await supabaseAdmin
    .from("calendar_classes")
    .update({ status })
    .eq("id", id)
    .select(
      "id, uid, dmc_class_id, dmc_instructor_id, class_name, teacher_name, raw_title, specific_date, start_time, end_time, status, scheduled_shift_id",
    )
    .single();
  if (error) throw new Error(error.message);
  return data as CalendarClassRow;
}

export type CalendarHealth = { connected: boolean; ok: boolean; error?: string };

/**
 * Lightweight liveness check for an operator's calendar link. Used by the UI to
 * show a green/red indicator independently of whether automatic sync is on.
 */
export async function checkOperatorCalendar(username: string): Promise<CalendarHealth> {
  const { icsUrl } = await loadOperatorCalendar(username);
  if (!icsUrl) return { connected: false, ok: false, error: "No calendar link set" };
  const safeUrl = safeRemoteUrl(icsUrl);
  if (!safeUrl) return { connected: true, ok: false, error: "Link is not an allowed public https address" };
  try {
    let target = safeUrl;
    let res: Response | null = null;
    for (let hop = 0; hop < 5; hop++) {
      res = await fetch(target, {
        headers: { Accept: "text/calendar, text/plain;q=0.9, */*;q=0.8" },
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) break;
        const next = safeRemoteUrl(new URL(loc, target).toString());
        if (!next) return { connected: true, ok: false, error: "Link redirects to a blocked address" };
        target = next;
        continue;
      }
      break;
    }
    if (!res || !res.ok) {
      return { connected: true, ok: false, error: `Calendar link returned HTTP ${res ? res.status : "error"}` };
    }
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      return { connected: true, ok: false, error: "Link did not return calendar data" };
    }
    return { connected: true, ok: true };
  } catch (e) {
    return { connected: true, ok: false, error: e instanceof Error ? e.message : "Unreachable" };
  }
}

/* ─────────────── Operator shift overview: class management ─────────────── */

const CLASS_COLUMNS =
  "id, uid, dmc_class_id, dmc_instructor_id, class_name, teacher_name, raw_title, specific_date, start_time, end_time, status, scheduled_shift_id";

/**
 * The shift label is derived data: it always states how many valid (non
 * cancelled) classes the shift currently contains. This is the single place
 * that computes it, used after sync and after any operator class edit.
 */
export async function refreshShiftLabels(shiftIds: string[]): Promise<void> {
  const ids = [...new Set(shiftIds.filter(Boolean))];
  if (!ids.length) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("calendar_classes")
    .select("scheduled_shift_id, status")
    .in("scheduled_shift_id", ids);
  if (error) throw new Error(error.message);
  const counts = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const row of data ?? []) {
    const sid = row.scheduled_shift_id as string | null;
    if (!sid || (row.status as string) === "cancelled") continue;
    counts.set(sid, (counts.get(sid) ?? 0) + 1);
  }
  for (const id of ids) {
    const n = counts.get(id) ?? 0;
    if (n === 0) continue; // busy-mode / class-less shifts keep their own label
    await supabaseAdmin
      .from("scheduled_shifts")
      .update({ label: n === 1 ? "1 class" : `${n} classes` })
      .eq("id", id);
  }
}

async function assertShiftOwnedBy(displayName: string, shiftId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("scheduled_shifts")
    .select("id, assigned_operator, specific_date, start_time, end_time")
    .eq("id", shiftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Response("Shift not found", { status: 404 });
  const owner = String((data as { assigned_operator: string | null }).assigned_operator ?? "");
  if (owner.toLowerCase() !== displayName.toLowerCase()) {
    throw new Response("Forbidden", { status: 403 });
  }
  return data as {
    id: string;
    assigned_operator: string | null;
    specific_date: string;
    start_time: string;
    end_time: string;
  };
}

async function assertClassOwnedBy(displayName: string, id: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("calendar_classes")
    .select("id, operator, scheduled_shift_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Response("Class not found", { status: 404 });
  if ((data.operator as string).toLowerCase() !== displayName.toLowerCase()) {
    throw new Response("Forbidden", { status: 403 });
  }
  return data as { id: string; operator: string; scheduled_shift_id: string | null };
}

/** Classes belonging to one scheduled shift — the same rows the dashboard uses. */
export async function listClassesForShift(
  displayName: string,
  shiftId: string,
): Promise<CalendarClassRow[]> {
  await assertShiftOwnedBy(displayName, shiftId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("calendar_classes")
    .select(CLASS_COLUMNS)
    .ilike("operator", displayName)
    .eq("scheduled_shift_id", shiftId)
    .order("specific_date")
    .order("start_time");
  if (error) throw new Error(error.message);
  return (data ?? []) as CalendarClassRow[];
}

/**
 * A class on a shift is identified by the canonical DMC directory (Operation
 * 8). Names are a display snapshot taken from the selected DMC entries; no
 * free-text class or teacher is created anywhere.
 */
export type ShiftClassInput = {
  dmcClassId: string;
  dmcInstructorId: string | null;
  specificDate: string;
  startTime: string;
  endTime: string;
};

async function resolveDmcSelection(
  dmcClassId: string,
  dmcInstructorId: string | null,
): Promise<{ className: string; teacherName: string; instructorId: string | null }> {
  const { findDmcClass, findDmcInstructor } = await import("@/domain/dmc-directory.server");
  const [cls, instructor] = await Promise.all([
    findDmcClass(dmcClassId),
    dmcInstructorId ? findDmcInstructor(dmcInstructorId) : Promise.resolve(null),
  ]);
  if (!cls) throw new Error("Select a DMC class");
  if (dmcInstructorId && !instructor) throw new Error("Select a DMC instructor");
  return {
    className: cls.name,
    teacherName: instructor?.name ?? "—",
    instructorId: instructor?.id ?? null,
  };
}

/** Adds a class to a scheduled shift and refreshes the derived shift label. */
export async function addClassToShift(
  displayName: string,
  shiftId: string,
  input: ShiftClassInput,
): Promise<CalendarClassRow> {
  await assertShiftOwnedBy(displayName, shiftId);
  const selection = await resolveDmcSelection(input.dmcClassId, input.dmcInstructorId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const uid = manualClassUid();
  const { data, error } = await supabaseAdmin
    .from("calendar_classes")
    .insert({
      operator: displayName,
      uid,
      dmc_class_id: input.dmcClassId,
      dmc_instructor_id: selection.instructorId,
      class_name: selection.className,
      teacher_name: selection.teacherName,
      raw_title: null,
      specific_date: input.specificDate,
      start_time: input.startTime,
      end_time: input.endTime,
      status: "scheduled",
      scheduled_shift_id: shiftId,
    })
    .select(CLASS_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  await refreshShiftLabels([shiftId]);
  return data as CalendarClassRow;
}

/** Operator edit of an existing class row (DMC class / instructor, times). */
export async function updateShiftClass(
  displayName: string,
  id: string,
  patch: Partial<ShiftClassInput>,
): Promise<CalendarClassRow> {
  const existing = await assertClassOwnedBy(displayName, id);
  const update: Record<string, unknown> = {};
  if (patch.dmcClassId !== undefined) {
    const selection = await resolveDmcSelection(
      patch.dmcClassId,
      patch.dmcInstructorId ?? null,
    );
    update.dmc_class_id = patch.dmcClassId;
    update.class_name = selection.className;
    if (patch.dmcInstructorId !== undefined) {
      update.dmc_instructor_id = selection.instructorId;
      update.teacher_name = selection.teacherName;
    }
  } else if (patch.dmcInstructorId !== undefined) {
    const { findDmcInstructor } = await import("@/domain/dmc-directory.server");
    const instructor = patch.dmcInstructorId
      ? await findDmcInstructor(patch.dmcInstructorId)
      : null;
    if (patch.dmcInstructorId && !instructor) throw new Error("Select a DMC instructor");
    update.dmc_instructor_id = instructor?.id ?? null;
    update.teacher_name = instructor?.name ?? "—";
  }
  if (patch.specificDate !== undefined) update.specific_date = patch.specificDate;
  if (patch.startTime !== undefined) update.start_time = patch.startTime;
  if (patch.endTime !== undefined) update.end_time = patch.endTime;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("calendar_classes")
    .update(update as never)
    .eq("id", id)
    .select(CLASS_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  if (existing.scheduled_shift_id) await refreshShiftLabels([existing.scheduled_shift_id]);
  return data as CalendarClassRow;
}

/**
 * Removes a class from the scheduled shift. Only the app's own row is deleted —
 * the Google Calendar event itself is never touched.
 */
export async function removeShiftClass(displayName: string, id: string): Promise<void> {
  const existing = await assertClassOwnedBy(displayName, id);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("calendar_classes").delete().eq("id", id);
  if (error) throw new Error(error.message);
  if (existing.scheduled_shift_id) await refreshShiftLabels([existing.scheduled_shift_id]);
}
