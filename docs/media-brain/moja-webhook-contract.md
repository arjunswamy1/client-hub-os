# Moja webhook — delivery contract and test payloads

Send this file to Moja. It states the endpoint, where the shared secret goes, the exact
JSON we expect, the two test cases we need, and the fields we require that a default
call-tracking payload usually omits.

Client in question: **RRM / River Road Marketing** — `client_id = 4b2434db-6d47-4653-be34-313976790f9d`.

As of 2026-09-14 12:39 UTC this endpoint has received **exactly one delivery**: your test fire.
It authenticated and was accepted. It is retained as evidence and flagged as a test, so it never
enters a report. The 34 other call rows were seeded by hand on 2026-08-22 and carry no payload.
No real call has ever been delivered.

---

## 1. Endpoint

```
POST https://bmwjwsxfpzzruitevnmx.supabase.co/functions/v1/moja-webhook?client_id=4b2434db-6d47-4653-be34-313976790f9d
Content-Type: application/json
x-moja-secret: <SHARED SECRET — supplied separately, never in this file>
```

The shared secret may be sent any of three ways, in this order of preference:

1. Header `x-moja-secret: <secret>` — **preferred.**
2. Header `Authorization: Bearer <secret>`.
3. Query parameter `?secret=<secret>` (or `?moja_auth_key=<secret>`) — only if your webhook
   UI cannot set headers. Secrets in URLs end up in logs at both ends; avoid if possible.

`client_id` is required and must be that exact UUID. Optional overrides, only if your
campaign names do not identify the service line: `&service_line=windows|plumbing` and
`&platform=meta|google`.

## 2. Responses

| Situation | HTTP | Body |
|---|---|---|
| Accepted and stored | `200` | `{"ok":true,"call_id":"...","client_id":"...","service_line":"windows","platform":"meta"}` |
| Wrong or missing secret | `401` | `{"error":"Unauthorized"}` |
| Body not parseable | `400` | `{"error":"Invalid body","details":"..."}` |
| `client_id` missing/malformed | `400` | `{"error":"Missing or invalid client_id query parameter"}` |
| Our storage failed | `500` | `{"error":"DB insert failed","details":"..."}` |

Every one of those outcomes — including the `401` — is now recorded on our side with a
timestamp and the list of field names your payload carried. A misconfigured delivery is
visible to us immediately; it no longer looks identical to no delivery at all. Retry on
`5xx`; do not retry on `400`/`401` (fix the configuration instead).

## 2b. Payload shape

**The flat shape is primary** — every field at the top level, which is what your test fire on
2026-09-14 sent. We also still accept a nested `{"call": {…}, "tags": {…}}` shape; we detect it
by the presence of a top-level `call` object. Either is fine; do not change what you already send.

Three rules that matter on our side:

- **Unreplaced macros are discarded.** Any value matching `[SOMETHING]` — e.g. `"[TRACKING_NUMBER]"`
  — is stored as empty, never as text, and the field is named in our receipt log. Your test fire
  substituted 9 of 31 fields; the other 22 arrived as bare macros. That list is the single most
  useful thing you can help us confirm (see §4b).
- **`call_id` is required.** A delivery without it is accepted, logged and **not stored** — we
  cannot deduplicate it, and duplicate call rows would corrupt every figure. Your test fire sent
  `"[CALL_ID]"`, so it produced a receipt but no usable call.
- **Timestamps are read as UTC unless the value carries an offset.** `"2026-09-14T15:04:11Z"` and
  `"2026-09-14T11:04:11-04:00"` are unambiguous; a bare `"2026-09-14 15:04:11"` is taken as UTC.
  Please send an offset or a `Z`.

`call_start` is used as sent. If it is absent we derive it on a `call.completed` as
`event_timestamp − inbound_duration`. If neither is available we leave it empty rather than
guessing — a guessed timestamp files a call into the wrong reporting week silently.

## 2c. `payout` vs `revenue` — please keep them separate

- **`payout`** = what the publisher (us) is paid. This is our revenue and the only figure that
  decides whether media is profitable.
- **`revenue`** = what the buyer paid you. Informational to us.

Never fold telco/carrier cost into `payout`. We have been burned by exactly that on another
provider, where a $0.07 carrier cost was recorded as revenue.

## 3. Test payload A — a **converting** call (flat shape)

