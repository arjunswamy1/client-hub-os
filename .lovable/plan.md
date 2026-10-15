Cannaball 14 Oct 2026 (ET) — read-only verification findings

Nothing was changed. The required build_log row is not written yet because this turn was read-only. Approving this plan writes only that one row.

1. Calls (cannaball_calls, 14 Oct 04:00 UTC to 15 Oct 04:00 UTC)
- DID 8889653087: 58 calls, 47 connected, $1,210.15 payout. This matches the hub.
- No other DID is counted as universal_ads. 8889653087 is the only number with a universal_ads period (from 30 Aug, open-ended).
- Roku numbers that day: 8884489081 (47 calls, 34 connected, $844.55), 8885696370 (4, 0, $0), 8888660956 (1, 1, $32.00).

2. Universal spend
- Source: one cannaball_spend row with platform universal_ads, campaign "Cannaball Final Expense V2", creative/ad set "Final Expense $6.74" (ad set 06756162…), date 2026-10-14, reported in America/New_York.
- When first read: $512.62 (72,778 impressions), which matches the hub. A sync at 01:00 UTC then raised it to $554.52 (78,807 impressions).
- No overlap with Roku: the four Roku rows in cannaball_spend total $535.74, the same as roku_daily_metrics (4 campaign rows, $535.74). The universal_ads row is the only non-Roku row, and universal_geo has no rows for that day. The revision log confirms it: cannaball_spend total $1,090.26 = Roku $535.74 + Universal $554.52.

3. Is it final?
- No, it is still partial. The spend went up during this check, and the campaign had been running for less than a full day. The day is not closed while Universal is still revising every 15 minutes.
- Last Universal update was at 01:00:11 UTC on 15 Oct (8:00 pm CT on 14 Oct). platform_connections_safe has no last_synced_at value for universal_ads (it is null), so the row's updated_at time and the revision log are the only record of syncs. Roku last synced at 00:45 UTC.

Result: calls, connected calls and payout match exactly. Spend matched at $512.62 when first read and is now $554.52, provisional.

On approval: write one build_log row (read-only verification, no data changes, open question: universal_ads has no last_synced_at in platform connections).
