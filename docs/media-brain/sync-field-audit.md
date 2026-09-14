# Sync field audit — Ringba, Moja, Meta Ads, Google Ads

**Date:** 2026-09-14 · **Scope:** read-only. No migration, no sync edit, no column added. The
only write from this pass is this file.

**Why this exists.** Four passes found four silent defects, and every one was a field the API
offered and the sync dropped: the dialed number never requested; telco cost recorded as payout;
the publisher / traffic-source field ignored; Meta conversions counting a `purchase` action a
call-driven account never fires. Nobody had audited Moja or Google Ads at all.

**Method.** Where a read-only diagnostic exists, the API was asked what it exposes rather than
inferred from code:

| Sync | Table A source | Table B source |
| --- | --- | --- |
| Ringba | code | **live probe** — `sync-ringba-calls-buyology?diagnose=1` (`/calllogs/columns`, `/tags`), 2026-09-14 |
| Meta | code | **live probe** — `sync-meta-ads` `{diagnose_actions:true, days_back:30}`, all 7 connected accounts, 2026-09-14 |
| Moja | code | **stored data + invocation logs** (Moja is push-only; no queryable API surface from our side) |
| Google Ads | code | **API reference for the resources queried** — no live probe was possible without adding a diagnostic mode, which is a code change and out of scope here. Named as a Phase 2 item below. |

---

## 1. Ringba

Three functions write Ringba data: `sync-ringba-calls-buyology` (BuyologyIQ → `ringba_calls`),
`sync-ringba-calls` (older, → `ringba_calls`), `sync-ringba-calls-4js` (→ `ringba_calls_4js`).

### Table A — what the sync reads (BuyologyIQ)

`VALUE_COLUMNS` in `sync-ringba-calls-buyology/index.ts`, filtered against
`/v2/{acct}/calllogs/columns` before the request (Ringba 422s the whole call on one unknown
column), then extended with every tag in groups `InboundNumber`, `Geo`, `User`, `DialedNumber`.

| API field | Column written | Note |
| --- | --- | --- |
| `inboundCallId` | `call_id` | falls back to `callId`, then `callDt`+caller |
| `callDt` | `call_date` | |
| `campaignName` | `campaign_name` | also the live-campaign filter (`walk in tubs`, `bathroom remodel`) |
| `targetName` \|\| `buyer` | `target_name` | |
| `tag:InboundNumber:Number` … \|\| `callerId` | `caller_number` | |
| `inboundPhoneNumber` | `inbound_number` | Ringba "Caller ID". **Read but not used for attribution** — correct, this is the caller |
| `tag:DialedNumber:Number` \|\| `…:NumberE164` \|\| `number` | `did` | the fix from the last pass |
| `numberPoolName` | `did_pool_name` | |
| `isFromNumberPool` | `is_from_number_pool` | |
| `hasPayout` | `has_payout` | |
| `noPayoutReason` | `no_payout_reason` | null on all 2,417 rows — Ringba populates it on this account only for no-bid/ring-tree paths |
| `callLengthInSeconds` \|\| `connectedCallLengthInSeconds` | `duration_seconds` | |
| `hasConnected` | `connected` | falls back to `duration > 0 && !wasBlocked` |
| `hasConverted` | `converted` | |
| `conversionAmount` | `revenue` | zero unless `converted` |
| `payoutAmount ?? payout ?? 0` | `payout` | **fixed**: was `payoutAmount \|\| payout \|\| totalCost`, which recorded telco cost as revenue. `??` keeps a legitimate `0` |
| `publisherName` | `metadata.publisher` | the traffic source; now a required attribution dimension |
| `callerStateProvince` / `callerCity` / geo tags | `metadata.state` / `.city` | |
| `endCallSource` | `metadata.disposition` | |
| `recordingUrl` | `metadata.recording_url` | |
| `totalCost` | `metadata.total_cost` | kept as cost only; used to detect `payout_looks_like_cost` at read time |
| `tag:User:utm_content` / `utm_source` / `utm_medium` / `utm_campaign` / `utm_term` / `creative` | `metadata['tag:User:…']` | the only ad-level key on this account |
| every other `tag:*` returned | `metadata` | kept verbatim |

Fallback chains that remain, and are safe: `call_id`, `caller_number`, `duration_seconds`,
`connected`. The one that was not safe (`payout`) is fixed.

**Still-open defects in the sibling functions:**

