/**
 * WHICH DAY IS "YESTERDAY"?  — the one helper every reporting-path day cut uses.
 *
 * A call feed stores an instant (`call_start`), a spend feed stores a calendar
 * date the platform already cut in its own timezone. Reading the call feed on
 * UTC midnight while comparing it to those dates silently mixes two different
 * days: on Spektrafin, 2026-09-19 held 638 calls on the account's reporting day
 * but 815 on the UTC day, because 177 of them belong to the 18th locally.
 *
 * So the reporting timezone is an ACCOUNT FACT, read from clients.reporting_timezone
 * (RingFuel reports Spektrafin and Jacuzzi on America/Puerto_Rico). When it is not
 * recorded the day is cut on America/New_York — the agency's operating day.
 * No reporting-path code buckets a day on UTC.
 */

export const FALLBACK_TZ = 'America/New_York';

/** Offset of `timeZone` from UTC in ms at an instant (DST aware). */
function offsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

export function reportingTimeZone(client: { reporting_timezone?: string | null }): string {
  const tz = (client.reporting_timezone || '').trim();
  return tz.length ? tz : FALLBACK_TZ;
}

export const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The UTC instant at which local midnight starts `isoDate` in `timeZone`. Two passes settle DST. */
export function dayStartsAt(isoDate: string, timeZone: string): Date {
  const naive = Date.parse(`${isoDate}T00:00:00Z`);
  let utc = naive - offsetMs(timeZone, new Date(naive));
  utc = naive - offsetMs(timeZone, new Date(utc));
  return new Date(utc);
}

/** The UTC instant at which `isoDate` ends (closes) in `timeZone`. */
export function dayEndsAt(isoDate: string, timeZone: string): Date {
  return dayStartsAt(addDays(isoDate, 1), timeZone);
}

/** Inclusive timestamp bounds for a calendar window, cut on the account's reporting day. */
export function reportingWindowBounds(
  window: { from: string; to: string },
  timeZone: string,
): { startTs: string; endTs: string } {
  return {
    startTs: dayStartsAt(window.from, timeZone).toISOString(),
    endTs: new Date(dayEndsAt(window.to, timeZone).getTime() - 1).toISOString(),
  };
}

/** The calendar day a timestamp falls on IN the account's reporting timezone. */
export function reportingDay(value: unknown, timeZone: string): string {
  const raw = String(value ?? '');
  if (!raw) return '';
  // A bare date is already a calendar day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  const y = get('year'), m = get('month'), day = get('day');
  return y && m && day ? `${y}-${m}-${day}` : raw.slice(0, 10);
}

/** Yesterday (D-1) in the account's reporting timezone. Today is never reported on. */
export function reportingYesterday(timeZone: string, now: Date = new Date()): string {
  return addDays(reportingDay(now.toISOString(), timeZone), -1);
}

/** 0 = Sunday, for a calendar date. */
export const weekdayIndex = (isoDate: string): number => new Date(`${isoDate}T12:00:00Z`).getUTCDay();

/** How the day was cut, for the answer to say out loud. */
export function reportingDayNote(timeZone: string): string {
  return `Days are cut on this account's reporting timezone (${timeZone}).`;
}
