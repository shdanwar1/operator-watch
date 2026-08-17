import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

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

/**
 * Records usage of directory names. The increment happens inside the database
 * (`bump_directory_usage`) so two concurrent recordings can't overwrite each
 * other's count, and missing names are created in the same statement.
 */
async function bump(table: "teachers" | "classes", names: string[]) {
  if (names.length === 0) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.rpc("bump_directory_usage", {
    p_table: table,
    p_names: names,
  });
  if (error) throw new Error(error.message);
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

export type DuplicatePair = { a: DirectoryItem; b: DirectoryItem; score: number };

/**
 * Read-only hygiene report: names in `classes`/`teachers` that closely
 * resemble another entry in the same table but aren't identical. It never
 * merges or deletes anything — deciding whether two entries are the same
 * class/person needs a human who knows the studio.
 */
export const findPossibleDuplicates = createServerFn({ method: "GET" }).handler(async () => {
  await requireGate();
  const [classes, teachers] = await Promise.all([listAll("classes"), listAll("teachers")]);
  const { similarity } = await import("./gcal-match");

  function pairs(rows: DirectoryItem[]): DuplicatePair[] {
    const out: DuplicatePair[] = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i]!;
        const b = rows[j]!;
        const score = similarity(a.name, b.name);
        if (score >= 60 && score < 99) out.push({ a, b, score });
      }
    }
    return out.sort((x, y) => y.score - x.score);
  }

  return { classes: pairs(classes), teachers: pairs(teachers) };
});

// ---------- admin management (App Settings → Classes & Teachers) ----------

async function requireAdminGate() {
  const session = await useSession<GateSession>(getSessionConfig());
  if (!session.data.siteUnlocked) throw new Response("Unauthorized", { status: 401 });
  if (!session.data.isAdmin) throw new Response("Admin access required", { status: 403 });
}

function parseTable(v: unknown): "teachers" | "classes" {
  return v === "teachers" ? "teachers" : "classes";
}

export const adminCreateDirectoryItem = createServerFn({ method: "POST" })
  .inputValidator((data: { table: string; name: string }) => ({
    table: parseTable(data?.table),
    name: String(data?.name ?? "").trim().slice(0, 200),
  }))
  .handler(async ({ data }) => {
    await requireAdminGate();
    if (!data.name) throw new Error("Name is required");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from(data.table)
      .insert({ name: data.name } as never);
    if (error) throw new Error(/duplicate/i.test(error.message) ? "That name already exists." : error.message);
    return { ok: true as const };
  });

export const adminRenameDirectoryItem = createServerFn({ method: "POST" })
  .inputValidator((data: { table: string; id: string; name: string }) => ({
    table: parseTable(data?.table),
    id: String(data?.id ?? ""),
    name: String(data?.name ?? "").trim().slice(0, 200),
  }))
  .handler(async ({ data }) => {
    await requireAdminGate();
    if (!data.id || !data.name) throw new Error("Name is required");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from(data.table)
      .update({ name: data.name } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const adminDeleteDirectoryItem = createServerFn({ method: "POST" })
  .inputValidator((data: { table: string; id: string }) => ({
    table: parseTable(data?.table),
    id: String(data?.id ?? ""),
  }))
  .handler(async ({ data }) => {
    await requireAdminGate();
    if (!data.id) throw new Error("id required");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from(data.table).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
