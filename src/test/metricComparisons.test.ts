import { describe, it, expect } from "vitest";
import {
  classifyDay, classifyWindow, compare, compareMetric, headlineDelta, isProvisional,
  renderFullComparison, COMPARE_ORDER, type Snapshot, type ComparisonSet,
} from "../../supabase/functions/_shared/metric-comparisons";
import { dayClosesAt } from "../../supabase/functions/_shared/metric-comparison-data";

const snap = (from: string, p: Partial<Snapshot> = {}, to = from): Snapshot => ({
  from, to, state: "available", spend: 1000, revenue: 1200, calls: 100, connected: 80, billable: 40, impressions: 50000, ...p,
});
const PPC = { engagement: "pay_per_call", reliableFrom: null };
const PM = { engagement: "performance_media", reliableFrom: null };

describe("baseline classification", () => {
  it("RRM 2 Oct: no row at all is missing — not zero, not −100%", () => {
    expect(classifyDay({ rowCount: 0, spend: 0 })).toBe("missing");
    const cur = snap("2026-10-02", { state: "missing", spend: null });
    const c = compare("vs_prior_day", cur, snap("2026-10-01", { spend: 19.7 }), PPC);
    expect(c.unavailable).toBe("reporting day no data recorded");
    expect(c.deltas).toEqual([]);
  });
  it("Jacuzzi D-8 at $0.00 was dark: no divide-by-zero, no +∞", () => {
    expect(classifyDay({ rowCount: 3, spend: 0 })).toBe("no_delivery");
    const c = compare("vs_same_weekday", snap("2026-10-02"), snap("2026-09-25", { state: "no_delivery", spend: 0 }), PM);
    expect(c.unavailable).toBe("baseline was dark");
    expect(JSON.stringify(c)).not.toMatch(/Infinity|NaN/);
  });
  it("$0 with an active campaign row is still available", () => {
    expect(classifyDay({ rowCount: 1, spend: 0, anyActiveCampaign: true })).toBe("available");
  });
  it("a week with a missing day is not comparable", () => {
    expect(classifyWindow(["available", "missing", "available"]).state).toBe("missing");
  });
});

describe("degenerate base", () => {
  it("Hablyte $1.05 → $2.95 prints two values, not +181%", () => {
    const d = compareMetric("spend", snap("2026-10-02", { spend: 2.95 }), snap("2026-10-01", { spend: 1.05 }), false);
    expect(d.kind).toBe("absolute");
    expect(d.text).toBe("spend $1.05 → $2.95");
    expect(d.text).not.toMatch(/%/);
  });
  it("under 10 baseline calls withholds call percentages", () => {
    expect(compareMetric("calls", snap("a", { calls: 20 }), snap("b", { calls: 6 }), false).kind).toBe("absolute");
  });
  it("beyond ±300% prints two values", () => {
    expect(compareMetric("spend", snap("a", { spend: 5000 }), snap("b", { spend: 1000 }), false).kind).toBe("absolute");
  });
});

describe("capture reliability", () => {
  it("Spektrafin: a side before 21 Sep withholds revenue-derived metrics but keeps spend", () => {
    const c = compare("vs_prior_week", snap("2026-09-26", {}, "2026-10-02"), snap("2026-09-19", {}, "2026-09-25"),
      { engagement: "performance_media", reliableFrom: "2026-09-21" });
    const by = Object.fromEntries(c.deltas.map((d) => [d.metric, d.kind]));
    expect(by.revenue).toBe("withheld");
    expect(by.profit).toBe("withheld");
    expect(by.spend).toBe("pct");
    const set: ComparisonSet = { client: "Spektrafin", engagement: "performance_media", forDate: "2026-10-02",
      reliableFrom: "2026-09-21", day: snap("2026-10-02"), comparisons: [c], provisional: { provisional: false, reason: null } };
    expect(renderFullComparison(set)).toContain("Revenue baselines before 21 Sep aren't comparable.");
  });
  it("null reliable_from treats all history as reliable", () => {
    const c = compare("vs_prior_week", snap("2026-09-26"), snap("2026-09-01"), PM);
    expect(c.deltas.find((d) => d.metric === "revenue")!.kind).toBe("pct");
  });
});

