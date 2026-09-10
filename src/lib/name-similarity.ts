/**
 * Fuzzy name comparison used by the directory hygiene report ("these two
 * class/teacher entries look like the same thing").
 *
 * This is NOT a DMC validation mechanism. Whether a Google Calendar event is a
 * DMC class is decided exclusively by the stored DMC Live Timetable
 * (`src/domain/timetable-resolver.ts`).
 */

const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const APOSTROPHES = /[\u2018\u2019\u201B\u02BC\u00B4`]/g;
const QUOTES = /[\u201C\u201D\u201E\u00AB\u00BB]/g;
const BULLETS = /[\u2022\u00B7\u2219\u25CF\u30FB]/g;

/** Lowercase, accent/punctuation-normalised text used only for comparison. */
export function normalizeText(input: string): string {
  return (input ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(DASHES, "-")
    .replace(APOSTROPHES, "'")
    .replace(QUOTES, '"')
    .replace(BULLETS, "•")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const FILLER = /\b(and|the|a|an|with|w|by|for|class|session|live|online)\b/g;

/** Aggressive comparison key: punctuation and filler words disappear. */
export function matchKey(input: string): string {
  return normalizeText(input)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(FILLER, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Key with all separators removed — makes "annalisa" == "anna lisa". */
function tightKey(input: string): string {
  return matchKey(input).replace(/ /g, "");
}

function tokens(input: string): string[] {
  return matchKey(input).split(" ").filter(Boolean);
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice coefficient over character bigrams (0..1). */
function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const [, n] of A) total += n;
  for (const [, n] of B) total += n;
  for (const [g, n] of A) overlap += Math.min(n, B.get(g) ?? 0);
  return (2 * overlap) / total;
}

/** Token-set overlap (0..1) — word order independent. */
function tokenOverlap(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return (2 * hit) / (A.size + B.size);
}

/** Blended similarity in 0..100 (tolerates minor spelling mistakes). */
export function similarity(a: string, b: string): number {
  const ka = matchKey(a);
  const kb = matchKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 100;
  if (tightKey(a) === tightKey(b)) return 99;
  const score = Math.max(
    dice(ka, kb),
    tokenOverlap(ka, kb) * 0.97,
    dice(tightKey(a), tightKey(b)),
  );
  return Math.round(score * 1000) / 10;
}