```json
{
  "event": "call.converted",
  "delivery_id": "test-delivery-0001",
  "call_id": "MOJA-TEST-CONVERTED-0001",
  "event_timestamp": "2026-09-14T15:06:38Z",
  "call_start": "2026-09-14T15:04:11Z",
  "converted": true,
  "call_converted_at": "2026-09-14T15:06:38Z",
  "duration": 412,
  "inbound_duration": 431,
  "answered": true,
  "disposition": "converted",
  "revenue": 145.00,
  "payout": 95.00,
  "no_payout_reason": null,
  "hangup_cause": "caller_hangup",
  "campaign_id": "cmp_9931",
  "campaign_name": "RRM - Windows - Meta - Prospecting",
  "publisher_name": "Connect Paid Media",
  "buyer_name": "River Road Windows",
  "target_name": "RRW Main Queue",
  "to": "+15055550142",
  "tracking_number": "+15055550142",
  "number_pool": null,
  "caller_id": "+15055559987",
  "caller_state": "NM",
  "zip_code": "87109",
  "recording_url": "https://example.moja.ai/recordings/test-0001.mp3",
  "utm_source": "facebook",
  "utm_medium": "paid_social",
  "utm_campaign": "120210000000000001",
  "utm_content": "120210000000000009",
  "utm_term": "120210000000000007",
  "gclid": null,
  "fbclid": "IwAR-test-fbclid-0001"
}
```

## 4. Test payload B — a call that **connected and ended without converting**

This one matters more than the first. Send it exactly as your system would fire it for a
real non-converting call. If your platform has no event for this case, say so plainly —
that answer is the information we need.

```json
{
  "event": "call.completed",
  "delivery_id": "test-delivery-0002",
  "call_id": "MOJA-TEST-NOTCONVERTED-0002",
  "event_timestamp": "2026-09-14T15:22:50Z",
  "call_start": "2026-09-14T15:22:03Z",
  "converted": false,
  "call_converted_at": null,
  "duration": 47,
  "inbound_duration": 61,
  "answered": true,
  "disposition": "buyer_hangup",
  "revenue": 0,
  "payout": 0,
  "no_payout_reason": "duration_below_threshold",
  "hangup_cause": "buyer_hangup",
  "campaign_id": "cmp_9931",
  "campaign_name": "RRM - Windows - Meta - Prospecting",
  "publisher_name": "Connect Paid Media",
  "buyer_name": "River Road Windows",
  "target_name": "RRW Main Queue",
  "to": "+15055550142",
  "tracking_number": "+15055550142",
  "number_pool": null,
  "caller_id": "+15055551122",
  "caller_state": "NM",
  "zip_code": "87114",
  "recording_url": null,
  "utm_source": "facebook",
  "utm_medium": "paid_social",
  "utm_campaign": "120210000000000001",
  "utm_content": "120210000000000009",
  "utm_term": "120210000000000007",
  "gclid": null,
  "fbclid": "IwAR-test-fbclid-0002"
}
```

## 4b. Confirmed macro list (Moja, 2026-09-14) — and what it settles

Moja has confirmed the outgoing webhook macro list. This section replaces the earlier
question about the test fire.

**Confirmed available.** `[CALL_ID]`, `[TO]` (the tracking number dialled), `[CALLER_ID]`,
`[DURATION]` (described as **connected** duration), `[INBOUND_DURATION]`,
`[PUBLISHER_PAID_OUT]` (publisher payout), `[CONVERTED]`, `[EVENT_TIMESTAMP]`,
`[CALL_CONVERTED_AT]`, `[UTM_SOURCE]`.

**Confirmed NOT available.** `gclid` and `fbclid` — there is no built-in macro for either.
They must be populated as **custom tags**, from the landing page or an incoming webhook, and
then referenced in the template.

**The 2026-09-14 test fire returned eight of the confirmed macros as unreplaced literals.**
Because Moja states those macros exist, the non-substitution is a **test-mode artifact, not a
missing macro**: a test fire has no real call to substitute from. The template field names are
correct and a real call should populate them. *Any earlier note in this document implying
those tags may not exist was wrong — do not read the test fire as evidence of absence.*

**What that settles, and what it costs.** With no `gclid`/`fbclid` macro and only
`[UTM_SOURCE]` among the UTMs, the delivered payload carries **no click-level key**. Tracking
numbers are the only other candidate and we do not yet know whether they are pooled. So on
current evidence River Road tops out at **campaign level**: ad-level attribution is
*unavailable*, not merely low-coverage, and no amount of number mapping changes that. Our
receiver now stores every unmapped field in a `custom_tags` bag and reads `gclid`, `fbclid`,
`wbraid`, `gbraid`, `msclkid` and the UTMs from **either** a top-level field **or** that bag,
so the moment a click key starts arriving by any mechanism it is picked up with no further
work on our side.

