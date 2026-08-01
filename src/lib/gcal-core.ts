/**
 * Pure (browser-safe) Google Calendar helpers: URL normalisation + SSRF guard,
 * ICS parsing, calendar-mode detection, class/teacher title parsing and the
 * class→shift grouping rules. No database or network access lives here.
 */

/* ───────────────────────── URL safety ───────────────────────── */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(":")) return false;
  return (
    h === "::1" ||
    h === "::" ||
    h.startsWith("fc") ||
    h.startsWith("fd") ||
    h.startsWith("fe80") ||
    h.startsWith("::ffff:")
  );
}

/**
 * Returns the URL when it is safe for the server to fetch, otherwise null.
 * Only http(s) is allowed and private / loopback / link-local / metadata
 * destinations are rejected so the sync feature can never be used to probe
 * internal infrastructure (SSRF).
 */
export function safeRemoteUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (!host) return null;
  if (BLOCKED_HOSTNAMES.has(host)) return null;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return null;
  if (!host.includes(".") && !host.includes(":")) return null; // bare hostnames are internal
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) return null;
  return u.toString();
}

/** Accepts a raw ICS URL, or a Google Calendar embed/share URL and derives the ICS URL. */
export function normalizeIcsUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  // Bare calendar id (e.g. an email address).
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && /@/.test(s) && !/\s/.test(s)) {
    return `https://calendar.google.com/calendar/ical/${encodeURIComponent(s)}/public/basic.ics`;
  }

  const safe = safeRemoteUrl(s);
  if (!safe) return null;

  if (/\.ics(\?|$)/i.test(safe) || /\/ical\//i.test(safe)) return safe;

  try {
    const u = new URL(safe);
    const src = u.searchParams.get("src");
    if (src) {
      return `https://calendar.google.com/calendar/ical/${encodeURIComponent(src)}/public/basic.ics`;
    }
    const cid = u.searchParams.get("cid");
    if (cid) {
      // Google base64-encodes the calendar id in `cid`.
      try {
        const decoded = atob(cid.replace(/-/g, "+").replace(/_/g, "/"));
        if (/@/.test(decoded)) {
          return `https://calendar.google.com/calendar/ical/${encodeURIComponent(decoded)}/public/basic.ics`;
        }
      } catch {
        /* not base64 — fall through */
      }
    }
  } catch {
    /* handled below */
  }
  return null;
}

/* ───────────────────────── ICS parsing ───────────────────────── */

export type ParsedEvent = {
  uid: string;
  summary: string;
  description: string;
  organizer: string | null;
  meetLink: string | null;
  recurrenceId: string | null;
  specific_date: string; // YYYY-MM-DD (Europe/Berlin wall clock)
  start_time: string; // HH:MM:SS
  end_time: string; // HH:MM:SS
  day_of_week: number;
  status: "confirmed" | "cancelled";
};

