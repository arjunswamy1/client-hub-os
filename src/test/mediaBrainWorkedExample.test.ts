/**
 * Media Brain — the §16 worked example, asserted.
 *
 * $50 payout, static, $40 expected cost per BILLABLE call (a 20% margin).
 * These are the framework's settled values; if a number here changes, the
 * doc and the engine have drifted apart.
 *
 * @see docs/media-brain/01_Decision_Engine.md §16
 */

import { describe, expect, it } from "vitest";
import * as engine from "@/lib/mediaBrain/engine";

describe("§16 worked example", () => {
  const payout = 50;
  const costPerBillableCall = 40;
  const targetMargin = 0.2;
  const gap = engine.DEFAULTS.actionableGap; // 0.57

  it("defaults are the settled values", () => {
    expect(engine.DEFAULTS.actionableGap).toBe(0.57);
    expect(engine.DEFAULTS.targetMargin).toBe(0.2);
    expect(engine.DEFAULTS.minMargin).toBe(0.1);
  });

  it("kill threshold is 2 x payout = 100", () => {
    expect(engine.killThreshold("static", payout, null)).toBe(100);
  });

  it("min_calls is 8 / gap^2 = 25 static, 35 under RTB", () => {
    expect(engine.minCalls(gap, "static")).toBe(25);
    expect(engine.minCalls(gap, "rtb")).toBe(35);
    // A tighter 40% gap costs twice the sample.
    expect(engine.minCalls(0.4, "static")).toBe(50);
  });

  it("allowable cost per call at a 20% target margin is 40", () => {
    expect(engine.allowableCostPerCall(payout, targetMargin)).toBe(40);
  });

  it("cost per angle is min_calls x cost per BILLABLE call = 1000", () => {
    expect(engine.costPerAngle(engine.minCalls(gap, "static"), costPerBillableCall)).toBe(1000);
  });

  it("margin bands are anchored on the instance values, not hardcoded", () => {
    // Framework defaults reproduce the §10 table.
    expect(engine.marginBand(0.12, 0.1, 0.2)?.band).toBe("thin");
    expect(engine.marginBand(0.25, 0.1, 0.2)?.band).toBe("good");
    // A client on a 15% floor: 12% is below the floor, not "thin but workable".
    expect(engine.marginBand(0.12, 0.15, 0.25)?.band).toBe("fragile");
  });

  it("allowable cost per call reaches a decision", () => {
    expect(engine.exceedsAllowableCostPerCall(45, 40)).toBe(true);
    expect(engine.exceedsAllowableCostPerCall(35, 40)).toBe(false);
    expect(engine.exceedsAllowableCostPerCall(35, null)).toBeNull();
  });
});
