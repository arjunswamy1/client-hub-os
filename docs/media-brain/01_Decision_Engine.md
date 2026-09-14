# Layer 2 — Decision Engine

**Scope:** Universal. Every client, vertical, and platform. No client economics, no platform mechanics — those live in Layers 1 and 3.

**Objective:** Scale as quickly as possible without losing money on the campaign.

Every rule here serves that sentence. Speed matters — a framework that takes three months to identify a winner has cost you the winner. But no scaling decision is worth taking the campaign negative, so the rules that slow you down exist only where moving faster would mean guessing.

**Payout modes.** Sections marked **[STATIC]** or **[RTB]** apply only to that mode. Under static, payout is a fixed contract price and only your cost varies. Under RTB, payout is a range set by live bidding — both sides vary.

## 1. Variables

From Layer 0 intake and the Layer 1 economics file.

| Variable | Meaning |
|---|---|
| `{payout_mode}` | `static` or `rtb` |
| `{payout}` | **[STATIC]** Fixed revenue per billable call |
| `{bid_range}`, `{avg_bid}`, `{duration_range}` | **[RTB]** Buyer's stated bid floor/ceiling, stated average, and the duration window payout scales across |
| `{billable_def}` | Duration threshold plus product, state, or buyer filters |
| `{expected_cpc}` | Trailing cost per call — your baseline. **Note: test-budget arithmetic uses cost per *billable* call, not this.** |
| `{target_margin}` | Target margin % |
| `{min_margin}` | Floor. Below this, stop or change something. |
| `{min_calls}` | Computed — §4 |
| `{tracking_platform}` | Determines the adapter mapping |
| `{buyer_hours}`, `{buyer_caps}` | Manual where no API exposes them |

## 2. Metrics and the denominator rule

| Metric | Formula |
|---|---|
| RPC | Revenue ÷ total calls |
| Cost per call | Spend ÷ total calls |
| **Margin per call** | RPC − cost per call |
| Profit | Revenue − spend |
| Margin % | Profit ÷ revenue |
| Cost per billable call | Spend ÷ billable calls |
| Allowable cost per call at margin *m* | RPC × (1 − *m*) |

**Mixing denominators is the most likely arithmetic error in this framework.** Never compare a metric built on total calls against the same metric built on billable calls.

**[STATIC]** Billable is binary — a call either pays `{payout}` or pays nothing. **Cost per billable call is the primary decision metric.**

**[RTB]** Payout is continuous and includes zeros, so "billable" isn't a clean line. **Use total calls as the denominator for both RPC and cost per call**, so margin per call subtracts cleanly and no-bid losses stay visible instead of hidden. Because there is no clean billable line here, the kill rule's "zero billable" has an explicit RTB definition: **zero calls with a payout above zero** (§6.3). Track paid calls separately from whatever the billable definition says.

**RPC is always trailing** — what calls actually paid. There's no separate forecast number; uncertainty about the next call lives in the distribution (§5).

### Where revenue comes from — `platform` or `computed`

Revenue has two possible sources, declared per vertical on the Economics record as `revenue_source`, and the engine resolves it in exactly one place (`resolveRevenue`).

| `revenue_source` | Billable is | Revenue is |
|---|---|---|
| `platform` | duration ≥ `{billable_min_duration_seconds}` **and** payout ≥ `{min_payout_threshold}` | the sum of those qualifying payouts |
| `computed` | duration ≥ `{billable_min_duration_seconds}` alone | contracted `{payout}` × billable calls; **null**, never zero, when no contracted payout is on file |

**A payout field we cannot see is a data limitation to declare, not a zero to believe.** On some accounts the buyer pays a contracted amount per billable call and our API access simply does not expose it — the payout column reads $0.00 across thousands of paid calls. Treating that as zero revenue would report a profitable product as a total loss and recommend killing it. `computed` says out loud that the platform is not the source of truth here, and prices revenue off the contracted payout and the duration side, which we *can* see.

**`{min_payout_threshold}`** (default $1.00) exists because a payout field can carry something other than payout. Where a sync's payout mapping falls through to telco cost, a 13-second call records a few cents of *cost* as *revenue*. Any payout below the threshold is excluded from revenue, and where it is non-zero, sub-threshold and exactly equal to the recorded total cost, the call is flagged `payout_looks_like_cost` and counted by name in the pull's flags. Read-time correction, not a rewrite of stored rows.