describe("weekend boundary", () => {
  it("Monday vs a dark Sunday is not comparable, but Monday vs last Monday is the headline", () => {
    const mon = snap("2026-09-28", { spend: 19934 });
    const sun = snap("2026-09-27", { state: "no_delivery", spend: 0 });
    const lastMon = snap("2026-09-21", { spend: 18000 });
    const set: ComparisonSet = {
      client: "Spektrafin", engagement: "performance_media", forDate: "2026-09-28", reliableFrom: null, day: mon,
      provisional: { provisional: false, reason: null },
      comparisons: [compare("vs_same_weekday", mon, lastMon, PM), compare("vs_prior_day", mon, sun, PM)],
    };
    const text = renderFullComparison(set);
    expect(text).toMatch(/vs Sun: not comparable — baseline was dark/);
    expect(text).not.toMatch(/Infinity|∞/);
    expect(text.indexOf("vs last Mon")).toBeLessThan(text.indexOf("vs Sun"));
    expect(COMPARE_ORDER[0]).toBe("vs_same_weekday");
  });
});

describe("provisional D-1", () => {
  const closed = dayClosesAt("2026-10-02", "America/New_York");
  it("the day closes at local midnight", () => expect(closed.toISOString()).toBe("2026-10-03T04:00:00.000Z"));
  it("under 24h since close is provisional", () => {
    expect(isProvisional({ observations: [], closedAt: closed, now: new Date("2026-10-03T13:00:00Z") }).provisional).toBe(true);
  });
  it("last two observations differing by >2% is provisional; settled otherwise", () => {
    const later = new Date("2026-10-05T13:00:00Z");
    const o = (t: string, spend: number) => ({ source: "roku_daily_metrics", observed_at: t, spend, revenue: null, calls: null });
    expect(isProvisional({ observations: [o("2026-10-04T10:00Z", 1000), o("2026-10-05T10:00Z", 1100)], closedAt: closed, now: later }).provisional).toBe(true);
    expect(isProvisional({ observations: [o("2026-10-04T10:00Z", 1000), o("2026-10-05T10:00Z", 1010)], closedAt: closed, now: later }).provisional).toBe(false);
  });
  it("is disclosed once without blocking the comparison", () => {
    const c = compare("vs_same_weekday", snap("2026-10-02"), snap("2026-09-25", { spend: 900 }), PM);
    const set: ComparisonSet = { client: "X", engagement: "performance_media", forDate: "2026-10-02", reliableFrom: null,
      day: snap("2026-10-02"), comparisons: [c], provisional: { provisional: true, reason: "closed 9h ago — platforms are still settling" } };
    const t = renderFullComparison(set);
    expect(t).toContain("2 Oct is provisional");
    expect(t).toMatch(/spend \+11%/);
  });
});

describe("polarity wording", () => {
  it("cost per call up is worse, calls up is better, spend is neutral", () => {
    const cur = snap("a", { spend: 1200, calls: 110 }), base = snap("b", { spend: 1000, calls: 100 });
    expect(compareMetric("cost_per_call", cur, base, false).text).toBe("cost per call +9% (worse)");
    expect(compareMetric("calls", cur, base, false).text).toBe("calls +10% (better)");
    expect(compareMetric("spend", cur, base, false).text).toBe("spend +20%");
  });
  it("profit renders as two values and a swing", () => {
    expect(compareMetric("profit", snap("a", { spend: 14503, revenue: 13600 }), snap("b", { spend: 12000, revenue: 12897 }), false).text)
      .toBe("profit swung from +$897 to −$903");
  });
  it("one-liner carries one same-weekday delta", () => {
    const set: ComparisonSet = { client: "S", engagement: "performance_media", forDate: "2026-10-03", reliableFrom: null,
      day: snap("2026-10-03"), provisional: { provisional: false, reason: null },
      comparisons: [compare("vs_same_weekday", snap("2026-10-03", { spend: 14503 }), snap("2026-09-26", { spend: 16114 }), PM)] };
    expect(headlineDelta(set)).toBe("Spend −10% vs last Sat.");
  });
});
