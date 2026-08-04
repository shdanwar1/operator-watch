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
  groupClassesIntoShifts,
  minToTime,
  parseIcs,
  safeRemoteUrl,
  syncWindow,
  toMin,
  dateKey,
  type CalendarMode,
  type ClassEvent,
  type ParsedEvent,
} from "./gcal-core";
import { matchEvent, type MatchLog } from "./gcal-match";

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
};

export type CalendarClassRow = {
  id: string;
  uid: string;
  class_name: string;
  teacher_name: string;
  specific_date: string;
  start_time: string;
  end_time: string;
  duration_min: number;
  status: string;
  meet_link: string | null;
  description: string | null;
  scheduled_shift_id: string | null;
};

export async function loadOperatorCalendar(username: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("operators")
    .select("username, calendar_ics_url")
    .ilike("username", username)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Response("Operator not found", { status: 404 });
  return {
    displayName: data.username as string,
    icsUrl: (data.calendar_ics_url ?? null) as string | null,
  };
}

function fail(mode: CalendarMode, error: string): GcalSyncResult {
  return { ok: false, mode, fetched: 0, ignored: 0, shifts: 0, removed: 0, error };
}

export async function runCalendarSync(
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

  const safeUrl = safeRemoteUrl(icsUrl);
  if (!safeUrl) {
    return fail("busy", "That calendar link is not an allowed public https address.");
  }

  let icsText: string;
  try {
    // The edge runtime does not support redirect: "error"; follow redirects
    // manually so every hop can be re-validated against the SSRF guard.
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
        if (!next) return fail("busy", "That calendar link redirects to a blocked address.");
        target = next;
        continue;
      }
      break;
    }
    if (!res || !res.ok) {
      return fail(
        "busy",
        `Calendar link returned HTTP ${res ? res.status : "error"}. In Google Calendar → Settings → "Access permissions", enable "Make available to public" and copy the "Public address in iCal format".`,
      );
    }
    icsText = await res.text();
  } catch (e) {
    return fail("busy", e instanceof Error ? e.message : "Failed to fetch calendar");
  }

  if (!/BEGIN:VCALENDAR/i.test(icsText)) {
    return fail(
      "busy",
      "That link did not return calendar data. Use the \"Public address in iCal format\" (ends in .ics) from Google Calendar settings.",
    );
  }

  const nowDate = new Date();
  const window = syncWindow(nowDate, includeNextMonth);
  const [fy, fm, fd] = window.from.split("-").map(Number);
  const [ty, tm, td] = window.to.split("-").map(Number);
  const events = parseIcs(icsText, {
    from: new Date(fy, fm - 1, fd),
    to: new Date(ty, tm - 1, td, 23, 59, 59),
  });
  const mode = detectCalendarMode(events);
  return mode === "detailed"
    ? syncDetailed(displayName, events, window)
    : syncBusy(displayName, events, window);
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
  const todayStr = dateKey(new Date());
  const from = window.from < todayStr ? todayStr : window.from;

  const { data: existingRows, error: exErr } = await supabaseAdmin
    .from("scheduled_shifts")
    .select("id, external_event_id, specific_date, status")
    .like("external_event_id", `${prefix}%`)
    .gte("specific_date", from)
    .lte("specific_date", window.to);
  if (exErr) throw new Error(exErr.message);

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

  const desired = new Map(plans.filter((p) => p.date >= todayStr).map((p) => [p.uid, p]));

  const staleIds = mutable
    .filter((r) => !r.external_event_id || !desired.has(r.external_event_id as string))
    .map((r) => r.id as string);
  let removed = 0;
  if (staleIds.length) {
    const { error: delErr } = await supabaseAdmin
      .from("scheduled_shifts")
      .delete()
      .in("id", staleIds);
    if (delErr) throw new Error(delErr.message);
    removed = staleIds.length;
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
      const { error } = await supabaseAdmin
        .from("scheduled_shifts")
        .update(payload)
        .eq("id", existingId);
      if (error) throw new Error(error.message);
      idByUid.set(plan.uid, existingId);
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from("scheduled_shifts")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      idByUid.set(plan.uid, (inserted as { id: string }).id);
    }
  }

  return { removed, idByUid };
}

function shiftUid(opKey: string, date: string, startMin: number) {
  const hh = String(Math.floor(startMin / 60)).padStart(2, "0");
  const mm = String(startMin % 60).padStart(2, "0");
  return `op:${opKey}:shift:${date}:${hh}${mm}`;
}

/* ───────────────────────── Busy mode ───────────────────────── */

