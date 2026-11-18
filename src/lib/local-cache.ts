/**
 * In-memory "what this screen just showed" cache, so switching between tabs
 * paints instantly within one app session.
 *
 * Deliberately NOT persisted to device storage: a snapshot from an earlier
 * visit (hours, shift counts) would flash outdated numbers before the server
 * replied. On a fresh app open every screen shows its loading state and then
 * the correct data. Any legacy persisted entries are purged on first use.
 */

const PREFIX = "studio-cache:";
const memory = new Map<string, unknown>();
let legacyPurged = false;

function browser(): boolean {
  // Never cache on the server: a module-level map would leak between requests.
  return typeof window !== "undefined" && !!window;
}

function purgeLegacy(): void {
  if (legacyPurged) return;
  legacyPurged = true;
  try {
    const ls = window.localStorage;
    const toRemove: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(PREFIX)) toRemove.push(k);
    }
    toRemove.forEach((k) => ls.removeItem(k));
  } catch {
    /* ignore */
  }
}

export function readCache<T>(key: string): T | null {
  if (!browser()) return null;
  purgeLegacy();
  return memory.has(key) ? (memory.get(key) as T) : null;
}

export function writeCache<T>(key: string, value: T): void {
  if (!browser()) return;
  memory.set(key, value);
}

export function clearCache(key: string): void {
  memory.delete(key);
}

export function clearCacheForOperator(username: string): void {
  const prefix = operatorNamespace(username);
  for (const k of [...memory.keys()]) if (k.startsWith(prefix)) memory.delete(k);
}

/** Called on sign-out: shared device, nothing survives into the next session. */
export function clearAllCaches(): void {
  memory.clear();
}

/** Namespaces a cache key by operator so switching operators on the same
 *  device never shows one person's cached shifts to another. */
export function operatorNamespace(username: string): string {
  return `op:${username.toLowerCase()}:`;
}

/** Test helper. */
export function __resetCacheForTests(): void {
  memory.clear();
  legacyPurged = false;
}
