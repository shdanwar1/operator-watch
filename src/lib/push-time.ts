/**
 * Berlin wall clock -> absolute instant.
 *
 * Scheduled shifts are stored as a Berlin date plus a Berlin time. Push
 * scheduling needs a real instant, so the offset is measured on the shift's
 * own date (at midday, where it is never ambiguous).
 */
export function berlinInstant(dateKey: string, time: string): Date | null {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;

  const noonUtc = Date.UTC(y, m - 1, d, 12, 0, 0);
  const asBerlin = new Date(new Date(noonUtc).toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
  const offsetMinutes = Math.round((asBerlin.getTime() - noonUtc) / 60000);

  return new Date(Date.UTC(y, m - 1, d, hh, mm, 0) - offsetMinutes * 60_000);
}

/** "07:30" in Berlin for an absolute instant. */
export function berlinClock(at: Date): string {
  return at.toLocaleTimeString("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  });
}
