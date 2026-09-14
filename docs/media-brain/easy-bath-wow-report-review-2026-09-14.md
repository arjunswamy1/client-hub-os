# Review — "Easy Bath Renovation, Meta Ads week over week, Sep 7–13" (client PDF)

Reviewed 2026-09-14 against Ringba call log and stored Meta data for BuyologyIQ
(`b3d600f5-5d6b-4378-aa96-b395c05e9297`). Verticals: Walk-In Tubs (payout $80,
`computed`, ≥90s confirmed by AJ 2026-09-14) and Bathroom Remodel (payout $60
observed, `platform`, **unconfirmed**; billable definition failed intake
validation at 17.2%).

## What checks out

| Claim | Verified |
| --- | --- |
| Call counts 16 / 14 (Walk-In Tub) and 10 (Bath, Sep 7–13) | Match publisher = Connect Paid Media exactly. Publisher scoping was applied correctly. |
| Meta conversions 6 (prior week) and 4 (this week) | Match the governing event `offsite_conversion.fb_pixel_custom.RingbaConversion`, ad level. |
| Meta reports 0 conversions on Bath Remodel | Confirmed — no governed event rows resolve to Bath. |
| "6 · $202" / "4 · $251" as Meta cost per conversion | Arithmetic consistent with the stated spend. |
| Live Transfer excluded | Correct — it is entirely Squeeze Media Group traffic, not CPM's. |

## Errors to correct

**1. The "converted" column does not match any definition in the data.** This is
the most serious problem: every headline number is built on it.

| | Report "converted" | Ringba `converted` flag | ≥90s | ≥60s | ≥20s | Total calls |
| --- | --- | --- | --- | --- | --- | --- |
| Walk-In Tub, Aug 31–Sep 6 | 10 | 6 | 11 | 13 | 16 | 16 |
| Walk-In Tub, Sep 7–13 | 8 | 4 | 6 | 7 | 9 | 14 |
| Bath Remodel, Sep 7–13 | 8 | 3 | 3 | 4 | 7 | 10 |

Bath Remodel cannot produce 8 converted calls out of 10 under any threshold in
the data — 7 calls reached even 20 seconds. The "80% conversion, no duplicates"
line and the $118 figure both fail. The report must state the definition it
used and reconcile to one of the columns above.

**2. Revenue is assumed, not measured, and the report reads as if it were
measured.** CPM-attributed calls carry effectively $0 platform payout ($0.80 and
$0.35 across the two weeks — telco cost, not revenue). Walk-In Tubs revenue is
`computed` from the confirmed $80 × billable count. That is legitimate, but it
must be labelled as computed from client terms, with the standing caveat that
platform payout data shows $0 for these calls.

**3. Bathroom Remodel is measured against the wrong target.** $80 is the
Walk-In Tubs payout. Bath's $60 is observed, never confirmed, and its billable
definition is in dispute. Bath's $118 "cost per converted call" cannot be judged
against $80, and no Bath verdict should be published until the payout and
duration terms are confirmed.

**4. Cost per conversion is presented as the deciding metric. It is not.**
Margin per call decides. At the report's own spend:

| | Spend | Calls | Cost/call | Billable (≥90s) | Cost/billable call | Allowable |
| --- | --- | --- | --- | --- | --- | --- |
| Walk-In Tub, Sep 7–13 | $1,004.99 | 14 | $71.79 | 6 | **$167.50** | $64 at 20% target, $72 at floor |
| Bath Remodel, Sep 7–13 | $941.32 | 10 | $94.13 | 3 | **$313.77** | not derivable — payout unconfirmed |

Walk-In Tubs is roughly 2.6× its allowable cost per billable call. Margin per
call is about **−$26**, margin about **−60%**. "Scaled 57% without losing
efficiency" describes a week that lost money faster, and should read that way.

**5. Both verticals are blended into one $122 figure.** Different payouts mean
different allowable costs; a blended cost per call cannot be judged against
either target. Report per vertical, and add an unclassified row — $673.63 of
mixed-campaign spend (08/19 Ringba_Lifetime_Statics) resolves to neither
vertical and is currently absorbed into the two columns.

**6. Every ad-set and daily read is below the confidence floor.** `min_calls` is
25 per angle at the standing 0.57 gap. The week has 6 and 3 billable calls.
So: "aesthetic statics best CTR, needs budget to prove out" (CTR explains, never
decides; $143 with 0 conversions says nothing either way), "FrontDoor and
NoMysteryMath are the converters" (4 conversions across an ad set), and "$84 on
Sunday, best day yet" (3 calls) are all noise. They should be marked
insufficient rather than read as findings.

**7. Duplicate counts are wrong.** By distinct caller number: Walk-In Tub
Sep 7–13 is 14 calls from 11 callers (3 repeats, not 5 of 14); prior week 16 from
12; Bath 10 from 8.

**8. Weekly spend splits cannot be verified in-system.** Stored Meta spend is one
lifetime/rolling aggregate per ad, not daily rows, so the WoW spend, impression,
CTR and CPC splits rest on the Ads Manager export alone. Fine to publish, but
the report should say the platform export is the sole source for those lines.

**9. The stated cut rule is not the system's.** "Cut any ad above $150 per
conversion after $300 of spend" is invented. The kill threshold is 2 × payout =
**$160 at zero billable calls**, and the cut test is margin per call below
breakeven with sufficient calls. Cost per conversion never decides.

**10. The end-of-September goal is set at breakeven.** "Blended under $80" is
zero margin at an $80 payout. At the 20% target it must be **$64 per billable
call**, and it must be per vertical.

**11. The Bath postback framing is probably too narrow.** The same pixel and the
same governing event fire for Walk-In Tubs, so a broken postback is unlikely to
be the whole story; check the event/campaign configuration on the Bath campaign.
Separately, Meta reporting fewer conversions than we attribute calls is the
expected shape for an offline upload — the platform count is a floor, not a
census — so it is not by itself evidence of breakage.

## Suggested correction order

1. Restate "converted" with one stated definition and re-derive every headline.
2. Split the read by vertical, add the unclassified spend row, drop the blend.
3. Publish margin per call and cost per billable call against each vertical's
   allowable cost; label Walk-In Tubs revenue as computed from client terms.
4. Withhold Bath verdicts pending confirmed payout and billable definition.
5. Grey out every ad-set and daily line as insufficient, or remove them.
6. Replace the goal and cut rule with the stored thresholds.