### When the billable threshold is an UNKNOWN — the sensitivity band

`{billable_min_duration_seconds}` is a **contract term**, not a setting. Where it is assumed rather than stated it belongs in `unknown_fields`, and per §1 an UNKNOWN must name what it blocks:

| Vertical's `revenue_source` | An UNKNOWN duration threshold blocks |
|---|---|
| `computed` | revenue, RPC, margin per call, margin %, profit, cost per billable call, and every threshold derived from them |
| `platform` | billable calls and cost per billable call (revenue comes from the payout field, so it survives) |

On a `computed` vertical the threshold **is** the revenue, because revenue is `{payout}` × billable calls. Read at 30s a real BuyologyIQ vertical showed +88.7% margin; read at 300s, −40.7%. The same 30 days, the same spend, opposite verdicts — decided by a number nobody had supplied.

So where a `computed` vertical's threshold is UNKNOWN, **no revenue or margin point estimate renders at all.** Calls and spend render, because they are measured. In place of revenue the read publishes the **sensitivity band** (`engine.revenueSensitivity`) across 30 / 60 / 90 / 120 / 180 / 240 / 300 seconds, with a plain statement that the true figure depends on a contract term nobody has supplied. **A band that crosses zero says so explicitly and blocks any verdict** — a range spanning profit and loss is not a measurement to act on. The same band renders on the intake compute step, so the operator sees the swing at the moment they are asked for the threshold. It is shown *instead of* a point estimate, never beside one: a figure printed next to its own range gets read as the answer.

**Verticals are read-only.** A vertical row blends many ads, so cut / hold / scale verdicts never render at that level — the blend hides precisely the differences those rules act on. The vertical read is information for a human, shown alongside the ad-level coverage figure so the reader knows why they are looking at verticals rather than ads.


### Hierarchy

**Decides:** margin per call, profit contribution. **Measures:** calls, billable calls, cost per billable call, connection rate, billable rate. **Explains:** CPM, CTR, CPC, frequency, duration.

**CPA never decides.** Under RTB, two ad sets at identical CPA can carry very different margins. CPA tells you why margin moved, not whether to cut.

## 3. Data adapter

Every call tracking platform names its fields differently. Rather than writing rules against one vendor's schema, the logic reads canonical names and each platform gets a small mapping.

`call_id` · `timestamp` · `ad_id` · `adset_id` · `campaign_id` · `duration_seconds` · `connected` · `billable` · `paid` · `payout_amount` · `buyer_id` · `state` · `no_bid_reason`

Plus the **attribution tags**, read off the call itself and never derived from anything else:

`utm_campaign` · `utm_content` · `utm_source` · `utm_term` · `utm_medium` · `creative_id`

`creative_id` is the Meta ad id where the tracking platform captured it (Ringba stores it as `tag:User:creative`). On accounts that pass UTMs into call tracking these tags are the only ad-level key available, because `ad_id` is null on every call table and some accounts never capture a tracking number either. Each platform keeps them somewhere different — Ringba in `metadata` as `tag:User:*`, Moja in real columns, RingFuel and Cannaball in `raw_payload` — and one reader handles all of them, so the join and the coverage meter can never see different values.

`{tracking_platform}` is captured at intake and determines which mapping loads. Change platforms, change only the mapping — never the rules.

Fields with no source get named as missing, not substituted. Buyer capacity often has no API endpoint; it's a manual field or an inference, never a guess dressed as data. A missing attribution tag is an unresolved call, not a guessed match.

The adapter also carries two named data-quality flags, because both would otherwise be silent:

- `did_is_caller_number_fallback` — the canonical `did` fell back to `inbound_number` because no dialed number was captured. On accounts where `inbound_number` holds the *caller's* number, that fallback would attribute a call to whatever mapping happened to match, so it is counted in the pull's flags rather than trusted.
- `payout_looks_like_cost` — a non-zero payout below `{min_payout_threshold}` and exactly equal to the recorded total cost (§2). Excluded from revenue and counted by name.

### Publisher attribution — a required dimension

