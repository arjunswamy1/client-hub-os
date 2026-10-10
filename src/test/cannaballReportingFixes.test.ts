import { describe, it, expect } from "vitest";
import { findCrossSourceSpendDuplicates } from "../../supabase/functions/_shared/data-health";
import { detectSpendScopeEvents } from "../../supabase/functions/_shared/spend-scope-events";
import { isProvisional } from "../../supabase/functions/_shared/metric-comparisons";
import { spendPlatformFilter } from "../../supabase/functions/_shared/client-metrics";
import { readFileSync } from "node:fs";

describe("spend double-count (Cannaball 10/1)", () => {
  it("flags roku counted from roku_daily_metrics and cannaball_spend on the same day", () => {
    const dups = findCrossSourceSpendDuplicates([
      { source: "roku_daily_metrics", date: "2026-10-01", platform: "roku", spend: 2072.2177 },
      { source: "cannaball_spend", date: "2026-10-01", platform: "roku", spend: 2072.22 },
      { source: "cannaball_spend", date: "2026-10-01", platform: "universal_ads", spend: 400 },
    ]);
    expect(dups).toEqual([{ date: "2026-10-01", platform: "roku", spend: 2072.22, sources: ["roku_daily_metrics", "cannaball_spend"] }]);
  });
  it("no flag once cannaball_spend is restricted to universal_ads", () => {
    expect(findCrossSourceSpendDuplicates([
      { source: "roku_daily_metrics", date: "2026-10-01", platform: "roku", spend: 2072.22 },
      { source: "cannaball_spend", date: "2026-10-01", platform: "universal_ads", spend: 400 },
    ])).toEqual([]);
  });
  it("platform filter reads only the listed platforms from that table", () => {
    const c = { spend_source_platforms: { cannaball_spend: ["universal_ads"] } };
    expect(spendPlatformFilter(c, "cannaball_spend")).toEqual(["universal_ads"]);
    expect(spendPlatformFilter(c, "roku_daily_metrics")).toBeNull();
  });
});

describe("paged reads are stably ordered", () => {
  it("every call and spend page in the engine has an order before range", () => {
    const src = readFileSync("supabase/functions/_shared/client-metrics.ts", "utf8");
    const ranges = src.match(/[\s\S]{0,200}\.range\(f, t\)/g) ?? [];
    expect(ranges.length).toBeGreaterThanOrEqual(4);
    for (const r of ranges) expect(r).toMatch(/\.order\(/);
  });
});

describe("Universal pause/restart scope events", () => {
  const days = new Map<string, Record<string, number>>();
  const add = (d: string, u: number) => days.set(d, { roku: 2000, universal_ads: u });
  add("2026-09-21", 500); add("2026-09-22", 450);
  for (const d of ["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28", "2026-10-08"]) add(d, 0);
  add("2026-10-09", 300);
  const ev = detectSpendScopeEvents("c1", "2026-09-21", "2026-10-09", days);
  it("records the 9/23 pause and 10/9 restart, nothing for roku", () => {
    expect(ev.map((e) => [e.date, e.platform, e.kind])).toEqual([
      ["2026-09-23", "universal_ads", "source_paused"],
      ["2026-10-09", "universal_ads", "source_resumed"],
    ]);
  });
  it("one quiet weekday is not a pause", () => {
    const m = new Map([["2026-10-05", { u: 10 }], ["2026-10-06", { u: 0 }], ["2026-10-07", { u: 10 }]]);
    expect(detectSpendScopeEvents("c1", "2026-10-05", "2026-10-07", m)).toEqual([]);
  });
  it("a weekend at $0 is not a pause", () => {
    const m = new Map([["2026-10-09", { u: 10 }], ["2026-10-12", { u: 10 }]]);
    expect(detectSpendScopeEvents("c1", "2026-10-09", "2026-10-12", m)).toEqual([]);
  });
});

describe("provisional agrees across reads", () => {
  const closed = new Date("2026-09-15T04:00:00Z");
  it("a day closed more than 3 days ago with no post-close observation is not provisional", () => {
    const p = isProvisional({ observations: [], closedAt: closed, trackedSources: ["roku_daily_metrics"], now: new Date("2026-10-10T00:00:00Z") });
    expect(p.provisional).toBe(false);
    expect(p.unjudged).toEqual(["roku_daily_metrics"]);
  });
  it("the same day within 3 days of closing is provisional", () => {
    expect(isProvisional({ observations: [], closedAt: closed, trackedSources: ["roku_daily_metrics"], now: new Date("2026-09-16T00:00:00Z") }).provisional).toBe(true);
  });
});
