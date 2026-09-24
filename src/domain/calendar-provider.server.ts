/**
 * Calendar provider boundary (Operation 4) — server only.
 *
 *   Google ICS → GoogleIcsCalendarProvider → CalendarCommitment[] → domain logic
 *
 * The provider owns everything Google/ICS-specific: fetching the feed, walking
 * redirects through the SSRF guard, and parsing the calendar into dated
 * commitments. It decides nothing about Dance Masterclass classes, shifts or
 * scheduling — that stays in the domain. Behaviour, error messages and parsing
 * are exactly what `runCalendarImport` performed before this boundary existed.
 */
import { parseIcs, safeCalendarUrl, type ParsedEvent } from "@/lib/gcal-core";
import type { CalendarCommitment } from "./types";

/** Provider-specific detail is preserved on `raw` during the migration. */
export type GoogleCommitment = CalendarCommitment<ParsedEvent>;

export type CommitmentWindow = { from: string; to: string };

export type FetchCommitmentsResult =
  | { ok: true; commitments: GoogleCommitment[] }
  | { ok: false; error: string };

export interface CalendarProvider {
  readonly source: "google-ics";
  fetchCommitments(feedUrl: string, window: CommitmentWindow): Promise<FetchCommitmentsResult>;
}

function toCommitment(event: ParsedEvent): GoogleCommitment {
  return {
    source: "google-ics",
    externalEventId: event.uid,
    date: event.specific_date,
    startTime: event.start_time,
    endTime: event.end_time,
    allDay: event.allDay,
    status: event.status,
    title: event.summary,
    raw: event,
  };
}

export const googleIcsCalendarProvider: CalendarProvider = {
  source: "google-ics",

  async fetchCommitments(feedUrl, window) {
    const safeUrl = safeCalendarUrl(feedUrl);
    if (!safeUrl) {
      return { ok: false, error: "That calendar link is not an allowed public https address." };
    }

    let icsText: string;
    try {
      // The edge runtime does not support redirect: "error"; follow redirects
      // manually so every hop can be re-validated against the SSRF guard.
      let target = safeUrl;
      let res: Response | null = null;
      for (let hop = 0; hop < 5; hop++) {
        res = await fetch(target, {
          headers: { Accept: "text/calendar, text/plain;q=0.9, */*;q=0.8" },
          redirect: "manual",
        });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          if (!loc) break;
          const next = safeCalendarUrl(new URL(loc, target).toString());
          if (!next) {
            return { ok: false, error: "That calendar link redirects to a blocked address." };
          }
          target = next;
          continue;
        }
        break;
      }
      if (!res || !res.ok) {
        return {
          ok: false,
          error: `Calendar link returned HTTP ${res ? res.status : "error"}. In Google Calendar → Settings → "Access permissions", enable "Make available to public" and copy the "Public address in iCal format".`,
        };
      }
      icsText = await res.text();
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Failed to fetch calendar" };
    }

    if (!/BEGIN:VCALENDAR/i.test(icsText)) {
      return {
        ok: false,
        error:
          'That link did not return calendar data. Use the "Public address in iCal format" (ends in .ics) from Google Calendar settings.',
      };
    }

    const [fy, fm, fd] = window.from.split("-").map(Number);
    const [ty, tm, td] = window.to.split("-").map(Number);
    const events = parseIcs(icsText, {
      from: new Date(fy, fm - 1, fd),
      to: new Date(ty, tm - 1, td, 23, 59, 59),
    });
    return { ok: true, commitments: events.map(toCommitment) };
  },
};