- `sync-ringba-calls-4js` line 120: `Number(c.payoutAmount || c.payout || (isConverted ? c.conversionAmount : 0) || 0)`.
  Same class as the cost-as-revenue bug — `||` treats a legitimate `0` payout as absent and falls
  through to conversion amount. Not fixed. Reported only.
- `sync-ringba-calls` sends **no `valueColumns`** at all, so Ringba returns its default column
  set. `did`, `numberPoolName`, `isFromNumberPool`, `hasPayout`, `noPayoutReason` are mapped in
  code but will be null in practice for any client on that function. Reported only.

### Table B — what Ringba offers and we ignore

Live probe: **110 call-log columns, 88 tags across 18 tag groups**
(`Buyer, CallInfo, CallLength, Campaign, Conversion, Date, DialedNumber, EndCall, Geo,
InboundNumber, Ivr, Lookup, PlacementInfo, Publisher, Recording, Target, Technology, Time`).
Of the 110 columns, 29 are requested; **81 are not**.

Flagged classes:

| Class | Available and ignored | Why it matters |
| --- | --- | --- |
| traffic source / publisher | `publisherId`, `publisherSubId`, tag group `Publisher` (`Company, Id, Name, ReplacementNumber, SubId`) | we match publishers by **display name** only. An id would make the match exact and rename-proof; `publisherSubId` is how sub-affiliates are split |
| payout / paid | `wasPayoutAdjusted`, `profitGross`, `profitNet`, `hasRpcCalculation` | a payout adjusted after the fact silently changes history; we would not see it |
| conversion | `noConversionReason`, `wasConversionAdjusted`, `conversionAdjustedCalls`, `convAdjustment*` (5 cols), `offlineConversionUploaded`, tag `Conversion:ConvertedDuringCall` | `noConversionReason` is the downstream diagnostic step 1 asks for and we do not have it |
| dialed number / pools | `targetNumber`, `buyerTargetNumber`, `globalCallId`, tag `PlacementInfo:NumberPoolId/NumberPoolName` | `PlacementInfo` also carries `LandingPageId`, `LandingPageVersion`, `PlacementId`, `SearchKeyWord`, `SearchTerm` — a **placement-level attribution key we have never read** |
| buyer / target | `buyerId`, `targetId`, `targetSubId`, `targetGroupName`, `targetGroupId`, `buyerHasConnected`, `buyerHasConverted`, `buyerCallLengthInSeconds`, `buyerConversionAmount`, `buyerTimeToConnectInSeconds`, tag groups `Buyer`, `Target` | buyer-side connect and convert flags are the downstream half of the diagnostic tree |
| RTB / ring-tree | `winningBid`, `bidAmount`, `avgPingTreeBidAmount`, `pingTotalBidAmount`, `pingSuccessCount`, `pingFailCount`, `ringTreeWinningBid*` (6 cols), `winningBidCallAccepted/Rejected` | **the entire RTB read**. §2's RTB branch (no-bid rate, bid depth, winning bid, median) has no data source until these are requested |
| block / quality | `wasBlocked`, `blockReason`, `wasBlockedByTCPA`, `tcpaCost`, `tcpaCount`, `isDuplicate`, `isIncomplete`, `incompleteCallReason`, `hasVoiceMail` | duplicates and blocks currently sit inside our call counts |
| cost detail | `telcoCost`, `icpCost`, `transcriptionCost` | we take only the `totalCost` roll-up |
| IVR / funnel | `ivrDepth`, `rerouteDepth`, `reroutedFromParent/ToChild`, `timeToCallInSeconds`, `timeToConnectInSeconds`, tag group `Ivr` | funnel structure and IVR steps are a named UNKNOWN in the pilot report; `ivrDepth` answers part of it |
| Google Ads link | `googleAdsIntegrationType`, `googleAdsSuccessfulUpload`, `googleAdsUploadErrorCode` | Ringba already uploads offline conversions to Google Ads on this account. **This is the join key to Google spend** and we read none of it |
| technology / device | tag group `Technology` (`Browser, IPAddress, IsMobile, OS, UserAgentString`) | device split |
| geo detail | `Geo:Latitude/Longitude/ZipCode/Country`, tag group `Lookup` (state/zip validation) | DMA/ZIP reporting |
| transcription | `hasTranscription`, `transcriptionId`, `transcriptionCount` | disposition evidence without listening |

