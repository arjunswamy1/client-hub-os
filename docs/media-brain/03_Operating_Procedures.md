# Operating Procedures

**What this is:** the execution layer. `01_Decision_Engine.md` holds the rules — what a threshold is and why. This holds the procedure — what to pull, what to look at, and in what order.

**Rule of thumb for which file a thing belongs in:** if it answers "what should I do about this?", it's the Decision Engine. If it answers "what do I run and when?", it's here.

## 1. Commands

Add these to the project instructions. Each is a trigger; the procedure lives in this document.

| Command | Runs | Section |
|---|---|---|
| `DAILY [client]` | Circuit-breaker scan and dashboard. No optimizations. | §3 |
| `WEEKLY [client]` | Full review: diagnostics, dispositions, graduation, scale, budget. | §4 |
| `MONTHLY [client]` | Trends, fatigue curves, structure fitness, economics re-validation. | §5 |
| `INTAKE [client]` | Runs `02_Client_Intake.md`. Outputs the client's Economics and Instance files. | — |
| `DECK [client]` | Builds the weekly client deck from `04_Client_Deck_Template.md`. | — |

Every command reads the client's Instance file first for its thresholds. A command run without an Instance file should stop and say so rather than fall back on defaults.

## 2. Data pull

**Confirm the date range before every pull.** State the window explicitly — start date, end date, timezone — and get confirmation before pulling anything or producing any report. This is not a formality: an off-by-one window quietly changes every number downstream, timezone mismatches between Meta and call tracking split calls across days, and a report built on the wrong window looks exactly like a report built on the right one. Never infer the window from context.

One pull spec, used by all three cadences. Only the date window and the permitted actions change. Writing it once is the point — two pulls drift, and then Tuesday's numbers don't reconcile with Friday's.

### Meta side

Per ad, per ad set, per campaign, for the window: spend · impressions · clicks · CTR · CPM · frequency · reach · delivery status

### Call tracking side

Per `ad_id`, for the window: total calls · connected calls · billable calls · total payout · median payout · P25 payout · median duration · no-bid count · buyer breakdown

### Join

On `ad_id` in principle. In practice **no call table carries a Meta `ad_id` column**, so the join runs through resolution tiers, tried in order of how precisely each identifies an ad. The tier is recorded on every call and reported per tier — never summed into one "resolved" figure.

| Tier | Path | Level | Can carry ad-level decisions? |
|---|---|---|---|
| `utm_ad` | `creative_id` (e.g. Ringba `tag:User:creative`) → `platform_ad_id`; else `utm_content` → `platform_ad_id`, else → `ad_name` | Ad | Yes |
| `did_ad` | DID → `client_dids` / `client_did_periods` → `creative_name` → `ad_creatives` | Ad | Yes |
| `utm_campaign` | `utm_campaign` → `platform_campaign_id`, else → `campaign_name` | **Campaign** | **No** |
| `vertical` | campaign-name patterns on `client_verticals` | Vertical | No |
| `none` | nothing resolved | — | No |

`utm_ad` is tried before `did_ad` because a UTM names the ad directly while the DID path names it through two lookups. Both ad-level tiers beat `utm_campaign`, because ad-level resolution of any kind beats campaign-level resolution.

**A campaign-level resolution is not an ad-level one.** Per-ad cut/hold/scale and per-angle graduation need one ad per row, so `utm_campaign` and `vertical` rows are flagged ineligible for those verdicts and excluded from the ad-level coverage figure. Reporting them together would overstate readiness for exactly the decisions the engine exists to make.

**Pilot readiness is measured on ad-level coverage** (`utm_ad` + `did_ad`) against an 80% threshold. Below it, say plainly that the client is not ready for a pilot.

Any Meta spend that doesn't join to call data is a tracking flag, not a zero — see §3. Calls that resolve to nothing are reported as unattributed, never folded into a row.


### Computed columns

| Column | Formula |
|---|---|
| Cost per call | spend ÷ total calls |
| RPC | payout ÷ total calls |
| **Margin per call** | RPC − cost per call |
| Profit | payout − spend |
| Margin % | profit ÷ payout |
| Cost per billable call | spend ÷ billable calls |
| Call rate | calls ÷ clicks |
| Connection rate | connected ÷ total calls |
| Billable rate | billable ÷ connected |
| **Confidence state** | billable calls ≥ `{min_calls}` → sufficient, else insufficient |

**[RTB]** Also: median payout, P25, no-bid rate, top-buyer revenue share.

### Naming dependency

Grouping by angle, audience, and creative iteration depends on parsing structure out of Meta entity names. Read the account's actual convention once and record the parsing rule in the client's Instance file. Where names carry no structure, the dashboard reports at ad level only and says so rather than inventing groupings.

