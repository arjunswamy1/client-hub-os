/**
 * Media Brain — LOCATION (ZIP) SCORING.
 *
 * The single implementation of the location scoring rule. Steps 3–6 of
 * `docs/media-brain/05_Location_Scoring.md` live here and nowhere else: no page,
 * hook or edge function re-derives a success rate, a percentile, a tier or a
 * launch-list size. `scripts/media-brain/score_locations.py` is the reference
 * implementation Santiago runs by hand; this file mirrors it exactly and the
 * test fixture asserts the two agree.
 *
 * Two boundaries the doc states and this file honours:
 *
 *  - The confidence gate here (`confidenceMin`, default 10 EVENTS) is NOT the
 *    Decision Engine's `{min_calls}` (25 BILLABLE CALLS). `{min_calls}` is the
 *    sample a creative angle needs before it may be RANKED AGAINST another angle
 *    on margin per call. This gate is the sample a LOCATION needs before its own
 *    success rate means anything at all. Different question, different number.
 *    Never substitute one for the other.
 *  - There is NO margin input, and there must never be one. Location ranking is
 *    a relative comparison across locations using the network's own accept rate
 *    and payout. Actual cost per call does not exist until the campaign spends,
 *    so an absolute margin test cannot be applied here. Margin governs
 *    cut/hold/scale AFTER launch — see `decisions.ts`.
 *
 * @see docs/media-brain/05_Location_Scoring.md
 */

/* ------------------------------------------------------------------ *
 * Canonical roles — never a client's column names
 * ------------------------------------------------------------------ */

/** One location, already mapped from whatever the client's file called things. */
export interface LocationInputRow {
  /** ZIP / city / DMA. */
  id: string;
  /** Total events (calls, bids). */
  volume: number;
  /** Accepted / connected / billable — whichever was confirmed at Step 1. */
  success: number;
  /** Optional: avg payout / bid / revenue per event. */
  value?: number | null;
  /** Optional: events that failed for a STRUCTURAL reason (e.g. no buyer coverage). */
  hardFail?: number | null;
}

export type Confidence = 'low' | 'medium' | 'high';
export type Tier = 'Launch' | 'Expand' | 'Hold';
export type ExcludeReason = 'hard_fail_rate' | 'success_rate_below_min';

export interface LocationScoringConfig {
  hardFailRateMax: number;
  minSuccessRate: number;
  confidenceMin: number;
  confidenceHigh: number;
  weightSuccess: number;
  weightValue: number;
  weightVolume: number;
  launchTierPct: number;
  expandTierPct: number;
  launchSize: number;
}

export const DEFAULT_LOCATION_SCORING_CONFIG: LocationScoringConfig = {
  hardFailRateMax: 0.5,
  minSuccessRate: 0.3,
  confidenceMin: 10,
  confidenceHigh: 20,
  weightSuccess: 0.4,
  weightValue: 0.35,
  weightVolume: 0.25,
  launchTierPct: 0.9,
  expandTierPct: 0.7,
  launchSize: 25,
};

export interface ScoredLocation {
  id: string;
  volume: number;
  success: number;
  successRate: number | null;
  value: number | null;
  hardFail: number | null;
  hardFailRate: number | null;
  /** Null on an excluded row — an excluded location is never scored. */
  score: number | null;
  scorePercentile: number | null;
  /** Percentile inputs, kept for the audit trail. */
  valuePercentile: number | null;
  volumePercentile: number | null;
  confidence: Confidence;
  tier: Tier | null;
  /** True when this row was capped out of Launch by the confidence gate. */
  confidenceCapped: boolean;
  inLaunchList: boolean;
  excluded: boolean;
  excludeReason: ExcludeReason | null;
}

export interface LocationScoringResult {
  /** Every location, excluded ones included, sorted by score descending. */
  all: ScoredLocation[];
  /** The right-sized, paste-into-targeting list. */
  launchList: ScoredLocation[];
  excluded: ScoredLocation[];
  /** Weights actually applied — differs from config when there is no value column. */
  effectiveWeights: { success: number; value: number; volume: number };
  /** Stated, never silent, when the value weight was redistributed. */
  weightRedistributionNote: string | null;
  counts: {
    total: number;
    scored: number;
    excluded: number;
    launchQualifying: number;
    launchList: number;
    lowConfidenceCapped: number;
  };
  /** The Step 6 sentence, rendered verbatim on screen and in the CSV header. */
  launchListSentence: string;
}

/* ------------------------------------------------------------------ *
 * Percentile ranking — pandas `rank(pct=True)`: average rank ÷ n
 * ------------------------------------------------------------------ */

export function percentileRank(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && order[j + 1].v === order[i].v) j += 1;
    // Ranks are 1-based; ties take the average of the ranks they span.
    const avgRank = (i + 1 + (j + 1)) / 2;
    for (let k = i; k <= j; k += 1) out[order[k].i] = avgRank / n;
    i = j + 1;
  }
  return out;
}

export const successRate = (success: number, volume: number): number | null =>
  volume > 0 ? success / volume : null;

