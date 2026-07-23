import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

type GateSession = { unlocked?: boolean; username?: string; isAdmin?: boolean };

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

export type DirectoryItem = {
  id: string;
  name: string;
  usage_count: number;
  last_used_at: string | null;
};

async function listAll(table: "teachers" | "classes"): Promise<DirectoryItem[]> {
  await requireGate();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from(table)
    .select("id,name,usage_count,last_used_at")
    .order("usage_count", { ascending: false })
    .order("name", { ascending: true })
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []) as DirectoryItem[];
}

export const listTeachers = createServerFn({ method: "GET" }).handler(() => listAll("teachers"));
export const listClasses = createServerFn({ method: "GET" }).handler(() => listAll("classes"));

function sanitizeNames(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const s = String(n ?? "").trim().slice(0, 200);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out.slice(0, 100);
}

async function bump(table: "teachers" | "classes", names: string[]) {
  if (names.length === 0) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const nowIso = new Date().toISOString();
  // Upsert new rows (name unique). ignoreDuplicates so we don't overwrite counts.
  const rows = names.map((name) => ({ name, usage_count: 0, last_used_at: nowIso }));
  await supabaseAdmin.from(table).upsert(rows, { onConflict: "name", ignoreDuplicates: true });
  // Increment usage + last_used_at for each name.
  // Fetch current counts then update (small N).
  const { data: existing } = await supabaseAdmin
    .from(table)
    .select("id,name,usage_count")
    .in("name", names);
  if (!existing) return;
  await Promise.all(
    existing.map((row) => {
      const r = row as { id: string; usage_count: number | null };
      return supabaseAdmin
        .from(table)
        .update({ usage_count: (r.usage_count ?? 0) + 1, last_used_at: nowIso })
        .eq("id", r.id);
    }),
  );
}

export const recordDirectoryUsage = createServerFn({ method: "POST" })
  .inputValidator((data: { teachers?: unknown; classes?: unknown }) => ({
    teachers: sanitizeNames(data?.teachers),
    classes: sanitizeNames(data?.classes),
  }))
  .handler(async ({ data }) => {
    await requireGate();
    await Promise.all([bump("teachers", data.teachers), bump("classes", data.classes)]);
    return { ok: true as const };
  });
