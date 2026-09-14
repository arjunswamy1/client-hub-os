# Media Brain Hardening Report

Written for someone who was not in these sessions. This report covers Phases 1a–1g (framework defects transcribed verbatim from the docs into the code), Phase 2 (proving the engine decides correctly against synthetic fixtures), and Phase 3 (the DID mapping tool and the pilot join-coverage findings it produced). It ends with what is still open.

The objective of the whole system is unchanged: scale as quickly as possible without losing money on the campaign. Everything below either fixes an arithmetic or reasoning error that stood between that sentence and the code, or documents what the first real client data told us.

---

## 1. What changed, by phase

### Phase 1a — min_calls was computed on the wrong formula

**Defect.** `engine.ts` computed the confidence threshold as `(2 ÷ gap)²`. The derivation in the Decision Engine is the standard error of a *difference between two independent samples*, which carries an extra √2: the detectable gap is about `2√2 ÷ √n`, so the required sample is `(2√2 ÷ gap)² = 8 ÷ gap²`. The code had silently dropped the √2 — the exact error the doc was written to prevent.

**Fix.** `src/lib/mediaBrain/engine.ts` — `minCalls = ceil(8 / gap²)`. Default actionable gap moved from 0.40 to **0.57**, because 25 calls detects a ~57% gap, not a 40% one; at 0.40 the true requirement is 50 calls per angle, which is more than the answer is worth at most pay-per-call economics. The dead `minCallsDefault` export was removed. Doc: `01_Decision_Engine.md` §4 — the gap table was rewritten (100% → ~8, 60% → ~22, 57% → ~25, 40% → ~50, 25% → ~128, 10% → ~800).

### Phase 1b — kill-threshold confidence overstated

**Defect.** The docs claimed killing at 2× payout with zero conversions gives 94% confidence the entity is genuinely broken. The arithmetic is e⁻² ≈ 13.5% chance of a false kill, i.e. **~87%** confidence. 94% would require 3× payout, which lets a dead ad run 50% longer.

**Fix.** Docs only — the threshold itself (2× payout static, 2× average bid RTB) was already correct in code and unchanged. `01_Decision_Engine.md` §6.3 and §16 now state ~87% with the e⁻² derivation, and explain the deliberate trade: we take the faster trigger because letting losers run is the more expensive mistake.

### Phase 1c — cost per angle used the wrong denominator

**Defect.** The worked example priced a test at `{min_calls} × cost per call`, describing a $50 payout, 60% billable rate, $30-per-call campaign at exactly breakeven — a campaign in which nothing can ever graduate, because nothing clears breakeven *with margin to spare*. Test budgets must be priced on cost per **billable** call, since `{min_calls}` counts billable calls.

**Fix.** `01_Decision_Engine.md` §9 and §16 now use **$50 payout, $40 cost per billable call, 20% margin**: kill at $100, 25 billable calls to graduate, **$1,000 per angle per window**, allowable cost per call at 20% target margin = $40. A regression test (`src/test/mediaBrainWorkedExample.test.ts`) pins these numbers so the example cannot drift again.

### Phase 1d — margins and the actionable gap were decorative

**Defect.** `target_margin`, `min_margin`, and the actionable gap were stored on the Instance record but never read: margin bands were hardcoded, the allowable cost per call was computed at intake and never compared against live rows, and pulls fell back to defaults when the Instance was incomplete.

**Fix.** `src/lib/mediaBrain/engine.ts` — `marginBand(marginPct, minMargin, targetMargin)` anchors bands on the client's stored floor and target rather than JSX literals; new `exceedsAllowableCostPerCall` marks every row whose cost per call is above the allowable. `src/lib/mediaBrain/pull.ts` — kill threshold, allowable cost, margins, and gap are read from the Instance with **no fallbacks**; a missing value stops the pull; a stored kill threshold that disagrees with current payout terms raises an "economics changed — re-run intake" flag. `MediaBrainIntakePage.tsx` gained an **A8 Margin targets** step (target margin, minimum margin, actionable gap, with Unknown toggles). The Daily page gained cost-per-call and vs-allowable columns and a re-run-intake control. Docs: `01_Decision_Engine.md` §1, `02_Client_Intake.md` A8 + Part B rows.

