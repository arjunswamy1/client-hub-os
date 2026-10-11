# Spektrafin RingFuel call detail: findings and fix plan

## What the data shows (checked 11 Oct)

- Calls since 22 Sept: 16,372 real calls. Only 3 have campaign or buyer, 0 have a tracking number or caller number, 3 have an end reason, and 2 have a connected duration.
- Raw payloads stored for calls since 22 Sept hold only five fields: call id, duration, payout, state, revenue. RingFuel never sent campaign, buyer, tracking number, caller, end reason or connected duration. Our mapping did not drop them.
- Before 22 Sept, the detail (Campaign, Buyer, Dialed Number, Caller Number, End Reason, End Call Source, connected_call_length, is_repeat_caller and more) came only from CSV exports loaded on top of the thin webhook rows. The last full export (14 Sept) and earlier loads cover up to about 21 Sept.
- The 10 Oct correction carried only revenue, not the other fields.
- The "connected" flag is filled on every post-22 Sept row, but the source sent no connection field. That value can't be trusted.
- About 1 in 5 recent calls still shows $0 revenue (e.g. 145 of 799 on 9 Oct). These calls are flagged "revenue captured" because the call-end event carries `revenue: 0` before any conversion.
- Spend: Spektrafin's Roku rows since 22 Sept have impressions on only 35 of 108 rows; the rest show zero. Universal (Cannaball spend table) has impressions on 20 of 48 rows. Calls per 1,000 impressions can be computed only on days with impressions, and must be withheld on the others.

## Root cause

This was not a payload or mapping change on our side. The RingFuel webhook template for Spektrafin has only ever sent the five thin fields. Before 22 Sept, the detail came from CSV exports. When those stopped, the detail stopped. Not yet confirmed: whether someone also trimmed the RingFuel template around then. That can only be checked in RingFuel's settings.

## What RingFuel can and can't provide

- **Webhook:** sends only the fields in its template. Adding RingFuel's template tokens (campaign, buyer/target, dialed number, caller number, end reason, end call source, connected call length, converted, revenue) would make every call arrive complete. This needs someone with RingFuel access. The webhook only fires on call events, so late conversions arrive only if RingFuel has a "conversion/revenue updated" event that we also subscribe to.
- **CSV export:** carries every field we need, including End Reason and connected_call_length. Available today; manual.
- **API:** the hub already uses RingFuel's API key for number minting. Whether that key can read call logs (and revenue updated after the call) has to be confirmed against RingFuel's API docs before we rely on it.

## Proposed changes

1. **Webhook fields (RingFuel side, AJ or Spektrafin):** add the missing tokens to the Spektrafin webhook template, plus a second event for conversion/revenue updates if RingFuel offers one. The hub mapping already recognises these field names, so no mapping change is needed.
2. **Scheduled reconciliation (hub side):** a Spektrafin-only daily job that pulls the last 7 days of calls from the RingFuel API (if the key allows), or else imports a dropped CSV export. It enriches existing rows through the existing merge function, which never blanks a stored value.
3. **Strict connected:** new fields `end_reason`, `end_call_source` and `strict_connected`. The strict-connected rule lives in one pure helper: connected duration > 0 **and** the end reason is not target no-answer, no answer from any target, SIP 486/487/180/183/503, caller hang-up before connect, or caller abandoned while ringing. When end reason is missing, strict connected is **unknown**, never false. The current "connected" flag stops counting for Spektrafin wherever no connection field arrived.
4. **Duration metrics:** average and median connected call length, and the share of calls at 90s, 10m, 20m and 30m+. Computed only over calls with a connected duration; withheld when coverage is missing.
5. **Caller metrics:** unique callers and repeat-call rate from caller number. Withheld for days without caller numbers.
6. **Late revenue:** a webhook `revenue: 0` with no converted flag no longer counts as settled. New `revenue_settled_at`: revenue for a call stays provisional until a reconciliation pass (API or CSV) has confirmed it, or for 7 days after the call. Spektrafin day totals show revenue as provisional until every call in the day is settled. The daily update and the hub tools label it that way.
7. **Calls per 1,000 impressions:** computed per day only where impressions > 0, otherwise withheld with a reason ("spend source reported no impressions").

## Backfill

- **22 Sept to now:** one full RingFuel CSV export (all columns) covering 22 Sept onwards. Re-run through the existing import, which enriches each call in place and adds no duplicates. That restores campaign, buyer, tracking number, caller, end reason, connected duration and final revenue wherever the export has them.
- Recompute strict connected for those rows and mark revenue settled.
- Days the export can't cover stay unknown and withheld, never zero.

## Tests

- Strict connected: each excluded end reason gives not connected; a positive duration with an excluded reason gives not connected; a missing end reason gives unknown.
- A webhook row with $0 revenue and no converted flag is provisional, not settled. After a reconciliation it becomes settled with the corrected revenue.
- The CSV merge never blanks a stored campaign, buyer or tracking number.
- Duration buckets and median on a fixed sample; withheld when coverage is missing.
- Unique callers and repeat rate on a fixed sample; withheld without caller numbers.
- Calls per 1,000 impressions withheld on zero-impression days.
- Other clients' ingestion is unchanged (only the Spektrafin code path is touched).

## Technical details

- Additive migration on `ringfuel_calls`: `end_reason text`, `end_call_source text`, `strict_connected boolean` (null = unknown), `revenue_settled_at timestamptz`. `ringfuel_merge_call` is extended to accept them without overwriting non-null values.
- Pure rules in a new `_shared/ringfuel-call-rules.ts` (strict connected, settled vs provisional); `client-metrics.ts` consumes them only when the client's call table is `ringfuel_calls`.
- New `ringfuel-reconcile` function: Spektrafin only, nonce/service auth, dry-run mode, schedule left disabled until AJ approves.
- `ringfuel_calls` is a sync-owned call table. Every write goes through the existing merge path, which is the sync itself. No direct edits.

## Needs AJ

1. Can someone with RingFuel access add the missing webhook fields and a conversion-update event? Or should we rely on the daily export/API pull?
2. Please send a full RingFuel export from 22 Sept to today for the backfill.
3. Confirm the 7-day window before unconfirmed revenue counts as settled.
4. Roku shows zero impressions on most Spektrafin days since 22 Sept. Should we look into the Roku impressions sync separately?
