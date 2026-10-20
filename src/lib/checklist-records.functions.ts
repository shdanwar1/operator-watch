import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { z } from "zod";
import {
  assertChecklistAdmin,
  checklistDateBounds,
  type ChecklistRecord,
} from "./checklist-records";
import { isShiftChecklists } from "@/domain/checklists";
import {
  scoreOperators,
  type OperatorScore,
  type ScorePeriod,
  type ScoreShiftInput,
} from "@/domain/checklist-scoring";

const gateSession = async () => {
  const password = process.env["SESSION_SECRET"];
  if (!password) throw new Error("SESSION_SECRET is not set");
  const session = await useSession<{
    siteUnlocked?: boolean;
    username?: string;
    isAdmin?: boolean;
  }>({
    password,
    name: "site-gate",
    maxAge: 60 * 60 * 24 * 30,
    cookie: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
  });
  assertChecklistAdmin(session.data);
};

const toRecord = (row: {
  id: string;
  operator_name: string;
  check_in_at: string;
  check_out_at: string | null;
  checklists: unknown;
}): ChecklistRecord => ({
  ...row,
  checklists: isShiftChecklists(row.checklists) ? row.checklists : null,
});

/** Single date-bounded read; all expanded details come from these historical snapshots. */
export const adminListChecklistRecords = createServerFn({ method: "GET" })
  .inputValidator((data: { date: string }) => z.object({ date: z.string() }).parse(data))
  .handler(async ({ data }): Promise<ChecklistRecord[]> => {
    await gateSession();
    const { from, to } = checklistDateBounds(data.date);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("shifts")
      .select("id, operator_name, check_in_at, check_out_at, checklists")
      .gte("check_in_at", from)
      .lt("check_in_at", to)
      .order("check_in_at");
    if (error) throw new Error("Could not load checklist records");
    return (rows ?? []).map(toRecord);
  });

/** Drill-down: one operator's shifts inside a scorecard period, newest first. */
export const adminOperatorChecklistRecords = createServerFn({ method: "GET" })
  .inputValidator((data: { period: ScorePeriod; operator: string }) =>
    z
      .object({ period: z.enum(["30d", "all"]), operator: z.string().min(1).max(120) })
      .parse(data),
  )
  .handler(async ({ data }): Promise<ChecklistRecord[]> => {
    await gateSession();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let query = supabaseAdmin
      .from("shifts")
      .select("id, operator_name, check_in_at, check_out_at, checklists")
      .eq("operator_name", data.operator)
      .not("check_out_at", "is", null)
      .order("check_in_at", { ascending: false })
      .limit(100);
    if (data.period === "30d") {
      query = query.gte("check_in_at", checklistScoresFrom());
    }
    const { data: rows, error } = await query;
    if (error) throw new Error("Could not load checklist records");
    return (rows ?? []).map(toRecord);
  });

/** Berlin midnight 29 days ago: the inclusive start of the "Last 30 days" window. */
function checklistScoresFrom(now: Date = new Date()): string {
  const today = now.toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
  const anchor = new Date(`${today}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() - 29);
  return checklistDateBounds(anchor.toISOString().slice(0, 10)).from;
}

const SCORE_PAGE = 500;

/** Per-operator completeness / punctuality aggregates over closed shifts. */
export const adminChecklistScores = createServerFn({ method: "GET" })
  .inputValidator((data: { period: ScorePeriod }) =>
    z.object({ period: z.enum(["30d", "all"]) }).parse(data),
  )
  .handler(async ({ data }): Promise<OperatorScore[]> => {
    await gateSession();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const shifts: ScoreShiftInput[] = [];
    for (let from = 0; ; from += SCORE_PAGE) {
      let query = supabaseAdmin
        .from("shifts")
        .select("operator_name, check_in_at, check_out_at, checklists")
        .not("check_out_at", "is", null)
        .order("check_in_at", { ascending: false })
        .range(from, from + SCORE_PAGE - 1);
      if (data.period === "30d") {
        query = query.gte("check_in_at", checklistScoresFrom());
      }
      const { data: rows, error } = await query;
      if (error) throw new Error("Could not load checklist scores");
      for (const row of rows ?? []) {
        shifts.push({
          operator_name: row.operator_name,
          check_in_at: row.check_in_at,
          check_out_at: row.check_out_at,
          checklists: isShiftChecklists(row.checklists) ? row.checklists : null,
        });
      }
      if (!rows || rows.length < SCORE_PAGE) break;
    }
    return scoreOperators(shifts);
  });
