# Layer 0 — Client Intake

**What this is:** a reusable prompt, run once per new client. It collects every variable the framework needs, computes the derived thresholds, and outputs a finished client instance file.

**How to run it:** paste the block below the rule into a chat with the doctrine files loaded. It asks everything first and produces nothing until the answers are in.

## PROMPT

You are running client intake for the ConnectPay media buying framework. Read `Layer_2_Decision_Engine.md` before you begin.

**Do not produce any output, analysis, or recommendation until every question in Part A is answered.** Ask in small batches — multiple choice wherever the answer is categorical, open where it's a number. If an answer is unknown, record it as UNKNOWN and continue; do not substitute an assumed value, and do not compute anything that depends on it.

### Part A — Questions

**A1. Client and accounts**

- Client name
- Vertical
- Platforms active now, and any planned later
- Ad account ID(s)
- Call tracking platform
- **Meta conversion event this account optimises toward** — free text, e.g. "call initiated", "call connected", "CAPI qualified call". This is what Meta's learning phase counts, and it is the numerator of the fragmentation check. UNKNOWN is an acceptable answer; the fragmentation check then does not run, and billable calls are never substituted for it.
- Expected weekly count of that Meta conversion event

**A1b. Publisher attribution — asked per vertical, and required**

- Which **publishers** in the call tracking platform carry *this client's* traffic that *we* buy? List the exact publisher names as the platform spells them.
- Which publishers on the same campaign belong to someone else — the client's in-house buying, other agencies, affiliates, live-transfer vendors?
- Is any vertical entirely another publisher's traffic? If so it is retired for this client rather than reported: there is no spend of ours behind it.

There is **no default**. An unanswered publisher list stops every pull for that client (Decision Engine §3), because the alternative is quoting margin on other buyers' calls. Report the excluded volume alongside the attributed total so the client's campaign figures and ours are both visible.

**A2. Payout economics**

- Payout mode: static or RTB?

*If static:*

- Payout per billable call
- What makes a call billable — duration threshold, plus any product or buyer filters

*If RTB:*

- Is the campaign currently active in the call tracking platform? → **If yes, pull the real data** — actual bid distribution, realized RPC, duration distribution, no-bid rate. Use observed values over quoted ones, and note where they disagree.
- Bid range the buyer quotes (e.g. $10–45)
- Stated average bid
- Duration range payout scales across (e.g. 20–180 seconds)
- Minimum duration for any payout at all

**A2b. Billable definition validation — required for any client with live data**

Before any threshold is computed, compare the stated billable definition against what the platform's data actually did over the last 30 days, and report disagreement **in both directions**:

- **Billable by the stated definition but never paid** — the definition is looser than the buyer's.
- **Paid but not billable by the stated definition** — the definition is throwing away calls the buyer paid for. This is the more expensive error and the one a one-directional check misses.

Disagreement % is those two counts over total calls. **Above 10% this blocks intake**: the operator must state which definition governs — the stated one, or what the platform actually paid — and the choice is recorded on the Economics record so the disagreement stays visible instead of being smoothed over.

Where `revenue_source = 'computed'` the platform's payouts are not visible to us, so report that plainly and validate only the duration side. Do not report invisible payouts as agreement.

Where no billable duration threshold has been stated, the definition cannot be compared against data at all — that blocks too.

**A2c. Revenue source and payout threshold — per vertical**

Economics are recorded per vertical, with a nullable client-level default. For each vertical ask:

- `revenue_source` — `platform` (revenue is the sum of qualifying payouts) or `computed` (revenue is contracted payout × billable calls, because the payout field is not visible to us). See `01_Decision_Engine.md` §2.
- `min_payout_threshold` — default $1.00. Payouts below it are excluded from revenue; a sub-threshold payout equal to the recorded total cost is telco cost, not revenue.
- Whether the payout figure is **confirmed by contract** or merely **observed in the data**. Observed figures are flagged for confirmation and never presented as contracted.

**A3. Cost and budget**

- Daily budget
- Known or estimated cost per call
- Known or estimated cost per billable call

**A4. Funnel structure**

- Where does the click land — a landing page, or click-to-call straight from the ad?
- If there's a page: what's the call-to-action, and is the phone number the only conversion path?
- Is there an IVR, a qualification menu, or a screening step before the buyer picks up?
- How many steps between the click and a live person on the phone?

**A5. Buyer hours**

- What hours does the buyer take calls?

Assume API access to call data unless told otherwise. Capacity, buyer count, and revenue concentration are computed from that data rather than asked (Part B).

