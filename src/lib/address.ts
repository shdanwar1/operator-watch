/**
 * Pure display helpers for postal addresses — safe for client and server.
 * The timeline shows street + house number only; postcode and city are noise.
 */

/** "Grüntaler Str. 18, 13357 Berlin" → "Grüntaler Str. 18". */
export function cleanAddress(label: string): string {
  const parts = label
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  // Drop "13357 Berlin"-style postcode+city segments and bare postcodes.
  const kept = parts.filter((p) => !/^\d{3,6}(\s+\S.*)?$/.test(p));
  // Drop a trailing city-only segment ("…, Berlin") when a numbered street
  // segment precedes it.
  while (
    kept.length > 1 &&
    /^[\p{L}][\p{L}\-. ]*$/u.test(kept[kept.length - 1]) &&
    /\d/.test(kept[kept.length - 2])
  ) {
    kept.pop();
  }
  return kept.join(", ") || label.trim();
}

/**
 * Extracts "Kaiserin-Augusta-Allee 10" from a Google Maps /place/ slug such as
 * "Dance Masterclass, Kaiserin-Augusta-Allee 10, 10553 Berlin". Returns null
 * when the slug carries no street segment (business name only).
 */
export function streetFromPlaceLabel(label: string): string | null {
  const parts = label
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const street = parts.find((p) => /\d/.test(p) && !/^\d{3,6}(\s+\S.*)?$/.test(p));
  return street ?? null;
}

/**
 * Full postal address from a Maps /place/ slug: street segment plus the
 * postcode+city segment when the slug carries one ("Kaiserin-Augusta-Allee 10,
 * 10553 Berlin"). Returns null when no street segment exists.
 */
export function fullAddressFromPlaceLabel(label: string): string | null {
  const street = streetFromPlaceLabel(label);
  if (!street) return null;
  const parts = label
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const idx = parts.indexOf(street);
  const rest = parts.slice(idx + 1);
  return [street, ...rest].join(", ");
}

