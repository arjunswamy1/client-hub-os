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