### Phase 1e — "zero billable" was undefined under RTB

**Defect.** Under RTB payout is continuous and includes zeros, so "billable" is not a clean line — but the kill rule fired on "zero billable calls," which is undefined in that mode.

**Fix.** "Zero billable" is now defined explicitly per mode. `adapter.ts` adds `paid: boolean` (payout > 0, independent of duration and conversion) to every canonical call across all five call tables. `join.ts` carries `paid_calls` and `paid_not_billable_calls` per entity row. `engine.ts` has a single `killCount(payoutMode, row)` — paid calls under RTB, billable under static — used by both the kill rule and the confidence state's decisive-zero branch. `pull.ts` surfaces paid-but-not-billable as its own count under static and flags it when non-trivial (≥5 calls or ≥10% of paid), because it usually means the billable definition on the economics record disagrees with what the buyer actually pays for. Docs: `01_Decision_Engine.md` §2, §6.3.

### Phase 1f — the fragmentation check used the wrong numerator

**Defect.** The fragmentation check (is the account splitting volume across more ad sets than can each exit Meta's learning phase?) divided billable calls across ad sets. Meta's ~50-per-week floor applies to the account's own Meta optimisation event — usually "call initiated" or a CAPI-fired qualified call — **not** the billable definition. Counting billable calls against Meta's floor is a denominator error.

**Fix.** Additive migration adds `meta_conversion_event text` and `expected_meta_events_per_week` to `media_brain_instances` (nullable). Intake A1 asks both, with an Unknown toggle. Weekly step 7 labels which event it used, warns when it differs from the billable definition, and when the event is UNKNOWN the check **does not run** — it reports that it cannot run, and never silently substitutes billable calls. Docs: `01_Decision_Engine.md` §4, `02_Client_Intake.md` A1.

### Phase 1g — circuit breakers had no structured action

**Defect.** The three circuit breakers fired as free text with no consistent recommended action and nothing making the propose-only boundary explicit.

**Fix.** Each breaker carries a structured `action: string`, rendered as a distinct "Recommended action" line on the Daily page: tracking broken → pause all spend for this client and alert the account team; buyer down → pause the affected ad sets and alert the client; ad past the kill threshold with zero billable → propose pausing the named ads, noting §6.3 is the decisive verdict and does not wait for `{min_calls}`. All three remain **propose-only** — no control exists that executes anything, and one banner line on the page states that boundary. Docs: `03_Operating_Procedures.md` §3.

### Phase 2 — proving the engine decides correctly

**Defect.** Verdict logic — `suggestVerdict`, graduation gates, scale qualification — lived inline in `MediaBrainWeeklyPage.tsx`, contradicting the rule that every formula lives exactly once in the engine. And there was no automated proof the rules produced the right verdicts.

**Fix.** New `src/lib/mediaBrain/decisions.ts`: pure functions, no React, no Supabase. `suggestVerdict(row, ctx)` (§6 cut rules, §7 hold rules), `graduationGates(row, group, ctx)` (two of three is never a pass), `scaleQualification(row, ctx, checks)` (all four conditions plus RTB extras), and `marginalVerdict(base, next, ctx)` (§8's judge-the-increment rule). The weekly page imports these and keeps no second copy of any rule. `pull.ts` was split: `pullWindow` fetches and runs failure checks, then delegates all computation to a new pure `computeWindow(...)` that tests exercise directly against in-memory fixtures. Two deliberate deviations were taken with the user's approval: tests run against fixtures rather than a seeded database (the call and Meta tables are read-only), and the fixture economics use $24 cost per call ($40 cost per billable call, 20% margin) so the fixture campaign is not stuck at exact breakeven. CI: `.github/workflows/ci.yml` installs, typechecks, and runs the suite on every push and pull request. Results in §4.

### Phase 3 — the DID mapping tool and the pilot audit

The join audit's blocker: `client_dids` was empty for every client with live data, so the join's primary path (DID → `client_dids` → `creative_name` → `ad_creatives`) resolved nothing and everything fell to an equally unpopulated vertical-pattern fallback.

**Built.** `src/lib/mediaBrain/didMapping.ts` (pure logic: the five call sources and which column each stores its tracking number in, `computeCoverage` built on the join's own resolver functions so coverage cannot drift from the join, per-DID aggregation, exact/strong/loose suggestions, the reverse view, reuse detection) and `src/pages/MediaBrainMappingsPage.tsx` at `/media-brain/:clientId/mappings` (admin and assigned account managers), wired into the Media Brain nav. The coverage meter is the point of the screen: real-path / fallback-only / unresolved against an 80% threshold, recomputed live. Suggestions are proposals — never auto-applied; only exact matches can be bulk-accepted, and that goes through a confirmation naming the row count. The tool writes only to `client_dids` and `client_did_periods`; the call tables and Meta sync tables remain read-only. What it found on the pilot client is in §5.

---

## 2. Before / after — the worked example

| Value | Before | After |
|---|---|---|
| Kill threshold | 2 × payout = $100 (unchanged) | $100, with confidence claim corrected |
| Kill confidence claim | 94% | **~87%** (e⁻² ≈ 13.5% false-kill chance) |
| min_calls | 25 (default unchanged) | 25 |
| min_calls formula | (2 ÷ gap)² | **8 ÷ gap²** (the √2 correction) |
| Default actionable gap | 0.40 | **0.57** (25 calls detect a ~57% gap, not 40%) |
| Cost per angle | $750 (min_calls × cost per **call**) | **$1,000** (25 × $40 cost per **billable** call) |
| Allowable cost per call | Stored, never read | $40 (RPC $50 × (1 − 0.20)); every row is compared against it |
| Margin bands | Hardcoded literals | Anchored on the Instance's stored floor and target |

The fixture campaign: $50 payout, 60% billable rate, $24 cost per call → $40 cost per billable call, 20% margin. The old $30-per-call figure described a campaign at exact breakeven, in which the graduation gate ("clears breakeven with margin to spare") could never pass.

---

## 3. The three corrected claims

These are the substantive changes to the framework's *reasoning*, so the arithmetic is shown.

**The √2 correction on detectable gap.** Ranking two angles compares two noisy estimates, not one estimate against a known truth. The standard error of a difference between two independent samples is √2 larger than the wobble on a single estimate (1 ÷ √n), so the detectable gap is about 2√2 ÷ √n. Inverted: n = (2√2 ÷ gap)² = 8 ÷ gap². The code had (2 ÷ gap)² = 4 ÷ gap² — understating the required sample by exactly half. At the default, 8 ÷ 0.57² ≈ 24.6 → 25; the old formula at gap 0.40 gave (2 ÷ 0.4)² = 25 for the *wrong reason*, two errors cancelling into a plausible-looking number.

**The e⁻² kill confidence.** If an ad were performing at its allowable cost, the probability of seeing zero conversions by the time spend reaches k × payout is e⁻ᵏ. At k = 2: e⁻² ≈ 0.135 — a 13.5% chance of killing a fine ad, i.e. ~87% confidence it is genuinely broken. 94% (e⁻³) would require spending 3× payout before acting, letting a dead ad run 50% longer. The framework deliberately takes the faster trigger; the docs now say 87% and show the trade.

**The cost-per-billable-call denominator.** `{min_calls}` counts *billable* calls, so a test budget must buy 25 *billable* calls. At $50 payout and $24 cost per call with a 60% billable rate, each billable call costs $24 ÷ 0.60 = $40, and the angle costs 25 × $40 = **$1,000** to rank conclusively. Pricing on cost per call ($24) would underfund every test by 40% and produce verdicts on samples the framework itself declares unreadable.

---

## 4. Synthetic test results

`src/test/mediaBrain.test.ts` — ten cases against 14 days of fixture Meta rows and canonical calls, no database, no network. All ten pass, plus the seven worked-example assertions: **17/17**.

| # | Case | Result |
|---|---|---|
| 1 | Clear loser (25 billable calls, margin per call below breakeven) | `cut` |
| 2 | Graduation candidate (clears breakeven with margin, top of group, ≥ min_calls) | all three gates pass |
| 3 | Group leader on 8 billable calls | `hold`; gates fail; failing gate identified as the **volume** gate |
| 4 | Past kill threshold with zero billable calls | breaker fires, confidence `decisive_zero`, action names the ad — **without** waiting for min_calls |
| 5 | 6 billable calls at good margin | `insufficient`, no performance verdict, row renders greyed |
| 6 | Meta rows present, no calls join | lands in `unjoinedSpend` with the tracking-flag breaker; does **not** appear as an entity with zero calls and catastrophic margin |
| 7 | Zero Meta rows | pull returns `ok: false` — a failure, not an empty report |
| 8 | Scaling on marginal return | blended ROAS passes while the last increment returns below target → `stop scaling`; both halves asserted explicitly |
| 9 | Denominator guard | cost per call ($12) and cost per billable call ($40) computed on their own denominators; no verdict compares one against the other |
| 10 | RTB kill count | kill rule counts **paid** calls: a row with billable 0 but paid 3 does not fire the breaker; the same row under static fires |

Case 3 is the one worth remembering: a group leader at 8 calls is noise, and the test proves the framework says so — two of three gates is not a pass.

---

## 5. Pilot join coverage — BuyologyIQ

These numbers were confirmed directly against the database.

**Coverage, last 30 days: 0%.** 2,417 calls; **0** resolving on the real path (DID → `client_dids` → `creative_name` → `ad_creatives`); **0** via the `client_verticals` pattern fallback; **2,417 (100%) resolving to nothing**. On the Meta side: 82 ads, $11,150.70 lifetime spend; in-window, 32 ad rows across 9 campaigns carrying **$8,866.80** — all of it currently unattributable at ad level.

**Root cause: the tracking number was never captured.** In `ringba_calls` for this client, `inbound_number` equals `caller_number` on 4,658 of 4,824 calls (96.6%), yielding 3,905 distinct "DIDs" for 4,824 calls. The column that should hold the tracking number holds the caller's own number instead. **No amount of mapping fixes this** — the Ringba sync must be corrected at the source to capture the DID before the primary join path can resolve anything. The mapping tool detects this shape (a "DID" that equals the caller's number on nearly every call) and says so on screen, rather than letting someone map caller numbers to creatives.

**A coarser join is available.** Ringba carries only 6 distinct `campaign_name` values, and they are buyer/vertical names: "Walk In tubs" (1,970 calls), "Bathroom Remodel" (1,893), "Walk In tubs Live Transfer" (897 — 100% paid), plus small Canada and Branded variants. The Meta side names campaigns like `WalkinTub_Statics_AggresiveAngle` and `8/18 - 08/25 BuyQ_Bath_Ringba_Lifetime_META`. So walk-in tubs and bathroom remodel can be matched as two verticals through `client_verticals.meta_patterns` / `ringba_patterns` — which for this client are also empty, so populating them is this week's work. One in-window campaign, `08/19 Ringba_Lifetime_Statics - Copy` ($757.28), mixes tub and bath ads and would need ad-name-level patterns; the ad names carry `Tub` / `Bath`, so it is resolvable.

**What that means, plainly.** Vertical-level attribution is reachable this week and would give margin per vertical. Ad-level and angle-level attribution is not reachable, and the Decision Engine's core loop — per-ad cut/hold/scale and per-angle graduation — requires ad-level attribution. **The pilot as designed cannot run on BuyologyIQ until the tracking number is captured.** What can run now is a coarser loop: margin per vertical, kill-rule checks at campaign level, and the downstream diagnostics (connection rate, billable rate, paid-vs-billable divergence) that do not need ad identity.

One more finding with product implications: "Walk In tubs Live Transfer" pays on 100% of calls. That is a different product with different economics, and it should be its own vertical — blending it into walk-in tubs would inflate that vertical's apparent RPC and hide the real per-vertical margins the fallback exists to produce.

---

## 6. Framework doc changes

Every edit across `docs/media-brain/`, per file. **The full set needs re-syncing to Lovable project knowledge** — the in-app AI reads these docs and must not drift from the code.

**`01_Decision_Engine.md`**
- §1: actionable gap, target margin, and minimum margin are load-bearing variables.
- §4: min_calls formula `(2√2 ÷ gap)² = 8 ÷ gap²`; gap table doubled (57% → 25, 40% → 50, 25% → 128); default gap 0.57; fragmentation check numerator is the account's Meta optimisation event, with the explicit UNKNOWN-does-not-run rule.
- §2: RTB paragraph defines paid calls; "zero billable" under RTB means zero calls with payout above zero.
- §5: RTB distribution reading (median vs mean, P25, zero rate, top-10% share, duration as a revenue lever).
- §6.3: ~87% confidence with the e⁻² derivation; the static asymmetry (paid-but-not-billable surfaced as its own count).
- §9: cost-per-angle on cost per **billable** call; fast-signal elimination (cost per call, call rate, RTB median duration); connection rate is not an elimination signal.
- §12: circuit breakers with structured recommended actions; nothing else is an emergency.
- §16: settled values table and the corrected worked example ($50 / $40 / $1,000 / kill at $100).

**`02_Client_Intake.md`**
- A1: Meta conversion event and expected weekly count, with Unknown toggle.
- A8: margin targets (target margin, minimum margin, actionable gap) with defaults and Unknown toggles.
- Part B: computed Instance rows for the new fields.

**`03_Operating_Procedures.md`**
- §3: recommended action under each circuit breaker; propose-only boundary stated.

**`00_Framework_Index.md`** — unchanged this hardening; still the entry point.

---

## 7. Open and not done

- **The pilot cannot run as designed.** BuyologyIQ ad-level coverage is 0% because the Ringba sync never captured the tracking number. Until the sync is fixed, only the vertical-level fallback in §5 is available, and it cannot decide per-ad or per-angle questions.
- **Paid-vs-billable divergence is real and large.** Against a 90-second billable proxy: Ringba — 6,089 paid vs 4,655 long-enough, disagreeing on ~43% of calls (3,079 paid-but-short, 1,645 long-but-unpaid); Cannaball — ~15% divergence; RingFuel — 3 paid vs 2 long. Duration-based billable definitions may not match what buyers actually pay for; the static-mode paid-but-not-billable flag exists precisely for this, and every client's billable definition should be validated against it at intake.
- **No client has an Economics record yet.** Every threshold in the system is currently a default, not a client's real terms. The framework's own rule applies to us: a command run without an Instance record stops, and operating on stale thresholds is worse than operating on none.
- **`04_Client_Deck_Template.md` and the `DECK` command are still unbuilt.**
- **Volume tier boundaries are unvalidated.** They need data from a campaign with enough history to check whether the cut/scale cadences hold up against real variance.
- **Universal Ads for Cannaball remains blocked** on `403 INVALID_ADVERTISER_AUTHORIZATION` despite app approval; the spend backlog table is the workaround until access lands.
