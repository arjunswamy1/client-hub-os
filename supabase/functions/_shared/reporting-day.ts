/**
 * WHICH DAY IS "YESTERDAY"?
 *
 * A call feed stores an instant (`call_start`), a spend feed stores a calendar
 * date the platform already cut in its own timezone. Reading the call feed on
 * UTC midnight while comparing it to those dates silently mixes two different
 * days: on Spektrafin, 2026-09-19 held 638 calls on the account's reporting day
 * but 815 on the UTC day, because 177 of them belong to the 18th locally. That
 * is how a one-day question came back looking like a wider range.
 *
 * So the reporting timezone is an ACCOUNT FACT, read from clients.reporting_timezone
 * (RingFuel reports Spektrafin and Jacuzzi on America/Puerto_Rico, a fixed UTC-4).
 * Unrecorded means UTC, which is what the feed's own timestamps are stored in —
 * never a guess at a local day.
 */

export const UTC_TZ = 'UTC';

function offsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60000);
}

function offsetSuffix(timeZone: string, isoDate: string): string {
  if (!timeZone || timeZone.toUpperCase() === 'UTC') return 'Z';
  const mins = offsetMinutes(timeZone, new Date(`${isoDate}T12:00:00.000Z`));
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export function reportingTimeZone(client: { reporting_timezone?: string | null }): string {
  const tz = (client.reporting_timezone || '').trim();
  return tz.length ? tz : UTC_TZ;
}

/** Inclusive timestamp bounds for a calendar window, cut on the account's reporting day. */
export function reportingWindowBounds(
  window: { from: string; to: string },
  timeZone: string,
): { startTs: string; endTs: string } {
  return {
    startTs: `${window.from}T00:00:00.000${offsetSuffix(timeZone, window.from)}`,
    endTs: `${window.to}T23:59:59.999${offsetSuffix(timeZone, window.to)}`,
  };
}

/** The calendar day a timestamp falls on IN the account's reporting timezone. */
export function reportingDay(value: unknown, timeZone: string): string {
  const raw = String(value ?? '');
  if (!raw) return '';
  if (!timeZone || timeZone.toUpperCase() === 'UTC') return raw.slice(0, 10);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  const y = get('year'), m = get('month'), day = get('day');
  return y && m && day ? `${y}-${m}-${day}` : raw.slice(0, 10);
}

/** How the day was cut, for the answer to say out loud when it is not UTC. */
export function reportingDayNote(timeZone: string): string {
  return timeZone === UTC_TZ
    ? 'Days are cut on UTC, matching the feed timestamps.'
    : `Days are cut on this account's reporting timezone (${timeZone}), matching the platform's own daily reporting.`;
}
