/**
 * Cross-view data bus.
 *
 * A Google Calendar sync touches data that several independent surfaces
 * render (dashboard, shift overview, calendar, open Studio Display popups).
 * Those surfaces each own their fetching, so after a sync we broadcast a
 * single "data-synced" event and every listener refreshes itself.
 *
 * Studio Display popups are opened with the class baked into the URL, so they
 * additionally receive the refreshed class payload keyed by class id.
 */

export const SYNC_CHANNEL = "studio-data-sync";

export type ClassDisplayPayload = {
  id: string;
  className: string;
  teacherName: string;
  startTime: string; // "HH:MM"
  durationMin: number;
  status: string;
};

export type SyncMessage =
  | { type: "data-synced"; at: number }
  | { type: "class-display"; classes: ClassDisplayPayload[] };

type Envelope = SyncMessage & { __source?: string };

/**
 * Identifies this document. BroadcastChannel delivers a message to every other
 * channel object — including ones created by the *same* page — so without this
 * tag a view would react to its own broadcast and refetch in a loop.
 */
const SOURCE_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export function publishSync(message: SyncMessage) {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  const ch = new BroadcastChannel(SYNC_CHANNEL);
  ch.postMessage({ ...message, __source: SOURCE_ID } satisfies Envelope);
  ch.close();
}

/** Subscribes to sync events for the lifetime of the calling component. */
export function subscribeSync(handler: (message: SyncMessage) => void): () => void {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return () => {};
  const ch = new BroadcastChannel(SYNC_CHANNEL);
  ch.onmessage = (ev: MessageEvent<Envelope>) => {
    if (!ev.data) return;
    if (ev.data.__source === SOURCE_ID) return; // never react to our own broadcast
    handler(ev.data);
  };
  return () => ch.close();
}
