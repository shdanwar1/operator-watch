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

  if (/\.ics(\?|$)/i.test(safe) || /\/ical\//i.test(safe)) return safeCalendarUrl(safe);

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
  /** DTSTART;VALUE=DATE — an all-day block, never a live class. */
  allDay: boolean;
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

const DAY_CODES: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

type RawEvent = {
  uid: string;
  summary: string;
  description: string;
  organizer: string | null;
  meetLink: string | null;
  conference: string | null;
  recurrenceId: string | null;
  status: "confirmed" | "cancelled";
  start: Date | null;
  end: Date | null;
  rrule: string | null;
  startIsUtc: boolean;
  allDay: boolean;
  exdates: string[]; // YYYY-MM-DD keys (local)
};

function fmtOccurrence(start: Date, end: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    specific_date: `${start.getFullYear()}-${p(start.getMonth() + 1)}-${p(start.getDate())}`,
    start_time: `${p(start.getHours())}:${p(start.getMinutes())}:00`,
    end_time: `${p(end.getHours())}:${p(end.getMinutes())}:00`,
    day_of_week: start.getDay(),
  };
}

/**
 * Berlin's UTC offset (in minutes) on a given wall-clock date, measured at
 * midday so it is never ambiguous around the changeover hour.
 */
function berlinOffsetMinutes(d: Date): number {
  const noonUtc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
  const asBerlin = new Date(
    new Date(noonUtc).toLocaleString("en-US", { timeZone: "Europe/Berlin" }),
  );
  return Math.round((asBerlin.getTime() - noonUtc) / 60000);
}

/** Expands a simple RRULE (FREQ/INTERVAL/COUNT/UNTIL/BYDAY) inside a date window. */
function expandRrule(
  start: Date,
  rrule: string,
  windowFrom: Date,
  windowTo: Date,
  /** DTSTART was UTC-anchored (…Z), so its Berlin wall clock shifts with DST. */
  utcAnchored = false,
): Date[] {
  const parts = Object.fromEntries(
    rrule
      .split(";")
      .map((p) => p.split("="))
      .filter((kv) => kv.length === 2)
      .map(([k, v]) => [k.toUpperCase(), v.toUpperCase()]),
  ) as Record<string, string>;

  const freq = parts.FREQ;
  if (!freq) return [start];
  const interval = Math.max(1, Number(parts.INTERVAL || "1"));
  const count = parts.COUNT ? Number(parts.COUNT) : Infinity;
  let until: Date | null = null;
  if (parts.UNTIL) {
    const u = parseIcsDateTime(parts.UNTIL, /Z$/i.test(parts.UNTIL));
    until = u.local;
  }
  const byDay = parts.BYDAY
    ? parts.BYDAY.split(",")
        .map((d) => DAY_CODES[d.replace(/^[-+]?\d+/, "")])
        .filter((n) => n !== undefined)
    : [];

  const out: Date[] = [];
  const hard = 800; // safety bound on iterations
  let emitted = 0;

  const startOffset = berlinOffsetMinutes(start);
  const push = (raw: Date) => {
    // A UTC-anchored series repeats at a fixed UTC instant, so its Berlin wall
    // clock moves by an hour across a DST boundary. A local (TZID) series keeps
    // its wall clock instead — that one needs no adjustment.
    const d = new Date(raw);
    if (utcAnchored) {
      const delta = berlinOffsetMinutes(d) - startOffset;
      if (delta) d.setMinutes(d.getMinutes() + delta);
    }
    if (emitted >= count) return;
    if (until && d.getTime() > until.getTime()) return;
    emitted++;
    if (d.getTime() >= windowFrom.getTime() && d.getTime() <= windowTo.getTime()) out.push(new Date(d));
  };

  if (freq === "WEEKLY") {
    const days = byDay.length ? byDay : [start.getDay()];
    // start of the week (Sunday) containing the DTSTART
    const weekStart = new Date(start);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    for (let w = 0; w < hard; w++) {
      const base = new Date(weekStart);
      base.setDate(base.getDate() + w * 7 * interval);
      if (base.getTime() > windowTo.getTime() + 7 * 864e5) break;
      if (emitted >= count) break;
      for (const dow of [...days].sort((a, b) => a - b)) {
        const occ = new Date(base);
        occ.setDate(occ.getDate() + dow);
        occ.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
        if (occ.getTime() < start.getTime()) continue;
        push(occ);
      }
    }
  } else if (freq === "DAILY") {
    for (let i = 0; i < hard; i++) {
      const occ = new Date(start);
      occ.setDate(occ.getDate() + i * interval);
      if (occ.getTime() > windowTo.getTime()) break;
      if (emitted >= count) break;
      push(occ);
    }
  } else if (freq === "MONTHLY") {
    for (let i = 0; i < 60; i++) {
      const occ = new Date(start);
      occ.setMonth(occ.getMonth() + i * interval);
      if (occ.getTime() > windowTo.getTime()) break;
      if (emitted >= count) break;
      push(occ);
    }
  } else if (freq === "YEARLY") {
    for (let i = 0; i < 10; i++) {
      const occ = new Date(start);
      occ.setFullYear(occ.getFullYear() + i * interval);
      if (occ.getTime() > windowTo.getTime()) break;
      if (emitted >= count) break;
      push(occ);
    }
  } else {
    return [start];
  }

  return out;
}

