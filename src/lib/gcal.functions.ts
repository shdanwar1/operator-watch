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
