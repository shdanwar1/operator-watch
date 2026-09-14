/**
 * Survival of the "Shift starting now" tap intent.
 *
 * The notification opens `/?autoCheckIn=<scheduled_shift_id>`, but the app may
 * not be able to act on it straight away: on a phone the gate session often
 * has to be re-entered first, and that redirect (to /unlock and back) drops
 * every query parameter. So the intent is captured from the URL as early as
 * possible — on whatever route the app happens to land on — parked in
 * sessionStorage, and consumed by the dashboard once the operator session is
 * established.
 */

export const AUTO_CHECKIN_PARAM = "autoCheckIn";
const STORAGE_KEY = "auto-checkin-intent";

/** Stale intents are dropped: a tap is only meaningful for a short while. */
export const INTENT_TTL_MS = 15 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pure: extracts a valid shift id from a query string. */
export function intentFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(AUTO_CHECKIN_PARAM);
  return value && UUID_RE.test(value) ? value : null;
}

/** Pure: validates a stored record against the clock. */
export function parseStoredIntent(raw: string | null, now: number): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { id?: unknown; at?: unknown };
    const id = typeof parsed.id === "string" ? parsed.id : "";
    const at = typeof parsed.at === "number" ? parsed.at : 0;
    if (!UUID_RE.test(id)) return null;
    if (now - at > INTENT_TTL_MS || now < at - 60_000) return null;
    return id;
  } catch {
    return null;
  }
}

export function serializeIntent(id: string, now: number): string {
  return JSON.stringify({ id, at: now });
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Parks an intent so it survives sign-in redirects. */
export function storeAutoCheckInIntent(id: string): void {
  if (!UUID_RE.test(id)) return;
  storage()?.setItem(STORAGE_KEY, serializeIntent(id, Date.now()));
}

/**
 * Reads the intent out of the current URL (if any), parks it, and removes the
 * parameter so a refresh never repeats it. Safe to call on every route.
 */
export function captureAutoCheckInIntent(): string | null {
  if (typeof window === "undefined") return null;
  const id = intentFromSearch(window.location.search);
  if (!id) return null;
  storeAutoCheckInIntent(id);

  const params = new URLSearchParams(window.location.search);
  params.delete(AUTO_CHECKIN_PARAM);
  const rest = params.toString();
  window.history.replaceState(
    {},
    "",
    window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash,
  );
  return id;
}

/** Takes the parked intent, clearing it. */
export function consumeAutoCheckInIntent(): string | null {
  const store = storage();
  if (!store) return null;
  const id = parseStoredIntent(store.getItem(STORAGE_KEY), Date.now());
  store.removeItem(STORAGE_KEY);
  return id;
}
