import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_STUDIO_DISPLAY_STATE,
  STUDIO_DISPLAY_CHANNEL,
  STUDIO_DISPLAY_KEY,
  readStudioDisplayState,
  writeStudioDisplayState,
  type StudioDisplayState,
} from "@/lib/studio-display";

type Msg =
  | { type: "state"; state: StudioDisplayState }
  | { type: "request" };

export function useStudioDisplay(role: "control" | "display") {
  const [state, setState] = useState<StudioDisplayState>(DEFAULT_STUDIO_DISPLAY_STATE);
  const [ready, setReady] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    setState(readStudioDisplayState());
    setReady(true);
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(STUDIO_DISPLAY_CHANNEL);
    channelRef.current = ch;
    ch.onmessage = (ev: MessageEvent<Msg>) => {
      const msg = ev.data;
      if (!msg) return;
      if (msg.type === "state") {
        setState(msg.state);
        writeStudioDisplayState(msg.state);
      } else if (msg.type === "request" && role === "control") {
        const current = readStudioDisplayState();
        ch.postMessage({ type: "state", state: current } satisfies Msg);
      }
    };
    if (role === "display") {
      ch.postMessage({ type: "request" } satisfies Msg);
    }
    // Cross-tab fallback via storage event
    const onStorage = (e: StorageEvent) => {
      if (e.key === STUDIO_DISPLAY_KEY && e.newValue) {
        try {
          setState(JSON.parse(e.newValue));
        } catch { /* ignore */ }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      ch.close();
      channelRef.current = null;
      window.removeEventListener("storage", onStorage);
    };
  }, [role]);

  const update = useCallback((patch: Partial<StudioDisplayState>) => {
    setState((prev) => {
      const next: StudioDisplayState = { ...prev, ...patch, updatedAt: Date.now() };
      writeStudioDisplayState(next);
      channelRef.current?.postMessage({ type: "state", state: next } satisfies Msg);
      return next;
    });
  }, []);

  return { state, update, ready };
}
