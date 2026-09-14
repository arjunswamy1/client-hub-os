# Media Brain — BuyologyIQ pilot unblock report

Written for someone who was not in these sessions. It records what was wrong with the
data, what was fixed, what is still UNKNOWN, and whether a pilot can start.

Companion documents: `hardening-report.md` (what was hardened and why),
`01_Decision_Engine.md` (the rules), `02_Client_Intake.md` (what must be asked).

Client: **BuyologyIQ** (`b3d600f5-5d6b-4378-aa96-b395c05e9297`). Tracking platform: Ringba.
Ad platform: Meta. Window used throughout: **last 30 days**.

---

## 1. The Ringba field mapping — before and after

**Before.** `ringba_calls.inbound_number` mapped from the API field
`call.inboundPhoneNumber`. Ringba titles that field **"Caller ID"** — it is the number the
*caller* dialled *from*, not the tracking number they dialled *to*. On this account it holds
a caller ANI on 96.6% of rows. Every join that treated it as a DID was matching caller
numbers.

The mapper did contain a fallback to `call["tag:DialedNumber:Number"]`, which would have
been correct — but the sync's tag-discovery allowlist only ever contained `InboundNumber`,
`Geo` and `User`. The `DialedNumber` tag group was never requested, so the tag was never
present and **the fallback was dead code from the day it was written**. Worse, when it did
appear to work it would have written a dialled number into a column named
`inbound_number`, conflating the two.

**After.**

- `sync-ringba-calls-buyology` requests these value columns in addition to the previous
  set: `number`, `numberId`, `numberPoolName`, `numberPoolId`, `isFromNumberPool`,
  `hasPayout`, `noPayoutReason`.
- `DialedNumber` was added to the tag-discovery allowlist alongside `InboundNumber`, `Geo`,
  `User`.
- `ringba_calls` gained (additive): `did`, `did_pool_name`, `is_from_number_pool`,
  `has_payout`, `no_payout_reason`.
- `did` maps from `tag:DialedNumber:Number`, falling back to the `number` column.
- `inbound_number` now maps from `inboundPhoneNumber` **only** — the dialled-number
  fallback was removed. The column is misnamed but genuinely useful (it is the caller), so
  it was left in place and both columns carry a database comment saying what they actually
  contain, so the next reader is not misled the way this one was.
- `adapter.ts` reads the canonical `did` from `ringba_calls.did` and falls back to
  `inbound_number` only when `did` is null — and when it does, it sets
  `did_is_caller_number_fallback` on the call, which surfaces as a **named count** in the
  pull's flags. Never a silent fallback: on this client that fallback resolves a caller's
  number and would attribute the call to whatever mapping happened to match.
- `sync-ringba-calls` (Billy/CPM) received the same five field mappings. It sends no value
  column list at all, so there was none to extend; its campaign filtering is untouched.

## 2. The diagnostic result

A read-only diagnostic mode (`?diagnose=1`, writes nothing) calls Ringba's
`/calllogs/columns` and `/tags` and returns the full menu. On this account:

- **110 available value columns**, including `number`, `numberId`, `numberPoolName`,
  `numberPoolId`, `isFromNumberPool`, `targetNumber`, `hasPayout`, `noPayoutReason`.
- **88 tags across 18 groups**, including a **`DialedNumber`** group exposing `Number` and
  `Name`.

The conclusion is unambiguous: the dialled number was always available on this account. It
was never asked for.

## 3. Backfill counts

The backfill (`ringba-backfill-did`) is idempotent, parameterised by client and date window,
and restricted to `UPDATE ... WHERE call_id = $1 AND client_id = $2` touching only the five
new columns — never insert, never delete, never a pre-existing column.

| Measure | Result |
|---|---|
| Rows in window | 2,417 |
| Matched by call id | 2,417 |
| Populated with a dialled number | 2,321 |
| Ringba returned no dialled number | 96 |
| **Distinct `did` values** | **302** |
| Rows where `did` equals the caller number | **0** |

302 distinct values across 2,321 calls, all toll-free (one number alone took 337 calls), is
the signature of genuine tracking numbers. Thousands of distinct values would have meant we
were still looking at caller numbers. We are not.

## 4. The pooling finding, and why it changed the design

- **1,764 of 2,320 calls (76%) arrived on numbers drawn from 4 number pools.**
- **100 of the 302 numbers carry more than one distinct `utm_content` — up to 6 creatives on
  a single number.** That is what a pool is for: it rotates numbers across visitors.