/**
 * Parses an ICS feed into concrete dated events. Recurring events (RRULE) are
 * expanded across the given window; EXDATEs and RECURRENCE-ID overrides win.
 */
export function parseIcs(ics: string, window?: { from: Date; to: Date }): ParsedEvent[] {
  const now = new Date();
  const windowFrom = window?.from ?? new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const windowTo = window?.to ?? new Date(now.getFullYear(), now.getMonth() + 3, 0, 23, 59, 59);

  const lines = unfoldIcs(ics);
  const raws: RawEvent[] = [];
  let cur: RawEvent | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {
        uid: "",
        summary: "",
        description: "",
        organizer: null,
        meetLink: null,
        conference: null,
        recurrenceId: null,
        status: "confirmed",
        start: null,
        end: null,
        rrule: null,
        startIsUtc: false,
        allDay: false,
        exdates: [],
      };
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur && cur.uid && cur.start) raws.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;

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
      case "RECURRENCE-ID": {
        const p = parseIcsDateTime(val, val.endsWith("Z") && !params.TZID);
        cur.recurrenceId = p.date;
        break;
      }
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
        cur.conference = val.trim();
        break;
      case "ORGANIZER":
        cur.organizer = val.replace(/^mailto:/i, "").trim() || null;
        break;
      case "STATUS":
        cur.status = val.trim().toLowerCase() === "cancelled" ? "cancelled" : "confirmed";
        break;
      case "RRULE":
        cur.rrule = val.trim();
        break;
      case "EXDATE":
        for (const piece of val.split(",")) {
          const p = parseIcsDateTime(piece.trim(), piece.trim().endsWith("Z") && !params.TZID);
          cur.exdates.push(p.date);
        }
        break;
      case "DTSTART": {
        const isUtc = val.endsWith("Z") && !params.TZID;
        cur.start = parseIcsDateTime(val, isUtc).local;
        cur.startIsUtc = isUtc;
        // VALUE=DATE (or a bare YYYYYMMDD value) marks an all-day event.
        cur.allDay =
          (params.VALUE ?? "").toUpperCase() === "DATE" || /^\d{8}$/.test(val.trim());
        break;
      }
      case "DTEND":
        cur.end = parseIcsDateTime(val, val.endsWith("Z") && !params.TZID).local;
        break;
    }
  }

  // RECURRENCE-ID rows override a single occurrence of their master event.
  const overrides = new Set(
    raws.filter((r) => r.recurrenceId).map((r) => `${r.uid}::${r.recurrenceId}`),
  );

  const events: ParsedEvent[] = [];
  for (const r of raws) {
    if (!r.start) continue;
    const end = r.end ?? new Date(r.start.getTime() + 60 * 60 * 1000);
    const durationMs = Math.max(0, end.getTime() - r.start.getTime());

    const base = {
      summary: r.summary,
      description: r.description,
      organizer: r.organizer,
      meetLink: findMeetLink(r.meetLink, r.conference, r.description),
      status: r.status,
      allDay: r.allDay,
    };

    if (!r.rrule || r.recurrenceId) {
      const f = fmtOccurrence(r.start, end);
      events.push({
        uid: r.recurrenceId ? `${r.uid}::${r.recurrenceId}` : r.uid,
        recurrenceId: r.recurrenceId,
        ...base,
        ...f,
      });
      continue;
    }

    for (const occStart of expandRrule(r.start, r.rrule, windowFrom, windowTo, r.startIsUtc)) {
      const occEnd = new Date(occStart.getTime() + durationMs);
      const f = fmtOccurrence(occStart, occEnd);
      if (r.exdates.includes(f.specific_date)) continue;
      if (overrides.has(`${r.uid}::${f.specific_date}`)) continue;
      events.push({
        uid: `${r.uid}::${f.specific_date}`,
        recurrenceId: f.specific_date,
        ...base,
        ...f,
      });
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

/**
 * Diagnostic log of one calendar event's validation attempt. DMC validity is
 * decided solely by the stored DMC Live Timetable (see
 * `src/domain/timetable-resolver.ts`) — this type only carries the outcome to
 * the operator-facing debug list.
 */
export type MatchLog = {
  title: string;
  accepted: boolean;
  confidence: number;
  reason: string;
  className?: string;
  teacherName?: string;
};


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

/** Absolute minutes since epoch-day for a `YYYY-MM-DD` + minute-of-day pair. */
function absMin(date: string, min: number): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 60000) + min;
}