export const hardFailRate = (hardFail: number | null | undefined, volume: number): number | null =>
  hardFail === null || hardFail === undefined || volume <= 0 ? null : hardFail / volume;

export function confidenceOf(volume: number, cfg: LocationScoringConfig): Confidence {
  if (volume >= cfg.confidenceHigh) return 'high';
  if (volume >= cfg.confidenceMin) return 'medium';
  return 'low';
}

/**
 * Step 5 — weights. With no value column its weight is redistributed
 * PROPORTIONALLY into success and volume, never silently zeroed.
 */
export function effectiveWeights(cfg: LocationScoringConfig, hasValue: boolean) {
  if (hasValue) {
    return {
      weights: { success: cfg.weightSuccess, value: cfg.weightValue, volume: cfg.weightVolume },
      note: null as string | null,
    };
  }
  const base = cfg.weightSuccess + cfg.weightVolume;
  const success = base > 0 ? cfg.weightSuccess / base : 0.5;
  const volume = base > 0 ? cfg.weightVolume / base : 0.5;
  return {
    weights: { success, value: 0, volume },
    note:
      `No value column was mapped, so the ${(cfg.weightValue * 100).toFixed(0)}% value weight was redistributed ` +
      `proportionally: success ${(success * 100).toFixed(1)}%, volume ${(volume * 100).toFixed(1)}%. ` +
      `It was not zeroed — a missing signal changes the ranking and that has to be said out loud.`,
  };
}

/* ------------------------------------------------------------------ *
 * The scoring run
 * ------------------------------------------------------------------ */

export function scoreLocations(
  rows: LocationInputRow[],
  partial: Partial<LocationScoringConfig> = {},
): LocationScoringResult {
  const cfg: LocationScoringConfig = { ...DEFAULT_LOCATION_SCORING_CONFIG, ...partial };
  const hasValue = rows.some((r) => r.value !== null && r.value !== undefined);
  const { weights, note } = effectiveWeights(cfg, hasValue);

  /* Step 3 — hard excludes BEFORE scoring, so a broken location never drags
     the percentile scale for everyone else. */
  const prepared = rows.map((r) => {
    const volume = Number(r.volume) || 0;
    const success = Number(r.success) || 0;
    const sr = successRate(success, volume);
    const hf = r.hardFail === null || r.hardFail === undefined ? null : Number(r.hardFail) || 0;
    const hfr = hardFailRate(hf, volume);
    let excludeReason: ExcludeReason | null = null;
    if (hfr !== null && hfr >= cfg.hardFailRateMax) excludeReason = 'hard_fail_rate';
    else if (sr === null || sr < cfg.minSuccessRate) excludeReason = 'success_rate_below_min';
    return {
      id: String(r.id),
      volume,
      success,
      successRate: sr,
      value: r.value === null || r.value === undefined ? null : Number(r.value) || 0,
      hardFail: hf,
      hardFailRate: hfr,
      excludeReason,
    };
  });

  const keep = prepared.filter((r) => !r.excludeReason);

  /* Step 5 — normalised, blended score over the SURVIVING set only. */
  const valuePct = percentileRank(keep.map((r) => r.value ?? 0));
  const volumePct = percentileRank(keep.map((r) => Math.log1p(r.volume)));
  const scores = keep.map((r, i) => {
    const sr = r.successRate ?? 0;
    return weights.success * sr + (hasValue ? weights.value * valuePct[i] : 0) + weights.volume * volumePct[i];
  });
  const scorePct = percentileRank(scores);

  const scored: ScoredLocation[] = keep.map((r, i) => {
    const confidence = confidenceOf(r.volume, cfg);
    /* Step 6 — tier by score percentile... */
    let tier: Tier = scorePct[i] >= cfg.launchTierPct ? 'Launch' : scorePct[i] >= cfg.expandTierPct ? 'Expand' : 'Hold';
    /* Step 4 — ...but a thin sample is capped out of Launch whatever it scored.
       Two events at 100% is not evidence; it is a coin landing once. */
    let confidenceCapped = false;
    if (confidence === 'low' && tier === 'Launch') {
      tier = 'Expand';
      confidenceCapped = true;
    }
    return {
      id: r.id,
      volume: r.volume,
      success: r.success,
      successRate: r.successRate,
      value: r.value,
      hardFail: r.hardFail,
      hardFailRate: r.hardFailRate,
      score: scores[i],
      scorePercentile: scorePct[i],
      valuePercentile: hasValue ? valuePct[i] : null,
      volumePercentile: volumePct[i],
      confidence,
      tier,
      confidenceCapped,
      inLaunchList: false,
      excluded: false,
      excludeReason: null,
    };
  });

  const excluded: ScoredLocation[] = prepared
    .filter((r) => r.excludeReason)
    .map((r) => ({
      id: r.id,
      volume: r.volume,
      success: r.success,
      successRate: r.successRate,
      value: r.value,
      hardFail: r.hardFail,
      hardFailRate: r.hardFailRate,
      score: null,
      scorePercentile: null,
      valuePercentile: null,
      volumePercentile: null,
      confidence: confidenceOf(r.volume, cfg),
      tier: null,
      confidenceCapped: false,
      inLaunchList: false,
      excluded: true,
      excludeReason: r.excludeReason,
    }));

  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.id.localeCompare(b.id));

  /* Step 6 — the Launch TIER is a growth pool. The launch LIST is what a real
     budget can gather signal on. */
  const qualifying = scored.filter((r) => r.tier === 'Launch');
  const launchList = qualifying.slice(0, Math.max(0, Math.trunc(cfg.launchSize)));
  for (const r of launchList) r.inLaunchList = true;

  const shortfall = qualifying.length < cfg.launchSize;
  const launchListSentence = shortfall
    ? `Your top tier has ${qualifying.length} qualifying location${qualifying.length === 1 ? '' : 's'} — fewer than the ${cfg.launchSize} you asked for, so the launch list is all ${qualifying.length} of them. Widen the data or loosen the tier cut before adding more.`
    : `Your top tier has ${qualifying.length} qualifying locations; here are the top ${launchList.length} to launch with. The rest of the tier is where you expand as budget grows — a small daily budget spread across ${qualifying.length} locations means the platform never gathers enough signal on any one.`;

  return {
    all: [...scored, ...excluded],
    launchList,
    excluded,
    effectiveWeights: weights,
    weightRedistributionNote: note,
    counts: {
      total: prepared.length,
      scored: scored.length,
      excluded: excluded.length,
      launchQualifying: qualifying.length,
      launchList: launchList.length,
      lowConfidenceCapped: scored.filter((r) => r.confidenceCapped).length,
    },
    launchListSentence,
  };
}