**Click IDs: Ringba exposes none.** No `gclid`, `wbraid`, `gbraid`, `fbclid` or `msclkid` column
or tag exists on this account. Click-ID joining to Ringba is not available; UTM tags and
`PlacementInfo` are the only ad-level keys. Stated so nobody plans around a field that is not there.

**One catalogue quirk to know.** `/tags` returns **no `User` group**, yet `tag:User:utm_content`
is accepted by `/calllogs` and populates on 94 calls. So the tag catalogue is incomplete, the
`["InboundNumber","Geo","User","DialedNumber"]` allowlist contributes nothing for `User`, and the
UTM columns only survive because `VALUE_COLUMNS` passes `tag:`-prefixed entries through the column
filter unchecked. Fragile, but currently working.

---

## 2. Moja

### Table A — what the sync reads

`moja-webhook/index.ts` is a **push receiver**, not a poller: Moja POSTs, we upsert
`moja_calls`. Auth is a shared secret (`x-moja-secret` / Bearer / `?secret=`), client routing is
`?client_id=`. Every field is read through `pick(obj, [aliases])`, first non-empty non-macro alias
wins, so each row below is itself a fallback chain.

| Payload aliases | Column | Note |
| --- | --- | --- |
| `call_id, callId, call_sid, id, uuid, inbound_call_id` | `call_id` | falls back to a generated UUID — a payload with no id becomes a new row on every retry |
| `campaign_name, campaign, campaignName` | `campaign_name` | |
| `publisher_name, publisher` | `publisher_name` | **Moja does expose a publisher field** — see below |
| `target_name, target` / `buyer_name, buyer` | `target_name` / `buyer_name` | |
| `to, tracking_number, did, dialed_number, publisher_number` | `tracking_number` | dialed number, distinct from the caller |
| `caller_id, caller, from, caller_number, ani` | `caller_number` | |
| `duration, call_duration, outbound_duration, duration_seconds` | `duration_seconds` | |
| `inbound_duration…` | `inbound_duration_seconds` | |
| `connected, answered` | `connected` | **`|| duration_seconds > 0`** — a duration alone marks a call connected |
| `converted, conversion, is_converted` | `converted` | |
| `revenue, revenue_paid_out, buyer_revenue, amount` | `revenue` | |
| `payout, publisher_paid_out, publisher_payout, target_payout, payout_numeric` | `payout` | `toNumber` → 0 when absent, so a missing payout is indistinguishable from a real zero |
| `disposition, status, call_termination_by, result` | `disposition` | |
| `recording_url, recording, audio_url` | `recording_url` | |
| tags/`source, campaign, term, keyword, content, creative` | `utm_source/campaign/term/content` | |
| `caller_state`/`caller_zip` (+ tag fallbacks) | `caller_state`, `caller_zip` | |
| whole payload | `raw_payload` | **see the finding below** |
| — | `service_line`, `platform` | **derived, not read**: `classify()` regexes the campaign / publisher text. Windows→meta, plumbing→google **as a default when no platform word appears** — a guess stored in a column that reads like a fact |

Read but discarded: nothing is dropped by design — the receiver keeps the whole payload. The
problem is that it is not arriving.

### Table B — and the answers to the specific questions

There is no Moja API to interrogate from our side, and no stored payload to read, so this section
is grounded in what the receiver expects and what the data shows.

- **Publisher / traffic source: yes.** `publisher_name` is populated on **34 of 34** rows. Every
  row reads `RRM (INTERNAL)`.
- **Dialed number distinct from caller: yes, confirmed against the data, not just inferred.**
  7 distinct `tracking_number` values, 24 distinct callers, **zero rows where
  `tracking_number = caller_number`**, and **zero cases of any tracking number appearing anywhere
  in the caller column**. The numbers themselves are consistent with tracking DIDs (two local
  `+1580447268x`, three `+1833720600x`, two `+1877273xxx`). This is the opposite of the Ringba
  conflation. It is *not* confirmed against Moja's API documentation — that requires Moja's own
  field reference, which we do not hold.
- **Number pools: unknown, and currently unanswerable.** No pool field is read, no pool field is
  known to exist, and 7 numbers across 2 campaigns is equally consistent with pooled or dedicated
  numbers. Cannot be resolved from 34 rows.