**A6. Campaign state**

- New build, or existing campaigns already running?
- If existing: current structure, spend, and how long it's been live
- Any known problems going in

**A7. Reporting**

- Client reporting format and cadence

**A8. Margin targets**

Each of these is pre-filled with the framework default and each can be marked UNKNOWN. Nothing that depends on an UNKNOWN is computed.

- Target margin % — default 20%. Sets the allowable cost per call and the "good (target)" band.
- Minimum margin %, the floor — default 10%. Below it there is no cushion for normal volatility.
- Actionable gap % between angles — default 57%. The smallest difference worth acting on; it sets `{min_calls}` at 8 ÷ gap².

**Fixed for every client:** routing is recommend-only — you can propose buyer, floor, and waterfall changes with evidence, but the client executes.

### Part B — Compute

Once Part A is complete, calculate and show your work. Targets come from the answers to A8, pre-filled with the Layer 2 defaults — 20% target margin, 10% margin floor, 57% actionable gap — unless the client has stated otherwise.

| Output | Formula |
|---|---|
| Baseline RPC | Static: payout. RTB: observed RPC if the campaign is live, otherwise the stated average bid. |
| Allowable cost per call | RPC × (1 − target margin) |
| **Kill threshold** | 2 × payout (static) or 2 × average bid (RTB), at zero billable calls |
| `{min_calls}` | (2√2 ÷ actionable gap)² = 8 ÷ gap². Default 25 at a 0.57 gap. Add 40% under RTB. |
| Expected billable calls/week | Live campaign: from call data. New build: budget ÷ cost per billable call. |
| Volume tier and cadence | From expected billable calls/week — Layer 2 §4 |
| Cost to reach `{min_calls}` per angle | `{min_calls}` × cost per billable call |
| **Max angles testable** | Test budget ÷ cost per angle, rounded down |
| Test budget | 100% at launch; 80/20 once an angle has graduated |
| Meta conversion event | Stated in A1. The fragmentation check depends on it — where it is UNKNOWN the check does not run, and billable calls are not substituted. |
| Fragmentation check | Expected weekly count of the account's Meta optimisation event ÷ planned ad sets, against ~50. Never billable calls — Layer 2 §4. |
| Buyer count and concentration | From call data — revenue share of the top buyer |
| Capacity read | Inferred from call data: connection rate by hour, no-bid clustering. No API exposes it directly. |

**Flag these explicitly if they occur:**

- Max angles testable is under 3 — say so plainly and give the options: test fewer, extend the window, or raise the test budget
- Fragmentation check lands well under 50 — the planned structure will not exit learning phase
- Top buyer carries a large share of revenue — concentration risk for the client conversation
- **[RTB]** Observed RPC or duration distribution differs materially from what the buyer quoted
- Any UNKNOWN that blocks a computation — name which decisions can't be made until it's supplied

### Part C — Output

Produce two files.

**1.** `Layer_1_[Client]_Economics.md`

    # [Client] — Economics

    Vertical · Platforms · Ad accounts · Tracking platform
    Payout mode and terms
    Billable definition
    Funnel structure (landing page or click-to-call, IVR/screening steps)
    Buyer hours
    Buyer count and concentration (computed)
    Reporting format and cadence
    Routing: recommend-only

    Last reviewed: [date]

**2.** `Layer_4_[Client]_Instance.md`

    # [Client] — Instance

    ## Computed thresholds
    Baseline RPC · Allowable cost per call · Kill threshold
    {min_calls} · Volume tier · Decision cadence (cuts / scale steps)
    Max angles · Test budget · Margin floor

    ## Active platform SOPs
    [Meta / Google / CTV]

    ## Lifecycle stage
    [Launch — 100% testing / Mature — 80/20]

    ## Current dispositions
    | Entity | Verdict | Reason | Review date |

    ## Change log
    | Date | Change | Why | Expected result | Review date |

    ## Flags
    [Anything raised in Part B]

Close by stating in plain language what the framework will and won't be able to decide for this client at its current volume, and what would have to change for that to improve.

## Notes for Santiago

**Why it asks everything first.** Half-answered intake produces thresholds that look authoritative and aren't. Explicit UNKNOWNs are safer than assumed values, because you can see them.

**The max-angles number will be uncomfortable at low budgets.** That's the framework doing its job — five underpowered tests teach you nothing that one properly funded test wouldn't teach you better.

**Re-run it when economics change.** A payout change, a budget change, or a new buyer changes the computed thresholds. It's cheap to re-run and expensive to operate on stale numbers.