- **All 302 numbers map to exactly one Ringba campaign each.**

So the dialled number is a **reliable vertical key and an invalid creative key**. Mapping a
DID to a creative on this account would misattribute. The design changed accordingly: DIDs
are mapped to **verticals**, the vertical read is built on that, and **ad-level attribution
can only ever come from the UTM tags**.

## 5. Join coverage by tier

Resolution tiers, in the order they are tried: `utm_ad` → `did_ad` → `utm_campaign` →
`vertical` → `none`. Only `utm_ad` and `did_ad` are ad-level.

| Tier | Calls | Share |
|---|---|---|
| Ad level — UTM tag (`utm_ad`) | 94 | 3.9% |
| Ad level — dialled number (`did_ad`) | 0 | 0% |
| Campaign level only (`utm_campaign`) | 0 | 0% |
| Vertical fallback | 0 | 0% |
| Resolves to nothing | 2,329 | 96.1% |

The tags are there — 621 calls carry `utm_source`, 604 carry `utm_content`, 72 carry a Meta
ad id in `tag:User:creative`. Only 94 resolve because **the Meta objects those tags name
live in ad accounts we do not sync**. The access token exposes **24 ad accounts** and only
`act_26673461192316342` ("Easy Bath Renovation") is synced. All 613 `utm_campaign` values
(26 distinct) match no synced campaign. `did_ad` is 0 by design now — pooled DIDs are not
creative keys — and `client_dids` holds no rows for this client.

Ad level is 3.9% because of unsynced ad accounts, not because of the tags.

## 6. DID-column audit of the other call tables — report only, nothing changed

| Table | Rows | DID column | Populated | Distinct DID values | Distinct caller numbers | Reading |
|---|---|---|---|---|---|---|
| `ringfuel_calls` | 99 | `did` | 5 | 1 | 5 | Tracking number, but populated on only 5 of 99 rows — a coverage gap, not a conflation |
| `moja_calls` | 34 | `tracking_number` | 34 | 7 | 24 | Genuine tracking numbers |
| `cannaball_calls` | 1,445 | `did` | 1,445 | 5 | 1,180 | Genuine tracking numbers — 5 numbers, 1,180 callers |

None of these three shows the Ringba failure mode. Each holds a small number of tracking
numbers against many distinct callers, which is the correct shape. `ringfuel_calls` needs
its population gap looked at; that is a separate piece of work and was not touched.

## 7. The payout finding

The question was whether the sub-dollar payouts are real revenue. **Neither Ringba field
answers it:**

- `noPayoutReason` is **null on all 2,417 rows**.
- `hasPayout` is **never false** — true on 1,605 rows, null on the rest, and true on 1,267
  of the 1,354 rows that paid $0. It does not separate zero from paid, let alone the
  sub-dollar tail from the $55/$60 calls.

The data answered it. **On all 721 sub-dollar rows, `payout` equals `metadata.total_cost`
exactly.** Payout buckets over the window:

| Payout | Calls | Median duration | Reading |
|---|---|---|---|
| $0.00 | 1,354 | 44s | Unpaid |
| $0.05 – $0.75 (avg $0.07) | 721 | 13s | **Telco cost written into the payout field** |
| $1.00 | 1 | 1,193s | Outlier |
| $55 – $60 (avg $55.25) | 341 | 357s | Real payouts |

The cause was in the sync's mapper: `Number(call.payoutAmount || call.payout || call.totalCost || 0)`
— whenever the real payout was zero, the `|| totalCost` fallback recorded the **telco cost
as revenue**. Both Ringba syncs now read `payoutAmount ?? payout ?? 0`; a cost may never
become revenue, and `??` keeps a legitimate zero.

