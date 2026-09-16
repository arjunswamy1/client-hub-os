#!/usr/bin/env python3
"""Pay-Per-Call Location Scoring — reference implementation (steps 3-6).

This script asks nothing. Every question in Step 1 of
docs/media-brain/05_Location_Scoring.md is answered by a human BEFORE this runs;
the answers arrive as CLI arguments. It executes what was confirmed.

The TypeScript port at src/lib/mediaBrain/locationScoring.ts mirrors this file
exactly and is the implementation the app uses. Keep the two in step: if a rule
changes here it changes there, and the test fixture asserts they agree.

There is deliberately no margin floor or target argument. Location ranking is a
relative comparison across locations using the network's own accept rate and
payout; actual cost per call does not exist until the campaign spends. Margin
governs cut/hold/scale after launch, not location selection.

Usage:
  python3 score_locations.py --input calls.csv --id-col zip \
      --volume-col total_calls --success-col accepted \
      --value-col avg_payout --hard-fail-col no_coverage --outdir out/
"""

import argparse
import math
import os
import sys

import pandas as pd


def percentile_rank(series: pd.Series) -> pd.Series:
    """Average-rank percentile, 0 < p <= 1. Ties share the average rank."""
    return series.rank(method="average", pct=True)


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Score locations into tiers and a launch list.")
    p.add_argument("--input", required=True, help="CSV/XLSX of location-level events")
    p.add_argument("--id-col", required=True, help="ZIP / city / DMA column")
    p.add_argument("--volume-col", required=True, help="total events column")
    p.add_argument("--success-col", required=True, help="accepted / connected / billable column")
    p.add_argument("--value-col", default=None, help="optional avg payout / bid / revenue per event")
    p.add_argument("--hard-fail-col", default=None, help="optional structural-failure count column")
    p.add_argument("--hard-fail-rate-max", type=float, default=0.5)
    p.add_argument("--min-success-rate", type=float, default=0.30)
    p.add_argument("--confidence-min", type=int, default=10)
    p.add_argument("--confidence-high", type=int, default=20)
    p.add_argument("--weight-success", type=float, default=0.40)
    p.add_argument("--weight-value", type=float, default=0.35)
    p.add_argument("--weight-volume", type=float, default=0.25)
    p.add_argument("--launch-tier-pct", type=float, default=0.90)
    p.add_argument("--expand-tier-pct", type=float, default=0.70)
    p.add_argument("--launch-size", type=int, default=25)
    p.add_argument("--outdir", default="out")
    return p.parse_args(argv)


def load(path: str) -> pd.DataFrame:
    if path.lower().endswith((".xlsx", ".xls")):
        return pd.read_excel(path)
    return pd.read_csv(path, dtype=str)


