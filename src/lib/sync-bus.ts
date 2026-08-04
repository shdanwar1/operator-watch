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

export function publishSync(message: SyncMessage) {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  const ch = new BroadcastChannel(SYNC_CHANNEL);
  ch.postMessage(message);
  ch.close();
}

/** Subscribes to sync events for the lifetime of the calling component. */
export function subscribeSync(handler: (message: SyncMessage) => void): () => void {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return () => {};
  const ch = new BroadcastChannel(SYNC_CHANNEL);
  ch.onmessage = (ev: MessageEvent<SyncMessage>) => {
    if (ev.data) handler(ev.data);
  };
  return () => ch.close();
}
