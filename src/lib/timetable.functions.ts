/**
 * Live Timetable server boundary (Operation 5).
 *
 * Admin-only refresh plus a read of the stored timetable. The Admin UI arrives
 * in Operation 6 and will consume these normalized results — it must never call
 * the DMC API itself.
 */
import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import type { DmcTimetableAnomaly } from "@/domain/timetable";
import type { StoredTimetable } from "@/domain/timetable-repository.server";
import type { ClassOccurrence, ShiftAssignmentRow } from "@/domain/timetable-week";

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

async function requireAdmin() {
  const session = await useSession<GateSession>(getSessionConfig());
  if (!session.data.siteUnlocked || !session.data.isAdmin) {
    throw new Response("Admin access required", { status: 403 });
  }
}

export type TimetableRefreshResult =
  | {
      ok: true;
      classes: number;
      instructors: number;
      slots: number;
      removedSlots: number;
      anomalies: DmcTimetableAnomaly[];
      refreshedAt: string;
    }
  | { ok: false; error: string };

/**
 * Fetch → validate → commit. Any failure before the commit leaves the stored
 * timetable exactly as it was.
 */
export const refreshLiveTimetable = createServerFn({ method: "POST" }).handler(
  async (): Promise<TimetableRefreshResult> => {
    await requireAdmin();
    const { dmcPublicTimetableProvider } = await import("@/domain/dmc-timetable-provider.server");
    const result = await dmcPublicTimetableProvider.fetchTimetable();
    if (!result.ok) return { ok: false, error: result.error };

    const { commitSnapshot } = await import("@/domain/timetable-repository.server");
    const committed = await commitSnapshot(result.snapshot);
    return {
      ok: true,
      ...committed,
      anomalies: result.anomalies,
      refreshedAt: result.snapshot.fetchedAt,
    };
  },
);

/** Read-only view of the stored timetable (no external call). */
export const getLiveTimetable = createServerFn({ method: "GET" }).handler(
  async (): Promise<StoredTimetable> => {
    await requireAdmin();
    const { loadStoredTimetable } = await import("@/domain/timetable-repository.server");
    return loadStoredTimetable();
  },
);

export type TimetableMonthBoard = {
  timetable: StoredTimetable;
  /** Operational month, "YYYY-MM". Operator assignments exist only for it. */
  month: string;
  /** Every Berlin date of the current month, YYYY-MM-DD. */
  monthDates: string[];
  occurrences: ClassOccurrence[];
  shifts: ShiftAssignmentRow[];
  classIdBySource: Record<string, string>;
};

/**
 * The whole current Berlin calendar month, loaded once: the stored DMC
 * timetable plus the dated class rows and their shift assignments. The week
 * selector slices this in memory — it never refetches.
 */
export const getTimetableMonthBoard = createServerFn({ method: "GET" }).handler(
  async (): Promise<TimetableMonthBoard> => {
    const session = await useSession<GateSession>(getSessionConfig());
    if (!session.data.siteUnlocked || !session.data.username) {
      throw new Response("Sign in required", { status: 401 });
    }
    const { loadStoredTimetable } = await import("@/domain/timetable-repository.server");
    const { loadWeekOperations } = await import("@/domain/timetable-board.server");
    const { currentBerlinMonth, monthDates } = await import("@/domain/timetable-week");

    const { year, month } = currentBerlinMonth(new Date());
    const dates = monthDates(year, month);
    const [timetable, operations] = await Promise.all([
      loadStoredTimetable(),
      loadWeekOperations(dates[0], dates[dates.length - 1]),
    ]);
    return {
      timetable,
      month: `${year}-${String(month).padStart(2, "0")}`,
      monthDates: dates,
      ...operations,
    };
  },
);