- **Click ID: none read.** No `gclid`, `wbraid`, `gbraid`, `fbclid` or `msclkid` alias appears in
  the receiver, and no column exists for one on `moja_calls`. Whether Moja sends one is unknown
  for the reason below.

**Finding: `raw_payload` is NULL on all 34 rows, and `moja-webhook` has never been invoked.**
The receiver sets `raw_payload: payload` unconditionally, so these rows did not come through it.
Edge function logs for `moja-webhook` return **no invocations at all**. All 34 rows were
`created_at` **2026-08-22**, in a single batch. `moja_calls` is written by nothing else in the
codebase.

**So: is the stale data a sync failure, a paused campaign, or a credentials problem?**
None of the three. **The Moja integration has never run.** The 34 rows are a one-time seed loaded
on 2026-08-22 covering 2026-08-13 → 2026-08-21, on two campaigns literally named
`RRM INTERNAL - Plumbing` and `RRM INTERNAL - Windows` from publisher `RRM (INTERNAL)`. Evidence:
zero webhook invocations ever; `raw_payload` null (impossible via the receiver); one single
`created_at` batch; no scheduled job and no poller referencing Moja anywhere.

The blocking item is therefore configuration on Moja's side: the webhook URL plus
`MOJA_WEBHOOK_SECRET` and `?client_id=` have never been registered in Moja. There is no evidence
of a credential rejection either — a wrong secret would still have produced 401 invocation logs,
and there are none. Nothing has ever been pointed at us.

Because there is no captured payload, **Table B for Moja cannot be completed** until one live
delivery lands. The moment it does, `raw_payload` gives the full field menu for free. Until then
any claim about Moja's publisher semantics, pooling, or click IDs would be invention.

---

## 3. Meta Ads

### Table A — what the sync reads

`sync-meta-ads/index.ts`. Insights are requested at **four levels** — `account`, `campaign`,
`adset`, `ad` — all with `time_increment=1`, fields
`spend, impressions, clicks, actions, action_values, conversions, conversion_values` plus the
id/name fields for the level. Entity statuses come from `/{account}/campaigns|adsets?fields=id,effective_status`.
Ads and creatives come from `/{account}/ads?fields=id,name,status,campaign_id,adset_id,creative{…}`.

| API field | Table.column |
| --- | --- |
| `spend, impressions, clicks` | `ad_daily_metrics`, `ad_campaigns`, `ad_sets`, `ad_creatives` |
| `conversions[]` → first match of `RingbaConversion`, `contact_total`, `contact_website` | `.conversions` |
| `conversion_values[]` → same order | `.revenue` |
| `actions[]` → `purchase`, `offsite_conversion.fb_pixel_purchase` | `.conversions` (only when the call list found nothing) |
| `actions[]` → `add_to_cart`, `omni_add_to_cart`, `offsite_conversion.fb_pixel_add_to_cart` | `ad_daily_metrics.add_to_cart` |
| `action_values[]` → purchase types | `.revenue` (added) |
| `campaign_id/name`, `adset_id/name`, `ad_id/name` | id and name columns |
| `objective`, `buying_type` | `ad_campaigns.bidding_strategy_type`, `.campaign_type` |
| `creative{object_story_spec, asset_feed_spec, thumbnail_url, image_url, video_id, image_hash}` | `ad_creatives` copy, thumbnail, video, cta, link |
| `effective_status` | `.status` |

**Read then discarded: `actions[]` and `action_values[]` in bulk.** Both arrays arrive complete and
the code keeps at most three action types out of ~28–37. Everything else is dropped silently.

**Ad-level spend is captured, but flattened.** `ad_creatives` is one row per ad with
`date_from`/`date_to`; the daily ad-level rows are aggregated away. Verdicts that need a *trend* at
ad level have no daily series on Meta.

### Table B — live probe, 7 accounts, last 30 days

| Account | Result |
| --- | --- |
| `act_26673461192316342` Easy Bath Renovation (BuyologyIQ) | $9,759.29 / 4,917 clicks · 37 action types |
| `act_2597438613978922` River Road Marketing – Windows (RRM) | $4,417.97 / 5,746 clicks · 28 action types |
| `act_277840156` DSW – Brand | **token invalid** — "session has been invalidated because the user changed their password" |
| `act_448669084867269`, `act_3645979822398099`, `act_1779578786137314`, `act_987522183147577` Billy's 4 accounts | **token invalid**, same message |