A call tracking campaign belongs to the *client*, not to us. The same campaign commonly receives traffic from several publishers — the client's own buying, other agencies, affiliate partners, live-transfer vendors — and every one of those calls lands in the same call table. Attributing all of them to our spend is the same class of error as mixing denominators: it inflates our call counts and our revenue against a cost side that only covers our own media.

So `publisher` is canonical, read off the call (`metadata->>'publisher'` on Ringba; the equivalent field where another platform has one), and `{attributed_publishers}` on the Economics record — per vertical, or client-level as the default — names the publishers whose calls belong to this client's media buying.

**Every metric, verdict, vertical read and coverage figure filters on it.** A call from a publisher outside the list is excluded from margin entirely and reported as excluded volume, so the client's campaign total and our attributable total are both visible and neither is mistaken for the other.

- Matching is exact on the trimmed, case-folded name. No prefix or fuzzy matching — publisher names are contractual labels, and a near-match is somebody else.
- A call with **no publisher recorded** is never assumed to be ours. It is excluded and counted under `(no publisher recorded)`.
- **An unconfigured list stops the pull.** Where `{attributed_publishers}` is null or empty the pull returns `ok: false`: "publisher attribution not configured — every margin figure would include other sources' calls." There is deliberately no "all publishers" default, because that default is what produced a wrong read on the pilot: 2,417 calls in the window, of which 119 were ours.
- Where filtering leaves zero attributed calls the pull also stops. That is a configuration or tagging failure, not a zero.

A vertical whose traffic is entirely another publisher's is not a vertical we operate. It gets no Economics record and is retired for that client, with the reason recorded.

### Publisher scoping — required, not required, or unanswered

`{attributed_publishers}` answers *whose calls are these*. `{publisher_scoping}` answers the question before it: **does that question need an answer here at all?** Three states, and the difference between two of them is the whole point.

| State | Meaning | Effect |
| --- | --- | --- |
| `required` | The tracking campaign takes traffic from more than one source. | An unconfigured `{attributed_publishers}` **stops the pull**, exactly as before. |
| `not_required_dedicated_campaigns` | A **recorded human decision** that this campaign receives only our traffic, so there is nothing to filter. | The pull proceeds unfiltered, and the decision — who made it, on what date — renders beside every figure. |
| `unknown` (default) | Nobody has answered. | **Stops the pull**, identically to `required` with no list. |

A record that states no scoping but *does* name publishers has answered the question — the publishers are named, so filtering plainly applies, and it reads as `required`. Only a record that says nothing either way is `unknown`. Silence is never read as "dedicated".

`not_required_dedicated_campaigns` is a deliberate, dated, attributed claim, not an absent answer — which is why it may switch filtering off where an absent answer may not. Two safety nets, and they are the only ones:

- **Contradiction check.** The moment more than one distinct publisher appears on calls for a vertical marked dedicated, the read reports the claim as *contradicted by the data* and names every publisher currently being counted against our spend. A campaign dedicated today can quietly have a second publisher pointed at it tomorrow and nothing in the feed announces it.
- **Re-check date.** `{publisher_scoping_verified_at}` records when the claim was last verified. Past 30 days it is surfaced on the vertical read as due for re-check; a claim with no date at all counts as unverified.

### Platform comes from `utm_source`, and from nothing else

`platform` on a canonical call is read from `utm_source`: `facebook` / `fb` / `meta` → `meta`; `google` / `adwords` → `google`; anything else, or absent → **`unclassified`**. Case-insensitive, trimmed.

It is never inferred from the dialed number, the campaign name, or a keyword heuristic. A campaign called "Internal Plumbing" says nothing about which platform delivered the click, and a heuristic that defaults plumbing to Google is quietly right often enough never to be questioned.

`unclassified` is a **visible row of its own** on every platform split, even at zero, and is never folded into the likelier platform or dropped. On Moja, `[UTM_SOURCE]` is the one UTM macro confirmed available, so it is the only platform signal that will ever arrive — which makes its absence a real gap worth showing rather than papering over.

**Meta conversion reconciliation.** Where the account records an offline or call conversion, the vertical read prints Meta's reported conversions beside our attributed call count and shows the gap. Per §6 of Operating Procedures a material disagreement is flagged, never reconciled silently — if Meta reports 300 conversions and we attribute 79 calls, that gap is the finding. Zero conversions against real spend is declared as a conversion-tracking gap on the account, not read as zero performance.

