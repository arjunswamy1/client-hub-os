// The ONLY writer of public.metric_revision_log. Append-only: one row per
// (client, date, source) per sync run, never updated, never deleted (a database
// trigger refuses both, and metricRevisionLogGuard.test.ts keeps every other file
// from touching the table).
//
// It re-reads the day's total from the sync table after the sync wrote it, so the
// observation is what the table now says — not what one API page returned.

type Db = { from: (t: string) => any };

const SPEND_TABLES = {
  roku_daily_metrics: { entityCampaign: true },
  ad_daily_metrics: { entityCampaign: false },
  cannaball_spend: { entityCampaign: false },
} as const;
export type ObservedSource = keyof typeof SPEND_TABLES;
/** Spend sources whose syncs log observations — the only ones provisionality can be judged on. */
export const LOGGED_SPEND_SOURCES = Object.keys(SPEND_TABLES) as readonly ObservedSource[];

/** Never throws: a failed observation must not fail the sync that called it. */
export async function recordSpendObservations(
  db: Db, clientId: string | null | undefined, source: ObservedSource, dates: (string | null | undefined)[],
): Promise<{ written: number; error?: string }> {
  try {
    const days = [...new Set(dates.filter((d): d is string => !!d).map((d) => d.slice(0, 10)))].sort();
    if (!clientId || !days.length) return { written: 0 };
    let q = db.from(source).select('date, spend').eq('client_id', clientId)
      .gte('date', days[0]).lte('date', days[days.length - 1]);
    if (SPEND_TABLES[source].entityCampaign) q = q.eq('entity', 'campaign');
    const { data, error } = await q.limit(20000);
    if (error) return { written: 0, error: error.message };
    const totals = new Map<string, number>();
    for (const r of data ?? []) {
      const d = String(r.date).slice(0, 10);
      if (!days.includes(d)) continue;
      totals.set(d, (totals.get(d) ?? 0) + Number(r.spend ?? 0));
    }
    const rows = [...totals.entries()].map(([metric_date, spend]) => ({
      client_id: clientId, metric_date, source, spend: Math.round(spend * 100) / 100, revenue: null, calls: null,
    }));
    if (!rows.length) return { written: 0 };
    const { error: insErr } = await db.from('metric_revision_log').insert(rows);
    if (insErr) return { written: 0, error: insErr.message };
    return { written: rows.length };
  } catch (e) {
    return { written: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
