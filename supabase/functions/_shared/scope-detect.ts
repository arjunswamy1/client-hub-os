// SCOPE-EVENT DETECTION — an ad account appearing in a client's spend data that
// was not seen in the prior 30 days is an `accounts_added` scope change, dated
// the first day it spent. Detected from the data, never typed in by hand, so a
// phased hand-over (one account at a time) logs itself.
//
// Writes only to client_scope_events, idempotently (one event per account).
// Reads spend tables; never writes to them.
import { addDays } from './reporting-day.ts';

export const NEW_ACCOUNT_LOOKBACK_DAYS = 30;
/** How far back a first appearance is searched for on each run. */
export const DETECT_WINDOW_DAYS = 7;

/** Spend tables that carry an ad-account id, and the column it lives in. */
const ACCOUNT_COLUMNS: { table: string; col: string; source: string; filter?: [string, string] }[] = [
  { table: 'roku_daily_metrics', col: 'account_uid', source: 'roku_daily_metrics', filter: ['entity', 'campaign'] },
  { table: 'ad_campaigns', col: 'account_id', source: 'ad_daily_metrics' },
];
const PLACEHOLDER = new Set(['', 'default', 'unknown', 'null']);

export interface DetectedAccount { account: string; table: string; firstDate: string }

/** Pure: first spend date per account in the detect window, for accounts absent from the lookback. */
export function newAccounts(rows: { date: string; account: string }[], forDate: string): { account: string; firstDate: string }[] {
  const windowStart = addDays(forDate, -(DETECT_WINDOW_DAYS - 1));
  const first = new Map<string, string>();
  for (const r of rows) {
    if (!r.account || PLACEHOLDER.has(r.account.toLowerCase())) continue;
    const prev = first.get(r.account);
    if (!prev || r.date < prev) first.set(r.account, r.date);
  }
  const out: { account: string; firstDate: string }[] = [];
  for (const [account, firstDate] of first) {
    if (firstDate < windowStart || firstDate > forDate) continue;
    // Only "new" when the read actually reached 30 days before its first spend.
    const earliestRead = rows.reduce((m, r) => (r.date < m ? r.date : m), forDate);
    if (earliestRead > addDays(firstDate, -NEW_ACCOUNT_LOOKBACK_DAYS)) continue;
    out.push({ account, firstDate });
  }
  return out;
}

export async function detectAccountsAdded(
  db: any, client: { id: string; spend_source_tables?: string[] | null }, forDate: string,
): Promise<{ inserted: DetectedAccount[]; uncovered: string[] }> {
  const inserted: DetectedAccount[] = [];
  const uncovered: string[] = [];
  const from = addDays(forDate, -(DETECT_WINDOW_DAYS + NEW_ACCOUNT_LOOKBACK_DAYS));
  for (const spec of ACCOUNT_COLUMNS) {
    if (!(client.spend_source_tables ?? []).includes(spec.source)) continue;
    let q = db.from(spec.table).select(`date, ${spec.col}, spend`).eq('client_id', client.id)
      .gte('date', from).lte('date', forDate).gt('spend', 0);
    if (spec.filter) q = q.eq(spec.filter[0], spec.filter[1]);
    const { data, error } = await q.limit(50000);
    if (error) throw new Error(`${spec.table} accounts: ${error.message}`);
    const rows = (data ?? []).map((r: any) => ({ date: String(r.date).slice(0, 10), account: r[spec.col] ? String(r[spec.col]) : '' }));
    if (rows.length && rows.every((r: { account: string }) => !r.account)) {
      uncovered.push(`${spec.table} carries no account id for this client, so new ad accounts cannot be detected from it`);
      continue;
    }
    for (const n of newAccounts(rows, forDate)) {
      const { data: existing } = await db.from('client_scope_events').select('id')
        .eq('client_id', client.id).eq('kind', 'accounts_added').eq('detail->>account_id', n.account).limit(1).maybeSingle();
      if (existing) continue;
      const { error: insErr } = await db.from('client_scope_events').insert({
        client_id: client.id, effective_date: n.firstDate, kind: 'accounts_added',
        description: `Ad account ${n.account} first spent on ${n.firstDate} (not seen in the prior ${NEW_ACCOUNT_LOOKBACK_DAYS} days)`,
        detail: { account_id: n.account, table: spec.table, detected: true },
        recorded_by: 'auto: draft-daily-updates',
      });
      if (insErr) throw new Error(`client_scope_events insert: ${insErr.message}`);
      inserted.push({ account: n.account, table: spec.table, firstDate: n.firstDate });
    }
  }
  return { inserted, uncovered };
}
