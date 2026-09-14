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

---

## Phase 1 — pilot unblock: the UTM attribution tier, and what Ringba actually offers

*Appended after the phases above. Flag for re-sync to Lovable project knowledge along with `01` §3 and `03` §2.*

### The redirect

Phase 0 established that the Ringba sync never asks for a dialed number: `inbound_number` maps from `inboundPhoneNumber`, which this account returns as the caller's ANI, and the `tag:DialedNumber:Number` fallback in the mapper is dead code because `DialedNumber` was in neither `VALUE_COLUMNS` nor the `["InboundNumber","Geo","User"]` tag allowlist. So the DID remedy could not be the fix.

The account does, however, already carry an ad-level key the join ignored: the UTM tags Meta passes into Ringba, stored in `ringba_calls.metadata` as `tag:User:*`.

### The tier model

The join now resolves each call through explicit tiers and reports coverage per tier. `src/lib/mediaBrain/join.ts` holds the order in one function, `resolveCall`, which both the join and the coverage meter call — so coverage cannot drift from behaviour.

| Tier | Path | Level | Ad-level decisions |
|---|---|---|---|
| `utm_ad` | `creative_id` → `platform_ad_id`; else `utm_content` → `platform_ad_id`, else `ad_name` | Ad | Yes |
| `did_ad` | DID → `client_dids` / `client_did_periods` → `creative_name` → ad | Ad | Yes |
| `utm_campaign` | `utm_campaign` → `platform_campaign_id`, else `campaign_name` | Campaign | **No** |
| `vertical` | campaign-name patterns | Vertical | No |
| `none` | unresolved | — | No |

Every joined row carries `resolution` and `adLevelEligible`. Campaign- and vertical-level rows are barred from per-ad verdicts and excluded from the headline coverage number, because per-ad cut/hold/scale and per-angle graduation need one ad per row.

### BuyologyIQ coverage with the UTM tier active — last 30 days

| Tier | Calls | Share |
|---|---|---|
| Total calls | 2,423 | 100% |
| `utm_ad` — ad level | 94 | 3.9% |
| `did_ad` — ad level | 0 | 0.0% |
| **Ad level total (the 80% threshold)** | **94** | **3.9%** |
| `utm_campaign` — campaign level only | 0 | 0.0% |
| `vertical` | 0 | 0.0% |
| `none` | 2,329 | 96.1% |

Up from 0%, and still nowhere near a pilot. 621 calls carry a `utm_source`, 604 a `utm_content` and 72 a `creative_id`, but only 94 resolve: the rest reference Meta objects in the 23 ad accounts on this token that are not being synced. Notably all 613 `utm_campaign` values (26 distinct) match no synced campaign, so campaign-level resolution adds nothing yet. `client_dids` and `client_verticals` remain empty, which is why both fallback tiers are zero.

### What Ringba actually exposes — the diagnostic answer

`sync-ringba-calls-buyology?diagnose=1` (read-only; it returns before any call-log fetch or insert) reports **110 call-log columns and 88 tags in 18 groups**. The dialed number *is* available, in more than one place:

