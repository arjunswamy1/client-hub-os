---
name: Hablyte account setup
description: Hablyte publisher scoping ("You"), click-to-call means no UTM tags, so reads are campaign/vertical level only
type: feature
---

Client: Hablyte (Home Insurance, Auto Insurance on Meta; Ringba call tracking, RTB payout mode).

**Publisher scoping:** Hablyte's own traffic is publisher `You` in Ringba. `media_brain_economics.attributed_publishers = {You}` on every economics row for this client. The other 23 publishers on that Ringba account (John Edward, RR Resolution, FA Outsourcing, etc.) are other people's traffic and must never enter a spend-vs-revenue read.

**No UTM tags by design.** Hablyte runs Meta click-to-call ads — the ad dials the number directly, there is no landing page, so no query string and no UTM tags can ever exist. Do not treat missing `utm_content` / `utm_campaign` as a tracking bug and do not ask for `{{ad.id}}` in links.

**Consequence:** ad-level attribution is unavailable for Hablyte. Reads resolve at campaign/vertical level (Ringba campaign name → vertical) and are barred from per-ad verdicts per canon. The only route to ad-level would be one dedicated Ringba number per Meta ad, fed as the click-to-call number — worth proposing, not assumed.

**Observed as of Sep 17 2026:** 32 calls from `You` (Aug 18 – Sep 16) — Auto RTB 21, Home Insurance 9, Pest Control 2 — with $0 payout on all of them. Below `{min_calls}` for RTB (35), so no verdict; the zero payout is itself a finding to raise, not a number to average.

**Revenue basis correction (Sep 17 2026).** Ringba's `payoutAmount` is what the account owes an *outside* publisher and is always 0 for publisher `You` — we are the publisher. Their revenue is the buyer's `conversionAmount` (stored in `ringba_calls.revenue`). Read buyer revenue first and fall back to payout, never both. The earlier "$0 revenue on every call" read was this field mistake, not a routing failure.

**Buyer availability is pullable, partially.** `GET /v2/{account}/targets` returns each target's `criteria` — `InboundNumber:State` accept lists (geo), `Publisher:Name` allowlists, plus `schedule.hoursOfOperation` and caps. This owner-level key sees only 2 targets and 403s on `/buyers`, `/campaigns`, `/numbers`, so coverage is partial. Diagnostic: `sync-ringba-calls-hablyte?buyers=1` (read-only). Observed: "Auto Static - Instar" accepts 22 states, excluding NY and NJ; "HomeFront Pro" filters on a publisher allowlist whose names come back masked — worth checking whether `You` is on it.

**RTB bid columns:** `winningBid` (boolean), `ringTreeWinningBidTargetName`, `noConversionReason`, `blockReason` are synced into metadata. The account's column budget is real — adding more crowded out the Geo/InboundNumber tags and blanked caller state on a resync. Keep the RTB additions to a handful.
