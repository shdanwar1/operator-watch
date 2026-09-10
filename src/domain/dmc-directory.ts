/**
 * Canonical DMC directory helpers (Operation 8) — pure, no database.
 *
 * `dmc_classes` and `dmc_instructors` are the only class/teacher authority a
 * record may reference. These helpers exist for the one-time linking of
 * historical free-text names and for display.
 *
 * Matching here is EXACT after case/punctuation folding, and only when the
 * folded name resolves to exactly one directory entry. There is deliberately
 * no fuzzy scoring, no alias table and no "best guess": an unresolved
 * historical name stays unresolved and gets reported.
 */

export type DmcOption = {
  id: string;
  name: string;
};

/** Lowercase, alphanumeric-only comparison key. */
export function foldName(value: string): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * The single directory entry whose folded name equals the folded input.
 * Returns null for no match and for more than one match — never a guess.
 */
export function findExactlyOne(options: DmcOption[], name: string): DmcOption | null {
  const key = foldName(name);
  if (!key) return null;
  const hits = options.filter((o) => foldName(o.name) === key);
  return hits.length === 1 ? hits[0] : null;
}

/** Display name of a DMC instructor record. */
export function dmcInstructorLabel(parts: {
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
}): string {
  const name = [parts.firstName, parts.lastName].filter(Boolean).join(" ").trim();
  return name || (parts.title ?? "").trim() || "—";
}