**Dialed numbers may be pooled.** Where a tracking number sits in a number pool it rotates across visitors, so one number carries several creatives and DID → creative is invalid. DID → campaign stays stable, so a pooled DID is a reliable **vertical** key and never an ad-level one; the join marks it accordingly and ad-level verdicts are withheld from it.


## 4. How much data is enough

### Why a perfect count still leaves uncertainty

Your tracking reports exactly how many billable calls you got. That number is not in doubt.

But the decision isn't "what did this cost?" — you know that. It's **"what will the next hundred calls cost?"** And that depends on the underlying rate, which you're estimating from a sample that contains luck: which people saw the ad, who was home, who stayed on past the duration threshold. Run the same ad set again unchanged and you'd get a different number.

Flip a fair coin ten times, get six heads. The count is exactly right. The coin still isn't 60%.

The wobble in an estimate built on `n` conversions is roughly `1 ÷ √n`:

| Calls | Range around your measured number |
|---|---|
| 10 | ±32% |
| 25 | ±20% |
| 50 | ±14% |
| 100 | ±10% |

Two ad sets measuring $55 and $68 on 10 calls each have plausible ranges of $37–73 and $46–90. They overlap almost entirely. Killing the "loser" is a coin flip wearing a decision's clothes.

### Setting `{min_calls}`

**What it is:** the number of billable calls a single angle or ad must produce before you trust its measured margin enough to promote it or cut it *on performance*.

It does not gate the zero-conversion kill in §6.3 — that fires on spend, and deliberately doesn't wait for a sample.

The wobble on a single estimate is about `1 ÷ √n`. But ranking angles never compares one estimate to a known truth — it compares two noisy estimates, and the standard error of a *difference* between two independent samples is larger by √2. The gap you can reliably detect is therefore about `2√2 ÷ √n`. Inverted:

