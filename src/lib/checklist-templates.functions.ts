/**
 * Master checklist template administration (Operation 4).
 *
 * Reads and writes `app_settings.operator_checklists` ONLY. Historical
 * snapshots in `shifts.checklists` are never touched here.
 */
import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import type { ChecklistConfig, ChecklistType } from "@/domain/checklists";
import { validateChecklistTemplate } from "@/domain/checklist-editor";

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
  if (!session.data.siteUnlocked) throw new Response("Unauthorized", { status: 401 });
  if (!session.data.isAdmin) throw new Response("Admin access required", { status: 403 });
}

/** Current master templates (admin only). */
export const adminGetChecklistTemplates = createServerFn({ method: "POST" }).handler(
  async (): Promise<ChecklistConfig> => {
    await requireAdmin();
    const { readChecklistConfig } = await import("./checklists.server");
    return readChecklistConfig();
  },
);

/** Replace exactly one master template. Other templates stay untouched. */
export const adminUpdateChecklistTemplate = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      type: ChecklistType;
      title: string;
      items: { id: string; text: string; heading?: string | null }[];
    }) => validateChecklistTemplate(data?.type, { title: data?.title, items: data?.items }),
  )
  .handler(async ({ data }): Promise<ChecklistConfig> => {
    await requireAdmin();
    const { readChecklistConfig } = await import("./checklists.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const current = await readChecklistConfig();
    const next: ChecklistConfig = { ...current, [data.type]: data.template };
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: "operator_checklists", value: next } as never, { onConflict: "key" });
    if (error) throw new Error(error.message);
    return next;
  });
