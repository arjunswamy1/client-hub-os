# Location (ZIP) Scoring

Turns a location-level call/bid file into a ranked, tiered, budget-sized target list. Works for any vertical, any payout structure, any data export — nothing about the client's business is assumed.

Where it sits: location targeting is the **hardest constraint in a pay-per-call launch**. Buyer coverage is geographic, payout is geographic, and a location the network cannot monetise cannot be fixed by a better hook or a tighter budget. So the target list is decided **before** campaigns are built, and campaign structure is built around it.

Implementation, stated once:

| Piece | Lives in |
|---|---|
| Rules (steps 3–6): success rate, hard excludes, confidence banding, weighted percentile score, tiering, launch-list sizing, weight redistribution | `src/lib/mediaBrain/locationScoring.ts` |
| Reference implementation Santiago runs by hand | `scripts/media-brain/score_locations.py` |
| Screen | `/media-brain/:clientId/locations` |
| Recorded runs | `media_brain_location_score_runs`, `media_brain_location_scores` |

No page, hook or function re-derives any of it. The two implementations mirror each other and a parity test asserts they agree on the same input (`src/test/mediaBrainLocationScoring.test.ts`).

## Two boundaries to keep straight

### The confidence gate is not `{min_calls}`

They look like the same idea and are not.

| | `{min_calls}` (§4 of `01_Decision_Engine.md`) | Location confidence gate (step 4 below) |
|---|---|---|
| Counts | **Billable calls** | **Events** on the location |
| Default | **25** (`8 ÷ gap²`, gap 0.57) | **10** |
| Answers | "Do I have enough sample to **rank this angle against another angle** on margin per call?" | "Does this location's **own success rate** mean anything yet?" |
| Consequence below it | The row renders greyed and labelled insufficient; no ranking | The location is capped out of Launch; it may surface as worth watching |

`{min_calls}` carries a √2 because ranking two angles compares two noisy estimates, and the uncertainty of a *difference* is larger than that of one estimate. The location gate is not a difference test at all — it is a floor under a single proportion before it is allowed to headline a launch list. **Never substitute one number for the other, and never "harmonise" them.**

### Margin is deliberately absent

There is no margin floor or margin target input here, and there must never be one.

Location ranking is a **relative comparison across locations** using the network's own accept rate and payout. An absolute margin test needs cost per call, and **actual cost per call does not exist until the campaign spends** — before launch every location's cost per call is the same guess. Applying a margin threshold to a pre-launch location list would dress a guess as a measurement.

Margin governs **cut / hold / scale after launch** (`decisions.ts`, `01_Decision_Engine.md` §5–§7). That is the correct boundary. Do not wire the instance's `min_margin`, `target_margin` or `allowable_cost_per_call` into location scoring.

Everything else in the framework still applies: **nothing auto-executes** (a scored list is a proposal a human approves), an **empty input is a failure not a zero**, and live-data scoring obeys the same **publisher scoping** gate as every other read.

## Step 1 — Ask before touching the data

Never assume the payout model, what the columns mean, or the client's priorities. At minimum:

- **What each column represents.** State your inference from the actual values and have it confirmed.
- **What the file represents** — their own trailing campaign history, or a broader market pull.
- **Payout mode** — static vs RTB. It changes which column is the value signal.
- **What the score should prioritise** — connection quality, volume, payout value, or a blend.
- **Service-area model** — national lead-gen vs a single local business with a real geographic limit. This decides whether data alone can pick locations or a hard geographic filter applies on top.
- **Budget**, so the launch list is sized to what the budget can support.

On the screen, column mapping and threshold confirmation are **required steps, not silent defaults**. Skipping them is how a wrong payout-mode assumption silently reshapes a target list.

## Step 2 — Inspect and confirm the data shape

Load the file. Map whatever columns exist onto canonical roles:

| Role | Meaning |
|---|---|
| **id** | ZIP / city / DMA |
| **volume** | total events |
| **success** | accepted / connected / billable — confirm which |
| **value** *(optional)* | avg payout / bid / revenue per event |
| **hard-fail** *(optional)* | events that failed for a **structural** reason (no buyer coverage), as distinct from a **quality** reason (buyer declined) |