**Finding 1 — the conversions defect is still live on RRM.** RRM's account returns
`conversions: null` and `conversion_values: null`, so the call list matches nothing, and it fires
no `purchase`, so the purchase fallback matches nothing either. RRM Meta conversions are therefore
**0 in every table** — confirmed in the data: $4,417.97 spend, 5,746 clicks, **0 conversions**
across `ad_campaigns` and `ad_creatives` for the last 30 days. Meanwhile the probe shows RRM's
account recording `lead: 487`, `offsite_conversion.fb_pixel_lead: 487`, `onsite_web_lead: 487`,
`landing_page_view: 5,050`, `view_content: 1,033`. **487 leads exist on the API and land nowhere.**
This is the identical defect fixed for BuyologyIQ, unfixed for RRM because the fix named the
BuyologyIQ event rather than reading what each account records.

**Finding 2 — BuyologyIQ's native call actions are ignored.** The probe shows, on the account we
have already audited twice: `click_to_call_call_confirm: 34`, `call_confirm_grouped: 34`,
`click_to_call_native_call_placed: 26`, `click_to_call_native_20s_call_connect: 6`,
`click_to_call_native_60s_call_connect: 4`. Meta counted 26 native calls placed and 6 that
connected past 20 seconds, and the sync reads none of them. These are Meta's own call events,
independent of the Ringba pixel, and they are the closest thing to a Meta-side check on our call
counts.

**Finding 3 — `contact_total`'s value is ignored while `RingbaConversion`'s is used.** BuyologyIQ
returns `conversion_values`: `contact_total 8850`, `contact_website 8850`,
`RingbaConversion 2710`. The allowlist order takes `RingbaConversion` first, so 37 conversions /
$2,710 is what we store. That is defensible — it is the Ringba event — but the $8,850 alternative
should be an explicit choice on the record, not an artefact of array order in code.

**Finding 4 — an invalid token reports as healthy.** All five Billy/DSW accounts fail auth, yet
`platform_connections` shows Billy Meta `status: active`, `sync_error: null`,
`last_synced_at: 2026-09-14 03:10`, `last_sync_records: 0`. `fetchInsights` logs the Graph error and
`break`s, `syncMetaForUser` returns `{success: true, records_synced: 0}`, and the health writer
marks it active. **A dead token and a genuinely quiet account are indistinguishable in the UI.**
Same defect class as a four-month silent Google outage.

**Ignored fields by class:**

| Class | Available and ignored |
| --- | --- |
| conversion actions | every action type outside the 3-name call list, the 2-name purchase list and the 3-name cart list. On the two live accounts that is **32 of 37** and **25 of 28** |
| click IDs | **none available.** The Insights API exposes no `fbclid`; Meta's click id reaches us only if it is written into the landing-page URL and passed to the call platform as a UTM/tag. Ringba's field menu has no fbclid column either, so this path does not exist today |
| ad-level breakdowns that would raise attribution | `breakdowns=` is never used: `publisher_platform`, `platform_position`, `device_platform`, `impression_device`, `country`, `region`, `dma`, `age`, `gender`, `hourly_stats_aggregated_by_advertiser_time_zone`. `action_breakdowns=action_type,action_destination,action_video_type`. Also unread: `frequency`, `reach`, `cpm`, `cpp`, `unique_clicks`, `inline_link_clicks`, `outbound_clicks`, `cost_per_action_type`, `video_p25/50/75/100_watched_actions`, `quality_ranking`, `engagement_rate_ranking`, `conversion_rate_ranking`, `attribution_setting`, `optimization_goal`, `objective` at ad level |
| entity fields | `ads?fields=` omits `tracking_specs`, `conversion_specs`, `adlabels`, `created_time`, `updated_time`, `issues_info`, and `creative{url_tags}` — **`url_tags` is the account's UTM template, i.e. the ground truth for how our own UTM keys are built** |
| **honest answer on raising attribution** | **No Meta field raises ad-level attribution above UTM coverage.** `frequency`/`reach` fix saturation-vs-fatigue, and `attribution_setting` and the ranking fields explain, but nothing here supplies a per-call identity. The only lever is `creative{url_tags}` — making sure every ad actually stamps a UTM — plus `quality_ranking` as a diagnostic. Attribution stays UTM-bound |

---

## 4. Google Ads — nothing here had been examined