function unfoldIcs(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function parseIcsDateTime(value: string, isUtc: boolean) {
  const compact = value.replace(/[TZ]/g, "");
  const y = Number(compact.slice(0, 4));
  const mo = Number(compact.slice(4, 6));
  const d = Number(compact.slice(6, 8));
  const hh = Number(compact.slice(8, 10) || "0");
  const mm = Number(compact.slice(10, 12) || "0");
  const ss = Number(compact.slice(12, 14) || "0");

  let localDate: Date;
  if (isUtc) {
    const utc = new Date(Date.UTC(y, mo - 1, d, hh, mm, ss));
    localDate = new Date(utc.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
  } else {
    localDate = new Date(y, mo - 1, d, hh, mm, ss);
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${localDate.getFullYear()}-${pad(localDate.getMonth() + 1)}-${pad(localDate.getDate())}`,
    time: `${pad(localDate.getHours())}:${pad(localDate.getMinutes())}:${pad(localDate.getSeconds())}`,
    dow: localDate.getDay(),
    local: localDate,
  };
}

function decodeIcsText(v: string): string {
  return v
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function findMeetLink(...sources: (string | null | undefined)[]): string | null {
  for (const s of sources) {
    if (!s) continue;
    const m = s.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i);
    if (m) return m[0];
  }
  return null;
}

export function parseIcs(ics: string): ParsedEvent[] {
  const lines = unfoldIcs(ics);
  const events: ParsedEvent[] = [];
  let cur: Partial<ParsedEvent> & { _rrule?: boolean; _conference?: string } = {};
  let inEvent = false;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      inEvent = true;
      continue;
    }
    if (line === "END:VEVENT") {
      if (inEvent && !cur._rrule && cur.uid && cur.specific_date && cur.start_time && cur.end_time) {
        events.push({
          uid: cur.recurrenceId ? `${cur.uid}::${cur.recurrenceId}` : cur.uid,
          summary: cur.summary || "",
          description: cur.description || "",
          organizer: cur.organizer ?? null,
          meetLink: findMeetLink(cur.meetLink, cur._conference, cur.description),
          recurrenceId: cur.recurrenceId ?? null,
          specific_date: cur.specific_date,
          start_time: cur.start_time,
          end_time: cur.end_time,
          day_of_week: cur.day_of_week ?? 0,
          status: cur.status ?? "confirmed",
        });
      }
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const rawKey = line.slice(0, colonIdx);
    const val = line.slice(colonIdx + 1);
    const [key, ...paramParts] = rawKey.split(";");
    const params = Object.fromEntries(
      paramParts
        .map((p) => p.split("="))
        .filter((kv) => kv.length === 2)
        .map(([k, v]) => [k.toUpperCase(), v]),
    );

    switch (key.toUpperCase()) {
      case "UID":
        cur.uid = val.trim();
        break;
      case "RECURRENCE-ID":
        cur.recurrenceId = val.trim();
        break;
      case "SUMMARY":
        cur.summary = decodeIcsText(val);
        break;
      case "DESCRIPTION":
        cur.description = decodeIcsText(val);
        break;
      case "LOCATION":
        cur.meetLink = cur.meetLink ?? findMeetLink(decodeIcsText(val));
        break;
      case "X-GOOGLE-CONFERENCE":
        cur._conference = val.trim();
        break;
      case "ORGANIZER":
        cur.organizer = val.replace(/^mailto:/i, "").trim() || null;
        break;
      case "STATUS":
        cur.status = val.trim().toLowerCase() === "cancelled" ? "cancelled" : "confirmed";
        break;
      case "RRULE":
        cur._rrule = true;
        break;
      case "DTSTART": {
        const p = parseIcsDateTime(val, val.endsWith("Z") && !params.TZID);
        cur.specific_date = p.date;
        cur.start_time = p.time;
        cur.day_of_week = p.dow;
        break;
      }
      case "DTEND": {
        const p = parseIcsDateTime(val, val.endsWith("Z") && !params.TZID);
        cur.end_time = p.time;
        break;
      }
    }
  }
  return events;
}

/* ───────────────────────── Mode detection ───────────────────────── */

export type CalendarMode = "busy" | "detailed";

const HIDDEN_TITLES = new Set([
  "",
  "busy",
  "private",
  "blocked",
  "blocker",
  "reserved",
  "unavailable",
  "occupied",
  "(no title)",
  "no title",
]);

/** True when the event title carries no real information. */
export function isHiddenTitle(summary: string): boolean {
  return HIDDEN_TITLES.has(summary.trim().toLowerCase());
}

/**
 * Busy Mode when every imported event title is hidden ("Busy"), Detailed Mode
 * as soon as at least one event carries a real title. Detected on every sync,
 * never configured by the user.
 */
export function detectCalendarMode(events: ParsedEvent[]): CalendarMode {
  return events.some((e) => e.status !== "cancelled" && !isHiddenTitle(e.summary))
    ? "detailed"
    : "busy";
}

/* ───────────────────────── Title → class + teacher ───────────────────────── */

const SEPARATORS = [" — ", " – ", " - "];

export function normalizeName(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ").replace(/[’']/g, "'");
}

export type TitleMatch = {
  className: string;
  teacherName: string;
  classId: string | null;
  teacherId: string | null;
};

type Directory = Map<string, { id: string; name: string }>;

export function buildDirectory(rows: { id: string; name: string }[]): Directory {
  const m: Directory = new Map();
  for (const r of rows) m.set(normalizeName(r.name), { id: r.id, name: r.name });
  return m;
}

/**
 * Splits "Class - Teacher" while tolerating hyphenated class names by trying
 * every separator position and keeping the split where BOTH sides exist in the
 * Dance Masterclass directories. Returns null for personal events (gym,
 * birthday, meetings, …) which must never become shifts.
 */
export function matchTitle(
  summary: string,
  classes: Directory,
  teachers: Directory,
): TitleMatch | null {
  const title = summary.replace(/\s+/g, " ").trim();
  if (!title) return null;

  const candidates: { left: string; right: string }[] = [];
  for (const sep of SEPARATORS) {
    let idx = title.indexOf(sep);
    while (idx !== -1) {
      candidates.push({
        left: title.slice(0, idx).trim(),
        right: title.slice(idx + sep.length).trim(),
      });
      idx = title.indexOf(sep, idx + sep.length);
    }
  }
  // Prefer the longest class name (the last separator) so hyphenated class
  // names such as "Barre - Full Body Toning" stay intact.
  candidates.sort((a, b) => b.left.length - a.left.length);

  for (const c of candidates) {
    const cls = classes.get(normalizeName(c.left));
    const tea = teachers.get(normalizeName(c.right));
    if (cls && tea) {
      return {
        className: cls.name,
        teacherName: tea.name,
        classId: cls.id,
        teacherId: tea.id,
      };
    }
  }
  return null;
}

/* ───────────────────────── Shift grouping ───────────────────────── */

export const SHIFT_CONFIG = {
  preClassBufferMin: 30,
  postClassBufferMin: 15,
  maxGapMin: 90,
} as const;

export type ClassEvent = {
  key: string;
  date: string;
  startMin: number;
  endMin: number;
};

export type GroupedShift = {
  date: string;
  startMin: number;
  endMin: number;
  classCount: number;
  classKeys: string[];
};

export function toMin(hhmmss: string): number {
  const [h, m] = hhmmss.split(":").map(Number);
  return h * 60 + m;
}

export function minToTime(total: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, total));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

/** Group consecutive/close classes into operator shifts. */
export function groupClassesIntoShifts(
  classes: ClassEvent[],
  config: {
    preClassBufferMin: number;
    postClassBufferMin: number;
    maxGapMin: number;
  } = SHIFT_CONFIG,
): GroupedShift[] {
  const byDate = new Map<string, ClassEvent[]>();
  for (const c of classes) {
    if (!byDate.has(c.date)) byDate.set(c.date, []);
    byDate.get(c.date)!.push(c);
  }

  const shifts: GroupedShift[] = [];
  for (const [date, dayClasses] of byDate) {
    const sorted = [...dayClasses].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
    let groupStart = sorted[0].startMin;
    let groupEnd = sorted[0].endMin;
    let keys = [sorted[0].key];

    for (let i = 1; i < sorted.length; i++) {
      const cls = sorted[i];
      const gap = cls.startMin - groupEnd;
      if (gap < config.maxGapMin) {
        groupEnd = Math.max(groupEnd, cls.endMin);
        keys.push(cls.key);
      } else {
        shifts.push({
          date,
          startMin: groupStart - config.preClassBufferMin,
          endMin: groupEnd + config.postClassBufferMin,
          classCount: keys.length,
          classKeys: keys,
        });
        groupStart = cls.startMin;
        groupEnd = cls.endMin;
        keys = [cls.key];
      }
    }
    shifts.push({
      date,
      startMin: groupStart - config.preClassBufferMin,
      endMin: groupEnd + config.postClassBufferMin,
      classCount: keys.length,
      classKeys: keys,
    });
  }

  shifts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin));
  return shifts;
}

/* ───────────────────────── Date windows ───────────────────────── */

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function dateKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Busy mode keeps the historical 4-week window. */
export function busyWindow(now: Date) {
  const from = dateKey(now);
  const to = dateKey(new Date(now.getTime() + 28 * 24 * 3600 * 1000));
  return { from, to };
}

/** Detailed mode reads the current calendar month plus the next one. */
export function detailedWindow(now: Date) {
  const from = dateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = dateKey(new Date(now.getFullYear(), now.getMonth() + 2, 0));
  return { from, to };
}
