import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import type { TimecodeState } from "./timecode";

type GateSession = { siteUnlocked?: boolean; username?: string; isAdmin?: boolean };

async function requireOperator() {
  const password = process.env.SESSION_SECRET;
  if (!password) throw new Error("SESSION_SECRET is not set");
  const session = await useSession<GateSession>({
    password,
    name: "site-gate",
    maxAge: 60 * 60 * 24 * 30,
    cookie: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" },
  });
  if (!session.data.siteUnlocked) throw new Response("Unauthorized", { status: 401 });
  const username = session.data.username ?? null;
  if (!username || session.data.isAdmin) throw new Response("Forbidden", { status: 403 });
  return username;
}

const id = (v: unknown) => {
  const s = String(v ?? "");
  if (!s || s.length > 128) throw new Error("Invalid classId");
  return s;
};

export const getClassTimecode = createServerFn({ method: "POST" })
  .inputValidator((d: { classId: string }) => ({ classId: id(d?.classId) }))
  .handler(async ({ data }): Promise<TimecodeState | null> => {
    await requireOperator();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("class_timecodes")
      .select("state")
      .eq("class_id", data.classId)
      .maybeSingle();
    if (error) throw new Error("Could not load timecode");
    return (row?.state as TimecodeState | undefined) ?? null;
  });

export const saveClassTimecode = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      classId: string;
      className?: string;
      teacherName?: string;
      date?: string;
      state: TimecodeState;
    }) => {
      const s = d?.state;
      if (!s || !Array.isArray(s.markers) || s.markers.length > 2000) throw new Error("Invalid state");
      const date = d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : null;
      return {
        classId: id(d.classId),
        className: String(d.className ?? "").slice(0, 200),
        teacherName: String(d.teacherName ?? "").slice(0, 200),
        date,
        state: {
          runningSince: typeof s.runningSince === "number" ? s.runningSince : null,
          elapsedMs: Number(s.elapsedMs) || 0,
          markers: s.markers.map((m) => ({
            id: String(m.id).slice(0, 64),
            frames: Math.max(0, Math.floor(Number(m.frames) || 0)),
            kind: m.kind,
            note: String(m.note ?? "").slice(0, 500),
          })),
        } as TimecodeState,
      };
    },
  )
  .handler(async ({ data }) => {
    const operator = await requireOperator();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("class_timecodes").upsert({
      class_id: data.classId,
      operator,
      class_name: data.className || null,
      teacher_name: data.teacherName || null,
      class_date: data.date,
      state: data.state as never,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error("Could not save timecode");
    return { ok: true };
  });