`sync-google-ads/index.ts`, API **v23**, `googleAds:searchStream`, 7-day date chunks, 50-second
budget. Customers: `metadata.customers`, restricted to `platform_connections.customer_id` when one
is mapped, otherwise **every accessible customer** — which the code itself warns "may produce
duplicates across clients". RRM has **no `customer_id` mapping**.

### Table A — the six queries, and their granularity

| Resource | Selected | Written to | Granularity |
| --- | --- | --- | --- |
| `customer` | `segments.date`, `cost_micros`, `impressions`, `clicks`, `conversions`, `conversions_value` | `ad_daily_metrics` | account × day |
| `campaign` | + `campaign.id/name/status/bidding_strategy_type/advertising_channel_type/campaign_budget`, `metrics.search_impression_share` | `ad_campaigns` | campaign × day |
| `campaign` (budget) | `campaign_budget.amount_micros` | `ad_campaigns.daily_budget` | current only |
| `ad_group` | ad group + campaign ids/names/status, same 5 metrics | `ad_sets` | ad group × day |
| `keyword_view` | keyword text, match type, quality score, negative, same 5 metrics + impression share | `campaign_keywords` | keyword × day |
| `search_term_view` | search term, matched keyword, same 5 metrics | `search_terms` | term × day |
| `ad_group_ad` | ad id/name/type/final_urls, RSA headlines + descriptions, status, same 5 metrics | `ad_creatives` | **ad, whole window** |

`cost_micros / 1e6` → `spend`; `conversions_value` → `revenue`; **`Math.round(metrics.conversions)`**
→ `conversions` (fractional Google conversions are rounded, so 0.5 becomes 1 and 0.4 becomes 0).

### Does it capture ad-level spend?

**Yes — but not per day, and only for enabled/paused ads.** `syncGoogleAdCreatives` runs
`FROM ad_group_ad` over the whole window with `segments.date` in the `WHERE` clause but **not in
the `SELECT`**, then sums every row into one record per ad id. Confirmed in the data: RRM has
**216 Google ads, $7,688.99, `date_from` 2026-07-25 → `date_to` 2026-09-14** — one aggregate row
per ad, no daily series. `ad_daily_metrics` for Google is account-level only.

Plainly, for the engine: **ad-level spend exists on Google, ad-level spend *by day* does not.**
A single-window verdict is possible; a two-consecutive-window scale gate, a marginal-return
comparison or any changepoint test at ad level is not, because the daily rows were discarded before
storage. Adding `segments.date` to the `SELECT` is the whole fix. Two further limits: the query
filters `campaign.status IN ('ENABLED','PAUSED')` and `ad_group_ad.status IN ('ENABLED','PAUSED')`,
so **a removed ad's spend silently leaves the totals** — the account roll-up and the ad roll-up will
not reconcile; and `creative_type` is hardcoded `"search"` while only
`responsive_search_ad` assets are extracted, so Demand Gen, Video, PMax and call-only ad copy is
stored as a search ad with null assets.

### Calls, call assets, phone conversions

**None of it is captured.** No query touches any call surface:

- `call_view` — the per-call resource (`call_view.call_duration_seconds`,
  `.call_status`, `.call_tracking_display_location`, `.start_call_date_time`, `.caller_area_code`,
  `.caller_country_code`, `.type`) is never queried. This is Google's equivalent of a call log and
  we have never read it.
- `metrics.phone_calls`, `metrics.phone_impressions`, `metrics.phone_through_rate` — not selected
  anywhere.
- Call assets — no `asset`, `campaign_asset`, `ad_group_ad_asset_view` or
  `asset_field_type_view` query, so call extensions and their performance are invisible, as is
  every other asset (sitelinks, images, headlines-as-assets for PMax).
- `landing_page_view` / `expanded_landing_page_view` — not queried, so no landing-page split.

Consequence: on Google we currently know spend and Google's own conversion count, and **nothing
about calls**. For a pay-per-call framework that is the largest gap in this audit.

### Which conversion actions, and the attribution model

**Neither is read.** The sync selects only `metrics.conversions` and `metrics.conversions_value`,
which are Google's aggregates over whatever actions the account marks *primary*. It never selects
`segments.conversion_action`, `segments.conversion_action_name`,
`segments.conversion_action_category`, and never queries the `conversion_action` resource
(`conversion_action.name`, `.type`, `.category`, `.status`, `.primary_for_goal`,
`.value_settings`, `.counting_type`, `.attribution_model_settings`), nor
`customer.conversion_tracking_setting`. So:

- We cannot tell a phone-call conversion from a form fill from a Ringba offline upload. They are
  one number.
- `metrics.all_conversions` / `all_conversions_value` (which include non-primary actions, often
  where call conversions sit) are never read — a call conversion that is not primary is invisible
  to us entirely.
- **The attribution model in use is unknown.** It is per conversion action
  (`attribution_model_settings`) and we read none of it, so we cannot say whether Google's number is
  last-click or data-driven, nor over what window. RRM's data shows the size of the doubt: **8
  conversions on $7,102 and 5,829 clicks in 30 days.**
- `segments.date` aside, no `segments.ad_network_type`, `.device`, `.click_type`,
  `.conversion_lag_bucket` is read.

### GCLID / wbraid / gbraid

**Not captured anywhere.** No `click_view` query (`click_view.gclid`, `.campaign_location_target`,
`.user_list`, and `segments.date` — Google only serves this resource for the **last 90 days**, one
day at a time), and no column named `gclid`, `wbraid`, `gbraid`, `fbclid` or `msclkid` exists
anywhere in the database — checked across all of `public`.

This matters more than any other single gap: **GCLID is the join key between Google spend and call
data**, and Ringba's own field menu shows `googleAdsIntegrationType`,
`googleAdsSuccessfulUpload`, `googleAdsUploadErrorCode` — Ringba is *already* uploading offline
conversions to Google Ads on the BuyologyIQ account, which means a GCLID is already flowing
Google → landing page → Ringba somewhere. Neither side of that link is read by us.

### Table B — ignored, by class

| Class | Available and ignored |
| --- | --- |
| calls | `call_view` (whole resource), `metrics.phone_calls`, `phone_impressions`, `phone_through_rate`, call assets via `ad_group_ad_asset_view` / `asset_field_type_view` |
| conversion actions | `conversion_action` resource, `segments.conversion_action*`, `metrics.all_conversions*`, `metrics.view_through_conversions`, `metrics.conversions_from_interactions_rate`, `metrics.value_per_conversion`, `customer.conversion_tracking_setting`, per-action attribution model |
| click IDs | `click_view.gclid` (90-day window), `campaign.url_custom_parameters`, `campaign.tracking_url_template`, `ad_group_ad.ad.final_url_suffix` — **the last one is where the UTM/GCLID template lives** |
| UTM | no tracking template or `final_url_suffix` is read at any level, so we cannot verify Google ads stamp UTMs at all, and only `final_urls[0]` is stored |
| daily ad detail | `segments.date` omitted from the ad-level `SELECT` (see above) |
| segments | `ad_network_type`, `device`, `click_type`, `conversion_lag_bucket`, `geo_target_*`, `hour` |
| geo / audience | `geographic_view`, `user_location_view`, `location_view`, `audience`, `campaign_audience_view`, `age_range_view`, `gender_view` — DMA/ZIP reporting on Google has no source |
| assets / PMax | `asset`, `asset_group`, `asset_group_asset`, `asset_group_listing_group_filter`, `ad_group_ad_asset_view` — Performance Max is effectively unreadable |
| quality / competition | `metrics.search_top_impression_share`, `search_absolute_top_impression_share`, `search_budget_lost_impression_share`, `search_rank_lost_impression_share`, `auction_insight_*` |
| entity status detail | `campaign.serving_status`, `ad_group_ad.policy_summary` (approval verdicts), `campaign.experiment_type`, `campaign.start_date/end_date` |
| billing | `metrics.cost_micros` is read; `account_budget`, `billing_setup`, `customer.currency_code`, `customer.time_zone` are not — spend is stored with no currency attached |

### Broken for four months, reported as an error nobody read

| Client | Google status | Last sync | Last records |
| --- | --- | --- | --- |
| RRM | active | 2026-09-14 03:05 | 193 |
| **Billy.com** | error — "Google authorization expired. Reconnect Google Ads in Settings." | **2026-04-30 01:05** | 0 |
| **Sample Client** | error — same | **2026-04-30 01:05** | 0 |

Both tokens expired on 2026-04-30 and the refresh has failed on every run since. The handler does
the right thing — writes `status: error` and the message — and then nothing surfaces it: **137 days
of no Google data for Billy.com.** Treat this as the same class of defect as a mis-mapped field:
the sync ran, reported truthfully, and no one was told. There is no alert on
`platform_connections.status = 'error'`, and Meta's swallowed 401s (finding 4 above) mean the
inverse case — broken but green — also exists.

