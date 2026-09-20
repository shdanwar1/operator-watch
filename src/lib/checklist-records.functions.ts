import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { z } from "zod";
import {
  assertChecklistAdmin,
  checklistDateBounds,
  type ChecklistRecord,
} from "./checklist-records";
import { isShiftChecklists } from "@/domain/checklists";

/** Single date-bounded read; all expanded details come from these historical snapshots. */
export const adminListChecklistRecords = createServerFn({ method: "GET" })
  .inputValidator((data: { date: string }) => z.object({ date: z.string() }).parse(data))
  .handler(async ({ data }): Promise<ChecklistRecord[]> => {
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
    const { from, to } = checklistDateBounds(data.date);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("shifts")
      .select("id, operator_name, check_in_at, check_out_at, checklists")
      .gte("check_in_at", from)
      .lt("check_in_at", to)
      .order("check_in_at");
    if (error) throw new Error("Could not load checklist records");
    return (rows ?? []).map((row) => ({
      ...row,
      checklists: isShiftChecklists(row.checklists) ? row.checklists : null,
    }));
  });
