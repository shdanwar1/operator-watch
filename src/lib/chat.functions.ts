import { createServerFn } from "@tanstack/react-start";
import type { ChatMessage } from "./chat-shared";

/** Thin RPC wrappers; all logic lives in chat.server.ts (server-only). */

export const getChatBootstrap = createServerFn({ method: "GET" }).handler(async () => {
  const { bootstrapChat } = await import("./chat.server");
  return bootstrapChat();
});

export const fetchChatSince = createServerFn({ method: "POST" })
  .inputValidator((data: { after?: string | null }) => ({
    after: typeof data?.after === "string" ? data.after : null,
  }))
  .handler(async ({ data }): Promise<ChatMessage[]> => {
    const { chatSince } = await import("./chat.server");
    return chatSince(data.after);
  });

export const sendChatMessage = createServerFn({ method: "POST" })
  .inputValidator((data: { text: string }) => ({ text: String(data?.text ?? "") }))
  .handler(async ({ data }): Promise<ChatMessage> => {
    const { postChatMessage } = await import("./chat.server");
    return postChatMessage(data.text);
  });
