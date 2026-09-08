/**
 * DMC timetable provider boundary (Operation 5) — server only.
 *
 *   DMC public API → DmcPublicTimetableProvider → validated snapshot → service
 *
 * The provider owns everything DMC-API-specific: the endpoint, the HTTP call
 * and the raw payload shape. It creates no shifts, assigns no operators, and
 * knows nothing about Google Calendar or attendance. The raw response stops
 * here; the rest of the app only ever sees the normalized snapshot.
 */
import { normalizeDmcPayload, type NormalizeResult } from "./timetable-normalize";

export const DMC_PUBLIC_TIMETABLE_URL =
  "https://scheduleclassesmanager-356018239005.europe-west1.run.app/get-public-data";

const REQUEST_TIMEOUT_MS = 20_000;

export interface TimetableProvider {
  readonly source: "dmc-public-api";
  fetchTimetable(): Promise<NormalizeResult>;
}

export const dmcPublicTimetableProvider: TimetableProvider = {
  source: "dmc-public-api",

  async fetchTimetable(): Promise<NormalizeResult> {
    let payload: unknown;
    try {
      const res = await fetch(DMC_PUBLIC_TIMETABLE_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        return { ok: false, error: `Timetable service returned HTTP ${res.status}.` };
      }
      payload = await res.json();
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? `Could not reach the timetable service: ${e.message}` : "Could not reach the timetable service.",
      };
    }
    return normalizeDmcPayload(payload, new Date().toISOString());
  },
};