def score(df: pd.DataFrame, a) -> tuple:
    cols = {"id": a.id_col, "volume": a.volume_col, "success": a.success_col}
    for role, col in cols.items():
        if col not in df.columns:
            sys.exit(f"column for {role!r} not found: {col!r}. Available: {list(df.columns)}")

    out = pd.DataFrame()
    out["id"] = df[a.id_col].astype(str).str.strip()
    out["volume"] = pd.to_numeric(df[a.volume_col], errors="coerce").fillna(0)
    out["success"] = pd.to_numeric(df[a.success_col], errors="coerce").fillna(0)

    has_value = bool(a.value_col)
    if has_value:
        out["value"] = pd.to_numeric(df[a.value_col], errors="coerce").fillna(0)
    else:
        out["value"] = 0.0

    if a.hard_fail_col:
        out["hard_fail"] = pd.to_numeric(df[a.hard_fail_col], errors="coerce").fillna(0)
        out["hard_fail_rate"] = out.apply(
            lambda r: (r["hard_fail"] / r["volume"]) if r["volume"] > 0 else None, axis=1
        )
    else:
        out["hard_fail"] = None
        out["hard_fail_rate"] = None

    out["success_rate"] = out.apply(
        lambda r: (r["success"] / r["volume"]) if r["volume"] > 0 else None, axis=1
    )

    # Step 3 - hard excludes BEFORE scoring, never ranked low afterwards.
    def exclusion(r):
        hfr = r["hard_fail_rate"]
        if hfr is not None and not pd.isna(hfr) and hfr >= a.hard_fail_rate_max:
            return "hard_fail_rate"
        sr = r["success_rate"]
        if sr is None or pd.isna(sr) or sr < a.min_success_rate:
            return "success_rate_below_min"
        return None

    out["exclude_reason"] = out.apply(exclusion, axis=1)
    out["excluded"] = out["exclude_reason"].notna()

    # Step 5 - weights. Missing value column redistributes proportionally.
    w_s, w_v, w_vol = a.weight_success, a.weight_value, a.weight_volume
    note = None
    if not has_value:
        base = w_s + w_vol
        w_s, w_vol, w_v = w_s / base, w_vol / base, 0.0
        note = (
            f"No value column mapped; the {a.weight_value:.0%} value weight was redistributed "
            f"proportionally: success {w_s:.1%}, volume {w_vol:.1%}. Not zeroed."
        )

    keep = out[~out["excluded"]].copy()
    keep["value_pct"] = percentile_rank(keep["value"]) if has_value else None
    keep["volume_pct"] = percentile_rank(keep["volume"].apply(lambda v: math.log1p(v)))
    keep["score"] = (
        w_s * keep["success_rate"].astype(float)
        + (w_v * keep["value_pct"].astype(float) if has_value else 0.0)
        + w_vol * keep["volume_pct"].astype(float)
    )
    keep["score_percentile"] = percentile_rank(keep["score"])

    # Step 4 - confidence banding.
    def band(v):
        if v >= a.confidence_high:
            return "high"
        if v >= a.confidence_min:
            return "medium"
        return "low"

    keep["confidence"] = keep["volume"].apply(band)

    # Step 6 - tier by percentile, low confidence capped out of Launch.
    def tier(r):
        p = r["score_percentile"]
        t = "Launch" if p >= a.launch_tier_pct else ("Expand" if p >= a.expand_tier_pct else "Hold")
        if r["confidence"] == "low" and t == "Launch":
            return "Expand"
        return t

    keep["confidence_capped"] = keep.apply(
        lambda r: r["confidence"] == "low" and r["score_percentile"] >= a.launch_tier_pct, axis=1
    )
    keep["tier"] = keep.apply(tier, axis=1)
    keep = keep.sort_values(["score", "id"], ascending=[False, True])

    qualifying = keep[keep["tier"] == "Launch"]
    launch = qualifying.head(max(0, a.launch_size)).copy()
    keep["in_launch_list"] = keep["id"].isin(set(launch["id"]))

    excluded = out[out["excluded"]].copy()
    for col in ("value_pct", "volume_pct", "score", "score_percentile", "tier"):
        excluded[col] = None
    excluded["confidence"] = excluded["volume"].apply(band)
    excluded["confidence_capped"] = False
    excluded["in_launch_list"] = False

    full = pd.concat([keep, excluded], ignore_index=True)

    if len(qualifying) < a.launch_size:
        sentence = (
            f"Your top tier has {len(qualifying)} qualifying locations - fewer than the "
            f"{a.launch_size} requested, so the launch list is all {len(qualifying)}."
        )
    else:
        sentence = (
            f"Your top tier has {len(qualifying)} qualifying locations; here are the top "
            f"{len(launch)} to launch with. The rest is where you expand as budget grows."
        )
    return full, launch, note, sentence


def main(argv=None):
    a = parse_args(argv)
    df = load(a.input)
    full, launch, note, sentence = score(df, a)
    os.makedirs(a.outdir, exist_ok=True)
    full_path = os.path.join(a.outdir, "scored_locations.csv")
    launch_path = os.path.join(a.outdir, "launch_list.csv")
    full.to_csv(full_path, index=False)
    launch.to_csv(launch_path, index=False)

    # Step 7 - self-check before delivery, printed so it is auditable.
    leaked = launch[launch["confidence"] == "low"]
    print(f"rows in: {len(df)}  scored: {(~full['excluded']).sum()}  excluded: {full['excluded'].sum()}")
    if note:
        print(note)
    print(sentence)
    print(f"thin-sample rows in launch list (must be 0): {len(leaked)}")
    print(f"wrote {full_path} and {launch_path}")


if __name__ == "__main__":
    main()
