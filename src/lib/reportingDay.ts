/**
 * Reporting-day helpers.
 *
 * A call feed stores timestamps in UTC, but the platform that reports on it cuts
 * its day in its own timezone. CallGrid reports Cannaball and PPC Media in
 * US/Eastern, so bucketing those calls on UTC midnight puts late-evening calls
 * on the wrong day and a single-day total never matches the platform.
 */

/** Offset of `timeZone` from UTC, in ms, at the given instant (DST aware). */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - instant.getTime();
}

/** The UTC instant of `yyyy-MM-dd HH:mm:ss` wall-clock time in `timeZone`. */
export function zonedTimeToUtcISO(dateStr: string, timeOfDay: string, timeZone: string): string {
  const naive = Date.parse(`${dateStr}T${timeOfDay}Z`);
  // Two passes settle DST boundaries.
  let utc = naive - zoneOffsetMs(new Date(naive), timeZone);
  utc = naive - zoneOffsetMs(new Date(utc), timeZone);
  return new Date(utc).toISOString();
}

/** The `yyyy-MM-dd` calendar day an instant falls on in `timeZone`. */
export function reportingDay(instant: string | Date, timeZone: string): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** CallGrid reports both CallGrid accounts in US/Eastern. */
export const CALLGRID_REPORTING_TZ = "America/New_York";
