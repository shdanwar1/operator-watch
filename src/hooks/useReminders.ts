import { useEffect, useRef } from "react";

/**
 * Browser reminders for the operator dashboard.
 *
 * Each reminder is fired at most once per target time — the fired keys are
 * kept in localStorage so a page refresh (or a second tab) does not repeat a
 * notification the operator already saw.
 */

export type Reminder = {
  /** Stable identity for this reminder occurrence. */
  key: string;
  /** When it should fire. */
  at: Date;
  title: string;
  body: string;
};

const STORE_KEY = "so.reminders.fired";

function readFired(): Record<string, number> {
  try {
    return JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function writeFired(map: Record<string, number>) {
  // Drop anything older than a day so the store cannot grow without bound.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const pruned = Object.fromEntries(Object.entries(map).filter(([, t]) => t > cutoff));
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(pruned));
  } catch {
    /* ignore */
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export function useReminders(reminders: Reminder[], enabled: boolean) {
  const ref = useRef(reminders);
  ref.current = reminders;

  useEffect(() => {
    if (!enabled) return;
    void ensureNotificationPermission();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const check = () => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const fired = readFired();
      const now = Date.now();
      let changed = false;
      for (const r of ref.current) {
        const at = r.at.getTime();
        // Fire only inside a sane window: due, but not stale by more than 10m.
        if (fired[r.key] || now < at || now - at > 10 * 60 * 1000) continue;
        try {
          new Notification(r.title, { body: r.body, tag: r.key });
        } catch {
          /* ignore */
        }
        fired[r.key] = now;
        changed = true;
      }
      if (changed) writeFired(fired);
    };
    check();
    const t = setInterval(check, 20_000);
    return () => clearInterval(t);
  }, [enabled]);
}
