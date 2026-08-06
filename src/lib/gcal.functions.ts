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

export const syncGoogleCalendar = createServerFn({ method: "POST" })
  .inputValidator((data?: { includeNextMonth?: boolean }) => ({
    includeNextMonth: data?.includeNextMonth === true,
  }))
  .handler(async ({ data }): Promise<GcalSyncResult> => {
    const { username } = await requireOperator();
    const { runCalendarSync } = await import("./gcal.server");
    return runCalendarSync(username, { includeNextMonth: data.includeNextMonth });
  });

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
  .handler(async ({ data }): Promise<CalendarClassRow> => {
    const { username } = await requireOperator();
    const { loadOperatorCalendar, correctClassMapping } = await import("./gcal.server");
    const { displayName } = await loadOperatorCalendar(username);
    return correctClassMapping(displayName, data.id, data.classId, data.teacherId);
  });


async function requireAdmin() {
  const session = await useSession<GateSession>(getSessionConfig());
  if (!session.data.siteUnlocked || !session.data.isAdmin) {
    throw new Response("Admin access required", { status: 403 });
  }
}

export type BackfillResult = { scanned: number; updated: number; unchanged: number };

/**
 * Re-runs the current class/teacher matching logic against every existing
 * calendar_classes row (all operators) and patches class_id / teacher_id /
 * class_name / teacher_name wherever the matcher now resolves the raw_title
 * differently than what's stored. Only those four classification columns are
 * touched — status, scheduling, and raw_title are never modified. Safe to
 * run repeatedly; rows that already match the current logic are skipped.
 */
export const backfillClassMatches = createServerFn({ method: "POST" }).handler(
  async (): Promise<BackfillResult> => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { matchEvent } = await import("./gcal-match");

    const [{ data: classRows }, { data: teacherRows }, { data: aliasRows }] = await Promise.all([
      supabaseAdmin.from("classes").select("id,name").limit(2000),
      supabaseAdmin.from("teachers").select("id,name").limit(2000),
      supabaseAdmin.from("class_aliases").select("alias_key,class_id,teacher_id").limit(5000),
    ]);
    const classDir = (classRows ?? []) as { id: string; name: string }[];
    const teacherDir = (teacherRows ?? []) as { id: string; name: string }[];
    const aliases = (aliasRows ?? []).map((a) => ({
      aliasKey: a.alias_key as string,
      classId: (a.class_id ?? null) as string | null,
      teacherId: (a.teacher_id ?? null) as string | null,
    }));

    let scanned = 0;
    let updated = 0;
    const pageSize = 500;

    for (let from = 0; ; from += pageSize) {
      const { data: rows, error } = await supabaseAdmin
        .from("calendar_classes")
        .select("id,raw_title,class_id,teacher_id,class_name,teacher_name")
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) break;

      const patches: {
        id: string;
        class_id: string | null;
        teacher_id: string | null;
        class_name: string;
        teacher_name: string;
      }[] = [];

      for (const row of rows) {
        scanned++;
        const { result } = matchEvent(row.raw_title ?? "", classDir, teacherDir, aliases);
        const className = result.className ?? result.fallbackClassName;
        const teacherName = result.teacherName ?? result.fallbackTeacherName;
        const changed =
          className !== row.class_name ||
          teacherName !== row.teacher_name ||
          result.classId !== row.class_id ||
          result.teacherId !== row.teacher_id;
        if (changed) {
          patches.push({
            id: row.id as string,
            class_id: result.classId,
            teacher_id: result.teacherId,
            class_name: className,
            teacher_name: teacherName,
          });
        }
      }

      for (const p of patches) {
        const { error: updErr } = await supabaseAdmin
          .from("calendar_classes")
          .update({
            class_id: p.class_id,
            teacher_id: p.teacher_id,
            class_name: p.class_name,
            teacher_name: p.teacher_name,
          })
          .eq("id", p.id);
        if (updErr) throw new Error(updErr.message);
      }
      updated += patches.length;

      if (rows.length < pageSize) break;
    }

    return { scanned, updated, unchanged: scanned - updated };
  },
);
