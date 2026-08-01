/**
 * Confidence-based matching engine for Google Calendar events.
 *
 * Google Calendar is treated as imperfect human input; the application
 * database is the source of truth. An event is only imported when a class AND
 * a teacher can be resolved together with a confidence at or above the
 * acceptance threshold — and the stored values are always the canonical
 * database strings, never the calendar text.
 */

export const CONFIDENCE_THRESHOLD = 90;

export type DirectoryEntry = { id: string; name: string };

export type MatchResult = {
  className: string;
  teacherName: string;
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

/** Lowercase, unicode/punctuation-normalised text used only for comparison. */
export function normalizeText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(DASHES, "-")
    .replace(APOSTROPHES, "'")
    .replace(QUOTES, '"')
    .replace(BULLETS, "•")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Aggressive comparison key: words only, "&"/"and" unified, no punctuation. */
export function matchKey(input: string): string {
  return normalizeText(input)
    .replace(/&/g, " and ")
    .replace(/\+/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an|with|for|class|session)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Key with all separators removed — makes "annalisa" == "anna lisa". */
function tightKey(input: string): string {
  return matchKey(input).replace(/ /g, "");
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

/** Token-set overlap (0..1) — order independent. */
function tokenOverlap(a: string, b: string): number {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return (2 * hit) / (A.size + B.size);
}

/** Blended similarity in 0..100. */
export function similarity(a: string, b: string): number {
  const ka = matchKey(a);
  const kb = matchKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 100;
  if (tightKey(a) === tightKey(b)) return 99;
  const score = Math.max(dice(ka, kb), tokenOverlap(ka, kb) * 0.97, dice(tightKey(a), tightKey(b)));
  return Math.round(score * 1000) / 10;
}

/* ───────────────────── Descriptive-suffix handling ───────────────────── */

const BRACKETED = /\s*[([{][^)\]}]*[)\]}]\s*/g;
const TRAILING_SEP = /\s*(?:[|•]|--|-|:|~|,)\s*/;

/**
 * Yields progressively simplified variants of a calendar title so that
 * descriptive suffixes, parentheticals and duration notes can be ignored.
 */
export function titleVariants(raw: string): string[] {
  const base = normalizeText(raw);
  const out = new Set<string>();
  const add = (v: string) => {
    const t = v.trim().replace(/[\s\-|•:,~]+$/, "").trim();
    if (t) out.add(t);
  };

  add(base);
  const noBrackets = base.replace(BRACKETED, " ").replace(/\s+/g, " ").trim();
  add(noBrackets);

  for (const seed of [base, noBrackets]) {
    // Drop trailing descriptive segments one at a time.
    let cur = seed;
    for (let i = 0; i < 4; i++) {
      const parts = cur.split(TRAILING_SEP);
      if (parts.length < 2) break;
      cur = parts.slice(0, -1).join(" - ").trim();
      add(cur);
    }
    // Duration / marketing notes without brackets, e.g. "... 45 min".
    add(seed.replace(/\b\d{1,3}\s?(min|mins|minutes|hr|hour|hours)\b/g, " "));
  }

  return [...out];
}

/* ───────────────────── Candidate splitting ───────────────────── */

const SPLIT_SEPARATORS = [" - ", " -- ", " | ", " • ", " / ", ": ", " with ", " w/ ", " by "];

type Split = { left: string; right: string };

/** Every plausible "class / teacher" split of a normalised title. */
function candidateSplits(title: string): Split[] {
  const out: Split[] = [];
  for (const sep of SPLIT_SEPARATORS) {
    let idx = title.indexOf(sep);
    while (idx !== -1) {
      const left = title.slice(0, idx).trim();
      const right = title.slice(idx + sep.length).trim();
      if (left && right) out.push({ left, right });
      idx = title.indexOf(sep, idx + sep.length);
    }
  }
  // Prefer the longest class part first so hyphenated class names stay intact.
  out.sort((a, b) => b.left.length - a.left.length);
  return out;
}

/* ───────────────────────── Best-of directory ───────────────────────── */

type Scored = { entry: DirectoryEntry; score: number; reason: string };

function bestEntry(value: string, dir: DirectoryEntry[], kind: "class" | "teacher"): Scored | null {
  let best: Scored | null = null;
  for (const entry of dir) {
    let score = similarity(value, entry.name);
    let reason = "Fuzzy similarity";

    if (score === 100) reason = "Exact match after normalization";
    else if (score >= 99) reason = kind === "teacher" ? "Name normalization" : "Punctuation/spacing normalization";

    if (kind === "class" && score < 99) {
      // A database class fully contained in the calendar title means the extra
      // text is descriptive metadata, not a different class.
      const k = matchKey(value);
      const e = matchKey(entry.name);
      if (e && (k === e || k.startsWith(`${e} `) || k.includes(` ${e} `) || k.endsWith(` ${e}`))) {
        const coverage = e.length / Math.max(k.length, 1);
        const contained = 90 + Math.round(coverage * 90) / 10; // 90..99
        if (contained > score) {
          score = contained;
          reason = "Descriptive suffix ignored";
        }
      }
    }

    if (!best || score > best.score) best = { entry, score, reason };
  }
  return best;
}

/**
 * Resolves a calendar event title to a canonical class + teacher pair.
 * Class and teacher are always scored together: a right class with the wrong
 * teacher scores far below the acceptance threshold.
 */
export function matchEvent(
  summary: string,
  classes: DirectoryEntry[],
  teachers: DirectoryEntry[],
): { result: MatchResult | null; log: MatchLog } {
  const title = summary.replace(/\s+/g, " ").trim();
  if (!title) {
    return {
      result: null,
      log: { title: summary, accepted: false, confidence: 0, reason: "Empty event title" },
    };
  }

  let best: (MatchResult & { classScore: number; teacherScore: number }) | null = null;

  for (const variant of titleVariants(title)) {
    for (const split of candidateSplits(variant)) {
      const cls = bestEntry(split.left, classes, "class");
      const tea = bestEntry(split.right, teachers, "teacher");
      if (!cls || !tea) continue;

      // Weighted so both halves must be convincing.
      const confidence =
        Math.round((cls.score * 0.55 + tea.score * 0.45) * Math.min(cls.score, tea.score) / 100 * 10) /
        10;

      const reasons = new Set([cls.reason, tea.reason]);
      if (!best || confidence > best.confidence) {
        best = {
          className: cls.entry.name,
          teacherName: tea.entry.name,
          classId: cls.entry.id,
          teacherId: tea.entry.id,
          confidence,
          reason: [...reasons].join(" + "),
          classScore: cls.score,
          teacherScore: tea.score,
        };
      }
    }
  }

  if (!best || best.confidence < CONFIDENCE_THRESHOLD) {
    return {
      result: null,
      log: {
        title,
        accepted: false,
        confidence: best ? best.confidence : 0,
        reason: best
          ? `Below ${CONFIDENCE_THRESHOLD}% threshold (class ${best.classScore}%, teacher ${best.teacherScore}%)`
          : "No Dance Masterclass match found",
      },
    };
  }

  const { classScore: _c, teacherScore: _t, ...result } = best;
  return {
    result,
    log: {
      title,
      accepted: true,
      confidence: best.confidence,
      reason: best.reason,
      className: best.className,
      teacherName: best.teacherName,
    },
  };
}
