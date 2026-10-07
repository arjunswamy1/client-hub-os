// SYNC-ACCURACY CHECKS — one implementation, read by the agent MCP server
// (`mcp-hub` → get_data_health) and the /data-health page (`data-health`).
//
// Every failure mode we hit in the fortnight to 7 Oct 2026 is a check here:
//   freshness · provisional days · duplicate campaign rows · rows loaded after
//   the 9am draft · publisher scope · zero versus missing · config mismatches.
// Each check returns ok / warn / fail with one human sentence. Read-only: this
// module never writes to any table.
// deno-lint-ignore-file no-explicit-any
import type { ResolvedClientRow } from './client-resolve.ts';
import { addDays, reportingDay, reportingTimeZone, reportingYesterday, dayEndsAt } from './reporting-day.ts';
import { loadDayStates } from './metric-comparison-data.ts';
import { isProvisional, type DayState, type Observation } from './metric-comparisons.ts';
import { LOGGED_SPEND_SOURCES } from './metric-revision-log.ts';
import { publisherColumns, readPublisher } from './publisher-scope.ts';

export type HealthStatus = 'ok' | 'warn' | 'fail';

export interface HealthCheck {
  check: 'freshness' | 'provisional' | 'duplicate_rows' | 'loaded_after_run' | 'publisher_scope' | 'zero_vs_missing' | 'config_mismatch';
  source: string | null;
  status: HealthStatus;
  explanation: string;
  detail?: Record<string, unknown>;
}

export interface ClientHealth {
  client_id: string;
  client: string;
  timezone: string;
  latest_reporting_day: string;
  overall: HealthStatus;
  checks: HealthCheck[];
  days: { date: string; state: DayState }[];
  tables_read: string[];
}

interface SourceSpec {
  dateCol: string;
  isTimestamp: boolean;
  /** Hours between expected loads before a source counts as stale. */
  cadenceHours: number;
  kind: 'spend' | 'call' | 'lead';
  entityCampaign?: boolean;
  hasUpdatedAt: boolean;
  /** platform_connections.platform values that sync this source. */
  platforms?: string[];
}

export const SOURCE_SPECS: Record<string, SourceSpec> = {
  ad_daily_metrics: { dateCol: 'date', isTimestamp: false, cadenceHours: 30, kind: 'spend', hasUpdatedAt: false, platforms: ['meta', 'google'] },
  roku_daily_metrics: { dateCol: 'date', isTimestamp: false, cadenceHours: 30, kind: 'spend', entityCampaign: true, hasUpdatedAt: true, platforms: ['roku'] },
  cannaball_spend: { dateCol: 'date', isTimestamp: false, cadenceHours: 30, kind: 'spend', hasUpdatedAt: true },
  universal_ads_geo_metrics: { dateCol: 'date', isTimestamp: false, cadenceHours: 30, kind: 'spend', entityCampaign: true, hasUpdatedAt: true, platforms: ['universal_ads'] },
  ringfuel_calls: { dateCol: 'call_start', isTimestamp: true, cadenceHours: 26, kind: 'call', hasUpdatedAt: true },
  ringba_calls: { dateCol: 'call_date', isTimestamp: true, cadenceHours: 26, kind: 'call', hasUpdatedAt: false },
  ringba_calls_4js: { dateCol: 'call_start', isTimestamp: true, cadenceHours: 26, kind: 'call', hasUpdatedAt: false },
  moja_calls: { dateCol: 'call_start', isTimestamp: true, cadenceHours: 26, kind: 'call', hasUpdatedAt: true },
  cannaball_calls: { dateCol: 'call_start', isTimestamp: true, cadenceHours: 26, kind: 'call', hasUpdatedAt: false },
  // The client's lead sheet is uploaded by hand on weekdays — a weekend gap is normal.
  jacuzzi_leads: { dateCol: 'transaction_date', isTimestamp: false, cadenceHours: 74, kind: 'lead', hasUpdatedAt: false },
};
const CALL_TABLES = Object.entries(SOURCE_SPECS).filter(([, s]) => s.kind !== 'spend').map(([t]) => t);

export const HEALTH_DAYS = 14;
/** Late rows above this share of a day's rows make that day "loaded after the run". */
export const LATE_SHARE = 0.1;
/** Unrecorded-publisher share above which a confirmed scope is a warning. */
export const UNRECORDED_SHARE = 0.05;

const rank: Record<HealthStatus, number> = { ok: 0, warn: 1, fail: 2 };
export const worst = (xs: HealthStatus[]): HealthStatus => xs.reduce<HealthStatus>((a, b) => (rank[b] > rank[a] ? b : a), 'ok');
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

