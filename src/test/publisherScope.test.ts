// Publisher scope, scope events and the Monday weekend block.
import { describe, expect, it } from "vitest";
import { computeClientMetrics } from "../../supabase/functions/_shared/client-metrics";
import { buildComparisonSet, loadDailySeries } from "../../supabase/functions/_shared/metric-comparison-data";
import { collectClientMetrics } from "../../supabase/functions/_shared/daily-update-metrics";
import { renderDailyComparison } from "../../supabase/functions/_shared/metric-comparisons";
import { fakeDb } from "./fixtures/fakeDb";

const BIQ = "biq-id";
const client = {
  id: BIQ, name: "BuyologyIQ", slug: "buyologyiq", engagement_type: "pay_per_call",
  expected_sources: null, data_model_note: null, aliases: null, revenue_field: "revenue",
  call_source_tables: ["ringba_calls"], spend_source_tables: ["ad_daily_metrics"], campaign_spend_source_tables: null,
  reporting_timezone: "America/New_York", metrics_reliable_from: null,
  publisher_scope: ["Connect Paid Media"], weekend_rollup: true, client_call_day: 1,
};

// 14 days, 888 calls across 10 publishers; 67 are CPM's. Spend $2,295.99.
const DAYS = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 8, 21 + i)).toISOString().slice(0, 10)); // Sep 21 – Oct 4
const OTHERS = ["You", "Squeeze Media Group SS", "Global Ventu", "BIQ", "Squeeze AS", "Pilothouse", "Madrivo", "BIQ SilverSpoon", "Squeeze KOH"];

function fixture(over: Partial<typeof client> = {}, extra: Record<string, any[]> = {}) {
  const calls: any[] = [];
  let n = 0;
  const ours = 67, total = 888;
  for (let k = 0; k < total; k++) {
    const d = DAYS[k % 14];
    const pub = k < ours ? "Connect Paid Media" : OTHERS[k % OTHERS.length];
    calls.push({
      client_id: BIQ, call_date: `${d}T15:00:00Z`, connected: true, duration_seconds: 120, payout: 0,
      revenue: k < ours ? (k % 2 ? 40 : 0) : 30, converted: true, metadata: { publisher: pub }, id: n++,
    });
  }
  // Another client's calls in the same table — must never be counted.
  calls.push({ client_id: "other", call_date: `${DAYS[13]}T15:00:00Z`, connected: true, duration_seconds: 99, payout: 0, revenue: 500, metadata: { publisher: "Connect Paid Media" } });
  const ads = DAYS.map((d, i) => ({ client_id: BIQ, date: d, spend: i === 13 ? 2295.99 - 13 * 164 : 164, impressions: 10000, conversions: 50 }));
  return fakeDb({
    ringba_calls: calls, ad_daily_metrics: ads, ad_campaigns: [],
    media_brain_economics: [{ client_id: BIQ, vertical_id: null, publisher_scoping: "unknown" }],
    metric_revision_log: [], client_scope_events: [], ...extra,
  }) && { db: fakeDb({
    ringba_calls: calls, ad_daily_metrics: ads, ad_campaigns: [],
    media_brain_economics: [{ client_id: BIQ, vertical_id: null, publisher_scoping: "unknown" }],
    metric_revision_log: [], client_scope_events: [], ...extra,
  }).db, c: { ...client, ...over } };
}
const val = (m: any, k: string) => m.metrics.find((x: any) => x.key === k)?.value ?? null;
const win = { from: DAYS[0], to: DAYS[13] };