**On the two durations.** We store `[DURATION]` and `[INBOUND_DURATION]` separately and
exactly as delivered, under names that say which macro they came from. We do **not** infer the
connection state from either one: `connected` is taken from an `answered` field alone, and is
recorded as *unknown* when that field is absent. Which duration the billable threshold applies
to is recorded as UNKNOWN for River Road, and that unknown blocks the billable count, cost per
billable call, billable rate and every threshold derived from them until question 2 below is
answered.

## 4c. River Road configuration recorded 2026-09-14 (confirmed by AJ Swamy)

**Campaign → vertical.** Moja campaign `Internal Plumbing` → vertical `plumbing`; `Internal Windows` → vertical `windows`.

**Publisher scoping.** Both campaigns are dedicated to CPM traffic only, so
`{publisher_scoping} = not_required_dedicated_campaigns` and the pull proceeds without a
publisher filter. This is a dated, attributed decision — not an absent answer — and it carries
two safety nets: it is flagged for re-check after 30 days, and if more than one distinct
publisher ever appears on a call for either campaign the read reports the dedicated-campaign
claim as contradicted by the data and names the publishers being counted. Any client whose
scoping is still `unknown` continues to stop the pull.

**Platform.** Read from `utm_source` alone — `facebook`/`fb`/`meta` → Meta,
`google`/`adwords` → Google, anything else or absent → `unclassified` and shown as its own
row. The webhook's old keyword guess from the campaign name has been removed from the platform
decision path entirely, so there is exactly one rule.

**Ad side, recorded as an UNKNOWN.** River Road's live ads carry no UTM parameters in their
final URLs (Google `homepromatch.net/plumbing`, 16 ads, $5,611.62; Meta
`homepromatch.net/windows`, 5 ads, $2,012.70; `yourhomeservicespros.com`, 60 Google ads,
$2,077.37 — all bare). But Google UTMs commonly live in the account tracking template or
`final_url_suffix` and Meta's in `creative{url_tags}`, and **our syncs capture none of those
three fields**. So "no UTMs in the final URL" is what we can see, not proof that none are
stamped at click time. Recorded as the `ad_side_utm_capture` UNKNOWN; capturing those fields is
on the sync backlog. Separately, the $0.00-spend Final Expense campaigns in the same synced
account are a scoping risk for any window covering their active period.

The landing-page work that would close the click-ID gap is specified in
`homepromatch-clickid-proposal.md` — written for the site owner, not applied.

### Questions we still need a human answer to

1. **Are `utm_campaign`, `utm_content`, `utm_term` and `utm_medium` available as macros, or is
   `[UTM_SOURCE]` the only one?** `utm_content` is the ad-level key; its absence is precisely
   what caps attribution at campaign level.
2. **Which of `[DURATION]` and `[INBOUND_DURATION]` is talk time with the buyer, and which
   includes ring time? Which one does the buyer's billable threshold apply to?** If inbound
   duration counts ring time, treating it as connected time would mark unanswered calls as
   connected and corrupt every downstream diagnostic.
3. **Is there a macro for publisher / traffic source, no-payout reason, hangup cause, number
   pool membership, and `answered`?** All five were in our template but absent from the
   confirmed list. Publisher is the one we cannot manage without: a tracking campaign receives
   calls from every source pointed at it, and without it every margin figure silently includes
   traffic we did not buy.
4. **Are the tracking numbers pooled or statically assigned per campaign?** A pooled number
   rotates between visitors, so it identifies a campaign and never a creative.
5. **Exactly how are custom tags populated** — via the incoming `call_data` webhook, URL
   parameters on the number request, or a JavaScript snippet on the landing page? This is the
   route by which `gclid` and `fbclid` would reach us, so the mechanics matter.



## 4d. Click-key readiness — how the test call is read (added 2026-09-14)

`homepromatch.net` now captures click IDs and UTMs and attaches them to the call-tracking
script (site owner, unverified by a live delivery). The receipt panel on DAILY no longer
asks the operator to eyeball a field list; it publishes a **verdict per key** for the ten
names in `homepromatch-clickid-proposal.md`, read from the top level of the payload **or**
the custom-tag bag, and one headline stating whether any **ad-level** key arrived.

Four states, because three different failures otherwise collapse into "missing":

| State | What it means | The fix |
| --- | --- | --- |
| arrived with a value | the key carries real data (value shown) | nothing — done |
| unreplaced `[MACRO]` literal | the template references a name Moja did not substitute | ask Moja what syntax references a **custom tag** in an outgoing webhook template |
| absent from the payload | the template does not reference it at all | add the field name to the Moja webhook payload template |
| not expected | this client is not configured to send it | not a defect |

