/** BuyologyIQ product-line classification + call-quality scoring helpers */

export type ProductLine = "tubs" | "bath" | "other";

export const PRODUCT_LINES: { id: ProductLine | "all"; label: string; short: string }[] = [
  { id: "all", label: "All product lines", short: "All" },
  { id: "tubs", label: "Walk-In Tubs", short: "Walk-In Tubs" },
  { id: "bath", label: "Bathroom Remodel", short: "Bath Remodel" },
];

export const productLineLabel = (line: ProductLine) =>
  line === "tubs" ? "Walk-In Tubs" : line === "bath" ? "Bathroom Remodel" : "Unclassified";

/** Meta naming conventions: WalkinTub / Tub_* => tubs, Bath* => bathroom remodel */
export function classifyName(name?: string | null): ProductLine {
  const n = (name || "").toLowerCase();
  if (!n) return "other";
  if (/walk\s?in\s?tub|walkintub|\btubs?\b|tub_|_tub/.test(n)) return "tubs";
  if (/bath/.test(n)) return "bath";
  return "other";
}

/** Classify using campaign name first, then ad/adset name as a fallback */
export function classifyCreative(campaignName?: string | null, adName?: string | null): ProductLine {
  const byCampaign = classifyName(campaignName);
  if (byCampaign !== "other") return byCampaign;
  return classifyName(adName);
}

/** Quality thresholds (seconds of talk time) */
export const QUALIFIED_SECONDS = 60;
export const PREMIUM_SECONDS = 120;

export interface QualityInput {
  total: number;
  connected: number;
  qualified: number;
  premium: number;
  converted: number;
}

/**
 * Composite 0-100 quality score for a group of calls.
 * Weighted toward talk-time depth (the strongest proxy for lead quality on
 * pay-per-call) with conversion + connect rate as supporting signals.
 */
export function qualityScore(q: QualityInput): number {
  if (!q.total) return 0;
  const score =
    40 * (q.qualified / q.total) +
    25 * (q.premium / q.total) +
    20 * (q.converted / q.total) +
    15 * (q.connected / q.total);
  return Math.round(score);
}

export const gradeFor = (score: number) =>
  score >= 70 ? "A" : score >= 55 ? "B" : score >= 40 ? "C" : score >= 25 ? "D" : "F";
