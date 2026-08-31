import { validateMapsUrl } from "./validation";
import { followRedirectsSafely } from "./safe-fetch.server";
import { streetFromPlaceLabel } from "./address";

export type ResolvedMapsPlace = {
  /** Place name from the link's /place/ slug (or the fallback label). */
  label: string;
  /** Street + house number derived from the slug, when present. */
  address: string | null;
  lat: number;
  lng: number;
};

/**
 * Verifies a Google Maps link and resolves it to a label + coordinates.
 * Accepts all common formats: full google.com/maps place links, @lat,lng
 * links, ?q=lat,lng links, and short links (maps.app.goo.gl, goo.gl, g.co),
 * which are followed safely first. Throws a human-readable error — nothing is
 * returned unless the link could be verified.
 */
export async function resolveGoogleMapsUrl(
  input: string,
  fallbackLabel = "Home",
): Promise<ResolvedMapsPlace> {
  const raw = validateMapsUrl(input);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("That does not look like a valid URL");
  }
  const shortHosts = ["maps.app.goo.gl", "goo.gl", "g.co", "maps.google.com"];
  let finalUrl = u.toString();
  if (shortHosts.includes(u.hostname)) {
    finalUrl = await followRedirectsSafely(u.toString());
  }

  const parse = (s: string): { lat: number; lng: number } | null => {
    const bang = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (bang) return { lat: parseFloat(bang[1]), lng: parseFloat(bang[2]) };
    const at = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (at) return { lat: parseFloat(at[1]), lng: parseFloat(at[2]) };
    const q = s.match(/[?&](?:q|query|ll|destination)=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (q) return { lat: parseFloat(q[1]), lng: parseFloat(q[2]) };
    return null;
  };
  const coords = parse(finalUrl) ?? parse(raw);
  if (!coords) {
    throw new Error(
      "Could not read coordinates from that link. Open the place in Google Maps, tap Share, and paste the link.",
    );
  }
  let label = fallbackLabel;
  const placeMatch = finalUrl.match(/\/place\/([^/@]+)/);
  if (placeMatch) {
    try {
      label = decodeURIComponent(placeMatch[1]).replace(/\+/g, " ");
    } catch {
      /* keep default */
    }
  }
  return { label, address: streetFromPlaceLabel(label), lat: coords.lat, lng: coords.lng };
}