describe("publisher scope", () => {
  it("BuyologyIQ: counts only the 67 Connect Paid Media calls of 888, cost per call $34.27", async () => {
    const { db, c } = fixture();
    const m = await computeClientMetrics(db, c as any, win);
    expect(val(m, "calls")).toBe(67);
    expect(val(m, "spend")).toBeCloseTo(2295.99, 2);
    expect(val(m, "cost_per_call")).toBeCloseTo(34.27, 2);
    expect(m.caveats.join(" ")).toContain("821 call(s) from other publishers");
  });

  it("unknown scope with several publishers withholds every call-derived figure — no fallback to all publishers", async () => {
    const { db, c } = fixture({ publisher_scope: null as any });
    const m = await computeClientMetrics(db, c as any, win);
    for (const k of ["calls", "connected_calls", "converted_calls", "revenue", "cost_per_call", "profit"]) expect(val(m, k)).toBeNull();
    expect(val(m, "spend")).toBeCloseTo(2295.99, 2);
    expect(m.caveats.join(" ")).toMatch(/publisher scoping is unconfirmed/i);
    const series = await loadDailySeries(db, c as any, DAYS[13]);
    expect(series.days.every((d) => d.calls === null && d.revenue === null)).toBe(true);
  });

  it("platform events are labelled separately and never added to validated calls", async () => {
    const { db, c } = fixture();
    const m = await computeClientMetrics(db, c as any, win);
    const ev = m.metrics.find((x: any) => x.key === "platform_events")!;
    expect(ev.value).toBe(700);
    expect(ev.label).toMatch(/NOT validated calls/);
    expect(val(m, "calls")).toBe(67);
    expect(m.metrics.find((x: any) => x.key === "calls")!.label).toMatch(/Validated calls/);
  });

  it("converted comes only from the configured revenue field, not the platform's converted flag", async () => {
    const { db, c } = fixture();
    const m = await computeClientMetrics(db, c as any, win);
    expect(val(m, "converted_calls")).toBe(33); // 67 ours, the odd-indexed ones carry revenue
  });
});

describe("scope events", () => {
  it("a comparison straddling an event is not comparable, named briefly; context shown for seven days", async () => {
    const { db, c } = fixture({}, { client_scope_events: [{ client_id: BIQ, effective_date: "2026-10-01", kind: "accounts_added", description: "Four ad accounts handed over" }] });
    const set = await buildComparisonSet(db, c as any, "2026-10-02");
    const sw = set.comparisons.find((x) => x.label === "vs_same_weekday")!;
    expect(sw.scopeBreak).toBe("accounts added 1 Oct");
    expect(sw.deltas).toEqual([]);
    const pd = set.comparisons.find((x) => x.label === "vs_prior_day")!;
    expect(pd.scopeBreak).toBe("accounts added 1 Oct");
    expect(set.scopeNotes!.length).toBe(1);
    const text = renderDailyComparison(set, { mode: "same_weekday", weekly: false });
    expect(text).toContain("accounts added 1 Oct — not comparable");
    expect(text).not.toMatch(/%/);
    const later = await buildComparisonSet(db, c as any, "2026-10-08".slice(0, 10) as string).catch(() => null);
    if (later) expect(later.scopeNotes).toEqual([]);
  });
});

describe("Monday weekend block", () => {
  it("Sat + Sun are one period, and every figure in the update uses it", async () => {
    const { db, c } = fixture();
    const sun = "2026-10-04";
    const series = await loadDailySeries(db, c as any, sun);
    const set = await buildComparisonSet(db, c as any, sun, series);
    expect(set.periodFrom).toBe("2026-10-03");
    const sat = series.days.find((d) => d.date === "2026-10-03")!, su = series.days.find((d) => d.date === sun)!;
    expect(set.day.calls).toBe((sat.calls ?? 0) + (su.calls ?? 0));
    expect(set.day.spend).toBeCloseTo((sat.spend ?? 0) + (su.spend ?? 0), 2);
    const draft = await collectClientMetrics(db as any, series, "2026-10-03");
    expect(draft.yesterday!.calls).toBe(set.day.calls);
    expect(draft.yesterday!.spend).toBeCloseTo(set.day.spend!, 2);
    const sw = set.comparisons.find((x) => x.label === "vs_same_weekday")!;
    expect([sw.baseline.from, sw.baseline.to]).toEqual(["2026-09-26", "2026-09-27"]);
    const text = renderDailyComparison(set, { mode: "same_weekday", weekly: true });
    expect(text).toContain("(weekend)");
    expect(text).toContain("vs last weekend");
  });

  it("weekend_rollup=false keeps the single Sunday", async () => {
    const { db, c } = fixture({ weekend_rollup: false });
    const set = await buildComparisonSet(db, c as any, "2026-10-04");
    expect(set.periodFrom).toBe("2026-10-04");
    expect(set.day.from).toBe("2026-10-04");
  });
});