async function syncBusy(
  displayName: string,
  events: ParsedEvent[],
  window: SyncWindow,
): Promise<GcalSyncResult> {
  const opKey = displayName.toLowerCase();

  const blocks: ClassEvent[] = events
    .filter((e) => e.status !== "cancelled")
    .filter((e) => e.specific_date >= window.from && e.specific_date <= window.to)
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

  const { removed } = await writeShifts(displayName, `op:${opKey}:shift:`, window, plans);

  return {
    ok: true,
    mode: "busy",
    fetched: grouped.reduce((n, g) => n + g.classCount, 0),
    ignored: 0,
    shifts: plans.length,
    removed,
  };
}

/* ───────────────────────── Detailed mode ───────────────────────── */

/**
 * Best-effort class/teacher split for events the directory could not resolve.
 * Never drops the event — a missing title just becomes a generic class.
 */
function fallbackTitle(summary: string): { className: string; teacherName: string } {
  const raw = (summary ?? "").trim();
  if (!raw) return { className: "Class", teacherName: "—" };
  const parts = raw.split(/\s+(?:-|–|—|\||with|w\/|by)\s+/i);
  const className = (parts[0] ?? raw).trim() || "Class";
  const teacherName = parts.length > 1 ? parts.slice(1).join(" ").trim() || "—" : "—";
  return { className: className.slice(0, 120), teacherName: teacherName.slice(0, 120) };
}

async function syncDetailed(
  displayName: string,
  events: ParsedEvent[],
  window: SyncWindow,
): Promise<GcalSyncResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = new Date();
  const opKey = displayName.toLowerCase();

  const [{ data: classRows }, { data: teacherRows }] = await Promise.all([
    supabaseAdmin.from("classes").select("id,name").limit(2000),
    supabaseAdmin.from("teachers").select("id,name").limit(2000),
  ]);
  const classDir = (classRows ?? []) as { id: string; name: string }[];
  const teacherDir = (teacherRows ?? []) as { id: string; name: string }[];

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
    if (e.status === "cancelled") {
      ignored++;
      logs.push({
        title: e.summary,
        accepted: false,
        confidence: 0,
        reason: "Event cancelled in Google Calendar",
      });
      continue;
    }
    const { result, log } = matchEvent(e.summary, classDir, teacherDir);
    logs.push(log);
    if (result) {
      // The database is the source of truth: calendar text is discarded here.
      imported.push({
        event: e,
        className: result.className,
        teacherName: result.teacherName,
        classId: result.classId,
        teacherId: result.teacherId,
      });
      continue;
    }
    // Directory matching failed. The event is still a real calendar block, so
    // it MUST be imported — otherwise the same calendar produces fewer shifts
    // in "see all event details" mode than in free/busy mode. Only the
    // metadata degrades: raw calendar text instead of canonical directory
    // values, and no class/teacher ids.
    const { className, teacherName } = fallbackTitle(e.summary);
    imported.push({ event: e, className, teacherName, classId: null, teacherId: null });
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
    `op:${opKey}:shift:`,
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
  const todayStr = dateKey(now);
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
    .map((i) => {
    const startMin = toMin(i.event.start_time);
    const endMin = toMin(i.event.end_time);
    return {
      operator: displayName,
      uid: i.event.uid,
      class_id: i.classId,
      teacher_id: i.teacherId,
      class_name: i.className,
      teacher_name: i.teacherName,
      specific_date: i.event.specific_date,
      start_time: i.event.start_time,
      end_time: i.event.end_time,
      duration_min: Math.max(0, endMin - startMin),
      status: keptStatus.get(i.event.uid) ?? i.event.status,

      meet_link: i.event.meetLink,
      description: i.event.description ? i.event.description.slice(0, 5000) : null,
      source: "google_calendar",
      scheduled_shift_id: shiftIdByClassKey.get(i.event.uid) ?? null,
    };
  });

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
  const staleClassIds = (futureRows ?? [])
    .filter((r) => !keepUids.has(r.uid as string))
    .map((r) => r.id as string);
  if (staleClassIds.length) {
    await supabaseAdmin.from("calendar_classes").delete().in("id", staleClassIds);
  }

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
      "id, uid, class_name, teacher_name, specific_date, start_time, end_time, duration_min, status, meet_link, description, scheduled_shift_id",
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
      "id, uid, class_name, teacher_name, specific_date, start_time, end_time, duration_min, status, meet_link, description, scheduled_shift_id",
    )
    .single();
  if (error) throw new Error(error.message);
  return data as CalendarClassRow;
}
