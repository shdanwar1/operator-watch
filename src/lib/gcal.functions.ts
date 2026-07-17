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

// Per-operator calendars. Add more entries here as other operators share
// their personal Google Calendar. Keys are lowercased usernames.
const OPERATOR_CALENDARS: Record<string, { calendarId: string; displayName: string }> = {
  shad: {
    calendarId: "shdanwar1@gmail.com",
    displayName: "Shad",
  },
};

async function requireOperatorWithCalendar() {
  const session = await useSession<GateSession>(getSessionConfig());
  const username = (session.data.username ?? "").toLowerCase();
  if (!session.data.unlocked || session.data.isAdmin) {
    throw new Response("Unauthorized", { status: 401 });
  }
  const cfg = OPERATOR_CALENDARS[username];
  if (!cfg) throw new Response("No calendar configured for this operator", { status: 404 });
  return cfg;
}

function icsUrlFor(calendarId: string) {
  return `https://calendar.google.com/calendar/ical/${encodeURIComponent(
    calendarId,
  )}/public/basic.ics`;
}

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

export type GcalSyncResult = {
  ok: boolean;
  fetched: number;
  created: number;
  updated: number;
  cancelled: number;
  error?: string;
};

export const syncGoogleCalendar = createServerFn({ method: "POST" }).handler(
  async (): Promise<GcalSyncResult> => {
    await requireAdmin();
    let icsText: string;
    try {
      const res = await fetch(ICS_URL, {
        headers: { Accept: "text/calendar" },
      });
      if (!res.ok) {
        return {
          ok: false,
          fetched: 0,
          created: 0,
          updated: 0,
          cancelled: 0,
          error: `Calendar is not public (HTTP ${res.status}). In Google Calendar → Settings for this calendar → “Access permissions for events”, enable “Make available to public” with “See all event details”.`,
        };
      }
      icsText = await res.text();
    } catch (e) {
      return {
        ok: false,
        fetched: 0,
        created: 0,
        updated: 0,
        cancelled: 0,
        error: e instanceof Error ? e.message : "Failed to fetch calendar",
      };
    }

    const events = parseIcs(icsText);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Only import upcoming / recent events (past 7 days → +180 days) to keep the table lean.
    const now = new Date();
    const lower = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    const upper = new Date(now.getTime() + 180 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    const inRange = events.filter(
      (e) => e.specific_date >= lower && e.specific_date <= upper,
    );

    // Fetch existing rows keyed by external_event_id in one query.
    const uids = inRange.map((e) => e.uid);
    const existingMap = new Map<string, { id: string; status: string }>();
    if (uids.length) {
      const { data: existing, error: exErr } = await supabaseAdmin
        .from("scheduled_shifts")
        .select("id, external_event_id, status")
        .in("external_event_id", uids);
      if (exErr) throw new Error(exErr.message);
      for (const row of existing ?? []) {
        if (row.external_event_id) {
          existingMap.set(row.external_event_id, { id: row.id, status: row.status });
        }
      }
    }

    let created = 0;
    let updated = 0;
    let cancelled = 0;

    for (const ev of inRange) {
      const existing = existingMap.get(ev.uid);
      const payload = {
        day_of_week: ev.day_of_week,
        start_time: ev.start_time,
        end_time: ev.end_time,
        label: ev.summary || null,
        specific_date: ev.specific_date,
        assigned_operator: null as string | null,
        status: ev.status === "cancelled" ? "cancelled" : "unassigned",
        external_event_id: ev.uid,
      };

      if (existing) {
        // Only overwrite fields sourced from GCal; preserve assigned_operator if admin already set one.
        const { data: cur } = await supabaseAdmin
          .from("scheduled_shifts")
          .select("assigned_operator")
          .eq("id", existing.id)
          .maybeSingle();
        const patch = {
          day_of_week: payload.day_of_week,
          start_time: payload.start_time,
          end_time: payload.end_time,
          label: payload.label,
          specific_date: payload.specific_date,
          status:
            ev.status === "cancelled"
              ? "cancelled"
              : cur?.assigned_operator
                ? "assigned"
                : "unassigned",
        };
        const { error } = await supabaseAdmin
          .from("scheduled_shifts")
          .update(patch)
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
        if (ev.status === "cancelled") cancelled++;
        else updated++;
      } else {
        const { error } = await supabaseAdmin.from("scheduled_shifts").insert(payload);
        if (error) throw new Error(error.message);
        created++;
      }
    }

    return {
      ok: true,
      fetched: inRange.length,
      created,
      updated,
      cancelled,
    };
  },
);
