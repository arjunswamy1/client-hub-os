// THE GUARANTEE: the 9am daily update and the CPM bot give the same spend,
// revenue and call count for the same client and date. The bot reads
// computeClientMetrics() for the asked day; the drafter reads loadDailySeries()
// → collectClientMetrics() and buildComparisonSet(). If any of them ever counts
// on its own, this fails.
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { computeClientMetrics } from "../../supabase/functions/_shared/client-metrics";
import { buildComparisonSet, loadDailySeries } from "../../supabase/functions/_shared/metric-comparison-data";
import { collectClientMetrics } from "../../supabase/functions/_shared/daily-update-metrics";
import { screenSql } from "../../supabase/functions/_shared/bot-sql";
import { fakeDb } from "./fixtures/fakeDb";

const SPEK = "spek-id", JAC = "jac-id";
const base = {
  expected_sources: null, data_model_note: null, aliases: null, revenue_field: null,
  call_source_tables: ["ringfuel_calls"], spend_source_tables: ["roku_daily_metrics"], campaign_spend_source_tables: null,
  reporting_timezone: "America/Puerto_Rico", metrics_reliable_from: null,
};
const spek = { ...base, id: SPEK, name: "Spektrafin", slug: "spektrafin", engagement_type: "performance_media" };
const jac = { ...base, id: JAC, name: "Jacuzzi", slug: "jacuzzi", engagement_type: "performance_media" };

const days = ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];

function fixture() {
  const roku: any[] = [];
  const calls: any[] = [];
  days.forEach((d, i) => {
    const sunday = new Date(`${d}T12:00:00Z`).getUTCDay() === 0;
    roku.push({ client_id: SPEK, date: d, entity: "campaign", campaign_name: "FE", spend: sunday ? 0 : 1000 + i * 100, impressions: sunday ? 0 : 50000 });
    roku.push({ client_id: JAC, date: d, entity: "campaign", campaign_name: "JZ", spend: 300, impressions: 9000 });
    for (let k = 0; k < (sunday ? 2 : 12 + i); k++) {
      // Half the calls land between 20:00 and 23:59 local (00:00–03:59 UTC next day):
      // a UTC day cut would move them to the wrong day.
      const late = k % 2 === 0;
      const ts = late ? new Date(Date.parse(`${d}T00:00:00Z`) + 86400000 + (k % 4) * 3600000 + 600000).toISOString()
        : `${d}T15:${String(10 + k).padStart(2, "0")}:00Z`;
      calls.push({ client_id: SPEK, call_id: `s-${d}-${k}`, call_start: ts, connected: true, duration_seconds: 30 + k * 20,
        payout: 0, revenue: 25, converted: k % 3 === 0, revenue_captured: true, conversion_captured: true, payload_shape: "full", is_test: false,
        raw_payload: { Publisher: "CPM" } });
    }
    // Jacuzzi calls sit in the SAME table and must never reach Spektrafin's figures.
    for (let k = 0; k < 40; k++) {
      calls.push({ client_id: JAC, call_id: `j-${d}-${k}`, call_start: `${d}T16:00:00Z`, connected: true, duration_seconds: 120,
        payout: 0, revenue: 999, converted: true, revenue_captured: true, conversion_captured: true, payload_shape: "full", is_test: false, raw_payload: {} });
    }
  });
  return fakeDb({
    roku_daily_metrics: roku,
    ringfuel_calls: calls,
    jacuzzi_leads: [{ client_id: JAC, transaction_date: "2026-10-02", lead_type: "call" }],
    media_brain_economics: [{ client_id: SPEK, vertical_id: null, publisher_scoping: "not_required_dedicated_campaigns" }],
    metric_revision_log: [],
  });
}

const val = (m: Awaited<ReturnType<typeof computeClientMetrics>>, k: string) => m.metrics.find((x) => x.key === k)?.value ?? null;

