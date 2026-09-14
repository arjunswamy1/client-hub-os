# Moja webhook — delivery contract and test payloads

Send this file to Moja. It states the endpoint, where the shared secret goes, the exact
JSON we expect, the two test cases we need, and the fields we require that a default
call-tracking payload usually omits.

Client in question: **RRM / River Road Marketing** — `client_id = 4b2434db-6d47-4653-be34-313976790f9d`.

As of 2026-09-14 this endpoint has received **zero deliveries, ever**. The 34 call rows in
our database were seeded by hand on 2026-08-22 and carry no payload. Nothing has been
mis-parsed; nothing has been sent.

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

## 4b. The question your test fire raises

Your 2026-09-14 test substituted only `event`, `duration`, `zip_code`, `caller_id`,
`campaign_id`, `campaign_name`, `publisher_name`, `buyer_name` and `target_name`. These 22 came
back as literal macros:

`to`, `call_id`, `event_timestamp`, `call_start`, `tracking_number`, `inbound_duration`,
`converted`, `call_converted_at`, `answered`, `revenue`, `payout`, `no_payout_reason`,
`hangup_cause`, `number_pool`, `caller_state`, `utm_source`, `utm_medium`, `utm_campaign`,
`utm_content`, `utm_term`, `gclid`, `fbclid`.

We assume that is because a test fire has no real call to substitute from. **Please confirm
which of those 22 are populated on a real call.** If `call_id`, `payout`, `tracking_number`,
the UTMs and the click IDs are genuinely unavailable, then we cannot deduplicate deliveries,
cannot measure revenue, and cannot attribute below campaign level — so we need to know now
rather than infer it from data in a month. A single real, non-test delivery answers it.


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
| **`is_from_number_pool`** / `number_pool_name` | A pooled number rotates between visitors, so it identifies a campaign, not a creative. We must know which numbers are pooled before trusting any per-creative claim. | *(needs adding)* |
| **`duration` and `inbound_duration`** separately | Total versus connected talk time. Billable is judged on one of them and we must know which. | `duration_seconds`, `inbound_duration_seconds` |
| **`payout` and `revenue`** separately, plus `has_payout` and `no_payout_reason` | A zero payout with a stated reason is diagnosable; a zero with no reason is not. Never fold telco cost into the payout field. | `payout`, `revenue`, *(reason needs adding)* |
| **UTM tags** — `source`, `campaign`, `content`, `term` | Our only ad-level attribution key where numbers are pooled. | `utm_*` |
| **Click IDs** — `gclid`, `wbraid`, `gbraid`, `fbclid`, `msclkid` | The reliable join to ad-platform spend, better than UTM. Please pass through whatever the landing page captured. | *(needs adding)* |
| **`buyer_name` / `target_name`** | Buyer-down diagnosis; a routing problem is not a media problem. | `buyer_name`, `target_name` |
| **`campaign_id`** as well as the name | Names get edited, ids do not. | `campaign_id` |
| **`event` / `event_type`** | Tells us whether this is a per-call or conversion-only feed. | `event_type` |

## 6. What we do with the first delivery

We record, for every receipt: the timestamp, the resolved client, the validation result,
your `delivery_id`, and **the list of field names** in the payload — never the values, and
never the secret. That field list is how we confirm the real contract on delivery one
rather than reverse-engineering it from data weeks later. Call details are stored only on a
successfully authenticated delivery.
