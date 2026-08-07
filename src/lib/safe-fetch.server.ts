import { safeRemoteUrl } from "./gcal-core";

/**
 * Follows redirects one hop at a time, re-validating every destination with the
 * SSRF guard, and returns the final URL. Never lets the server be steered to a
 * private / loopback / link-local / metadata address.
 */
export async function followRedirectsSafely(input: string, maxHops = 5): Promise<string> {
  let target = safeRemoteUrl(input);
  if (!target) throw new Error("That link points to a blocked address");

  for (let hop = 0; hop < maxHops; hop++) {
    let res: Response;
    try {
      res = await fetch(target, { redirect: "manual" });
    } catch {
      return target;
    }
    if (res.status < 300 || res.status >= 400) return target;
    const loc = res.headers.get("location");
    if (!loc) return target;
    let next: string | null;
    try {
      next = safeRemoteUrl(new URL(loc, target).toString());
    } catch {
      next = null;
    }
    if (!next) throw new Error("That link redirects to a blocked address");
    target = next;
  }
  return target;
}