describe("drafter and bot agree", () => {
  it("identical spend, revenue and calls for every day, and for the reporting day the drafter renders", async () => {
    const { db } = fixture();
    const series = await loadDailySeries(db, spek as any, "2026-10-02");
    for (const d of days) {
      const bot = await computeClientMetrics(db, spek as any, { from: d, to: d });
      const row = series.days.find((x) => x.date === d)!;
      expect({ d, spend: row.spend, revenue: row.revenue, calls: row.calls })
        .toEqual({ d, spend: val(bot, "spend"), revenue: val(bot, "revenue"), calls: val(bot, "calls") });
    }
    const bot = await computeClientMetrics(db, spek as any, { from: "2026-10-02", to: "2026-10-02" });
    const draft = await collectClientMetrics(db as any, series);
    expect(draft.yesterday!.spend).toBe(val(bot, "spend"));
    expect(draft.yesterday!.calls).toBe(val(bot, "calls"));
    const set = await buildComparisonSet(db, spek as any, "2026-10-02", series);
    expect([set.day.spend, set.day.revenue, set.day.calls]).toEqual([val(bot, "spend"), val(bot, "revenue"), val(bot, "calls")]);
    // A loaded series and a fresh one (the bot path) give the same set.
    const fresh = await buildComparisonSet(db, spek as any, "2026-10-02");
    expect(fresh.day).toEqual(set.day);
  });

  it("days are cut on the reporting timezone, not UTC", async () => {
    const { db } = fixture();
    const series = await loadDailySeries(db, spek as any, "2026-10-02");
    // 2026-10-02 has 12 + 6 = 18 calls in the fixture, all on that local day.
    expect(series.days.find((d) => d.date === "2026-10-02")!.calls).toBe(18);
  });

  it("a week's revenue is summed from the same days", async () => {
    const { db } = fixture();
    const week = await computeClientMetrics(db, spek as any, { from: "2026-09-26", to: "2026-10-02" });
    const series = await loadDailySeries(db, spek as any, "2026-10-02");
    const tail = series.days.slice(-7);
    expect(tail.reduce((a, d) => a + (d.calls ?? 0), 0)).toBe(val(week, "calls"));
    expect(tail.reduce((a, d) => a + (d.revenue ?? 0), 0)).toBe(val(week, "revenue"));
  });
});

describe("client_id scoping on the shared call tables", () => {
  it("ringfuel_calls holds Spektrafin and Jacuzzi: every engine read filters on client_id", async () => {
    const { db, queries } = fixture();
    const s = await computeClientMetrics(db, spek as any, { from: "2026-10-02", to: "2026-10-02" });
    const j = await computeClientMetrics(db, jac as any, { from: "2026-10-02", to: "2026-10-02" });
    const reads = queries.filter((q) => q.table === "ringfuel_calls" || q.table === "cannaball_calls");
    expect(reads.length).toBeGreaterThan(0);
    for (const q of reads) expect(q.filters.some(([op, col]) => op === "eq" && col === "client_id")).toBe(true);
    expect(val(s, "revenue")).toBe(18 * 25); // never Jacuzzi's $999 calls
    expect(val(j, "calls")).toBe(1);        // Jacuzzi is paid per lead
  });

  it("every literal read of ringfuel_calls / cannaball_calls in the code filters on client_id", () => {
    const roots = ["supabase/functions", "src"];
    const files: string[] = [];
    const walk = (p: string) => {
      for (const f of readdirSync(p)) {
        const full = path.join(p, f);
        if (statSync(full).isDirectory()) { if (f !== "node_modules" && f !== "test") walk(full); }
        else if (/\.(ts|tsx)$/.test(f)) files.push(full);
      }
    };
    roots.forEach(walk);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const re = /\.from\(\s*["'](ringfuel_calls|cannaball_calls)["']\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const chain = src.slice(m.index, m.index + 600).split(/;\s*\n|\n\s*\n/)[0];
        if (/\.(upsert|insert)\(/.test(chain)) continue; // a write keyed on (client_id, call_id), not an aggregate
        if (!/client_id/.test(chain)) offenders.push(`${f}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the bot's SQL fallback refuses an unscoped aggregate on a shared table", () => {
    expect(screenSql("select count(*) from ringfuel_calls").ok).toBe(false);
    expect(screenSql("select count(*) from cannaball_calls where call_start > now() - interval '1 day'").ok).toBe(false);
    expect(screenSql("select count(*) from ringfuel_calls where client_id = 'x'").ok).toBe(true);
  });
});
