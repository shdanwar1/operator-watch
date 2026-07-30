/**
 * Shared validators used by both client components and server functions.
 * Any user-facing string must go through here before it hits the DB.
 */

export const USERNAME_RE = /^[A-Za-z0-9_.-]{2,32}$/;
export const PIN_RE = /^\d{4}$/;

export function validateUsername(v: unknown): string {
  if (typeof v !== "string") throw new Error("Username is required");
  const t = v.trim();
  if (!t) throw new Error("Username is required");
  if (!USERNAME_RE.test(t)) {
    throw new Error("Username must be 2–32 letters, numbers, . _ or -");
  }
  return t; // capitalization is preserved
}

export function validatePin(v: unknown): string {
  if (typeof v !== "string") throw new Error("PIN must contain exactly 4 digits");
  const t = v.trim();
  if (!PIN_RE.test(t)) throw new Error("PIN must contain exactly 4 digits");
  return t;
}

export function validateCalendarUrl(v: unknown): string {
  if (typeof v !== "string") throw new Error("Calendar URL is required");
  const s = v.trim();
  if (!s) throw new Error("Calendar URL is required");
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) throw new Error("bad protocol");
    return u.toString();
  } catch {
    throw new Error("That does not look like a valid URL");
  }
}

export function validateMapsUrl(v: unknown): string {
  if (typeof v !== "string") throw new Error("Paste a Google Maps link");
  const s = v.trim();
  if (!s) throw new Error("Paste a Google Maps link");
  try {
    // eslint-disable-next-line no-new
    new URL(s);
  } catch {
    throw new Error("That does not look like a valid URL");
  }
  return s;
}

/** Case-insensitive equality for usernames. Only used for auth/uniqueness. */
export function sameUsername(a: string | null | undefined, b: string | null | undefined) {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}