**No stored rows were rewritten.** History and future are corrected at read time: a payout
counts as revenue only at or above the vertical's `min_payout_threshold`, and a
`payout_looks_like_cost` flag is set (and counted by name in the pull's flags) when a
non-zero sub-threshold payout equals the call's own total cost.

The account therefore has two payout states, $0 and $55/$60 — a **STATIC** shape.

## 8. Verticals, and the read

Assigned from the **Ringba campaign name the dialled number resolves to**, never from
creative matching.

| Vertical | Ringba campaigns | Meta patterns | Payout | Revenue source | Payout confirmed |
|---|---|---|---|---|---|
| Walk-In Tubs | `Walk In tubs`, `Walk In tubs Canada` | `WalkinTub*`, `*WIT*`, `*Tub*` | $80 | **computed** | Yes — confirmed by AJ |
| Bathroom Remodel | `Bathroom Remodel`, `Bathroom Remodel  - Canada`, `Bathroom Remodel - Branded` | `*Bath*` | $60 | platform | **No — observed only** |
| Live Transfer | `Walk In tubs Live Transfer` | — | $55 | platform | **No — observed only** |

Walk-In Tubs is `computed` because AJ confirmed $80 per billable call but our Ringba access
shows **$0.00 in payouts above $1 across 1,155 calls** for that campaign. A payout field we
cannot see is a **declared data limitation, not a zero**, so revenue is
`payout × billable calls`. The Canada and Branded campaigns carry zero payouts and tiny
volume; they are mapped but flagged as possibly needing their own economics.

The mixed Meta campaign `08/19 Ringba_Lifetime_Statics - Copy` carries both tub and bath
ads and is resolved **ad by ad** on ad-name patterns; an ad matching neither is reported as
**unclassified**, never assigned by default.

**Vertical read, last 30 days.** This is a vertical read, not an ad-level decision — no
cut/hold/scale verdict renders at this level, and the 3.9% ad-level coverage figure is shown
beside it.

| Vertical | Spend | Calls | Paid | Billable (at the assumed 90s) | Revenue | Source |
|---|---|---|---|---|---|---|
| Walk-In Tubs | $6,190.85 | 1,171 | 415 | 239 | **not shown — see §9** | computed |
| Bathroom Remodel | $4,335.42 | 841 | 244 | 17 | $1,020 | platform |
| Live Transfer | — | 404 | 404 | 325 | $17,821 | platform |
| Unclassified | $673.63 | 0 | 0 | 0 | — | no economics |

All calls are accounted for; nothing is unclassified on the call side. The unclassified
spend is 3 ads including `SameRoomSixDays_Static` from the mixed campaign.

## 9. The 90-second threshold is an UNKNOWN, and on Walk-In Tubs it decides the verdict

All three verticals were written with `billable_min_duration_seconds = 90`. **No contract
confirmed it.** Because Walk-In Tubs is `computed`, revenue *is* `payout × billable count`,
so that one unconfirmed number is the revenue. Against $6,190.85 of spend over the same 30
days:

| Threshold | Billable | Revenue | Margin |
|---|---|---|---|
| 30s | 687 | $54,960 | +88.7% |
| 60s | 418 | $33,440 | +81.5% |
| 90s | 238 | $19,040 | +67.5% |
| 120s | 158 | $12,640 | +51.0% |
| 180s | 95 | $7,600 | +18.5% |
| 240s | 67 | $5,360 | **−15.5%** |
| 300s | 55 | $4,400 | **−40.7%** |

The verdict flips from outstanding to losing money on an input nobody has supplied. So:

- `billable_min_duration_seconds` is now listed in `unknown_fields` on all three BuyologyIQ
  economics rows.
- Per §1, the UNKNOWN names what it blocks. On a `computed` vertical it blocks **revenue,
  RPC, margin per call, margin %, profit, cost per billable call, and every threshold
  derived from them.** On a `platform` vertical it blocks the **billable count and cost per
  billable call**.
- Where a `computed` vertical's threshold is UNKNOWN the vertical read renders **no revenue
  or margin point estimate at all**. Calls and spend are shown, because they are real. In
  place of revenue it shows the **sensitivity band** across plausible thresholds, with a
  plain statement that the true figure depends on a contract term nobody has supplied. A
  band that crosses zero says so explicitly and is marked verdict-blocking.
- The same band renders on the **intake compute step** for any `computed` vertical, so the
  operator sees the swing at the moment they are asked for the threshold.

## 10. Live Transfer is a genuinely separate source

Checked directly: only **2 shared caller numbers** between Live Transfer (384 callers) and
Walk-In Tubs (770 callers); Live Transfer has its own **3 dedicated non-pooled numbers**;
and **zero** of its calls arrive on a Walk-In Tubs number. These are not transferred
Walk-In Tubs calls. The split is correct and there is no double counting — and keeping it
separate matters, because blending a 100%-paid product into Walk-In Tubs would inflate that
vertical's RPC.

But Live Transfer carries **$17,821 of revenue with no Meta spend joined at all** — roughly
**47% of the client's revenue has no attributable cost**. Until we know whether that spend
sits in one of the 23 unsynced ad accounts or is simply not Meta traffic, **no blended
margin for this client means anything.**

## 11. Intake validation results (last 30 days, both directions)

| Vertical | Disagreement | Outcome |
|---|---|---|
| Walk-In Tubs | 0.8% | Passes — duration side only, because platform payouts are not visible |
| Bathroom Remodel | **17.2%** | **Blocks** — the operator must choose which definition governs |
| Live Transfer | 1.5% | Passes |

## 12. Every UNKNOWN, and what each blocks

| UNKNOWN | Blocks |
|---|---|
| Walk-In Tubs billable duration threshold (assumed 90s) | Revenue, RPC, margin per call, margin %, profit, cost per billable call, and every threshold derived from them — nearly the whole read for that vertical |
| Bathroom Remodel payout ($60 observed, unconfirmed) | Baseline RPC, allowable cost per call, kill threshold, and any margin judgement for that vertical |
| Live Transfer payout ($55 observed, unconfirmed) | The same set for that vertical, and any client-level revenue total |
| Bathroom Remodel governing billable definition (17.2% disagreement) | All computed thresholds for that vertical — intake will not compute them |
| Buyer hours | Whether a low-hour period is a delivery problem or a closed buyer; hold decisions that depend on buyer availability |
| Funnel structure and IVR steps | The connection-rate diagnostic — step 1 of the diagnostic tree cannot be read without knowing how many steps precede a live person |
| Which Meta ad accounts belong to this client | Spend, therefore every cost and margin metric; ad-level attribution above 3.9%; any blended client margin |
| Duration threshold on Bathroom Remodel and Live Transfer | Their billable counts and cost per billable call (platform verticals, so revenue itself is unaffected) |

## 13. Doc changes to re-sync

- `01_Decision_Engine.md` — §2 gained "Where revenue comes from — platform or computed";
  §3 gained the data-quality flags (`did_is_caller_number_fallback`,
  `payout_looks_like_cost`), the pooled-DID note, and the UNKNOWN-threshold /
  sensitivity-band rule.
- `02_Client_Intake.md` — Part A gained A2b (billable definition validation, required for
  any client with live data, blocking above 10%) and A2c (per-vertical revenue source,
  payout threshold, payout confirmation).
- `hardening-report.md` — Phase 1b, Phase 2 and Phase 3a sections.
- This report — new.

Code that holds the rules, for the next reader: `engine.ts` (every formula, plus
`resolveRevenue`, `isBillableCall`, `validateBillableDefinition`, `revenueSensitivity`),
`decisions.ts` (cut/hold/scale, graduation, scale, marginal), `adapter.ts` (canonical call),
`join.ts` (resolution tiers), `pull.ts` (the single pull spec), `verticalRead.ts` (the
vertical read). No page re-derives a rule.

---

## Can a shadow pilot start on BuyologyIQ next week?

**Yes — at vertical level, shadow only, on two of the three verticals.**

Bathroom Remodel and Live Transfer can be read weekly at vertical level: their revenue comes
from platform payouts we can see, their intake validation passes, and their call attribution
is stable. Walk-In Tubs can be read for calls and spend but **not for revenue or margin**
until the duration threshold is confirmed. Nothing at ad level is possible at 3.9% coverage,
and no blended client-level margin should be quoted at all while 47% of revenue has no
joined spend.

**The single blocking item: the Meta ad accounts.** Confirm which of the 24 ad accounts on
the token belong to BuyologyIQ and sync them. That one action fixes ad-level attribution
(the UTM tags already carry the keys — they just name objects we have not pulled) and gives
Live Transfer's $17,821 a cost side. Everything else is a confirmation email: the $80
duration threshold, the $60 and $55 payouts, and Bathroom Remodel's governing definition.

---

## 2026-09-14 — Walk-In Tubs billable threshold confirmed (record change)

**Confirmed by AJ Swamy on 2026-09-14, as a client contract term:** the Walk-In Tubs
billable definition is **90 seconds**, against the **$80** payout, revenue source
`computed`.

Recorded on the BuyologyIQ `walk-in-tubs` economics row only — Bathroom Remodel and every
other client untouched:

- `payout = 80`, `billable_min_duration_seconds = 90`, `revenue_source = 'computed'`
- `billable_min_duration_seconds` **removed from `unknown_fields`** (now `{}`)
- provenance on the existing record: `last_reviewed_at = 2026-09-14`, plus
  `billable_filters.billable_duration_confirmed_by = 'AJ Swamy'`,
  `billable_duration_confirmed_at = '2026-09-14'`
- declared flag, verbatim: *"payout assumed from client terms; not verified against platform
  payout data — CPM-attributed calls show $0 platform payout."*

**The platform still shows $0.** Across the 79 CPM-attributed Walk-In Tubs calls in the last
30 days the summed Ringba payout is **$2.80**, with **zero** calls paying $1 or more. The $80
is a contract term we are trusting; it is not corroborated by any payout the platform exposes
to us. Revenue stays labelled `computed` and the flag renders beside the point estimate.

**No special case was written.** The suppression rule already keyed on `unknown_fields`
(`engine.isUnknownField` → `blockedByUnknownDuration` → `revenueSensitivity`), so the band
disappeared on the record change alone. The only code added is a generic path for
record-declared caveats (`VerticalEconomics.declared_flags`, read from
`billable_filters.flags`) so a stated caveat renders verbatim. Bathroom Remodel's threshold
is still UNKNOWN and still suppresses its billable-denominated figures — covered by a new
test alongside the existing one.

### The read that follows — Walk-In Tubs, CPM-attributed only, 2026-08-15 to 2026-09-14

| Figure | Value |
| --- | --- |
| Spend | $5,425.31 |
| Calls | 79 |
| Connected | 77 |
| Billable (≥90s) | 42 |
| Revenue (computed, $80 × 42) | $3,360.00 |
| RPC | $42.53 |
| Cost per call | $68.68 |
| Cost per billable call | $129.17 |
| Margin per call | **−$26.14** |
| Margin % | **−61.5%** (profit −$2,065.31) |
| Margin band | **below the 10% floor — negative** |
| Connection rate | 97.5% |
| Billable rate | 54.5% |
| Call rate | 3.55% (79 calls ÷ 2,223 clicks) |
| Confidence | sufficient (42 billable ≥ min_calls 25) |

**Excluded volume beside it:** 1,096 calls on the same tracking campaigns from other
publishers — You 550, BIQ 537, Madrivo 6, Pilothouse 3. The client's campaign total and CPM's
attributable total are different numbers; both are true.

### Derived thresholds

No Instance record exists for this client yet, so these are computed for this report from the
framework defaults and must be written at intake before any command runs (§9).

- Baseline RPC: **$42.53**
- Allowable cost per billable call: **$64.00** at the 20% target margin, **$72.00** at the
  10% floor (`payout × (1 − margin)`)
- Actual cost per billable call: **$129.17** — **2.02× allowable at target, 1.79× at the floor**
- Kill threshold: **$160** (2 × $80) at zero billable
- `min_calls`: **25**, from an actionable gap of **0.57** (`8 ÷ gap²`, static)
- Expected billable calls per week: **9.8** → volume tier **5–25/wk** → cuts and scale steps
  **every 2 weeks**, both sides
- Cost to rank one angle to `min_calls`: 25 × $129.17 = **$3,229**. The full 30-day budget of
  $5,425 buys **1.7 angles**; a single 2-week decision window (~$2,713) buys **0.84** — it
  cannot even complete one.

**Under 3 angles, stated plainly (§9):** at this cost per billable call the budget cannot rank
angles at all. Any creative-versus-creative claim in this vertical is unsupported and every
per-angle row must render greyed and labelled insufficient. The only decision the data
supports is at vertical level, and at −61.5% margin that decision is to cut or to renegotiate
the terms, not to test.

### The mixed campaign

`08/19 Ringba_Lifetime_Statics - Copy` totals **$757.28** across five ads (current sync; the
$758.36 quoted earlier predates the last sync) and splits ad by ad:

- **Walk-In Tubs:** `TubWalls_Static` $19.53, 1 conversion
- **Bathroom Remodel:** `TheBathIsAboveThis_Static` $64.12, 0 conversions
- **Unclassified:** `SameRoomSixDays_Static` $565.46, `ThatsNotDirt_Static` $62.82,
  `GutIt_Static` $45.35 — **$673.63 across 3 ads, matching no vertical pattern.** Reported as
  unclassified, not allocated.

**Yes, it adds spend to Walk-In Tubs, and the $5,425.31 above already includes that $19.53.**
Tub campaigns alone are $5,405.78.

### Verification

Full suite **43/43 pass** (was 41), typecheck clean. No Bathroom Remodel figure changed: its
row was not written, its `unknown_fields` still carry both
`billable_min_duration_seconds` and `payout`, and its billable-denominated figures remain
suppressed.
