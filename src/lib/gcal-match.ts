/**
 * Human-style matching engine for Google Calendar event titles.
 *
 * The `classes` and `teachers` tables are the single source of truth. A raw
 * calendar title is resolved the way a person scanning the schedule would:
 *
 *   1. Learned alias (operator corrections) — always wins.
 *   2. Find the class. Class names are a small, known list, so they're the
 *      reliable anchor: try an exact hit, then "the calendar title is a
 *      shorthand for a longer class name" (or vice versa), then "the class
 *      name shows up somewhere in the title", then (last resort) a fuzzy
 *      guess.
 *   3. Strip the matched class text out of the title. Whatever's left is
 *      almost always just the teacher.
 *   4. Find the teacher in what's left, matching name *tokens* against each
 *      other (first name / last name separately) rather than scoring the
 *      whole string as one blob — a single misspelled letter in a surname
 *      ("Arbaleaz" vs "Arbelaez") shouldn't be able to sink an otherwise
 *      obvious match, the way one blended similarity score can.
 *
 * Nothing is ever dropped: an unmatched event still imports with a clean,
 * human-readable title (never a mash of leftover class-subtitle words) so
 * shift generation stays correct even when the directory lookup misses.
 */

export const CLASS_THRESHOLD = 72;
export const TEACHER_THRESHOLD = 80;

export type DirectoryEntry = { id: string; name: string };
export type AliasEntry = { aliasKey: string; classId: string | null; teacherId: string | null };

export type MatchResult = {
  className: string | null;
  teacherName: string | null;
  classId: string | null;
  teacherId: string | null;
  confidence: number;
  reason: string;
  /** Best-effort human-readable text to show when className is null. */
  fallbackClassName: string;
  /** Best-effort human-readable text to show when teacherName is null. */
  fallbackTeacherName: string;
};

export type MatchLog = {
  title: string;
  accepted: boolean;
  confidence: number;
  reason: string;
  className?: string;
  teacherName?: string;
};

/* ───────────────────────── Normalisation ───────────────────────── */

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

/**
 * Aggressive comparison key: separators become spaces, punctuation and filler
 * words disappear, everything collapses to single-spaced lowercase words.
 */
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

/* ───────────────────────── Similarity ───────────────────────── */

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

/** Blended similarity in 0..100 (tolerates minor spelling mistakes). Used for
 *  class-name matching, where whole-phrase comparison works well. */
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

/** Levenshtein edit distance. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Single-word similarity (0..100) — how a person reads two words as "the
 *  same word, just spelled slightly differently". Blends character-overlap
 *  with edit distance so letter transpositions (a common typo shape) don't
 *  tank the score the way pure bigram overlap can. */
function tokenSim(a: string, b: string): number {
  if (a === b) return 100;
  if (a.length < 2 || b.length < 2) return 0;
  const editSim = (1 - levenshtein(a, b) / Math.max(a.length, b.length)) * 100;
  return Math.max(dice(a, b) * 100, editSim);
}

/**
 * Compares a set of candidate words against a name's words, pairing each
 * name-word with its best available match (first name against first name,
 * surname against surname — regardless of order) instead of blending
 * everything into one string score. This is what makes "Isabel Arbaleaz"
 * still resolve to "Isabel Arbelaez": the first name matches perfectly and
 * anchors the pair, so one shaky surname doesn't sink the whole thing — but
 * "Elena Pris" vs "Elena Lucas" still correctly fails, because the surnames
 * genuinely don't resemble each other once compared on their own.
 */
