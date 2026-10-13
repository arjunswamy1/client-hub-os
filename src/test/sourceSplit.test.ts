import { describe, it, expect } from "vitest";
import { splitBySource, callRates, platformFor } from "../../supabase/functions/_shared/source-split";

const periods = [
  { did: "8889653087", platform: "universal_ads", effective_from: "2026-08-30", effective_to: null },
  { did: "8884489081", platform: "roku", effective_from: "2026-08-30", effective_to: null },
];
describe("Cannaball source split", () => {
  it("3087 is Universal Ads and other mapped numbers are Roku", () => {
    expect(platformFor(periods, "+18889653087", "2026-10-12")).toBe("universal_ads");
    expect(platformFor(periods, "8884489081", "2026-10-12")).toBe("roku");
  });
  it("a number with no period is unattributed, not guessed", () => {
    const s = splitBySource([{ did: "8880000000", call_start: "2026-10-12T15:00:00Z", connected: true, payout: 10 }], periods, { roku: 100 }, "America/New_York");
    expect(s.find((x) => x.source === "unattributed")?.calls).toBe(1);
    expect(s.find((x) => x.source === "unattributed")?.spend).toBeNull();
  });
  it("RPC per connected call, cost per connected call, no-connect rate", () => {
    const r = callRates({ calls: 10, connected: 8, revenue: 200, spend: 100 });
    expect(r.revenue_per_connected_call).toBe(25);
    expect(r.cost_per_connected_call).toBe(12.5);
    expect(r.no_connect_rate).toBe(0.2);
    expect(r.roas).toBe(2);
  });
  it("unknown revenue stays null", () => {
    expect(callRates({ calls: 5, connected: null, revenue: null, spend: 50 }).revenue_per_connected_call).toBeNull();
  });
});