A structural failure is not fixable by better targeting or creative. A quality failure might be. Never hardcode a client's column names into logic.

## Step 3 — Hard excludes before scoring

Remove structurally non-viable locations **before** scoring, not after:

- structural failure rate **≥ 50%** (`--hard-fail-rate-max`)
- success rate **< 30%** (`--min-success-rate`)

Exclude rather than rank low. A structurally broken location must never leak into percentile scoring and drag the scale for everyone else. Excluded rows carry their reason and **no score at all**.

## Step 4 — Confidence gate

Small samples lie. A location with 2 events at 100% success is not better than one with 200 at 80%.

- volume ≥ `confidence-high` (20) → **high**
- volume ≥ `confidence-min` (10) → **medium**
- below `confidence-min` → **low**

A low-confidence location is **capped out of Launch regardless of score**. It can surface as "worth watching"; it must not headline the launch list on a fluke.

## Step 5 — Blended, normalised score

Default when the client wants a bit of everything:

- **40% success rate** — highest weight. A great payout on a location that rarely connects doesn't matter.
- **35% value**, percentile-ranked so raw dollar scale doesn't dominate.
- **25% volume**, log-transformed then percentile-ranked so a few huge outliers don't drown everything.

Percentiles are average-rank percentiles computed over the **surviving** set only.

With **no value column**, its weight is redistributed **proportionally** into success and volume (success 61.5%, volume 38.5% at the defaults) — never silently zeroed — **and the redistribution is stated on the output.**

## Step 6 — Tier, then right-size the launch list

Tier by score percentile: top 10% **Launch**, next 20% **Expand**, rest **Hold**. Low-confidence locations are capped out of Launch.

**The full Launch tier is a growth pool, not a day-one target list.** A small daily budget spread across hundreds of locations means the platform never gathers enough signal on any one. Size the real launch list (default top 25) to the budget and say plainly:

> "Your top tier has N qualifying locations; here are the top 25 to launch with; the rest is where you expand as budget grows."

When the tier holds fewer than the requested size, say that instead — do not pad the list from a lower tier.

## Step 7 — Self-rate before delivering

Check the output against the rubric:

1. Does exclusion actually remove the non-viable?
2. Does the weighting match what was asked for?
3. Did any thin-sample location sneak into the top tier?
4. Is the launch list sized to real budget?
5. Is the output a specific list, not a description of a method?

Below 8.5, fix the specific weak point rather than re-running the whole thing.

## Step 8 — Output

Two files: the **full scored file** (every location, tier, score, exclusion reason) and the **right-sized launch list**, ready to paste into platform targeting. Both are downloadable from the screen and both are persisted.

## Scoring from live call data

For an existing campaign the location table is built from the client's own calls rather than an upload:

| Source | ZIP |
|---|---|
| `cannaball_calls` | `caller_zip` |
| `moja_calls` | `caller_zip` |
| `jacuzzi_leads` | `billing_zip` |
| Ringba (`ringba_calls`) | `metadata->>'tag:Geo:ZipCode'` — there is no ZIP column; it is in the tag bag |

Volume = calls. Success = billable per the client's **governing** definition (`engine.isBillableCall`, from the economics record — never a default). Value = payout.

**Publisher scoping applies here exactly as everywhere else.** The same `publisher_scoping` / `attributed_publishers` gate runs first, and calls from publishers that are not ours are excluded before aggregation. Scoring a client's ZIPs on calls we did not buy would repeat the error that made BuyologyIQ's first read wrong — and it would be *harder* to spot here, because a location list looks plausible either way.

Calls carrying no ZIP are dropped and **counted as a named data gap**, never bucketed as a location called "".

## A run is evidence

Two months later someone needs to know which list was launched and on what basis. Every run records the **column mapping**, the **thresholds and weights**, the **payout mode**, the **budget and launch size it was sized to**, and the publisher-scoping note — alongside the output, never just the output.
