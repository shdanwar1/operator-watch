import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import type { ShiftChecklists } from "@/domain/checklists";

type GateSession = { siteUnlocked?: boolean; username?: string; isAdmin?: boolean };

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
  if (!session.data.siteUnlocked) throw new Response("Unauthorized", { status: 401 });
  const username = session.data.username ?? null;
  if (!username || session.data.isAdmin) throw new Response("Forbidden", { status: 403 });
  return username;
}

/** Toggle one checklist item on the operator's own open shift. */
export const setMyChecklistItem = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      shiftId: string;
      section: "start" | "end" | "class";
      classId?: string | null;
      itemId: string;
      completed: boolean;
    }) => {
      const shiftId = String(data?.shiftId ?? "");
      const itemId = String(data?.itemId ?? "");
      if (!shiftId || shiftId.length > 64) throw new Error("Invalid shiftId");
      if (!itemId || itemId.length > 64) throw new Error("Invalid itemId");
      const section = data?.section;
      if (section !== "start" && section !== "end" && section !== "class") {
        throw new Error("Invalid section");
      }
      const classId = data.classId ? String(data.classId) : null;
      if (section === "class" && !classId) throw new Error("classId required");
      return { shiftId, section, classId, itemId, completed: Boolean(data?.completed) };
    },
  )
  .handler(async ({ data }): Promise<ShiftChecklists> => {
    const operator = await requireOperator();
    const { setChecklistItem } = await import("./checklists.server");
    return setChecklistItem({ ...data, operator });
  });