/** Inverse of {@link absMin}: back to a calendar date + minute-of-day. */
function fromAbs(total: number): { date: string; min: number } {
  const dayIdx = Math.floor(total / 1440);
  const min = total - dayIdx * 1440;
  const d = new Date(dayIdx * 1440 * 60000);
  return { date: dateKey(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), min };
}

/**
 * Group classes into continuous operator shifts.
 *
 * Grouping is purely chronological: calendar-day boundaries are ignored, so a
 * class at 23:30 and the next at 00:15 belong to the same overnight shift.
 * A shift's `date` is the calendar date it *starts* on; `endMin` may wrap past
 * midnight, in which case `endMin < startMin` after conversion to a time.
 */
export function groupClassesIntoShifts(
  classes: ClassEvent[],
  config: {
    preClassBufferMin: number;
    postClassBufferMin: number;
    maxGapMin: number;
  } = SHIFT_CONFIG,
): GroupedShift[] {
  if (classes.length === 0) return [];

  const sorted = [...classes]
    .map((c) => ({
      key: c.key,
      start: absMin(c.date, c.startMin),
      end: absMin(c.date, c.endMin < c.startMin ? c.endMin + 1440 : c.endMin),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const shifts: GroupedShift[] = [];
  const flush = (start: number, end: number, keys: string[]) => {
    const s = fromAbs(start - config.preClassBufferMin);
    const e = fromAbs(end + config.postClassBufferMin);
    shifts.push({
      date: s.date,
      startMin: s.min,
      endMin: e.min,
      classCount: keys.length,
      classKeys: keys,
    });
  };

  let groupStart = sorted[0].start;
  let groupEnd = sorted[0].end;
  let keys = [sorted[0].key];

  for (let i = 1; i < sorted.length; i++) {
    const cls = sorted[i];
    if (cls.start - groupEnd < config.maxGapMin) {
      groupEnd = Math.max(groupEnd, cls.end);
      keys.push(cls.key);
    } else {
      flush(groupStart, groupEnd, keys);
      groupStart = cls.start;
      groupEnd = cls.end;
      keys = [cls.key];
    }
  }
  flush(groupStart, groupEnd, keys);

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

/**
 * The studio's business date for an instant, in Berlin wall-clock time.
 *
 * Server code runs in UTC, so `dateKey(new Date())` rolls over to "tomorrow"
 * at 23:00 (CET) / 22:00 (CEST) Berlin time and would treat a still-running
 * evening as a past day. Every "today" decision on the server must use this.
 */
export function berlinDateKey(d: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, and the DST offset is handled by the engine.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Berlin calendar year/month for an instant (month is 1-12). */
export function berlinYearMonth(d: Date = new Date()): { year: number; month: number } {
  const [y, m] = berlinDateKey(d).split("-").map(Number);
  return { year: y, month: m };
}

/**
 * Sync scope: the current calendar month, optionally plus the next one.
 *
 * `from`/`scopeEnd` bound the *shift start* timestamps that are imported.
 * `parseTo` extends two days past the scope so overnight shifts crossing the
 * month boundary can be read in full and never truncated. The month is the
 * Berlin month, not the server's UTC month.
 */
export function syncWindow(now: Date, includeNextMonth = false) {
  const { year, month } = berlinYearMonth(now);
  const from = dateKey(new Date(year, month - 1, 1));
  const scopeEndDate = new Date(year, month - 1 + (includeNextMonth ? 2 : 1), 0);
  const parseToDate = new Date(scopeEndDate);
  parseToDate.setDate(parseToDate.getDate() + 2);
  return { from, scopeEnd: dateKey(scopeEndDate), to: dateKey(parseToDate) };
}


/**
 * Calendar feeds are only fetched from Google Calendar hosts. This keeps the
 * server from being used to contact arbitrary websites.
 */
const CALENDAR_HOST_SUFFIXES = [".google.com", ".googleusercontent.com"];
export function safeCalendarUrl(input: string): string | null {
  const safe = safeRemoteUrl(input);
  if (!safe) return null;
  const u = new URL(safe);
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (host !== "google.com" && !CALENDAR_HOST_SUFFIXES.some((s) => host.endsWith(s))) return null;
  return safe;
}
