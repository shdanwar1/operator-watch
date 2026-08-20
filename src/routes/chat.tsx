import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getGateStatus } from "@/lib/gate.functions";
import {
  deleteChatMessage,
  fetchChatSince,
  getChatBootstrap,
  sendChatMessage,
} from "@/lib/chat.functions";
import { CHAT_MAX_CHARS, type ChatMessage } from "@/lib/chat-shared";
import { opColor } from "@/lib/admin-utils";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/chat")({
  beforeLoad: async () => {
    const status = await getGateStatus();
    if (!status.unlocked) throw redirect({ to: "/unlock" });
    if (status.isAdmin) throw redirect({ to: "/admin" });
  },
  head: () => ({
    meta: [
      { title: "Chat — DMC Studio Operators" },
      {
        name: "description",
        content: "Private group chat for DMC Studio operators on shift.",
      },
      { property: "og:title", content: "Chat — DMC Studio Operators" },
      {
        property: "og:description",
        content: "Private group chat for DMC Studio operators on shift.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ChatPage,
});

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayOf(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

function merge(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return prev;
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return Array.from(byId.values()).sort((a, b) =>
    a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at < b.created_at ? -1 : 1,
  );
}

function ChatPage() {
  const bootstrap = useServerFn(getChatBootstrap);
  const since = useServerFn(fetchChatSince);
  const send = useServerFn(sendChatMessage);
  const remove = useServerFn(deleteChatMessage);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [hasNew, setHasNew] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ChatMessage | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  const nearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setHasNew(false);
  }, []);

  const pull = useCallback(async () => {
    const last = messagesRef.current.at(-1)?.created_at ?? null;
    const stick = nearBottom();
    try {
      const fresh = await since({ data: { after: last } });
      if (fresh.length === 0) return;
      setMessages((prev) => {
        const next = merge(prev, fresh);
        if (next.length !== prev.length && !stick) setHasNew(true);
        return next;
      });
      if (stick) requestAnimationFrame(() => scrollToBottom(true));
    } catch {
      /* transient — the next signal or reconnect will recover */
    }
  }, [since, scrollToBottom]);

  /** A deletion changes older rows, so the window is re-read in full. */
  const reload = useCallback(async () => {
    try {
      const all = await since({ data: { after: null } });
      setMessages(all);
    } catch {
      /* transient */
    }
  }, [since]);

  // Initial load.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await bootstrap();
        if (!alive) return;
        setMe(data.operatorId);
        setTopic(data.topic);
        setMessages(data.messages);
        setLoaded(true);
        requestAnimationFrame(() => scrollToBottom());
      } catch {
        if (alive) setLoadError("Could not load the conversation.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [bootstrap, scrollToBottom]);

  // Realtime: content-free signals tell us to pull or re-read.
  useEffect(() => {
    if (!topic) return;
    const channel = supabase
      .channel(topic)
      .on("broadcast", { event: "new" }, () => {
        void pull();
      })
      .on("broadcast", { event: "del" }, () => {
        void reload();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void pull();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [topic, pull, reload]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const saved = await send({ data: { text } });
      setDraft("");
      setMessages((prev) => merge(prev, [saved]));
      requestAnimationFrame(() => scrollToBottom(true));
    } catch {
      setSendError("Message not sent. Try again.");
    } finally {
      setSending(false);
    }
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    setMessages((prev) => prev.filter((m) => m.id !== target.id));
    try {
      await remove({ data: { id: target.id } });
    } catch {
      void reload();
    }
  };

  let lastDay = "";
  let lastSender = "";

  return (
    <AppShell>
      <PageHeader title="Chat" />

      <div className="flex h-[calc(100vh-14rem)] min-h-[420px] flex-col rounded-2xl border border-border bg-card max-lg:h-[calc(100vh-16rem)]">
        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} className="h-full overflow-y-auto overflow-x-hidden px-3 py-4 sm:px-4">
            {loadError ? (
              <p className="py-8 text-center text-[13px] text-destructive">{loadError}</p>
            ) : !loaded ? (
              <p className="py-8 text-center text-[13px] text-muted-foreground">Loading…</p>
            ) : messages.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-[13px] font-medium">No messages yet</p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Start the conversation with the team.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {messages.map((m) => {
                  const day = dayOf(m.created_at);
                  const showDay = day !== lastDay;
                  if (showDay) lastSender = "";
                  lastDay = day;
                  const mine = m.operator_id === me;
                  const grouped = lastSender === m.operator_id;
                  lastSender = m.operator_id;
                  const c = opColor(m.sender);

                  return (
                    <div key={m.id}>
                      {showDay && (
                        <p className="py-3 text-center text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
                          {day}
                        </p>
                      )}
                      <div
                        className={cn(
                          "group flex flex-col",
                          grouped ? "mt-0.5" : "mt-3",
                          mine ? "items-end" : "items-start",
                        )}
                      >
                        {!grouped && (
                          <p
                            className={cn(
                              "mb-1 px-1 text-[11px] font-semibold",
                              c?.text ?? "text-muted-foreground",
                            )}
                          >
                            {m.sender}
                          </p>
                        )}
                        <div
                          className={cn(
                            "flex items-center gap-1",
                            mine && "flex-row-reverse",
                          )}
                        >
                          <div
                            className={cn(
                              "max-w-[85%] rounded-2xl border px-3 py-1.5 sm:max-w-[65%]",
                              c ? `${c.bg} ${c.border}` : "border-border bg-muted/40",
                            )}
                          >
                            <p className="whitespace-pre-wrap break-words text-[14px] leading-snug">
                              {m.text}
                            </p>
                            <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
                              {timeOf(m.created_at)}
                            </p>
                          </div>

                          {mine && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  aria-label="Message options"
                                  className="rounded-full p-1 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 max-lg:opacity-60"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align={mine ? "end" : "start"}>
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onSelect={() => setPendingDelete(m)}
                                >
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {hasNew && (
            <button
              type="button"
              onClick={() => scrollToBottom(true)}
              className="press absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background px-3 py-1.5 text-[12px] shadow-sm"
            >
              New messages
            </button>
          )}
        </div>

        <div className="border-t border-border p-3">
          {sendError && <p className="mb-2 text-[12px] text-destructive">{sendError}</p>}
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              maxLength={CHAT_MAX_CHARS}
              onChange={(e) => setDraft(e.target.value.slice(0, CHAT_MAX_CHARS))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="Write a message..."
              rows={1}
              className="max-h-32 min-h-[40px] resize-none text-[14px]"
            />
            <Button onClick={() => void submit()} disabled={!draft.trim() || sending}>
              Send
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent className="max-w-xs">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[15px]">Delete this message?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmDelete()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
