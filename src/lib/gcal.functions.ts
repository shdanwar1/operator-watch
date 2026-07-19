import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

type GateSession = { unlocked?: boolean; username?: string; isAdmin?: boolean };

function getSessionConfig() {
  const password = process.env.SESSION_SECRET;
  if (!password) throw new Error("SESSION_SECRET is not set");
  return {
    password,
    name: "site-gate",
    maxAge: 60 * 60 * 24 * 30,
    cookie: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" },
  };
}

async function requireOperator() {
  const session = await useSession<GateSession>(getSessionConfig());
  const username = (session.data.username ?? "").toLowerCase();
  if (!session.data.unlocked || session.data.isAdmin || !username) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return { username };
}

async function loadOperatorCalendar(username: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("operators")
    .select("username, calendar_ics_url")
    .ilike("username", username)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Response("Operator not found", { status: 404 });
  return { displayName: data.username as string, icsUrl: (data.calendar_ics_url ?? null) as string | null };
}

// Accepts a raw ICS URL, or a Google Calendar embed/share URL and derives the ICS URL.
export function normalizeIcsUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // Direct ICS link
  if (/\.ics(\?|$)/i.test(s) || /\/ical\//i.test(s)) return s;
  // Embed link: ?src=<calendarId>
  try {
    const u = new URL(s);
    const src = u.searchParams.get("src");
    if (src) {
      return `https://calendar.google.com/calendar/ical/${encodeURIComponent(src)}/public/basic.ics`;
    }
    // cid-style link — cannot resolve to ICS without login
  } catch {
    // not a URL — treat as bare calendar id (e.g. an email)
    if (/@/.test(s)) {
      return `https://calendar.google.com/calendar/ical/${encodeURIComponent(s)}/public/basic.ics`;
    }
  }
  return null;
}

export const getMyCalendarUrl = createServerFn({ method: "GET" }).handler(async () => {
  const { username } = await requireOperator();
  const { icsUrl } = await loadOperatorCalendar(username);
  return { icsUrl };
});

