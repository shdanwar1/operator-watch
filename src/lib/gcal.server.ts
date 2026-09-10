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
  type ParsedEvent,
} from "./gcal-core";
import { aliasKeyFor, type MatchLog } from "./gcal-match";
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


export type GcalSyncResult = {
  ok: boolean;
  mode: CalendarMode;
  fetched: number; // classes imported (detailed) / busy blocks (busy)
  ignored: number; // events skipped (personal / unknown class or teacher)
  shifts: number;
  removed: number;
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
  class_name: string;
  teacher_name: string;
  specific_date: string;
  start_time: string;
  end_time: string;
  status: string;
  class_id: string | null;
  teacher_id: string | null;
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

  const mode = detectCalendarMode(events);
  return mode === "detailed"
    ? syncDetailed(displayName, events, window, index)
    : syncBusy(displayName, events, window, index);
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


/* ───────────────────────── Busy mode ───────────────────────── */

async function syncBusy(
  displayName: string,
  events: ParsedEvent[],
  window: SyncWindow,
): Promise<GcalSyncResult> {
  const opKey = operatorKey(displayName);

  let ignoredBusy = 0;
  const blocks: ClassEvent[] = events
    .filter((e) => e.specific_date >= window.from && e.specific_date <= window.to)
    .filter((e) => {
      // Untitled busy blocks still have to look like a live class: no all-day
      // blocks, and an exact 45 / 60 minute duration.
      const verdict = isValidDanceMasterclassClass(e);
      if (!verdict.valid) {
        ignoredBusy++;
        console.warn(`[gcal] Ignored event: "${e.summary || "(busy)"}" — reason: ${verdict.reason}`);
      }
      return verdict.valid;
    })
    .map((e) => ({
      key: e.uid,
      date: e.specific_date,
      startMin: toMin(e.start_time),
      endMin: toMin(e.end_time),
    }));

  // The scope boundary is the *shift start*, so a shift beginning on the last
  // day of the scope is kept whole even when it runs into the next month.
  const grouped = groupClassesIntoShifts(blocks).filter(
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

  const { removed } = await writeShifts(displayName, googleShiftPrefix(opKey), window, plans);

  return {
    ok: true,
    mode: "busy",
    fetched: grouped.reduce((n, g) => n + g.classCount, 0),
    ignored: ignoredBusy,
    shifts: plans.length,
    removed,
  };
}

/* ───────────────────────── Detailed mode ───────────────────────── */




async function syncDetailed(
  displayName: string,
  events: ParsedEvent[],
  window: SyncWindow,
): Promise<GcalSyncResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = new Date();
  const opKey = operatorKey(displayName);

  const [{ data: classRows }, { data: teacherRows }, { data: aliasRows }] = await Promise.all([
    supabaseAdmin.from("classes").select("id,name").limit(2000),
    supabaseAdmin.from("teachers").select("id,name").limit(2000),
    supabaseAdmin.from("class_aliases").select("alias_key,class_id,teacher_id").limit(5000),
  ]);
  const classDir = (classRows ?? []) as { id: string; name: string }[];
  const teacherDir = (teacherRows ?? []) as { id: string; name: string }[];
  const aliases: AliasEntry[] = (aliasRows ?? []).map((a) => ({
    aliasKey: a.alias_key as string,
    classId: (a.class_id ?? null) as string | null,
    teacherId: (a.teacher_id ?? null) as string | null,
  }));


  const inWindow = events.filter(
    (e) => e.specific_date >= window.from && e.specific_date <= window.to,
  );

  type Imported = {
    event: ParsedEvent;
    className: string;
    teacherName: string;
    classId: string | null;
    teacherId: string | null;
  };

  const imported: Imported[] = [];
  const logs: MatchLog[] = [];
  let ignored = 0;
  for (const e of inWindow) {
    // Title matching only supplies *evidence*; eligibility is decided by the
    // single central gate so nothing else in the pipeline can widen it.
    const matched =
      e.status === "cancelled"
        ? null
        : matchEvent(e.summary, classDir, teacherDir, aliases);
    const verdict = isValidDanceMasterclassClass(e, {
      classId: matched?.result.classId ?? null,
      teacherId: matched?.result.teacherId ?? null,
    });

    if (!verdict.valid) {
      ignored++;
      console.warn(`[gcal] Ignored event: "${e.summary}" — reason: ${verdict.reason}`);
      logs.push({
        title: e.summary,
        accepted: false,
        confidence: matched?.log.confidence ?? 0,
        reason: verdict.reason,
      });
      continue;
    }

    const result = matched!.result;
    logs.push({ ...matched!.log, accepted: true, reason: `${matched!.log.reason} · ${verdict.reason}` });
    imported.push({
      event: e,
      className: result.className ?? result.fallbackClassName,
      teacherName: result.teacherName ?? result.fallbackTeacherName,
      classId: result.classId,
      teacherId: result.teacherId,
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
      class_id: i.classId,
      teacher_id: i.teacherId,
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


  return {
    ok: true,
    mode: "detailed",
    fetched: rows.length,
    ignored,
    shifts: plans.length,
    removed,
    logs,
  };
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
      "id, uid, class_id, teacher_id, class_name, teacher_name, raw_title, specific_date, start_time, end_time, status, scheduled_shift_id",
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
      "id, uid, class_id, teacher_id, class_name, teacher_name, raw_title, specific_date, start_time, end_time, status, scheduled_shift_id",
    )
    .single();
  if (error) throw new Error(error.message);
  return data as CalendarClassRow;
}

/**
 * Operator correction of a class/teacher mapping.
 *
 * The correction is applied to the row AND remembered as an alias keyed on the
 * raw Google Calendar title, so every future sync resolves it automatically.
 */
export async function correctClassMapping(
  displayName: string,
  id: string,
  classId: string,
  teacherId: string | null,
): Promise<CalendarClassRow & { alias_saved: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row, error: readErr } = await supabaseAdmin
    .from("calendar_classes")
    .select("id, operator, raw_title, class_name")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!row) throw new Response("Not found", { status: 404 });
  if ((row.operator as string).toLowerCase() !== displayName.toLowerCase()) {
    throw new Response("Forbidden", { status: 403 });
  }

  const [{ data: cls }, teacherRes] = await Promise.all([
    supabaseAdmin.from("classes").select("id,name").eq("id", classId).maybeSingle(),
    teacherId
      ? supabaseAdmin.from("teachers").select("id,name").eq("id", teacherId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!cls) throw new Error("Unknown class");
  const tea = (teacherRes as { data: { id: string; name: string } | null }).data;

  const { data, error } = await supabaseAdmin
    .from("calendar_classes")
    .update({
      class_id: cls.id,
      teacher_id: tea?.id ?? null,
      class_name: cls.name,
      teacher_name: tea?.name ?? "—",
    })
    .eq("id", id)
    .select(
      "id, uid, class_id, teacher_id, class_name, teacher_name, raw_title, specific_date, start_time, end_time, status, scheduled_shift_id",
    )
    .single();
  if (error) throw new Error(error.message);

  // The row itself is already corrected. Remembering it as an alias is a
  // separate step that can fail on its own; when it does, the caller is told
  // so it doesn't promise "future syncs will use it".
  const rawTitle = (row.raw_title as string | null) ?? (row.class_name as string);
  const aliasKey = aliasKeyFor(rawTitle);
  let aliasSaved = false;
  if (aliasKey) {
    const { error: aliasErr } = await supabaseAdmin.from("class_aliases").upsert(
      {
        alias_key: aliasKey,
        raw_title: rawTitle.slice(0, 500),
        class_id: cls.id,
        teacher_id: tea?.id ?? null,
      },
      { onConflict: "alias_key" },
    );
    if (aliasErr) console.error("[gcal] alias upsert failed", aliasErr.message);
    else aliasSaved = true;
  }

  return { ...(data as CalendarClassRow), alias_saved: aliasSaved };
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
  "id, uid, class_id, teacher_id, class_name, teacher_name, raw_title, specific_date, start_time, end_time, status, scheduled_shift_id";

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
 * Resolves a typed teacher name against the existing teacher directory. A new
 * name is recorded in that same directory so there is never a second list.
 */
async function resolveTeacher(name: string): Promise<{ id: string | null; name: string }> {
  const clean = name.trim().slice(0, 200);
  if (!clean) return { id: null, name: "—" };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("teachers")
    .select("id,name")
    .ilike("name", clean)
    .maybeSingle();
  if (data) return { id: data.id as string, name: data.name as string };
  await supabaseAdmin.rpc("bump_directory_usage", { p_table: "teachers", p_names: [clean] });
  const { data: created } = await supabaseAdmin
    .from("teachers")
    .select("id,name")
    .ilike("name", clean)
    .maybeSingle();
  return created
    ? { id: created.id as string, name: created.name as string }
    : { id: null, name: clean };
}

async function resolveClassName(name: string): Promise<{ id: string | null; name: string }> {
  const clean = name.trim().slice(0, 200);
  if (!clean) throw new Error("Class name is required");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("classes")
    .select("id,name")
    .ilike("name", clean)
    .maybeSingle();
  if (data) return { id: data.id as string, name: data.name as string };
  await supabaseAdmin.rpc("bump_directory_usage", { p_table: "classes", p_names: [clean] });
  const { data: created } = await supabaseAdmin
    .from("classes")
    .select("id,name")
    .ilike("name", clean)
    .maybeSingle();
  return created
    ? { id: created.id as string, name: created.name as string }
    : { id: null, name: clean };
}

export type ShiftClassInput = {
  className: string;
  teacherName: string;
  specificDate: string;
  startTime: string;
  endTime: string;
};

/** Adds a class to a scheduled shift and refreshes the derived shift label. */
export async function addClassToShift(
  displayName: string,
  shiftId: string,
  input: ShiftClassInput,
): Promise<CalendarClassRow> {
  await assertShiftOwnedBy(displayName, shiftId);
  const [cls, tea] = await Promise.all([
    resolveClassName(input.className),
    resolveTeacher(input.teacherName),
  ]);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const uid = manualClassUid();
  const { data, error } = await supabaseAdmin
    .from("calendar_classes")
    .insert({
      operator: displayName,
      uid,
      class_id: cls.id,
      teacher_id: tea.id,
      class_name: cls.name,
      teacher_name: tea.name,
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

/** Operator edit of an existing class row (teacher, name, times). */
export async function updateShiftClass(
  displayName: string,
  id: string,
  patch: Partial<ShiftClassInput>,
): Promise<CalendarClassRow> {
  const existing = await assertClassOwnedBy(displayName, id);
  const update: Record<string, unknown> = {};
  if (patch.teacherName !== undefined) {
    const tea = await resolveTeacher(patch.teacherName);
    update.teacher_id = tea.id;
    update.teacher_name = tea.name;
  }
  if (patch.className !== undefined) {
    const cls = await resolveClassName(patch.className);
    update.class_id = cls.id;
    update.class_name = cls.name;
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
