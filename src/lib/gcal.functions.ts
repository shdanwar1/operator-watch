import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import type { CalendarClassRow, GcalSyncResult } from "./gcal.server";

type GateSession = { siteUnlocked?: boolean; username?: string; isAdmin?: boolean };

export type { CalendarClassRow, GcalSyncResult };

function getSessionConfig() {
  const password = process.env.SESSION_SECRET;
  if (!password) throw new Error("SESSION_SECRET is not set");
  return {
    password,
    name: "site-gate",
    maxAge: 60 * 60 * 24 * 30,
    cookie: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" },
  };
}

async function requireOperator() {
  const session = await useSession<GateSession>(getSessionConfig());
  const username = session.data.username ?? "";
  if (!session.data.siteUnlocked || session.data.isAdmin || !username) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return { username };
}

export const getMyCalendarUrl = createServerFn({ method: "GET" }).handler(async () => {
  const { username } = await requireOperator();
  const { loadOperatorCalendar } = await import("./gcal.server");
  const { icsUrl } = await loadOperatorCalendar(username);
  return { icsUrl };
});

export const setMyCalendarUrl = createServerFn({ method: "POST" })
  .inputValidator((data: { url: string }) => {
    if (!data || typeof data.url !== "string") throw new Error("Invalid input");
    return { url: data.url.slice(0, 2000) };
  })
  .handler(async ({ data }) => {
    const { username } = await requireOperator();
    const { normalizeIcsUrl } = await import("./gcal-core");
    const normalized = data.url.trim() === "" ? null : normalizeIcsUrl(data.url);
    if (data.url.trim() !== "" && !normalized) {
      throw new Error(
        "Could not read that link. Paste the public ICS URL (ends in .ics) from Google Calendar → Settings → Integrate calendar → Public address in iCal format.",
      );
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("operators")
      .update({ calendar_ics_url: normalized })
      .ilike("username", username);
    if (error) throw new Error(error.message);
    return { ok: true, icsUrl: normalized };
  });

/**
 * Operator manual sync. The scope is fixed by product contract: the current
 * calendar month only. Any client-supplied options are ignored on purpose so
 * stale preferences or an obsolete caller can never widen the window.
 */
export const syncGoogleCalendar = createServerFn({ method: "POST" })
  .inputValidator(() => ({}) as Record<string, never>)
  .handler(async (): Promise<GcalSyncResult> => {
    const { username } = await requireOperator();
    const { runCalendarSync } = await import("./gcal.server");
    return runCalendarSync(username, { includeNextMonth: false });
  });

/** Server-authoritative last successful sync time (no calendar fetch). */
export const getMyCalendarSyncStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ calendarLastSyncAt: string | null }> => {
    const { username } = await requireOperator();
    const { readCalendarSyncStatus } = await import("./gcal.server");
    return readCalendarSyncStatus(username);
  },
);

/** Classes imported from the operator's calendar (Detailed Mode only). */
export const listMyCalendarClasses = createServerFn({ method: "GET" }).handler(
  async (): Promise<CalendarClassRow[]> => {
    const { username } = await requireOperator();
    const { loadOperatorCalendar, listClassesForOperator } = await import("./gcal.server");
    const { displayName } = await loadOperatorCalendar(username);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const from = key(new Date(now.getFullYear(), now.getMonth(), 1));
    const to = key(new Date(now.getFullYear(), now.getMonth() + 2, 0));
    return listClassesForOperator(displayName, from, to);
  },
);

/** Marks a class in the current shift as completed or cancelled. */
export const setMyClassStatus = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; status: "scheduled" | "completed" | "cancelled" }) => {
    if (!data || typeof data.id !== "string") throw new Error("Invalid input");
    if (!["scheduled", "completed", "cancelled"].includes(data.status)) {
      throw new Error("Invalid status");
    }
    return { id: data.id, status: data.status };
  })
  .handler(async ({ data }): Promise<CalendarClassRow> => {
    const { username } = await requireOperator();
    const { loadOperatorCalendar, setClassStatus } = await import("./gcal.server");
    const { displayName } = await loadOperatorCalendar(username);
    return setClassStatus(displayName, data.id, data.status);
  });

/**
 * Fixes the class/teacher a synced calendar event resolved to. The correction
 * is stored as an alias so future syncs match the same title automatically.
 */
export const correctMyClassMatch = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; classId: string; teacherId?: string | null }) => {
    if (!data || typeof data.id !== "string" || typeof data.classId !== "string") {
      throw new Error("Invalid input");
    }
    return {
      id: data.id,
      classId: data.classId,
      teacherId: typeof data.teacherId === "string" && data.teacherId ? data.teacherId : null,
    };
  })
  .handler(async ({ data }): Promise<CalendarClassRow & { alias_saved: boolean }> => {
    const { username } = await requireOperator();
    const { loadOperatorCalendar, correctClassMapping } = await import("./gcal.server");
    const { displayName } = await loadOperatorCalendar(username);
    return correctClassMapping(displayName, data.id, data.classId, data.teacherId);
  });




