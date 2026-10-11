// Spektrafin / RingFuel call-quality rules. Pure: no I/O, tests import it.
// Unknown stays unknown (null) — never coerced to zero or false.

/** End reasons that mean the caller never reached a live target, whatever the duration says. */
const NOT_CONNECTED = [
  /target did not answer/i,
  /no answer from any target/i,
  /no answer/i,
  /SIP:?\s*(486|487|180|183|503)\b/i,
  /hung up before the call connected/i,
  /abandon/i,
  /while ringing/i,
];

export interface RingFuelCallLike {
  end_reason?: string | null;
  connection_duration_seconds?: number | null;
  caller_number?: string | null;
  revenue?: number | null;
  revenue_reconciled?: boolean | null;
  call_start?: string | null;
}

/** Strict connected: end reason AND connected duration together. Missing end reason = unknown. */
export function strictConnected(c: RingFuelCallLike): boolean | null {
  if (!c.end_reason) return null;
  if (NOT_CONNECTED.some((re) => re.test(c.end_reason!))) return false;
  return (c.connection_duration_seconds ?? 0) > 0;
}

export const SETTLE_REVENUE_AFTER_DAYS = 7;

/** Revenue is settled once a reconciliation merged the call, or after the settle window. */
export function revenueSettled(c: RingFuelCallLike, now: Date): boolean {
  if (c.revenue_reconciled) return true;
  if (!c.call_start) return false;
  return now.getTime() - new Date(c.call_start).getTime() > SETTLE_REVENUE_AFTER_DAYS * 86400000;
}

export interface CallQualitySummary {
  calls: number;
  strict_connected: number | null;
  strict_connected_coverage: number;
  acl_seconds: number | null;
  median_seconds: number | null;
  share_at: { s90: number; m10: number; m20: number; m30: number } | null;
  unique_callers: number | null;
  repeat_call_rate: number | null;
  revenue_provisional: boolean;
  withheld: string[];
}

export function summariseCalls(rows: RingFuelCallLike[], now: Date): CallQualitySummary {
  const withheld: string[] = [];
  const judged = rows.map(strictConnected);
  const known = judged.filter((v) => v !== null);
  const coverage = rows.length ? known.length / rows.length : 0;
  const strict = rows.length && known.length === rows.length ? known.filter(Boolean).length : null;
  if (strict === null) withheld.push(`strict connected: end reason missing on ${rows.length - known.length} of ${rows.length} calls`);

  const durs = rows.filter((_, i) => judged[i] === true).map((r) => r.connection_duration_seconds ?? 0).sort((a, b) => a - b);
  let acl: number | null = null, median: number | null = null, share: CallQualitySummary['share_at'] = null;
  if (strict !== null && durs.length) {
    acl = durs.reduce((a, b) => a + b, 0) / durs.length;
    const m = Math.floor(durs.length / 2);
    median = durs.length % 2 ? durs[m] : (durs[m - 1] + durs[m]) / 2;
    const at = (s: number) => durs.filter((d) => d >= s).length / durs.length;
    share = { s90: at(90), m10: at(600), m20: at(1200), m30: at(1800) };
  } else withheld.push('durations: no strictly connected calls with known end reason');

  const callers = rows.map((r) => r.caller_number).filter((x): x is string => !!x);
  let unique: number | null = null, repeat: number | null = null;
  if (rows.length && callers.length === rows.length) {
    unique = new Set(callers).size;
    repeat = 1 - unique / callers.length;
  } else withheld.push(`callers: caller number missing on ${rows.length - callers.length} of ${rows.length} calls`);

  return {
    calls: rows.length, strict_connected: strict, strict_connected_coverage: coverage,
    acl_seconds: acl, median_seconds: median, share_at: share,
    unique_callers: unique, repeat_call_rate: repeat,
    revenue_provisional: rows.some((r) => !revenueSettled(r, now)),
    withheld,
  };
}

/** Calls per 1,000 impressions; withheld (null) when the spend source reported no impressions. */
export function callsPerThousandImpressions(calls: number, impressions: number | null | undefined): number | null {
  if (!impressions || impressions <= 0) return null;
  return (calls / impressions) * 1000;
}