`utm_campaign` is deliberately **not** an ad-level key: it names a campaign, and a
campaign-level key can never carry a per-ad verdict.

Our working inference, recorded as an inference: AJ's template already carries
`"gclid": "[GCLID]"`, which returned as a literal on the test fire. Once the landing page
supplies a custom tag of that name the same reference may resolve, in which case **no
template change is needed**. Moja has not confirmed that. Only `[UTM_SOURCE]` is a
confirmed system macro, so `utm_campaign`, `utm_content`, `utm_term` and `utm_medium` face
the same custom-tag question — `utm_content` most of all, since it is the ad-level key.

**A macro literal is never data.** `[GCLID]` no longer passes through string coercion in
the adapter, and is not counted as a click key by the mapping screen; a template
placeholder must never make a client look ad-level-capable.

**Evidence clears its own UNKNOWN.** When a receipt carries an ad-level key with a real
value, the webhook stamps `click_key_evidence_at` / `click_key_evidence_field` on the sync
status detail and removes `ad_side_utm_capture` from that client's economics
`unknown_fields`, replacing the ad-level-unavailable flag with a dated note of the key
observed. The stamp is first-seen and is carried forward: a later receipt without a key
never erases it.

**Unavailable and 0% are different diagnoses.** The mappings screen derives the ceiling
from the window every time — whether any call carries a click key or `utm_content`. No key
anywhere means *unavailable* (no mapping can fix it). A key present with nothing joining
means *0% coverage*, and the fault is the join: the delivered value does not match a synced
ad id or name.


### Why B decides the whole integration

If Moja only fires on conversion, we never learn the total call count or the connected
count. Without those two denominators we cannot compute revenue per call, cost per call,
connection rate or billable rate — the only figures that decide whether media is
profitable. A conversion-only feed reduces us to counting conversions, which cannot
distinguish a campaign generating 20 calls with 5 conversions from one generating 200 with
5. So: **we need an event on every call, converted or not.** If that is configurable, turn
it on. If it is not, tell us and we will pull a per-call report instead.

## 5. Fields we need that a default payload often omits

Please confirm each of these is included, or tell us the field name you use.

| What we need | Why | Our column |
|---|---|---|
| **`publisher_name`** / traffic source | We must exclude other buyers' traffic from our margin. Without it every figure includes calls we did not pay for. This has already produced one badly wrong read on another account. | `publisher_name` |
| **`tracking_number`** — the number *dialed*, distinct from the caller | Our only per-campaign key. It must be the tracking DID, not the caller's ANI; another provider conflated the two and it took a full audit to find. | `tracking_number` |
| **`caller_id`** — the caller's own number | Kept separately, never used as the tracking number. | `caller_number` |
| **`is_from_number_pool`** / `number_pool_name` | A pooled number rotates between visitors, so it identifies a campaign, not a creative. We must know which numbers are pooled before trusting any per-creative claim. | `number_pool` |
| **`duration` and `inbound_duration`** separately | Total versus connected talk time. Billable is judged on one of them and we must know which. | `duration_seconds`, `inbound_duration_seconds` |
| **`payout` and `revenue`** separately, plus `has_payout` and `no_payout_reason` | A zero payout with a stated reason is diagnosable; a zero with no reason is not. Never fold telco cost into the payout field. | `payout`, `revenue`, `no_payout_reason` |
| **UTM tags** — `source`, `campaign`, `content`, `term` | Our only ad-level attribution key where numbers are pooled. | `utm_*` |
| **Click IDs** — `gclid`, `wbraid`, `gbraid`, `fbclid`, `msclkid` | The reliable join to ad-platform spend, better than UTM. Please pass through whatever the landing page captured. | `gclid`, `fbclid` |
| **`buyer_name` / `target_name`** | Buyer-down diagnosis; a routing problem is not a media problem. | `buyer_name`, `target_name` |
| **`campaign_id`** as well as the name | Names get edited, ids do not. | `campaign_id` |
| **`event` / `event_type`** | Tells us whether this is a per-call or conversion-only feed. | `event_type` |

## 6. What we do with the first delivery

We record, for every receipt: the timestamp, the resolved client, the validation result,
your `delivery_id`, and **the list of field names** in the payload — never the values, and
never the secret. That field list is how we confirm the real contract on delivery one
rather than reverse-engineering it from data weeks later. Call details are stored only on a
successfully authenticated delivery.