export const setMyCalendarUrl = createServerFn({ method: "POST" })
  .inputValidator((data: { url: string }) => {
    if (!data || typeof data.url !== "string") throw new Error("Invalid input");
    return data;
  })
  .handler(async ({ data }) => {
    const { username } = await requireOperator();
    const normalized = data.url.trim() === "" ? null : normalizeIcsUrl(data.url);
    if (data.url.trim() !== "" && !normalized) {
      throw new Error("Could not read that link. Paste the public ICS URL (ends in .ics) from Google Calendar → Settings → Integrate calendar → Public address in iCal format.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("operators")
      .update({ calendar_ics_url: normalized })
      .ilike("username", username);
    if (error) throw new Error(error.message);
    return { ok: true, icsUrl: normalized };
  });

type ParsedEvent = {
  uid: string;
  summary: string;
  specific_date: string; // YYYY-MM-DD (local Europe/Berlin wall-clock)
  start_time: string; // HH:MM:SS
  end_time: string; // HH:MM:SS
  day_of_week: number; // 0=Sun..6=Sat (postgres DOW)
  status: "confirmed" | "cancelled";
};

function unfoldIcs(text: string): string[] {
  // Per RFC5545, continuation lines start with a space or tab and belong to the previous line.
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

// Parse a DTSTART/DTEND value which may be:
//  - "YYYYMMDDTHHMMSSZ" (UTC)
//  - "YYYYMMDDTHHMMSS"  (local / floating; assume Europe/Berlin)
//  - "YYYYMMDD"         (all-day)
// Returns { date: 'YYYY-MM-DD', time: 'HH:MM:SS', dow } in Europe/Berlin wall-clock.
function parseIcsDateTime(value: string, isUtc: boolean): {
  date: string;
  time: string;
  dow: number;
} {
  const compact = value.replace(/[TZ]/g, "");
  const y = Number(compact.slice(0, 4));
  const mo = Number(compact.slice(4, 6));
  const d = Number(compact.slice(6, 8));
  const hh = Number(compact.slice(8, 10) || "0");
  const mm = Number(compact.slice(10, 12) || "0");
  const ss = Number(compact.slice(12, 14) || "0");

  let localDate: Date;
  if (isUtc) {
    // Convert the UTC instant to Europe/Berlin wall-clock.
    const utc = new Date(Date.UTC(y, mo - 1, d, hh, mm, ss));
    localDate = new Date(
      utc.toLocaleString("en-US", { timeZone: "Europe/Berlin" }),
    );
  } else {
    // Treat as Europe/Berlin wall-clock directly.
    localDate = new Date(y, mo - 1, d, hh, mm, ss);
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${localDate.getFullYear()}-${pad(localDate.getMonth() + 1)}-${pad(
      localDate.getDate(),
    )}`,
    time: `${pad(localDate.getHours())}:${pad(localDate.getMinutes())}:${pad(
      localDate.getSeconds(),
    )}`,
    dow: localDate.getDay(),
  };
}

function decodeIcsText(v: string): string {
  return v
    .replace(/\\n/g, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function parseIcs(ics: string): ParsedEvent[] {
  const lines = unfoldIcs(ics);
  const events: ParsedEvent[] = [];
  let cur: Partial<ParsedEvent> & { _rrule?: boolean } = {};
  let inEvent = false;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      inEvent = true;
      continue;
    }
    if (line === "END:VEVENT") {
      if (
        inEvent &&
        !cur._rrule && // skip recurring rules for now — Google will still export the concrete instances
        cur.uid &&
        cur.specific_date &&
        cur.start_time &&
        cur.end_time
      ) {
        events.push({
          uid: cur.uid,
          summary: cur.summary || "",
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
      case "SUMMARY":
        cur.summary = decodeIcsText(val);
        break;
      case "STATUS":
        cur.status = val.trim().toLowerCase() === "cancelled" ? "cancelled" : "confirmed";
        break;
      case "RRULE":
        cur._rrule = true;
        break;
      case "DTSTART": {
        const isUtc = val.endsWith("Z");
        const p = parseIcsDateTime(val, isUtc && !params.TZID);
        cur.specific_date = p.date;
        cur.start_time = p.time;
        cur.day_of_week = p.dow;
        break;
      }
      case "DTEND": {
        const isUtc = val.endsWith("Z");
        const p = parseIcsDateTime(val, isUtc && !params.TZID);
        cur.end_time = p.time;
        break;
      }
    }
  }
  return events;
}

// ── Shift grouping configuration ─────────────────────────────────────────────
// These are the defaults from the spec. Adjust here to change behavior globally.
export const SHIFT_CONFIG = {
  preClassBufferMin: 30,
  postClassBufferMin: 15,
  maxGapMin: 15,
} as const;

type ClassEvent = {
  date: string; // YYYY-MM-DD
  startMin: number; // minutes since midnight
  endMin: number;
};

type GroupedShift = {
  date: string;
  day_of_week: number;
  startMin: number;
  endMin: number;
  classCount: number;
};

function toMin(hhmmss: string): number {
  const [h, m] = hhmmss.split(":").map(Number);
  return h * 60 + m;
}

function minToTime(total: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, total));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

function dowOf(dateStr: string): number {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(y, mo - 1, d).getDay();
}

/** Group consecutive/close classes into operator shifts per the spec rules. */
export function groupClassesIntoShifts(
  classes: ClassEvent[],
  config: { preClassBufferMin: number; postClassBufferMin: number; maxGapMin: number } = SHIFT_CONFIG,
): GroupedShift[] {
  const byDate = new Map<string, ClassEvent[]>();
  for (const c of classes) {
    if (!byDate.has(c.date)) byDate.set(c.date, []);
    byDate.get(c.date)!.push(c);
  }

  const shifts: GroupedShift[] = [];
  for (const [date, dayClasses] of byDate) {
    // Rule 7: sort chronologically
    const sorted = [...dayClasses].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
    let groupStart = sorted[0].startMin;
    let groupEnd = sorted[0].endMin;
    let count = 1;

    for (let i = 1; i < sorted.length; i++) {
      const cls = sorted[i];
      const gap = cls.startMin - groupEnd;
      if (gap <= config.maxGapMin) {
        // Rules 1, 2, 9: merge
        groupEnd = Math.max(groupEnd, cls.endMin);
        count++;
      } else {
        // Rule 3: split
        shifts.push({
          date,
          day_of_week: dowOf(date),
          startMin: groupStart - config.preClassBufferMin,
          endMin: groupEnd + config.postClassBufferMin,
          classCount: count,
        });
        groupStart = cls.startMin;
        groupEnd = cls.endMin;
        count = 1;
      }
    }
    shifts.push({
      date,
      day_of_week: dowOf(date),
      startMin: groupStart - config.preClassBufferMin,
      endMin: groupEnd + config.postClassBufferMin,
      classCount: count,
    });
  }

  shifts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin));
  return shifts;
}

export type GcalSyncResult = {
  ok: boolean;
  fetched: number; // classes imported
  shifts: number; // shifts generated
  removed: number; // stale generated shifts deleted
  error?: string;
};

export const syncGoogleCalendar = createServerFn({ method: "POST" }).handler(
  async (): Promise<GcalSyncResult> => {
    const { username } = await requireOperator();
    const { displayName, icsUrl } = await loadOperatorCalendar(username);
    if (!icsUrl) {
      return {
        ok: false,
        fetched: 0,
        shifts: 0,
        removed: 0,
        error: "No calendar link set. Click the settings icon next to Sync to paste your public Google Calendar ICS link.",
      };
    }

    let icsText: string;
    try {
      const res = await fetch(icsUrl, { headers: { Accept: "text/calendar" } });
      if (!res.ok) {
        return {
          ok: false,
          fetched: 0,
          shifts: 0,
          removed: 0,
          error: `Calendar link returned HTTP ${res.status}. In Google Calendar → Settings → "Access permissions", enable "Make available to public" and copy the "Public address in iCal format".`,
        };
      }
      icsText = await res.text();
    } catch (e) {
      return {
        ok: false,
        fetched: 0,
        shifts: 0,
        removed: 0,
        error: e instanceof Error ? e.message : "Failed to fetch calendar",
      };
    }

    const events = parseIcs(icsText);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Spec: import calendar events for the next 4 weeks. Include today.
    const now = new Date();
    const todayStr = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      .toISOString()
      .slice(0, 10);
    const upperDate = new Date(now.getTime() + 28 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);

    // Filter to window + drop cancelled classes (Rule 10 — a removed class must not participate in grouping).
    const activeClasses: ClassEvent[] = events
      .filter((e) => e.status !== "cancelled")
      .filter((e) => e.specific_date >= todayStr && e.specific_date <= upperDate)
      .map((e) => ({
        date: e.specific_date,
        startMin: toMin(e.start_time),
        endMin: toMin(e.end_time),
      }));

    const grouped = groupClassesIntoShifts(activeClasses);

    // Deterministic external id per generated shift so re-runs are idempotent.
    const shiftUid = (date: string, startMin: number) =>
      `op:${displayName.toLowerCase()}:shift:${date}:${String(Math.floor(startMin / 60)).padStart(2, "0")}${String(startMin % 60).padStart(2, "0")}`;

    // Rule 8/10/11: fully regenerate the operator's shifts in the window rather than diffing per event.
    // Only delete rows this sync feature produced (external_event_id prefixed op:<user>:shift:).
    const prefix = `op:${displayName.toLowerCase()}:shift:`;
    const { data: existingRows, error: exErr } = await supabaseAdmin
      .from("scheduled_shifts")
      .select("id, external_event_id, specific_date")
      .like("external_event_id", `${prefix}%`)
      .gte("specific_date", todayStr)
      .lte("specific_date", upperDate);
    if (exErr) throw new Error(exErr.message);

    const desiredUids = new Set(grouped.map((g) => shiftUid(g.date, g.startMin)));
    const staleIds = (existingRows ?? [])
      .filter((r) => !r.external_event_id || !desiredUids.has(r.external_event_id))
      .map((r) => r.id);
    let removed = 0;
    if (staleIds.length) {
      const { error: delErr } = await supabaseAdmin
        .from("scheduled_shifts")
        .delete()
        .in("id", staleIds);
      if (delErr) throw new Error(delErr.message);
      removed = staleIds.length;
    }

    const existingUids = new Set(
      (existingRows ?? [])
        .map((r) => r.external_event_id)
        .filter((v): v is string => Boolean(v)),
    );

    // Upsert generated shifts.
    for (const s of grouped) {
      const uid = shiftUid(s.date, s.startMin);
      const payload = {
        day_of_week: s.day_of_week,
        start_time: minToTime(s.startMin),
        end_time: minToTime(s.endMin),
        label: s.classCount === 1 ? "1 class" : `${s.classCount} classes`,
        specific_date: s.date,
        assigned_operator: displayName,
        status: "assigned",
        external_event_id: uid,
      };
      if (existingUids.has(uid)) {
        const { error } = await supabaseAdmin
          .from("scheduled_shifts")
          .update(payload)
          .eq("external_event_id", uid);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabaseAdmin.from("scheduled_shifts").insert(payload);
        if (error) throw new Error(error.message);
      }
    }

    return {
      ok: true,
      fetched: activeClasses.length,
      shifts: grouped.length,
      removed,
    };
  },
);