---

## 5. What this audit could not answer, and what would answer it

| Question | Blocked by | Read-only probe that answers it |
| --- | --- | --- |
| Google's true field menu, conversion actions, attribution model, whether `call_view` has rows | no diagnostic mode on `sync-google-ads`; developer token and OAuth tokens are server-side secrets | a `diagnose=1` branch that returns `GoogleAdsFieldService` metadata plus `SELECT` counts from `conversion_action`, `call_view`, `click_view` and writes nothing — mirroring the Ringba diagnostic that found 110 columns |
| Moja's real payload shape, pooling, click IDs | Moja has never delivered | register the webhook in Moja; the first delivery stores `raw_payload` and the menu is free |
| Whether Ringba's RTB columns carry data on any account | never requested | one `valueColumns` probe with the ring-tree columns, reading the response without upserting |
| Whether a GCLID is reaching Ringba via a landing-page tag | not read on either side | read `tag:PlacementInfo:*` and the `User` tag namespace in a diagnostic response |

## 6. Findings ranked

1. **Google captures no call data at all** — no `call_view`, no phone-call metrics, no call assets, no conversion-action names. On a pay-per-call framework, Google is currently spend-only.
2. **Meta's conversion defect is still live on RRM** — 487 leads on the API, 0 stored, on $4,417.97.
3. **Billy.com and Sample Client have had no Google data for 137 days** — reported correctly, surfaced nowhere.
4. **No GCLID / wbraid / gbraid anywhere** — the only viable Google↔call join key is uncaptured on both sides, while Ringba is already uploading conversions to Google.
5. **Google ad-level spend is stored window-aggregated, not daily** — single-window verdicts only; no ad-level trend, hold gate, or marginal return on Google.
6. **The Moja integration has never run** — the 34 rows are a seed, not traffic; zero webhook invocations ever.
7. **An invalid Meta token reports `status: active`** — DSW and all four Billy accounts are dead and green.
8. **Ringba's entire RTB / ring-tree column family is unrequested** — §2's RTB branch has no data source.
9. **`sync-ringba-calls-4js` still has the cost-as-revenue fallback pattern**, and `sync-ringba-calls` sends no `valueColumns`, so its `did` and payout-verdict columns are null in practice.
10. **Ringba `PlacementInfo` (landing page, placement, search term) and `noConversionReason` are unread** — a second attribution key and the downstream diagnostic we keep asking for.

Nothing in this pass changed code, schema, or data.

---

## Resolution — 2026-09-14: finding 2 (Meta conversion event)

**Fixed.** The sync no longer names any conversion event. Every `action_type` Meta returns is captured with its count and value, per entity, per date, into the new `media_brain_platform_conversions` table. The raw ad tables were not altered.

- **RRM's real event is `lead` — 489 in the last 30 days, $0 reported value**, alongside its aliases `onsite_web_lead`, `offsite_conversion.fb_pixel_lead` and `offsite_lead_add_20_s_calls` (identical counts — the same event under four names, which is exactly why summing is barred). Set `meta_conversion_event = 'lead'` on RRM's instance record and the count publishes; until then it reads UNKNOWN, not 0, against $4,462.59 of spend.
- **BuyologyIQ unchanged**: 140 tub / 120 bath on `ad_campaigns` over the trailing 30 days (previously 139 / 119 — one day of window roll), and its `RingbaConversion` breakdown holds 37 events / $2,710, matching the figure recorded at intake.
- **The decision-time count comes from `media_brain_instances.meta_conversion_event` only.** No instance record exists for any client yet, so every Media Brain conversion read currently states UNKNOWN and names what it blocks: the fragmentation check, cost per conversion, and any conversion-based read.
- The single legacy `conversions` column on `ad_campaigns` / `ad_sets` / `ad_creatives` still carries the pre-existing collapsed value for the older client dashboards, and only when no governing event is set. It is labelled in code as legacy dashboard compatibility. **No Media Brain figure reads it** — Media Brain reads the breakdown table. Removing that column's population is a separate decision about those dashboards.
- Each account's own event menu (Insights event names plus its defined custom conversions) is recorded on the platform connection, so intake offers the real list instead of free text.

Findings 1, 3–10 remain open.
