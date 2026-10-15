import { describe, it, expect } from "vitest";
import { mapUniversalRows } from "../../supabase/functions/_shared/universal-ads-rows";
import { adsetBreakdown } from "../../supabase/functions/_shared/source-split";

const opts = { clientId: "c", level: "ad" as const, fallbackDate: "2026-10-14", campaignNames: new Map([["camp", "Cannaball Final Expense V2"]]), adsetNames: new Map<string, string>() };
const row = (adset_id: string, entity_id: string, spend: number) =>
  ({ start_date: "2026-10-14T00:00:00", campaign_id: "camp", adset_id, entity_id, name: "Final Expense $6.74", spend, impressions: 100 });

describe("Universal Ads rows", () => {
  it("two ad sets with the same ad name stay separate rows", () => {
    const out = mapUniversalRows([row("A", "ad1", 100), row("B", "ad2", 50)], opts);
    expect(out).toHaveLength(2);
    expect(out.map((r) => [r.platform_adset_id, r.spend])).toEqual([["A", 100], ["B", 50]]);
  });
  it("pieces of the same ad set and ad merge, total unchanged", () => {
    const out = mapUniversalRows([row("A", "ad1", 100), row("A", "ad1", 25), row("B", "ad2", 50)], opts);
    expect(out.find((r) => r.platform_adset_id === "A")?.spend).toBe(125);
    expect(out.reduce((s, r) => s + r.spend, 0)).toBe(175);
  });
  it("source split breakdown keys on ad set id, not name", () => {
    const b = adsetBreakdown([
      { platform: "universal_ads", platform_adset_id: "A", adset_name: "Final Expense $6.74", campaign_name: "x", spend: 10, impressions: 1 },
      { platform: "universal_ads", platform_adset_id: "B", adset_name: "Final Expense $6.74", campaign_name: "x", spend: 5, impressions: 1 },
    ]);
    expect(b).toHaveLength(2);
  });
});