`{min_calls}` **≈ (2√2 ÷ the gap you'd act on)² = 8 ÷ gap²**

| Gap between angles | Calls needed each |
|---|---|
| 100% | ~8 |
| 60% | ~22 |
| **57%** | **~25** |
| 40% | ~50 |
| 25% | ~128 |
| 10% | ~800 |

**25 is the default because it detects a ~57% gap.** Detecting 40% takes 50 billable calls per angle, and at most pay-per-call economics that is more than the answer is worth. This is a deliberate trade: we act on large differences quickly rather than small ones slowly.

**Cost decides how strict you can afford to be.** At $80 per call, detecting a 25% gap costs $5,120 per angle. Not worth it. Expensive verticals act on wide gaps and lean on the fast proxies (§9) for the rest. Cheap verticals can afford real precision.

**[RTB]** Payout varies too, so margin per call is noisier — add roughly 40% to the computed figure.

### Volume tiers

Cadence means **how often you're allowed to decide** — not how often you look. You review the dashboard daily regardless. At 3 calls a week there simply isn't enough new information to justify a weekly decision.

| Billable calls/week | Cuts | Scale steps |
|---|---|---|
| Under 5 | Monthly | Monthly |
| 5–25 | Every 2 weeks | Every 2 weeks |
| 25–100 | Weekly | Weekly |
| 100–300 | Every 2–3 days | Weekly |
| 300+ | Daily | Every 3–4 days |

**Cuts move faster than scale steps.** Cutting a losing ad disturbs nothing else, so at high volume there's no reason to let one bleed for six more days. Raising a budget resets Meta's learning on that entity — stack two increases back to back and you never get a clean read on either. Higher spend justifies faster cutting, not faster scaling.

**Fragmentation check.** Expected weekly count of **the account's own Meta optimisation event** ÷ number of ad sets. Meta needs roughly 50 per ad set per week to exit learning phase — and a "conversion" in Meta's sense is whatever event the ad set bids toward, usually "call initiated" or a CAPI-fired qualified call, **not your billable definition**. Counting billable calls against Meta's 50 floor is a denominator error: it compares Meta's counter against a different, usually rarer, event, and makes a structure look more fragmented than it is (or less). Record the optimisation event on the client's Instance record. **Where that event is not recorded the check does not run** — it reports that it cannot run, and billable calls are never substituted (§1 on UNKNOWNs). When the check comes back well below that, you're splitting volume across ad sets that will each learn nothing — consolidate. This is a calculation to run, not an ad set count to obey.

### Platform-attributed vs call-attributed — two measures, never one

An ad platform reports its own conversion count. We hold our own call records. **These are two different measures with different denominators and different attribution, and they are never blended, averaged, or reconciled into a single figure.** They are shown side by side, and the gap between them is reported as the finding.

| | Platform-attributed | Call-attributed |
|---|---|---|
| Counted by | The ad platform | Our call records |
| Attribution | The platform's own window and modelling; offline-upload match rate | The join tiers in §3 |
| Denominator | Ad impressions/clicks the platform claims credit for | Calls we received and attributed |
| May decide | Nothing on its own — it *explains* delivery and checks our own count | Margin per call and every verdict in §6 |

**A platform count is a floor, not a census.** Where conversions arrive by offline upload, only the calls the upload matched are counted, and match rates run well short of 100%. An implausible cost per conversion — River Road's Google read implies $852 per plumbing call — is far more likely a match-rate failure than a performance one. That caveat belongs on the screen, not in a doc.

**The governing event decides; a sum never does.** One account records many event names for the same call: BuyologyIQ fires `offsite_conversion.fb_pixel_custom.RingbaConversion` (37 events, $2,710 in 30 days) *and* `contact_website` / `contact_total` (354). Adding them triple-counts one call and produces a confidently wrong cost per conversion. So the decision-time count is **the single event named in `media_brain_instances.meta_conversion_event`**, read from the stored per-event breakdown. **Where that field is unset the count is UNKNOWN** — not zero, not a sum, not the largest event — and it names what it blocks: the fragmentation check, cost per conversion, and any conversion-based read of the account.

**Never hardcode an event name in a sync.** Capture every `action_type` the account returns, with its count and value, per entity, per date, into `media_brain_platform_conversions`; choose afterwards. Naming one client's event in code is what stored zero conversions for RRM against $4,451.81 of spend while its account reported 489 `lead` events. Show the full event menu wherever the governing count appears — a hidden alternative is how the wrong event gets picked and never noticed.

**The `conversions` column on `ad_campaigns`, `ad_sets` and `ad_creatives` is barred from Media Brain entirely.** It holds whatever the sync happened to write, across several event names at once: over the 30 days to 2026-09-14 BuyologyIQ's read **264** while its governing event read **37**. It is not a governed choice, so it never reaches a decision, a reconciliation or a screen here. Other parts of the app still use it; Media Brain reads `media_brain_platform_conversions` filtered to the governing event, or it publishes nothing.

**A platform count below our attributed call count is the expected shape, not an error.** BuyologyIQ, 30 days to 2026-09-14: Meta reports 37 `RingbaConversion` against 121 CPM-attributed calls. Offline uploads match well short of 100%, so the platform figure is a floor. Report the direction plainly — under-reporting is the opposite of an overclaim — and never reconcile the two into one number.

**Event names sometimes encode a duration, and that is evidence rather than an answer.** Both pilot accounts define `offsite_lead_add_20_s_calls`, `click_to_call_native_20s_call_connect` and `click_to_call_native_60s_call_connect` — somebody drew a 20-second and a 60-second line in the ad account, neither of which is the 90 seconds on record. An event defined for optimisation is not the buyer's billable term. It bears on the open billable-definition question; it does not settle it.

### Confidence states

- **Sufficient** — at or above `{min_calls}`. Act.
- **Insufficient** — below it. Hold, and show it greyed on the dashboard.
- **Decisive despite low count** — zero conversions past the kill threshold (§6.3).

**A wrong promotion costs more than a wrong cut.** A bad cut wastes a test slot. A bad promotion builds an ABO stage and a scaling campaign on top of a loser. Graduation gets a higher bar than survival.

## 5. Reading the distribution **[RTB]**

Under static this section doesn't apply — payout is one number.

| Field | What it tells you |
|---|---|
| **Median payout** | What a typical call pays |
| **P25** | If this is below your cost per call, a quarter of calls lose money outright |
| **Zero / no-bid rate** | Share earning nothing. Rising means a demand problem, not a creative one. |
| **Top-10% revenue share** | Whether rare premium calls are carrying the campaign |

**Mean versus median.** The mean is the average; the median is the middle call. Ten calls — nine at $20, one at $200 — average $38, median $20. At $30 cost per call, the mean says profitable and the median says nine out of ten calls lose money. You survive only while that $200 call keeps appearing.

Two campaigns at $40 RPC are not equivalent. A $40 median is repeatable. A $30 median with half the revenue in the top ten calls is luck that hasn't run out yet.

**Skip resampling techniques at low volume.** A bootstrap on 40 skewed calls produces a confident-looking interval built on very little. Median and P25 are sturdier and you can explain them to a client.

### Duration is a revenue lever **[RTB]**

When the buyer quotes `{duration_range}` — say 20 to 180 seconds against a $10–45 bid range — payout scales with how long the call lasts. Longer calls literally pay more.

That makes anything influencing call length worth money: how the creative sets expectations, what the caller believes they're about to get, IVR design, how fast the call routes to a live person. Under static, duration only matters as a pass/fail gate. Under RTB it's a continuous revenue dial, and it belongs in optimization decisions alongside cost per call.

Track median duration by ad and by angle. An angle producing longer calls at the same cost is worth more even when call counts match.

## 6. Cut rules

Cut if **any** of these fires.

### 6.1 It's losing money

Margin per call is below breakeven and you have enough calls to trust that (§4). **[RTB]** Both the mean and the median have to fail. A campaign profitable on the mean but not the median is a §7 hold, not a cut.

### 6.2 It's the worst of a working group

It ranks last on margin per call, you have enough calls to trust the ranking, and at least one other angle is clearing target.

If the whole group is underwater, cut the whole group. Don't promote the least-bad option — that's how a bad test cohort becomes a bad month.

### 6.3 It's spent real money and produced nothing

**Kill at 2× payout with zero billable calls.** **[STATIC]** 2 × `{payout}`. Payout $50 → kill at $100. **[RTB]** 2 × `{avg_bid}`. Average bid $25 → kill at $50.

Why 2x is defensible rather than arbitrary: if the ad were performing at your allowable cost, the odds of seeing zero conversions by the time you've spent double the payout are about 13.5% (e⁻²). So you're about 87% confident it's genuinely broken, not unlucky. Going to 3× would buy ~95% confidence at the cost of letting a dead ad run 50% longer — we take the faster trigger, because letting losers run is the more expensive mistake. You'll occasionally kill a fine ad. Far more often you'll stop paying for a dead one — and letting losers run is the more expensive mistake.

**[RTB] What "zero billable" means here.** Under RTB, payout is continuous and includes zeros, so there is no clean billable line (§2). The rule therefore fires on **zero calls with a payout above zero** in the window — paid calls, not billable calls. Under static it fires on zero billable calls as defined on the economics record.

**The static asymmetry, stated rather than hidden.** Under static, a call that ran long enough but paid $0, or paid but ran short, collapses into "not billable" and disappears from every surfaced number. Surface **paid but not billable** as its own count and flag it when it is non-trivial: it usually means the billable definition on the economics record disagrees with what the buyer is actually paying for.

This one fires any day, not just at review (§12).

### 6.4 Every entity gets a verdict, every review

**Keep, cut, or hold** — stated explicitly for every ad set and every ad. A hold has to name what evidence you're waiting for and when it arrives.

**Nothing carries forward by default.** Default-carry-forward is the entire mechanism by which losers survive.

## 7. Hold rules

Hold — keep spending at current level, don't expand, don't cut — when:

- Not enough calls yet to trust the number
- **[RTB]** Good mean, weak median or P25
- **[RTB]** Revenue concentrated in a handful of calls
- **[RTB]** No-bid rate, buyer mix, or bid depth shifted enough that past RPC may not predict the next call
- A test hasn't accumulated enough calls to be read

Hold is a real decision with a deadline, not a way of deferring one.

## 8. Scale rules

### Qualify — all four

1. Margin per call at or above target
2. Held across two consecutive decision windows
3. Enough calls to trust it
4. Buyer has capacity headroom

**[RTB]** Plus: distribution isn't carried by outliers, and no-bid rate and buyer mix are stable.

### Step size

**10–20% per increase.** Bigger jumps push Meta into lower-intent audience faster and compress margin before your data can show it.

### Judge the added spend, not the average

> Baseline: $1,000 spend → $1,540 revenue. Add $150; revenue rises to $1,705. The added dollars returned $165 on $150 — a 1.10 return. Blended ROAS is still 1.48, comfortably above a 1.25 requirement, but the incremental spend didn't clear it. Stop.

Blended numbers hide what the last increment actually bought. This is the single most common way a scaling campaign quietly goes negative while its dashboard still looks green.

### Stop when

Marginal margin falls below `{min_margin}` · buyer capacity is reached · connection rate degrades as volume rises, which means you're buying calls the buyer can't absorb.

## 9. Testing and graduation

### Lifecycle

- **Launch** — 100% of budget is testing. Nothing is proven yet, so there's nothing to protect.
- **Maturity** — once winners exist, 80% funds them and 20% funds testing.

The shift happens when at least one angle has cleared the graduation gate, not on a date.

### How many angles you can test

`angles = test budget ÷ ({min_calls} × cost per billable call)`

At $60 per **billable** call and `{min_calls}` of 25, each angle needs $1,500 to be conclusively ranked. At $300/day total, that's real arithmetic — test fewer angles properly rather than five badly.

**Spend floors are mandatory at low volume.** CBO reallocates within hours based on click signal, before any call has happened. Without floors it starves an angle that would have converted.

### Eliminate early on the fast signal

You need `{min_calls}` billable calls to rank angles reliably. That takes weeks at low volume, while bad angles keep spending.

But some failures announce themselves much sooner, on signals that accumulate with every click rather than only with paying calls:

- **Cost per call** — spend ÷ total calls. Reads within a day or two.
- **Call rate** — calls ÷ clicks. Directly measures whether the ad is producing callers.
- **[RTB] Median duration** — payout scales with call length, so a short-call angle is a low-revenue angle before any billable data exists.

If one angle is at $9 per call while the others are at $3, you know it's broken long before you have `{min_calls}` billable calls from it.

**Connection rate is not an elimination signal.** Whether the buyer answers is routing, not ad quality — it belongs in the downstream check (§11 Step 1), and using it to judge creative will get you killing good angles for someone else's staffing problem.

**Cheap signal for obvious problems. Expensive signal for close calls.** Drop clear failures on cost per call and call rate; reserve the full `{min_calls}` bar for picking the winner among survivors.

### Graduation gate — all three

1. Clears breakeven with margin to spare
2. Top of its group on margin per call
3. At or above `{min_calls}`

Two of three is not a pass. A group leader at 8 calls is noise.

### Demotion

The path runs both ways. Anything failing §6 for two consecutive windows goes back to ABO for isolated diagnosis, or gets cut. Frameworks that only define promotion accumulate zombies.

## 10. Margin benchmarks

| Margin | Verdict | Action |
|---|---|---|
| Under 0% | Losing | Stop the ad or ad set |
| 0–10% | Fragile | Usually bad for paid traffic; viable only for controlled testing or unusually reliable, low-overhead traffic |
| 10–15% | Thin but workable | Fine for learning or low-volume cash flow; little room for volatility |
| 15–20% | Decent | A real campaign if revenue is stable and other costs are very low |
| 20–30% | Good | Target range for a proven campaign |
| 30–40% | Very good | Strong enough to scale confidently |
| 40%+ | Excellent | — |

**10% is the floor.** Below it, the campaign has no cushion — a small CPM shift takes it negative.

**[RTB]** Judge the campaign at the band its **median** lands in, not its mean. A campaign at 12% on the mean can be at 0% on the median when payout is concentrated.

## 11. Diagnostic tree

Runs **before** any corrective action. Order matters — each step rules out a cause that would make the next step wasted work.

**Step 1 — Downstream.** Billable rate, connection rate, no-bid reasons, buyer status. → If media metrics are flat and billable or connection rate moved: **stop.** Not a media problem. No ad change fixes it.

**Step 1a [RTB] — Your traffic or their demand?** The two look identical in CPA.

| Signal | Your traffic | Their demand |
|---|---|---|
| No-bid rate | Stable | Rising |
| Bid depth | Stable | Falling |
| Average winning bid | Stable | Falling |
| Connection or qualification rate | Falling | Stable |
| Buyer mix | Stable | Shifted |
| CTR, CPM, frequency | Moved | Stable |

Traffic-side → creative, targeting, landing flow. Demand-side → routing (Layer 1.5), not ads.

**Step 2 — Saturation.** CPM up, frequency up, reach flattening → expand audience. New creative into a saturated audience decays fast.

**Step 3 — Fatigue.** Frequency up, CTR down, CPM flat → refresh creative, same angle.

**Step 4 — Structural.** Tracking, attribution, delivery. Verify before concluding anything about performance.

Skipping Step 1 is the expensive error: a week of creative production aimed at someone else's routing problem.

## 12. Circuit breakers

Act same day, any day. Everything else waits for the scheduled review.

1. Tracking broken or calls not routing
2. Buyer down or at capacity — **[RTB]** abrupt no-bid spike or rate-limiting
3. Spend past 2× payout with zero billable calls — **[RTB]** "zero billable" means zero calls with a payout above zero, since payout is continuous and there is no clean billable line (§2, §6.3)

Compliance runs as a passive monitor — flagged, not auto-actioned.

**Nothing else is an emergency.** A number looking alarming on a Tuesday is not on this list.

## 13. Buyer concentration

Track what share of revenue comes from the top buyer. When one buyer carries most of a campaign, its economics are a single relationship — a cap change craters revenue overnight with no warning in any media metric.

A standing risk read, and a routing conversation (Layer 1.5) rather than a media one.

## 14. Cadence

**Daily.** Dashboard and circuit-breaker scan. **No optimizations.** Every metric shows its confidence state; insufficient-sample numbers are visually suppressed, so you see whether a number means anything before you see the number.

**Weekly** (or per volume tier). 1. Diagnostic tree on anything that moved 2. Verdict on every ad set and ad 3. Graduation decisions 4. Scale decisions 5. Budget reallocation 6. Log every change with its hypothesis and review date

**Monthly+.** Fatigue curves across creative lifetimes. Angle library — which angles have ever won, not just which are winning. Fragmentation check against current volume. Seasonality. Re-validate economics: cost per call, breakeven, and payout all drift. **[RTB]** Payout drift specifically — rolling median, P25, zero rate, buyer mix, and whether the buyer's stated average still matches reality.

## 15. Change log

Every change logged with what you changed, why, what you expect to happen, and a **review date** — the day you come back and check whether it did. Without that date, changes get made and never evaluated, and you end up with a campaign full of edits nobody ever checked. With weekly changes and multi-day feedback, causality is otherwise unrecoverable — by the time a result lands you won't remember which of four changes produced it.

**Routing changes are changepoints.** A routing change alters RPC, invalidating every margin comparison spanning it. Log it, reset baselines, flag prior comparisons as broken. Without this rule, a routing change eventually gets diagnosed as creative fatigue.

## 16. Settled values

| Variable | Value | Basis |
|---|---|---|
| Kill threshold | **2 × payout** (static) or **2 × average bid** (RTB), at zero billable calls | ~87% confidence the entity is genuinely broken rather than unlucky (e⁻² ≈ 13.5% chance of a false kill) |
| `{min_calls}` | **Computed** — (2√2 ÷ actionable gap)² = 8 ÷ gap². Default **25** at a 0.57 gap, +40% under RTB | 25 detects a ~57% gap; detecting 40% would take 50 per angle |
| Scale step | **10–20%** | Keeps delivery stable and the marginal read legible |
| Margin floor | **10%** | Below this there's no cushion for normal volatility |

**Worked example** — $50 payout, static, $40 expected cost per **billable** call (a 20% margin):
- Kill any ad at $100 spent with zero billable calls
- 25 billable calls before an angle graduates
- Test budget: 25 × $40 = $1,000 per angle per window
- Allowable cost per call at a 20% target margin: $50 × 0.80 = $40
- A winning ad set at $200/day moves to $220–240/day

## Still open

Whether the volume tier boundaries hold up against real variance. Needs data from a campaign with enough history to check.