/* ------------------------------------------------------------------ *
 * Building the location table from live calls
 * ------------------------------------------------------------------ */

/** One call, already publisher-filtered by the caller. */
export interface LocationCall {
  locationId: string | null;
  /** Billable per the client's GOVERNING definition — resolved before it gets here. */
  billable: boolean;
  payout: number | null;
  /** A structural failure (no buyer coverage / no route), not a quality one. */
  structuralFail?: boolean;
}

/**
 * Volume = calls, success = billable, value = average payout per call,
 * hard-fail = structurally failed calls. Calls with no location are dropped and
 * counted separately — a missing ZIP is a data gap, never a location named "".
 */
export function locationTableFromCalls(calls: LocationCall[]): {
  rows: LocationInputRow[];
  callsWithoutLocation: number;
} {
  const byId = new Map<string, { volume: number; success: number; payout: number; hardFail: number }>();
  let missing = 0;
  for (const c of calls) {
    const id = (c.locationId ?? '').trim();
    if (!id) {
      missing += 1;
      continue;
    }
    const acc = byId.get(id) ?? { volume: 0, success: 0, payout: 0, hardFail: 0 };
    acc.volume += 1;
    if (c.billable) acc.success += 1;
    acc.payout += c.payout ?? 0;
    if (c.structuralFail) acc.hardFail += 1;
    byId.set(id, acc);
  }
  const rows = [...byId.entries()]
    .map(([id, a]) => ({
      id,
      volume: a.volume,
      success: a.success,
      value: a.volume > 0 ? a.payout / a.volume : 0,
      hardFail: a.hardFail,
    }))
    .sort((a, b) => b.volume - a.volume || a.id.localeCompare(b.id));
  return { rows, callsWithoutLocation: missing };
}

/* ------------------------------------------------------------------ *
 * CSV
 * ------------------------------------------------------------------ */

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function scoredLocationsToCsv(rows: ScoredLocation[]): string {
  const head = [
    'location_id',
    'volume',
    'success',
    'success_rate',
    'value',
    'hard_fail',
    'hard_fail_rate',
    'score',
    'score_percentile',
    'confidence',
    'confidence_capped',
    'tier',
    'in_launch_list',
    'excluded',
    'exclude_reason',
  ];
  const lines = rows.map((r) =>
    [
      r.id,
      r.volume,
      r.success,
      r.successRate === null ? '' : r.successRate.toFixed(4),
      r.value === null ? '' : r.value.toFixed(4),
      r.hardFail ?? '',
      r.hardFailRate === null ? '' : r.hardFailRate.toFixed(4),
      r.score === null ? '' : r.score.toFixed(6),
      r.scorePercentile === null ? '' : r.scorePercentile.toFixed(6),
      r.confidence,
      r.confidenceCapped,
      r.tier ?? '',
      r.inLaunchList,
      r.excluded,
      r.excludeReason ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  return [head.join(','), ...lines].join('\n');
}

/** Minimal RFC-4180-ish CSV parse for the upload path. */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) out.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) out.push(row);
  if (out.length === 0) return { headers: [], rows: [] };
  const headers = out[0].map((h) => h.trim());
  const rows = out.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => {
      o[h] = (r[i] ?? '').trim();
    });
    return o;
  });
  return { headers, rows };
}
