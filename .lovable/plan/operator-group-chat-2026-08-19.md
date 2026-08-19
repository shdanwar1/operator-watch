# Operator Group Chat

A minimal shared chat for enabled operators, added as an isolated new page. No other feature changes.

## How it fits the existing app

This app does not use Supabase user accounts. Identity comes from the signed cookie session (site password + operator PIN), and all database access goes through server functions using the privileged server client. Chat follows exactly that pattern:

- The chat table is not readable or writable by the browser at all.
- Reading history and sending messages happen in server functions that resolve the operator from the session and verify the operator is still enabled.
- The browser never sends who it is; the server inserts `operator_id` itself.

## Real-time without exposing the table

Because the browser is anonymous to the database, exposing the chat table to realtime would make it publicly readable. Instead:

- A database trigger on insert sends a lightweight signal (no message text) on a Realtime broadcast topic whose name is a private token stored in app settings.
- A server function hands that topic name only to a signed-in, enabled operator.
- On a signal, the client fetches only messages newer than the last one it holds, through the same protected server function.

Result: instant updates, no polling, and message content never leaves the protected path.

## Database (one migration)

- `operator_chat_messages`: `id`, `operator_id` (references operators), `message_text`, `created_at`.
- `CHECK (char_length(trim(message_text)) between 1 and 256)`.
- Index on `created_at`.
- RLS enabled, no policies, no grants to `anon`/`authenticated`; `service_role` only — same lockdown as the other operator tables.
- Trigger `notify_operator_chat` calling `realtime.send` on the private topic.
- A `chat_realtime_topic` random value stored in `app_settings`.
- Retention: a daily `pg_cron` job (alongside the existing push-deliveries cleanup) deleting rows older than one month.

## Files to create

- `src/lib/chat.functions.ts` — `getChatBootstrap` (topic + last month of messages), `fetchChatSince(afterIso)`, `sendChatMessage(text)`. Each resolves the operator from the session, rejects unknown or disabled operators, trims and enforces 1–256 characters, and returns sender display names from the operators table.
- `src/routes/chat.tsx` — the page: heading "Chat", scrollable message list (oldest → newest), composer at the bottom.

## Files to change

- `src/components/AppShell.tsx` — add "Chat" to the operator sidebar and mobile tab bar (admin navigation untouched).

## Page behaviour

- One month of history loads on open, scrolled to the newest message.
- Grouped by sender: name, plain text message, `HH:mm`. Own messages subtly differentiated. Plain text rendering only.
- Composer: textarea with placeholder "Write a message...", hard `maxLength` 256 (pasted text is silently truncated), no counter, Send disabled on empty/whitespace. Enter sends, Shift+Enter adds a line.
- New message while scrolled up: a small "New messages" pill instead of forcing a scroll.
- Send failure keeps the typed text and shows a short inline error; load failure shows an error, never a fake empty chat.
- Realtime reconnect refetches anything missed; deduplication by message id.
- Mobile: composer stays reachable above the tab bar, messages wrap, no horizontal scroll.
