import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

type GateSession = { siteUnlocked?: boolean; username?: string; isAdmin?: boolean };

function getGateConfig() {
  const password = process.env.SESSION_SECRET;
  if (!password) throw new Error("SESSION_SECRET is not set");
  return {
    password,
    name: "site-gate",
    maxAge: 60 * 60 * 24 * 30,
    cookie: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" },
  };
}

export type TimeToLeaveResult =
  | {
      ok: true;
      shift_start_iso: string;
      leave_iso: string;
      travel_minutes: number;
      source: "live" | "cached" | "fallback";
    }
  | { ok: false; reason: "no_home" | "no_session" | "no_operator" | "unavailable" };

export const getTimeToLeave = createServerFn({ method: "POST" })
  .inputValidator((data: { shift_start_iso: string }) => {
    const iso = String(data?.shift_start_iso ?? "");
    if (!iso || Number.isNaN(Date.parse(iso))) {
      throw new Error("shift_start_iso must be an ISO datetime string");
    }
    return { shift_start_iso: iso };
  })
  .handler(async ({ data }): Promise<TimeToLeaveResult> => {
    const session = await useSession<GateSession>(getGateConfig());
    if (!session.data.siteUnlocked || !session.data.username) {
      return { ok: false, reason: "no_session" };
    }
    try {
      const { resolveTimeToLeave } = await import("./time-to-leave.server");
      return await resolveTimeToLeave(
        { username: session.data.username },
        new Date(data.shift_start_iso),
      );
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  });
