/** Browser-safe chat constants and types (no server imports). */
export const CHAT_MAX_CHARS = 256;

export type ChatMessage = {
  id: string;
  operator_id: string;
  sender: string;
  text: string;
  created_at: string;
};
