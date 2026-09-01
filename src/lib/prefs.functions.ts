import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { coercePresets, type StudioPreset } from "@/lib/studio-presets";

/**
 * Per-operator preferences. These live on the operator row so they follow the
 * person across devices instead of sitting in one browser's localStorage.
 */

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
  const username = session.data.username ?? "";
  if (!session.data.siteUnlocked || !username) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return { username };
}

export type OperatorPrefs = {
  /** Sync Google Calendar automatically in the background. */
  autoSync: boolean;
  /** Extend the sync window to cover next month as well. */
  syncNextMonth: boolean;
  /** Browser reminder when it is time to leave home. */
  notifyTimeToLeave: boolean;
  /** Browser reminder shortly before the shift starts. */
  notifyShiftStart: boolean;
  /** Show the "Time to leave" card on the dashboard. */
  showTimeToLeave: boolean;
  /** Operator-specific saved Studio Display presets. */
  studioPresets: StudioPreset[];
};

export const DEFAULT_PREFS: OperatorPrefs = {
  autoSync: true,
  syncNextMonth: false,
  notifyTimeToLeave: true,
  notifyShiftStart: true,
  showTimeToLeave: true,
  studioPresets: [],
};

function coerce(value: unknown): OperatorPrefs {
  const v = (value ?? {}) as Partial<Record<keyof OperatorPrefs, unknown>>;
  type BoolKey = {
    [K in keyof OperatorPrefs]: OperatorPrefs[K] extends boolean ? K : never;
  }[keyof OperatorPrefs];
  const pick = (k: BoolKey): boolean =>
    v[k] === undefined ? (DEFAULT_PREFS[k] as boolean) : Boolean(v[k]);
  return {
    autoSync: pick("autoSync"),
    syncNextMonth: pick("syncNextMonth"),
    notifyTimeToLeave: pick("notifyTimeToLeave"),
    notifyShiftStart: pick("notifyShiftStart"),
    showTimeToLeave: pick("showTimeToLeave"),
    studioPresets: coercePresets(v.studioPresets),
  };
}

export const getMyPrefs = createServerFn({ method: "GET" }).handler(
  async (): Promise<OperatorPrefs> => {
    const { username } = await requireOperator();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("operators")
      .select("prefs")
      .ilike("username", username)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return coerce((data as { prefs?: unknown } | null)?.prefs);
  },
);

export const setMyPrefs = createServerFn({ method: "POST" })
  .inputValidator((data: Partial<OperatorPrefs>) => coerce(data))
  .handler(async ({ data }): Promise<OperatorPrefs> => {
    const { username } = await requireOperator();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("operators")
      .update({ prefs: data } as never)
      .ilike("username", username);
    if (error) throw new Error(error.message);
    return data;
  });