/*
 * `backfillClassMatches` was removed in Operation 6. It re-applied Google title
 * matching to stored calendar_classes rows, which is no longer the authority:
 * DMC validity is decided solely by the stored DMC Live Timetable during sync.
 */

/** Green/red status for the operator's calendar link (independent of sync). */
export const checkMyCalendarHealth = createServerFn({ method: "GET" }).handler(
  async (): Promise<import("./gcal.server").CalendarHealth> => {
    const { username } = await requireOperator();
    const { checkOperatorCalendar } = await import("./gcal.server");
    return checkOperatorCalendar(username);
  },
);

/* ───────── Operator calendar: shift overview class management ───────── */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function normTime(v: unknown): string {
  const s = String(v ?? "").slice(0, 8);
  if (!TIME_RE.test(s)) throw new Error("Invalid time");
  return s.length === 5 ? `${s}:00` : s;
}

function normDate(v: unknown): string {
  const s = String(v ?? "");
  if (!DATE_RE.test(s)) throw new Error("Invalid date");
  return s;
}

/** Classes contained in one scheduled shift (same rows as the dashboard). */
export const listMyShiftClasses = createServerFn({ method: "GET" })
  .inputValidator((data: { shiftId: string }) => {
    if (!data?.shiftId) throw new Error("shiftId required");
    return { shiftId: String(data.shiftId) };
  })
  .handler(async ({ data }): Promise<CalendarClassRow[]> => {
    const { username } = await requireOperator();
    const { loadOperatorCalendar, listClassesForShift } = await import("./gcal.server");
    const { displayName } = await loadOperatorCalendar(username);
    return listClassesForShift(displayName, data.shiftId);
  });

export const addMyShiftClass = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      shiftId: string;
      className: string;
      teacherName?: string;
      specificDate: string;
      startTime: string;
      endTime: string;
    }) => {
      if (!data?.shiftId) throw new Error("shiftId required");
      const className = String(data.className ?? "").trim().slice(0, 200);
      if (!className) throw new Error("Class name is required");
      return {
        shiftId: String(data.shiftId),
        className,
        teacherName: String(data.teacherName ?? "").trim().slice(0, 200),
        specificDate: normDate(data.specificDate),
        startTime: normTime(data.startTime),
        endTime: normTime(data.endTime),
      };
    },
  )
  .handler(async ({ data }): Promise<CalendarClassRow> => {
    const { username } = await requireOperator();
    const { loadOperatorCalendar, addClassToShift } = await import("./gcal.server");
    const { displayName } = await loadOperatorCalendar(username);
    const { shiftId, ...input } = data;
    return addClassToShift(displayName, shiftId, input);
  });

export const updateMyShiftClass = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id: string;
      className?: string;
      teacherName?: string;
      specificDate?: string;
      startTime?: string;
      endTime?: string;
    }) => {
      if (!data?.id) throw new Error("id required");
      const patch: {
        className?: string;
        teacherName?: string;
        specificDate?: string;
        startTime?: string;
        endTime?: string;
      } = {};
      if (data.className !== undefined) {
        const c = String(data.className).trim().slice(0, 200);
        if (!c) throw new Error("Class name is required");
        patch.className = c;
      }
      if (data.teacherName !== undefined) {
        patch.teacherName = String(data.teacherName).trim().slice(0, 200);
      }
      if (data.specificDate !== undefined) patch.specificDate = normDate(data.specificDate);
      if (data.startTime !== undefined) patch.startTime = normTime(data.startTime);
      if (data.endTime !== undefined) patch.endTime = normTime(data.endTime);
      return { id: String(data.id), patch };
    },
  )
  .handler(async ({ data }): Promise<CalendarClassRow> => {
    const { username } = await requireOperator();
    const { loadOperatorCalendar, updateShiftClass } = await import("./gcal.server");
    const { displayName } = await loadOperatorCalendar(username);
    return updateShiftClass(displayName, data.id, data.patch);
  });

export const removeMyShiftClass = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => {
    if (!data?.id) throw new Error("id required");
    return { id: String(data.id) };
  })
  .handler(async ({ data }) => {
    const { username } = await requireOperator();
    const { loadOperatorCalendar, removeShiftClass } = await import("./gcal.server");
    const { displayName } = await loadOperatorCalendar(username);
    await removeShiftClass(displayName, data.id);
    return { ok: true as const };
  });