async function pagedRead(make: (a: number, b: number) => any, cap = 60000): Promise<any[]> {
  const out: any[] = [];
  for (let off = 0; off < cap; off += 1000) {
    const { data, error } = await make(off, off + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

/** The tables a client's figures depend on: configured feeds plus Jacuzzi's lead sheet. */
export function sourcesFor(client: ResolvedClientRow): string[] {
  const s = new Set([...(client.spend_source_tables ?? []), ...(client.call_source_tables ?? [])]);
  if (client.slug === 'jacuzzi') s.add('jacuzzi_leads');
  return [...s].filter((t) => SOURCE_SPECS[t]);
}

/** Pure: the duplicate-row rule over ad_campaigns rows. Exported for tests. */
export function findDuplicateCampaignRows(rows: { date: string; campaign_name: string | null; spend: number | null }[]) {
  const groups = new Map<string, Set<string>>();
  for (const r of rows) {
    const spend = Number(r.spend ?? 0);
    if (!(spend > 0)) continue;
    const k = `${String(r.date).slice(0, 10)}|${spend.toFixed(2)}`;
    if (!groups.has(k)) groups.set(k, new Set());
    groups.get(k)!.add(String(r.campaign_name ?? ''));
  }
  return [...groups.entries()].filter(([, names]) => names.size > 1)
    .map(([k, names]) => ({ date: k.split('|')[0], spend: Number(k.split('|')[1]), names: [...names] }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Pure: per reporting day, rows created after that day's first draft run. Exported for tests. */
export function lateLoads(rows: { day: string; created_at: string }[], runAt: Map<string, string>) {
  const byDay = new Map<string, { total: number; late: number }>();
  for (const r of rows) {
    const e = byDay.get(r.day) ?? { total: 0, late: 0 };
    e.total++;
    const run = runAt.get(r.day);
    if (run && r.created_at > run) e.late++;
    byDay.set(r.day, e);
  }
  return [...byDay.entries()].filter(([d, e]) => runAt.has(d) && e.late > 0)
    .map(([day, e]) => ({ day, late: e.late, total: e.total, run_at: runAt.get(day)!, share: e.late / e.total }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** Pure: the zero-versus-missing summary for a run of day states. */
export function summariseDays(days: { date: string; state: DayState }[]): HealthCheck {
  const missing = days.filter((d) => d.state === 'missing').map((d) => d.date);
  const dark = days.filter((d) => d.state === 'no_delivery').map((d) => d.date);
  return {
    check: 'zero_vs_missing', source: null,
    status: missing.length ? 'warn' : 'ok',
    explanation: missing.length
      ? `${missing.length} of ${days.length} days have no spend row at all (missing, not zero): ${missing.join(', ')}.${dark.length ? ` ${dark.length} dark day(s) recorded as $0: ${dark.join(', ')}.` : ''}`
      : `Every one of the last ${days.length} days has spend rows${dark.length ? `; ${dark.length} were recorded dark ($0, no delivery): ${dark.join(', ')}` : ''}.`,
    detail: { missing, no_delivery: dark },
  };
}

export async function clientHealth(db: any, client: ResolvedClientRow, now: Date = new Date()): Promise<ClientHealth> {
  const tz = reportingTimeZone(client);
  const latest = reportingYesterday(tz, now);
  const from = addDays(latest, -(HEALTH_DAYS - 1));
  const sources = sourcesFor(client);
  const read = new Set<string>(['clients']);
  const checks: HealthCheck[] = [];

  // Draft run times per reporting day: the first saved draft or the first live run.
  const runAt = new Map<string, string>();
  const [{ data: drafts }, { data: runs }, { data: conns }] = await Promise.all([
    db.from('client_daily_updates').select('for_date, created_at').eq('client_id', client.id).gte('for_date', from).lte('for_date', latest),
    db.from('daily_update_run_log').select('for_date, created_at, dry_run').eq('client_id', client.id).eq('dry_run', false).gte('for_date', from).lte('for_date', latest),
    db.from('platform_connections').select('platform, last_synced_at, sync_error, status').eq('client_id', client.id),
  ]);
  read.add('client_daily_updates'); read.add('daily_update_run_log'); read.add('platform_connections');
  for (const r of [...(drafts ?? []), ...(runs ?? [])]) {
    const d = String(r.for_date).slice(0, 10);
    const t = new Date(r.created_at).toISOString();
    if (!runAt.has(d) || t < runAt.get(d)!) runAt.set(d, t);
  }

  for (const table of sources) {
    const spec = SOURCE_SPECS[table];
    read.add(table);
    // ── freshness ──
    const cols = [spec.dateCol, 'created_at', ...(spec.hasUpdatedAt ? ['updated_at'] : [])].join(', ');
    let lq = db.from(table).select(cols).eq('client_id', client.id);
    if (spec.entityCampaign) lq = lq.eq('entity', 'campaign');
    const { data: last, error: lErr } = await lq.order(spec.dateCol, { ascending: false }).limit(1).maybeSingle();
    if (lErr) throw new Error(`${table}: ${lErr.message}`);
    const sync = (conns ?? []).filter((c: any) => spec.platforms?.includes(String(c.platform)))
      .map((c: any) => c.last_synced_at).filter(Boolean).sort().pop() ?? null;
    if (!last) {
      checks.push({ check: 'freshness', source: table, status: 'fail', explanation: `${table} holds no rows for ${client.name} at all.`, detail: { last_sync_at: sync } });
    } else {
      const latestRowDate = spec.isTimestamp ? reportingDay(String(last[spec.dateCol]), tz) : String(last[spec.dateCol]).slice(0, 10);
      const loaded = [last.updated_at, last.created_at, sync].filter(Boolean).map((v: string) => new Date(v).toISOString()).sort().pop()!;
      const hours = Math.round(((now.getTime() - new Date(loaded).getTime()) / 3600000) * 10) / 10;
      const status: HealthStatus = hours > spec.cadenceHours * 3 ? 'fail' : hours > spec.cadenceHours ? 'warn' : 'ok';
      checks.push({
        check: 'freshness', source: table, status,
        explanation: `Latest row is for ${latestRowDate}; last loaded ${hours}h ago (expected at least every ${spec.cadenceHours}h)${status === 'ok' ? '.' : ' — stale.'}`,
        detail: { last_sync_at: sync, latest_row_date: latestRowDate, last_loaded_at: loaded, hours_stale: hours, cadence_hours: spec.cadenceHours },
      });
    }

    // ── loaded after run + publisher scope (one 14-day read) ──
    const pubCols = spec.kind === 'call' ? publisherColumns(table) : [];
    const sel = [spec.dateCol, 'created_at', ...pubCols].join(', ');
    const lo = spec.isTimestamp ? dayEndsAt(addDays(from, -1), tz).toISOString() : from;
    const hi = spec.isTimestamp ? dayEndsAt(latest, tz).toISOString() : latest;
    const rows = await pagedRead((a, b) => {
      let q = db.from(table).select(sel).eq('client_id', client.id).gte(spec.dateCol, lo);
      q = spec.isTimestamp ? q.lt(spec.dateCol, hi) : q.lte(spec.dateCol, hi);
      if (spec.entityCampaign) q = q.eq('entity', 'campaign');
      return q.order(spec.dateCol, { ascending: true }).range(a, b);
    });
    const dayOf = (r: any) => (spec.isTimestamp ? reportingDay(String(r[spec.dateCol]), tz) : String(r[spec.dateCol]).slice(0, 10));
    const late = lateLoads(rows.map((r) => ({ day: dayOf(r), created_at: new Date(r.created_at).toISOString() })), runAt);
    const material = late.filter((l) => l.share >= LATE_SHARE);
    checks.push({
      check: 'loaded_after_run', source: table,
      status: material.length ? 'warn' : 'ok',
      explanation: material.length
        ? `Rows for ${material.map((l) => `${l.day} (${l.late}/${l.total})`).join(', ')} arrived after that day's 9am draft ran — those drafts were written without them.`
        : late.length
          ? `A few rows arrived after their day's draft (${late.map((l) => `${l.day}: ${l.late}`).join(', ')}), each under ${pct(LATE_SHARE)} of the day.`
          : `No ${table} rows in the last ${HEALTH_DAYS} days arrived after their day's draft ran.`,
      detail: { late_days: late },
    });

    if (spec.kind === 'call') {
      const counts = new Map<string, number>();
      let unrecorded = 0;
      for (const r of rows) {
        const p = readPublisher(table, r);
        if (p) counts.set(p, (counts.get(p) ?? 0) + 1); else unrecorded++;
      }
      const total = rows.length;
      const scope = (client.publisher_scope ?? []).filter(Boolean);
      const named = [...counts.keys()];
      const outside = named.filter((p) => !scope.some((s) => s.toLowerCase() === p.toLowerCase())).reduce((a, p) => a + counts.get(p)!, 0);
      let status: HealthStatus = 'ok';
      let explanation: string;
      if (!total) explanation = `No ${table} calls in the last ${HEALTH_DAYS} days to judge.`;
      else if (!scope.length) {
        status = named.length >= 2 ? 'fail' : 'ok';
        explanation = named.length >= 2
          ? `Scope NOT confirmed and ${named.length} named publishers appear — call-derived figures are withheld until it is set.`
          : `Scope not confirmed; ${named.length ? `one named publisher (${named[0]})` : 'no publisher recorded on any call'}${unrecorded ? `, ${unrecorded} of ${total} calls unrecorded (a coverage gap, not mixing)` : ''}.`;
      } else {
        const unShare = unrecorded / total;
        status = unShare > UNRECORDED_SHARE ? 'warn' : 'ok';
        explanation = `Scope confirmed as ${scope.join(', ')}; ${named.length} named publisher(s) seen; ${pct(outside / total)} of calls are outside scope${unrecorded ? ` and ${pct(unShare)} have no publisher recorded (excluded)` : ''}.`;
      }
      checks.push({
        check: 'publisher_scope', source: table, status, explanation,
        detail: { confirmed: scope.length > 0, scope, publishers: Object.fromEntries(counts), unrecorded, total_calls: total, outside_scope_share: total ? outside / total : null },
      });
    }
  }

  // ── provisional ──
  const tracked = (client.spend_source_tables ?? []).filter((t) => (LOGGED_SPEND_SOURCES as readonly string[]).includes(t));
  if (tracked.length) {
    read.add('metric_revision_log');
    const { data: obs } = await db.from('metric_revision_log').select('source, observed_at, spend, revenue, calls')
      .eq('client_id', client.id).eq('metric_date', latest).order('observed_at', { ascending: false }).limit(50);
    const p = isProvisional({ observations: (obs ?? []) as Observation[], closedAt: dayEndsAt(latest, tz), trackedSources: tracked });
    checks.push({
      check: 'provisional', source: tracked.join(', '), status: p.provisional ? 'warn' : 'ok',
      explanation: p.provisional ? `${latest} is provisional: ${p.reason}.` : `${latest} is settled — the last two observations agree within 2%.`,
      detail: { date: latest, observations: (obs ?? []).length },
    });
  }

  // ── duplicate campaign rows ──
  if ((client.spend_source_tables ?? []).includes('ad_daily_metrics')) {
    read.add('ad_campaigns');
    const rows = await pagedRead((a, b) => db.from('ad_campaigns').select('date, campaign_name, spend')
      .eq('client_id', client.id).gte('date', addDays(latest, -89)).lte('date', latest).range(a, b));
    const dups = findDuplicateCampaignRows(rows);
    checks.push({
      check: 'duplicate_rows', source: 'ad_campaigns', status: dups.length ? 'warn' : 'ok',
      explanation: dups.length
        ? `${dups.length} day/spend pair(s) appear under more than one campaign name (renames stored as new rows), e.g. ${dups[0].date} $${dups[0].spend} × ${dups[0].names.length}. Campaign breakdowns are inflated there; ad_daily_metrics (one row per client/date/platform) is NOT affected, so daily spend totals stayed correct.`
        : `No campaign rows in the last 90 days share a date and spend under different names. ad_daily_metrics is keyed per client/date/platform and cannot duplicate this way.`,
      detail: { duplicates: dups.slice(0, 20) },
    });
  }

  // ── config mismatch ──
  const configured = new Set([...(client.call_source_tables ?? []), ...(client.spend_source_tables ?? [])]);
  const since = addDays(latest, -29);
  const mismatches: string[] = [];
  for (const table of CALL_TABLES) {
    const spec = SOURCE_SPECS[table];
    const lo = spec.isTimestamp ? `${since}T00:00:00Z` : since;
    const { data } = await db.from(table).select(spec.dateCol).eq('client_id', client.id).gte(spec.dateCol, lo).limit(1);
    const has = (data ?? []).length > 0;
    read.add(table);
    if (has && !configured.has(table)) {
      mismatches.push(table === 'jacuzzi_leads'
        ? `paid per lead out of jacuzzi_leads, but call_source_tables is [${(client.call_source_tables ?? []).join(', ')}] — the engine reads leads by a slug special case the record does not state`
        : `${table} holds rows for this client in the last 30 days but is not in call_source_tables`);
    }
    if (!has && configured.has(table)) mismatches.push(`${table} is configured but holds no rows for this client in the last 30 days`);
  }
  checks.push({
    check: 'config_mismatch', source: null, status: mismatches.length ? 'warn' : 'ok',
    explanation: mismatches.length ? `Configured sources disagree with where the data is: ${mismatches.join('; ')}.` : 'Configured sources match where this client\'s data is.',
    detail: { mismatches, call_source_tables: client.call_source_tables ?? [], spend_source_tables: client.spend_source_tables ?? [] },
  });

  // ── zero versus missing ──
  const days = (client.spend_source_tables ?? []).length ? await loadDayStates(db, client, from, latest) : [];
  checks.push(days.length ? summariseDays(days) : { check: 'zero_vs_missing', source: null, status: 'warn', explanation: 'No spend source is configured, so dark days and gaps cannot be told apart.' });

  return {
    client_id: client.id, client: client.name, timezone: tz, latest_reporting_day: latest,
    overall: worst(checks.map((c) => c.status)), checks,
    days: days.map((d) => ({ date: d.date, state: d.state })),
    tables_read: [...read],
  };
}