function phraseTokenScore(candidateTokens: string[], nameTokens: string[]): number {
  if (!candidateTokens.length || !nameTokens.length) return 0;
  const pool = [...candidateTokens];
  let total = 0;
  for (const want of nameTokens) {
    let bestScore = 0;
    let bestIdx = -1;
    pool.forEach((have, idx) => {
      const s = tokenSim(want, have);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) pool.splice(bestIdx, 1);
    total += bestScore;
  }
  const avg = total / nameTokens.length;
  // Extra unrelated words around the name weaken the signal a little; an
  // isolated match ("Isabel Arbaleaz" alone) is stronger than the same name
  // buried in a longer unrelated phrase.
  const coverage = nameTokens.length / Math.max(nameTokens.length, candidateTokens.length);
  return avg * (0.6 + 0.4 * coverage);
}

/* ───────────────────────── Teacher detection ───────────────────────── */

/** Word-boundary containment test on normalised keys. */
function containsKey(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return (
    haystack === needle ||
    haystack.startsWith(`${needle} `) ||
    haystack.endsWith(` ${needle}`) ||
    haystack.includes(` ${needle} `)
  );
}

const SEGMENT_SPLIT = /\s*(?:[-|•:/~,]|\bwith\b|\bw\/\b|\bby\b)\s*/;

/** Trailing segments of the title — the usual home of the teacher name. */
function segments(title: string): string[] {
  const base = normalizeText(title).replace(/[([{][^)\]}]*[)\]}]/g, " ");
  return base
    .split(SEGMENT_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type TeacherHit = { entry: DirectoryEntry; score: number; matchedText: string } | null;

/** Finds the single teacher referenced by an event title, if any. */
export function detectTeacher(title: string, teachers: DirectoryEntry[]): TeacherHit {
  const key = matchKey(title);
  const segs = segments(title);
  const titleTokens = tokens(title);
  let best: TeacherHit = null;

  for (const t of teachers) {
    const nameTokens = tokens(t.name);
    if (!nameTokens.length) continue;
    const tk = matchKey(t.name);
    let score = 0;
    let matchedText = t.name;

    if (containsKey(key, tk)) {
      score = 100;
    } else if (nameTokens.length >= 2) {
      // Multi-word name: compare token-by-token (first name / surname) so a
      // typo in one word doesn't wreck the whole comparison. Try each
      // separator-delimited segment first (the usual home of the name)...
      for (const seg of segs) {
        const segTokens = tokens(seg);
        if (!segTokens.length) continue;
        const s = phraseTokenScore(segTokens, nameTokens);
        if (s > score) {
          score = s;
          matchedText = seg;
        }
      }
      // ...and also slide a same-length window across the raw title, in case
      // the name isn't cleanly isolated by a separator.
      for (let start = 0; start + nameTokens.length <= titleTokens.length; start++) {
        const windowTokens = titleTokens.slice(start, start + nameTokens.length);
        const s = phraseTokenScore(windowTokens, nameTokens);
        if (s > score) {
          score = s;
          matchedText = windowTokens.join(" ");
        }
      }
      // Last-name-only mentions ("… - Arbelaez").
      const last = nameTokens[nameTokens.length - 1]!;
      if (last.length >= 4 && containsKey(key, last) && score < 92) {
        score = 92;
        matchedText = last;
      }
    }
    // Single-word names ("Shannon", "Soraya") only ever match the exact
    // containsKey check above — too ambiguous to fuzz.

    if (score >= TEACHER_THRESHOLD && (!best || score > best.score)) {
      best = { entry: t, score, matchedText };
    }
  }
  return best;
}

/** Removes matched text (and dangling separators) from a normalised title. */
function stripPhrase(title: string, phrases: string[]): string {
  const base = normalizeText(title);
  let out = base;
  for (const raw of phrases) {
    const p = normalizeText(raw);
    if (!p) continue;
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escaped}\\b`, "g"), " ");
  }
  return out
    .replace(/\s*(?:\bwith\b|\bw\/\b|\bby\b)\s*$/g, " ")
    .replace(/[\s\-|•:/~,]+$/g, "")
    .replace(/^[\s\-|•:/~,]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Removes the detected teacher (and dangling separators) from the title. */
export function stripTeacher(title: string, hit: TeacherHit): string {
  if (!hit) return normalizeText(title);
  const nameTokens = matchKey(hit.entry.name)
    .split(" ")
    .filter((t) => t.length >= 3);
  return stripPhrase(title, [hit.entry.name, hit.matchedText, ...nameTokens]);
}

/* ───────────────────────── Class matching ───────────────────────── */

type ClassHit = { entry: DirectoryEntry; score: number; reason: string };

/** Weighted, priority-ordered class ranking against the directory. */
export function matchClass(workingTitle: string, classes: DirectoryEntry[]): ClassHit | null {
  const key = matchKey(workingTitle);
  if (!key) return null;
  let best: ClassHit | null = null;

  for (const c of classes) {
    const ck = matchKey(c.name);
    if (!ck) continue;
    let score = 0;
    let reason = "Fuzzy similarity";

    if (key === ck) {
      score = 100;
      reason = "Exact match";
    } else if (tightKey(workingTitle) === tightKey(c.name)) {
      score = 99;
      reason = "Punctuation/spacing normalization";
    } else if (key.startsWith(`${ck} `)) {
      // Descriptive subtitle after the class name.
      const coverage = ck.length / key.length;
      score = 90 + Math.round(coverage * 80) / 10; // 90..98
      reason = "Starts with class name";
    } else if (ck.startsWith(`${key} `)) {
      // The calendar title is a shorthand for the full class name, e.g.
      // "Full Body Strength" for "Full Body Strength Training".
      const coverage = key.length / ck.length;
      score = 88 + Math.round(coverage * 60) / 10; // 88..94
      reason = "Shorthand for class name";
    } else if (containsKey(key, ck)) {
      const coverage = ck.length / key.length;
      score = 85 + Math.round(coverage * 80) / 10; // 85..93
      reason = "Contains class name";
    } else {
      const tok = tokenOverlap(key, ck) * 100;
      const fuzzy = similarity(workingTitle, c.name);
      if (tok >= fuzzy) {
        score = Math.round(tok * 0.92 * 10) / 10;
        reason = "Token similarity";
      } else {
        score = Math.round(fuzzy * 0.9 * 10) / 10;
        reason = "Fuzzy similarity";
      }
    }

    if (!best || score > best.score) best = { entry: c, score, reason };
  }
  return best;
}

/* ───────────────────────── Fallback text (no directory match) ───────────────────────── */

const RAW_SPLIT = /\s+(?:-|–|—|\||with|w\/|by)\s+/i;

/** Naive split used only when nothing confident was found at all. */
function naiveSplit(raw: string): { className: string; teacherName: string } {
  const t = (raw ?? "").trim();
  if (!t) return { className: "Class", teacherName: "—" };
  const parts = t.split(RAW_SPLIT);
  const className = (parts[0] ?? t).trim() || "Class";
  const teacherName = parts.length > 1 ? parts.slice(1).join(" ").trim() || "—" : "—";
  return { className: className.slice(0, 120), teacherName: teacherName.slice(0, 120) };
}

/** Removes a known phrase from the ORIGINAL-case title for display — matching
 *  itself always happens on normalised text; this is purely cosmetic so the
 *  leftover teacher text keeps its real capitalisation. */
function removePhraseForDisplay(raw: string, phrase: string): string {
  if (!phrase) return raw.trim();
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return raw
    .replace(new RegExp(`\\b${escaped}\\b`, "gi"), " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s*(?:[-–—|•:/~,]|\bwith\b|\bw\/\b|\bby\b)\s*$/gi, " ")
    .replace(/^\s*(?:[-–—|•:/~,]|\bwith\b|\bw\/\b|\bby\b)\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ───────────────────────── Pipeline ───────────────────────── */

/** Stable alias key for a raw calendar title. */
export function aliasKeyFor(rawTitle: string): string {
  return matchKey(rawTitle);
}

export function matchEvent(
  summary: string,
  classes: DirectoryEntry[],
  teachers: DirectoryEntry[],
  aliases: AliasEntry[] = [],
): { result: MatchResult; log: MatchLog } {
  const title = (summary ?? "").replace(/\s+/g, " ").trim();
  const empty: MatchResult = {
    className: null,
    teacherName: null,
    classId: null,
    teacherId: null,
    confidence: 0,
    reason: "Empty event title",
    fallbackClassName: "Class",
    fallbackTeacherName: "—",
  };
  if (!title) {
    return {
      result: empty,
      log: { title: summary ?? "", accepted: false, confidence: 0, reason: "Empty event title" },
    };
  }

  const byId = (dir: DirectoryEntry[], id: string | null) =>
    id ? (dir.find((d) => d.id === id) ?? null) : null;

  /* 1 — learned alias wins over everything else. */
  const key = aliasKeyFor(title);
  const alias = aliases.find((a) => a.aliasKey === key);
  if (alias) {
    const cls = byId(classes, alias.classId);
    const tea = byId(teachers, alias.teacherId);
    if (cls) {
      const result: MatchResult = {
        className: cls.name,
        teacherName: tea?.name ?? null,
        classId: cls.id,
        teacherId: tea?.id ?? null,
        confidence: 100,
        reason: "Learned alias",
        fallbackClassName: cls.name,
        fallbackTeacherName: tea?.name ?? "—",
      };
      return {
        result,
        log: {
          title,
          accepted: true,
          confidence: 100,
          reason: "Learned alias",
          className: cls.name,
          teacherName: tea?.name ?? undefined,
        },
      };
    }
  }

  /* 2 — find the class first: it's the small, known list, so it's the
   * reliable anchor. Try it two ways and keep whichever scores higher:
   *   a) against the full raw title — the tiered scoring (starts-with /
   *      shorthand-of / contains) already tolerates trailing teacher text
   *      for the common, cleanly-formatted case;
   *   b) against the title with a confidently-recognised teacher name
   *      stripped out first — needed for the lowest, fuzzy-overlap tier,
   *      where unrelated teacher-name tokens ("Annalisa", "Piccolo") would
   *      otherwise dilute the score against a longer class name like "Full
   *      Body Strength Training".
   */
  const preTeacherHit = detectTeacher(title, teachers);
  const clsHitRaw = matchClass(title, classes);
  const clsHitStripped = preTeacherHit
    ? matchClass(stripTeacher(title, preTeacherHit), classes)
    : null;
  const clsHit =
    clsHitStripped && (!clsHitRaw || clsHitStripped.score > clsHitRaw.score)
      ? clsHitStripped
      : clsHitRaw;
  const classAccepted = !!clsHit && clsHit.score >= CLASS_THRESHOLD;

  /* 3 — strip the matched class text out; whatever remains is almost always
   * just the teacher. Only strip when the class match is reasonably
   * confident, so a bad guess can't eat real teacher text. */
  const remainder = classAccepted ? stripPhrase(title, [clsHit!.entry.name]) : title;

  /* 4 — find the teacher in the remainder (falling back to the full title,
   * in case stripping over-consumed something). */
  const teacherHit = detectTeacher(remainder, teachers) ?? detectTeacher(title, teachers);

  /* 5 — teacher-assisted tie-breaking: a confirmed teacher name is evidence
   * this is a well-formed title, so it only ever raises class confidence. */
  const finalClsScore =
    classAccepted && teacherHit ? Math.min(100, clsHit!.score + 2) : (clsHit?.score ?? 0);

  const accepted = classAccepted;
  const reasonParts = [
    accepted ? clsHit!.reason : `Class below ${CLASS_THRESHOLD}% threshold`,
    teacherHit ? "Teacher detected" : "No teacher matched",
  ];

  // Fallback display text for whichever side didn't resolve to a directory id.
  let fallbackClassName: string;
  let fallbackTeacherName: string;
  if (accepted) {
    fallbackClassName = clsHit!.entry.name;
    fallbackTeacherName = teacherHit
      ? teacherHit.entry.name
      : removePhraseForDisplay(title, clsHit!.entry.name) || "—";
  } else {
    const guess = naiveSplit(title);
    fallbackClassName = guess.className;
    fallbackTeacherName = teacherHit ? teacherHit.entry.name : guess.teacherName;
  }

  const result: MatchResult = {
    className: accepted ? clsHit!.entry.name : null,
    teacherName: teacherHit?.entry.name ?? null,
    classId: accepted ? clsHit!.entry.id : null,
    teacherId: teacherHit?.entry.id ?? null,
    confidence: accepted ? finalClsScore : (clsHit?.score ?? 0),
    reason: reasonParts.join(" + "),
    fallbackClassName,
    fallbackTeacherName,
  };

  return {
    result,
    log: {
      title,
      accepted,
      confidence: result.confidence,
      reason: result.reason,
      className: result.className ?? undefined,
      teacherName: result.teacherName ?? undefined,
    },
  };
}
