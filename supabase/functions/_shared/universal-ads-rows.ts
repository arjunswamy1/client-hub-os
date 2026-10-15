// Universal Ads report rows → cannaball_spend rows. Pure; no I/O.
// Rows merge on date + ad set id + ad id. Names are labels only: two ad sets
// sharing an ad name stay separate rows. Rows with no ad set id keep their
// API row identity rather than being folded into a named sibling.

export interface UniversalSpendRow {
  client_id: string;
  date: string;
  platform: "universal_ads";
  campaign_name: string | null;
  creative_name: string | null;
  platform_adset_id: string;
  adset_name: string | null;
  platform_ad_id: string;
  spend: number;
  impressions: number;
  clicks: number;
  raw: unknown;
}

export function mapUniversalRows(
  rows: any[],
  opts: { clientId: string; level: "ad" | "campaign"; fallbackDate: string; campaignNames: Map<string, string>; adsetNames: Map<string, string> },
): UniversalSpendRow[] {
  const merged = new Map<string, UniversalSpendRow & { raw: unknown[] }>();
  for (const r of rows) {
    const date = (pickStr(r, ["date", "day", "report_date", "start_date", "datetime", "timestamp"]) ?? opts.fallbackDate).slice(0, 10);
    const spend = pickNum(r, ["spend", "cost", "amount_spent", "total_spend", "spend_usd"]) || pickNum(r, ["spend_micros", "cost_micros"]) / 1_000_000;
    const impressions = Math.round(pickNum(r, ["impressions", "impression", "total_impressions"]));
    const clicks = Math.round(pickNum(r, ["clicks", "click", "total_clicks"]));
    if (!(spend > 0 || impressions > 0)) continue;
    const rawCampaign = pickStr(r, ["campaign_name", "campaign"]) ??
      (opts.level === "campaign" ? pickStr(r, ["name"]) : pickStr(r, ["campaign_id"]));
    const adsetId = pickStr(r, ["adset_id", "ad_set_id"]) ?? "";
    const adId = opts.level === "ad" ? (pickStr(r, ["ad_id", "entity_id", "creative_id"]) ?? "") : "";
    const key = `${date}|${adsetId}|${adId}|${adsetId || adId ? "" : rawCampaign}`;
    const cur = merged.get(key);
    if (cur) {
      cur.spend += spend; cur.impressions += impressions; cur.clicks += clicks; cur.raw.push(r);
      continue;
    }
    merged.set(key, {
      client_id: opts.clientId,
      date,
      platform: "universal_ads",
      campaign_name: (rawCampaign && opts.campaignNames.get(rawCampaign)) ?? rawCampaign,
      creative_name: opts.level === "ad" ? pickStr(r, ["ad_name", "ad", "creative_name", "name", "ad_id"]) : null,
      platform_adset_id: adsetId,
      adset_name: pickStr(r, ["adset_name", "ad_set_name"]) ?? (adsetId ? opts.adsetNames.get(adsetId) ?? null : null),
      platform_ad_id: adId,
      spend, impressions, clicks,
      raw: [r],
    });
  }
  return [...merged.values()].map((x) => ({ ...x, spend: Math.round(x.spend * 1e6) / 1e6 }));
}

export function pickNum(row: Record<string, any>, keys: string[]): number {
  for (const k of keys) {
    const v = row?.[k] ?? row?.metrics?.[k];
    if (v !== undefined && v !== null && v !== "") {
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

export function pickStr(row: Record<string, any>, keys: string[]): string | null {
  for (const k of keys) {
    const v = row?.[k] ?? row?.dimensions?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
