/**
 * Local persistence for "last known good" data — so a page can paint
 * instantly from what it showed last time, instead of blanking to a loading
 * state on every mount while it waits for the network.
 *
 * This is deliberately just a cache of what the operator's own screen
 * already showed them (shift times, class names, travel plans) — nothing
 * that isn't already visible in the UI for that signed-in operator. It is
 * not a substitute for the server being the source of truth: every read
 * from here is expected to be followed by a background refresh that
 * overwrites it once fresh data arrives.
 */

const PREFIX = "studio-cache:";
const VERSION = 1;

type Envelope<T> = {
  v: number;
  savedAt: number;
  value: T;
};

/**
 * Reads a cached value. Returns null if nothing is cached, storage isn't
 * available (private browsing, disabled storage, SSR), or the cached
 * envelope doesn't parse — a cache miss is always a safe, silent fallback
 * to the normal loading path, never an error.
 */
export function readCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Envelope<T>;
    if (parsed.v !== VERSION) return null;
    return parsed.value;
  } catch {
    return null;
  }
}

/** Writes a value, replacing whatever was cached for this key. Best-effort. */
export function writeCache<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    const envelope: Envelope<T> = { v: VERSION, savedAt: Date.now(), value };
    window.localStorage.setItem(PREFIX + key, JSON.stringify(envelope));
  } catch {
    // Storage full or disabled mid-session — the page still works, it just
    // won't have a warm cache next time. Never let this throw into a render.
  }
}

/** Removes a single cached entry (e.g. on sign-out for that operator). */
export function clearCache(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** Removes every cached entry for one operator — call this on sign-out. */
export function clearCacheForOperator(username: string): void {
  if (typeof window === "undefined") return;
  try {
    const prefix = PREFIX + operatorNamespace(username);
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    toRemove.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/**
 * Removes every cached entry, regardless of operator. Called on sign-out:
 * this is a shared kiosk device, so nothing an operator saw should survive
 * into the next person's session.
 */
export function clearAllCaches(): void {
  if (typeof window === "undefined") return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) toRemove.push(k);
    }
    toRemove.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/** Namespaces a cache key by operator so switching operators on the same
 *  device never shows one person's cached shifts to another. */
export function operatorNamespace(username: string): string {
  return `op:${username.toLowerCase()}:`;
}