- Columns: `number` ("Number", group Call) and `numberId`; `numberPoolName`, `numberPoolId`, `isFromNumberPool` (group Impression); `targetNumber` / `buyerTargetNumber` (the buyer's number, not the tracking number); `inboundPhoneNumber` is titled "Caller ID", confirming Phase 0's reading.
- Tag groups include **`DialedNumber`** with `Number` and `Name` — exactly the tag the mapper already reads and never requests.

Also newly visible and useful later: `noPayoutReason`, `blockReason`, `hasPayout`, the `RTB` group (`bidAmount`, `winningBid`, `winningBidCallAccepted/Rejected`) and the `Ring Tree` group (winning bid, bid depth, ring successes/failures) — the no-bid diagnostics the RTB branch of the framework asks for.

Per instruction, nothing was changed in `VALUE_COLUMNS` or the tag allowlist, no `did` column was added and no backfill was written. The next step is a decision, not a guess: request `DialedNumber:Number` (and `numberPoolName`) going forward.

### Meta ad accounts

The sync already reads `metadata.sync_ad_accounts` as an array. Settings now has an admin-only picker listing all 24 accounts on the token by name, writing that list. It records intent only — it changes no sync behaviour and starts no sync, because several accounts on this token belong to other clients and syncing them would contaminate BuyologyIQ's spend.

### Tests

20/20 (was 17/17). Three new cases: a `creative_id` matching a `platform_ad_id` resolves at `utm_ad`; a call with only `utm_campaign` resolves at `utm_campaign`, is `adLevelEligible: false` and leaves ad-level coverage at zero; a call with no tags, no DID mapping and no vertical match lands in `unjoinedCalls` while its spend surfaces as a tracking flag.

---

## Phase 1b — the dialed number, recovered

The diagnostic's answer was acted on. `sync-ringba-calls-buyology` now requests `number`, `numberId`, `numberPoolName`, `numberPoolId`, `isFromNumberPool`, `hasPayout`, `noPayoutReason`, and `DialedNumber` joins the tag-discovery allowlist. `ringba_calls` gained `did`, `did_pool_name`, `is_from_number_pool`, `has_payout`, `no_payout_reason`, and both phone columns now carry a comment recording what they actually contain.

`inbound_number` maps from `inboundPhoneNumber` and nothing else — the `tag:DialedNumber:Number` fallback that conflated caller with tracking number is gone. In `adapter.ts` the canonical `did` reads `ringba_calls.did` and falls back to `inbound_number` only when it is null, setting `did_is_caller_number_fallback`; the pull raises that as a named count. There is no silent path from a caller's number into attribution.

`sync-ringba-calls` (Billy/CPM) has the same mapping gap but sends **no `valueColumns` at all**, so there is no column list to extend — adding one would narrow the default record it currently relies on. Its mapper now reads the five fields from whatever the default record carries and leaves them null otherwise. Campaign filtering untouched.

### Backfill

`supabase/functions/ringba-backfill-did` — parameterised by `client_id` and either `days_back` or an explicit `start`/`end`, idempotent, `UPDATE ... WHERE call_id = $1 AND client_id = $2` only, restricted to the five new columns by an explicit allowlist that throws on anything else. No insert, no delete, no pre-existing column. Ran in three window slices for BuyologyIQ's last 30 days (each invocation stops at a 110s budget).

| | |
|---|---|
| Rows in window | 2,417 |
| Matched by call id | 2,417 |
| Populated with a non-null `did` | 2,321 (96.0%) |
| Ringba returned no dialed number | 96 |
| **Distinct `did` values** | **302** |
| Rows where `did` equals `inbound_number` | 0 |

302 distinct values across 2,321 calls — **genuine tracking numbers**, not caller numbers. They are toll-free (`+18884611277` alone took 337 calls) and `is_from_number_pool` is true on the bulk of them, consistent with Ringba number pools.

### Payout: what `noPayoutReason` and `hasPayout` actually say

**Neither field answers the question on this account.**

- `no_payout_reason` is **null on all 2,417 rows** — the column is requested and returns nothing.
- `has_payout` is **never false**: true on 1,605 rows, null on the rest. It is true on 1,267 of the 1,354 rows whose payout is $0. It does not distinguish the sub-dollar tail from the $55/$60 calls, or even zero from paid.

The sub-dollar tail was answered by the data instead, decisively:

| Payout | Calls | Range | Median duration | `has_payout` true / null | Converted |
|---|---|---|---|---|---|
| $0 | 1,354 | — | 44s | 1,267 / 87 | 245 |
| $0.05–$0.75 | 721 | avg $0.07 | 13s | 6 / 715 | 24 |
| $1.00 | 1 | — | 1,193s | 0 / 1 | 0 |
| $55–$60 | 341 | avg $55.25 | 357s | 332 / 9 | 341 |

On **all 721** sub-dollar rows, `payout` equals `metadata.total_cost` exactly. This is not payout at all: the mapper's `payoutAmount || payout || totalCost` chain falls through to telco cost whenever Ringba's real payout is zero. So the account has two payout states, $0 and $55/$60 — a **STATIC** payout shape — and the $0.05–$0.75 tail is cost misrecorded as revenue. The billable definition for this client should key on the $55/$60 payout with the duration threshold, and `payout` must stop falling back to `totalCost`. That fallback is in the pre-existing mapping and was left alone here; changing it rewrites historical revenue and needs its own decision.

### Coverage after the backfill — BuyologyIQ, last 30 days

| Tier | Calls | Share |
|---|---|---|
| `utm_ad` | 94 | 3.9% |
| `did_ad` | 0 | 0.0% |
| **Ad level** | **94** | **3.9%** |
| `utm_campaign` | 0 | 0.0% |
| `vertical` | 0 | 0.0% |
| `none` | 2,329 | 96.1% |

Unchanged against the 3.9% baseline, and the reason is exactly the one the mapping tool exists to fix: **`client_dids` holds zero rows for this client**, so 2,321 calls now carry a real tracking number with nothing to match it to. The 302 distinct DIDs, top ones by call volume:

`+18884611277` 337 · `+18884611282` 55 · `+18888310922` 41 · `+18664722878` 30 · `+18887070993` 30 · `+18889651917` 29 · `+18666590082` 23 · `+18559651602` 22 · `+18887110714` 20 · `+18887070831` 20 · `+18886793596` 19 · `+18887070862` 18 · `+18887772486` 17 · `+18889282764` 17 · `+18888491498` 17 · `+18887070942` 16 · `+18887070867` 16 · `+18442596021` 16 · `+18888543195` 16 · `+18889641487` 16 · `+18887070915` 16 · `+18889282756` 15 · `+18887071018` 14 · `+18663173380` 14 · `+18883311799` 14

The gap is missing mappings, not missing data. Mapping the top 20 DIDs covers roughly 750 calls; mapping the long tail is what gets this client past 80%.

Tests: 21/21 (was 20/20) — one new case asserting a real dialed number is not flagged and a caller-number fallback is.

---

## Phase 2 + 3a — per-vertical revenue, the vertical read, and intake validation

**The finding that decided the design.** 1,764 of 2,320 backfilled calls (76%) came from number pools across 4 pools, and 100 of the 302 dialed numbers carry more than one distinct `utm_content` — up to 6 creatives on a single number. Pools rotate numbers across visitors, so DID → creative is invalid on this account and mapping it would misattribute. All 302 numbers map to exactly one Ringba campaign each, so the dialed number is a reliable *vertical* key on 96% of calls, and ad-level attribution can only come from UTM tags. **DIDs are therefore mapped to verticals, not creatives.**

**Payout no longer falls back to telco cost.** `mapCallToRow` used `payoutAmount || payout || totalCost || 0`, so a real payout of zero silently recorded the telco cost as revenue — the source of the 721 sub-dollar rows, where `payout` equalled `metadata.total_cost` exactly. The sync now reads `payoutAmount ?? payout ?? 0`; `??` rather than `||` so a legitimate zero is not skipped, and `totalCost` never becomes revenue. **Stored rows were not rewritten.** History and future are both corrected at read time: revenue counts a payout only at or above `{min_payout_threshold}`, and a non-zero sub-threshold payout equal to the recorded total cost sets `payout_looks_like_cost`, surfaced as a named count in the pull's flags.

**Per-vertical economics.** `media_brain_economics` gained `vertical_id` (nullable; null is the client-level default, unique per client either way), `revenue_source` (`platform` | `computed`, default `platform`) and `min_payout_threshold` (default 1.00). `revenue_source` is the load-bearing one: AJ confirmed Walk-In Tubs pays $80 per billable call, but our Ringba access shows $0.00 in payouts above $1 across 1,155 calls. A payout field we cannot see is a data limitation to declare, not a zero to believe — so that vertical computes revenue as contracted payout × billable calls, with billable determined by duration alone. The selection lives once in the engine, in `resolveRevenue`.

**Verticals created for BuyologyIQ**, assigned from the Ringba campaign name on the dialed number rather than from creative matching:

| Vertical | Ringba campaigns | Payout | Source | Confirmed |
|---|---|---|---|---|
| Walk-In Tubs | `Walk In tubs`, `Walk In tubs Canada` | $80 | `computed` | yes, by AJ |
| Bathroom Remodel | `Bathroom Remodel`, `Bathroom Remodel  - Canada`, `Bathroom Remodel - Branded` | $60 | `platform` | **observed, unconfirmed** |
| Live Transfer | `Walk In tubs Live Transfer` | $55 | `platform` | **observed, unconfirmed** |

Live Transfer is separate because it is 100% paid — blending it into Walk-In Tubs would inflate that vertical's RPC. The Canada and Branded campaigns carry zero payouts and tiny volume; they are mapped but flagged as possibly needing their own economics. The mixed Meta campaign `08/19 Ringba_Lifetime_Statics - Copy` is resolved ad by ad on ad-name patterns; an ad matching no pattern is reported **unclassified**, never assigned by default.

**The vertical read is read-only.** Per vertical: spend, calls, paid, billable, revenue with its source labelled, RPC, cost per call, cost per billable call, margin per call, margin %, confidence — plus an unclassified row and the ad-level coverage figure beside it. Cut / hold / scale verdicts do not render at this level; `adLevelDecisionEligible` is false on every row. A vertical blends many ads and the blend hides exactly the differences those rules act on.

**Intake validation (3a).** Before any threshold is computed, the stated billable definition is compared against the last 30 days of platform data in both directions — billable-by-definition but unpaid, and paid but not billable-by-definition. Above 10% disagreement intake blocks until the operator states which definition governs, and the choice is recorded on the Economics record. Where `revenue_source = 'computed'` the check says the payouts are not visible and validates only the duration side, rather than reporting invisible payouts as agreement.

BuyologyIQ, last 30 days: Walk-In Tubs 0.8% (passes, duration side only) · Bathroom Remodel 17.2% (**blocks**) · Live Transfer 1.5% (passes).

Tests: 31/31 (was 21/21) — ten new cases, including a pooled DID resolving to a vertical without ad-level eligibility, a `computed` vertical ignoring the platform payout field entirely, a 100%-paid vertical not leaking into a neighbour's RPC, and an ad matching no pattern landing in unclassified.
