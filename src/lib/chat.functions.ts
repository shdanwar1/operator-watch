import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

/**
 * Operator group chat.
 *
 * The browser is anonymous to the database in this app, so the chat table is
 * service-role only and every read/write goes through these session-verified
 * server functions. The client never states who it is.
 */

type GateSession = { siteUnlocked?: boolean; username?: string; isAdmin?: boolean };

import { CHAT_MAX_CHARS, type ChatMessage } from "./chat-shared";
const HISTORY = "1 month";

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

/** Resolve the signed-in operator and confirm they are still enabled. */
async function requireEnabledOperator() {
  const session = await useSession<GateSession>(getSessionConfig());
  const username = session.data.username ?? "";
  if (!session.data.siteUnlocked || !username) {
    throw new Response("Unauthorized", { status: 401 });
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("operators")
    .select("id, username, is_active")
    .ilike("username", username)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { id: string; username: string; is_active: boolean } | null;
  if (!row || row.is_active === false) {
    throw new Response("Forbidden", { status: 403 });
  }
  return { id: row.id, username: row.username, supabaseAdmin };
}

function monthAgoIso() {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

type Admin = Awaited<ReturnType<typeof requireEnabledOperator>>["supabaseAdmin"];

async function readMessages(supabaseAdmin: Admin, sinceIso: string): Promise<ChatMessage[]> {
  const { data, error } = await supabaseAdmin
    .from("operator_chat_messages")
    .select("id, operator_id, message_text, created_at")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as {
    id: string;
    operator_id: string;
    message_text: string;
    created_at: string;
  }[];
  if (rows.length === 0) return [];

  const ids = Array.from(new Set(rows.map((r) => r.operator_id)));
  const { data: ops } = await supabaseAdmin
    .from("operators")
    .select("id, username")
    .in("id", ids);
  const names = new Map(
    ((ops ?? []) as { id: string; username: string }[]).map((o) => [o.id, o.username]),
  );

  return rows.map((r) => ({
    id: r.id,
    operator_id: r.operator_id,
    sender: names.get(r.operator_id) ?? "Operator",
    text: r.message_text,
    created_at: r.created_at,
  }));
}

/** Initial load: identity, realtime topic, and the last month of history. */
export const getChatBootstrap = createServerFn({ method: "GET" }).handler(async () => {
  const { id, username, supabaseAdmin } = await requireEnabledOperator();
  const { data: setting } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "chat_realtime_topic")
    .maybeSingle();
  const topic =
    ((setting as { value?: { topic?: string } } | null)?.value?.topic as string | undefined) ??
    null;
  const messages = await readMessages(supabaseAdmin, monthAgoIso());
  return { operatorId: id, username, topic, messages, historyWindow: HISTORY };
});

/** Incremental fetch used on realtime signals and after a reconnect. */
export const fetchChatSince = createServerFn({ method: "POST" })
  .inputValidator((data: { after?: string | null }) => ({
    after: typeof data?.after === "string" ? data.after : null,
  }))
  .handler(async ({ data }): Promise<ChatMessage[]> => {
    const { supabaseAdmin } = await requireEnabledOperator();
    const floor = monthAgoIso();
    const since = data.after && data.after > floor ? data.after : floor;
    return readMessages(supabaseAdmin, since);
  });

/** Send a message. The sender is taken from the session, never the client. */
export const sendChatMessage = createServerFn({ method: "POST" })
  .inputValidator((data: { text: string }) => ({ text: String(data?.text ?? "") }))
  .handler(async ({ data }): Promise<ChatMessage> => {
    const { id, username, supabaseAdmin } = await requireEnabledOperator();
    const text = data.text.trim().slice(0, CHAT_MAX_CHARS);
    if (!text) throw new Error("Message is empty");

    const { data: row, error } = await supabaseAdmin
      .from("operator_chat_messages")
      .insert({ operator_id: id, message_text: text })
      .select("id, operator_id, message_text, created_at")
      .single();
    if (error) throw new Error(error.message);
    const r = row as {
      id: string;
      operator_id: string;
      message_text: string;
      created_at: string;
    };
    return {
      id: r.id,
      operator_id: r.operator_id,
      sender: username,
      text: r.message_text,
      created_at: r.created_at,
    };
  });