## 3. Daily

**Time: two minutes unless something is flagged.** Nothing here changes the account except circuit breakers.

### Order

1. **Circuit-breaker scan** — before anything else:

    - Tracking broken or calls not routing. *Signal: Meta spend with no joined call records, or calls with no* `ad_id`*.*
      **Recommended action:** pause all spend for this client and alert the account team. Spend is accruing against call data that is not arriving; nothing downstream can be read until the join is fixed.
    - Buyer down or at capacity. **[RTB]** abrupt no-bid spike or rate-limiting.
      **Recommended action:** pause the affected ad sets and alert the client. This is a routing conversation, not a media one.
    - Any ad past 2× payout with zero billable calls — **[RTB]** zero calls with a payout above zero (Layer 2 §6.3).
      **Recommended action:** propose pausing those specific ads, named. §6.3 makes this the decisive verdict — it does not wait for `{min_calls}`.

- A breaker fires → act today. Nothing else here justifies a same-day change.
- **Every breaker states its recommended action, and the daily view only ever proposes it.** The page executes nothing — no pauses, no budget changes, no creative swaps. The account manager carries the action out in Meta. A stated remedy is never something the page has already done.

2. **Account totals** — spend, calls, billable calls, profit, margin % against the client's floor.

3. **Ad set table** — margin per call, cost per billable call, billable calls, confidence state.

4. **Ad table** — same, plus call rate and median duration.

### Display rules

- **Confidence state on every row.** Anything below `{min_calls}` renders greyed or explicitly marked *insufficient data*. You see whether a number means anything before you see the number.
- **Circuit-breaker status at the top**, always visible, green or red.
- **No week-over-week deltas on the daily view.** They invite intervention on a cadence the data can't support.

### What not to do

No cuts, no budget changes, no creative swaps, no "just checking" edits. A number looking alarming on a Tuesday is not a circuit breaker. If it's still bad on review day, the weekly procedure will catch it.

## 4. Weekly

Run on the cadence the client's volume tier sets. Higher-volume tiers cut more often than they scale — check the Instance file.

### Steps

**1. Pull the window.** Full data pull (§2) for the review period.

**2. Diagnose anything that moved.** Run the Decision Engine's diagnostic tree — downstream first, then saturation, fatigue, structural. **[RTB]** traffic-side vs demand-side before anything else.

**3. Forced disposition.** Every ad set and every ad gets **keep / cut / hold**, written down. A hold names the evidence awaited and the date it arrives. Nothing carries forward unstated.

**4. Graduation.** Any angle clearing all three gates — absolute, relative, volume — moves to ABO. Two of three is not a pass.

**5. Scale.** Qualifying entities get one step of 10–20%. Check marginal return on the last increase before granting another.

**6. Budget reallocation.** Move budget from cut entities into proven ones. Recompute the test/scale split — 100% testing until an angle has graduated, then 80/20.

**7. Fragmentation check.** Expected weekly conversions ÷ active ad sets. Well under 50 means the structure won't exit learning phase.

**8. Log everything.** Date, what changed, why, expected result, review date.

### Output

A list of proposed actions, each with its evidence and confidence state, formatted for fast approve or reject. Nothing executes until approved.

## 5. Monthly

The trend layer. Nothing here is a same-week decision.

**Creative fatigue curves.** How long a winning ad holds before decay. Builds the expectation for how often refreshes are needed.

**Angle library.** Which angles have ever won, not just which are winning. A retired winner may be worth re-testing against a rested audience.

**Structure fitness.** Does the account's shape still match its volume tier? Volume grows and shrinks; structure should follow.

**Economics re-validation.** Cost per call, breakeven, and payout all drift. Re-run the intake computations against the last month's actuals and update the Instance file if they've moved.

**[RTB] Payout drift.** Rolling median, P25, zero rate, buyer mix — and whether the buyer's stated average bid still matches what you're actually getting. A gap here is a client conversation.

**Buyer concentration.** Top buyer's revenue share. Rising concentration is rising risk.

**Seasonality.** Note anything that looks periodic. One month can't establish it; the record is what eventually will.

## 6. Failure handling

**Data pull fails or returns empty.** Stop. An empty result means the pull failed, not that there were zero calls — and zero calls is a kill trigger. Never let a failed pull look like performance.

**Meta and call tracking disagree materially.** Flag it, don't reconcile silently. Report both numbers and let the discrepancy be visible.

**Instance file missing or stale.** Stop and say so. Running on defaults produces authoritative-looking numbers with nothing behind them.
