/**
 * Semantic matching engine for Google Calendar event titles.
 *
 * The `classes` and `teachers` tables are the single source of truth. A raw
 * calendar title is resolved through an ordered pipeline:
 *
 *   1. Learned alias (operator corrections)
 *   2. Teacher detection
 *   3. Teacher removal + normalisation
 *   4. Class matching (exact → starts-with → contains → tokens → fuzzy)
 *   5. Teacher-assisted tie-breaking
 *
 * Nothing is ever dropped: an unmatched event still imports with its raw
 * calendar title so shift generation stays identical in every sharing mode.
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
  let best: TeacherHit = null;

  for (const t of teachers) {
    const tk = matchKey(t.name);
    if (!tk) continue;
    let score = 0;
    let matchedText = t.name;

    if (containsKey(key, tk)) {
      score = 100;
    } else {
      // Fuzzy against each segment — tolerates typos and partial names.
      for (const seg of segs) {
        const s = similarity(seg, t.name);
        if (s > score) {
          score = s;
          matchedText = seg;
        }
      }
      // Last-name-only mentions ("… - Arbelaez").
      const last = tk.split(" ").slice(-1)[0] ?? "";
      if (last.length >= 4 && containsKey(key, last) && score < 92) {
        score = 92;
        matchedText = last;
      }
    }

    if (score >= TEACHER_THRESHOLD && (!best || score > best.score)) {
      best = { entry: t, score, matchedText };
    }
  }
  return best;
}

/** Removes the detected teacher (and dangling separators) from the title. */
export function stripTeacher(title: string, hit: TeacherHit): string {
  if (!hit) return normalizeText(title);
  const base = normalizeText(title);
  // Remove the full name, the matched text, and each individual name token so
  // partial mentions ("… with Anna-Lisa") never pollute the class title.
  const nameTokens = matchKey(hit.entry.name)
    .split(" ")
    .filter((t) => t.length >= 3);
  const targets = [hit.entry.name, hit.matchedText, ...nameTokens]
    .map((t) => normalizeText(t))
    .filter(Boolean);
  let out = base;
  for (const t of targets) {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escaped}\\b`, "g"), " ");
  }
  return out
    .replace(/\s*(?:\bwith\b|\bw\/\b|\bby\b)\s*$/g, " ")
    .replace(/[\s\-|•:/~,]+$/g, "")
    .replace(/^[\s\-|•:/~,]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

  /* 2/3 — teacher detection + removal. */
  const teacherHit = detectTeacher(title, teachers);
  const working = stripTeacher(title, teacherHit);

  /* 4 — class matching on the cleaned title. */
  let clsHit = matchClass(working, classes);
  // 5 — teacher-assisted: if the cleaned title lost too much, retry on the raw
  // title. Teacher context only ever raises confidence, never overrides.
  const rawHit = matchClass(title, classes);
  if (rawHit && (!clsHit || rawHit.score > clsHit.score + 6)) clsHit = rawHit;
  if (clsHit && teacherHit && clsHit.score >= CLASS_THRESHOLD) {
    clsHit = { ...clsHit, score: Math.min(100, clsHit.score + 2) };
  }

  const accepted = !!clsHit && clsHit.score >= CLASS_THRESHOLD;
  const reasonParts = [
    accepted ? clsHit!.reason : `Class below ${CLASS_THRESHOLD}% threshold`,
    teacherHit ? "Teacher detected" : "No teacher matched",
  ];

  const result: MatchResult = {
    className: accepted ? clsHit!.entry.name : null,
    teacherName: teacherHit?.entry.name ?? null,
    classId: accepted ? clsHit!.entry.id : null,
    teacherId: teacherHit?.entry.id ?? null,
    confidence: accepted ? clsHit!.score : (clsHit?.score ?? 0),
    reason: reasonParts.join(" + "),
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
