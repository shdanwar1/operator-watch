/**
 * Read-only DMC directory for record entry (Operation 8).
 *
 * Records reference `dmc_classes` / `dmc_instructors` directly, so the pickers
 * choose from this list instead of typing free text.
 */
import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import type { DmcOption } from "@/domain/dmc-directory";

export type { DmcOption };

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

async function requireGate() {
  const session = await useSession<GateSession>(getSessionConfig());
  if (!session.data.siteUnlocked) throw new Response("Unauthorized", { status: 401 });
}

export const listDmcDirectory = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ classes: DmcOption[]; instructors: DmcOption[] }> => {
    await requireGate();
    const { loadDmcDirectory } = await import("@/domain/dmc-directory.server");
    return loadDmcDirectory();
  },
);
