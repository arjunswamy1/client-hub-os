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

Follow-up — the "missing" second Universal ad set (read-only)

- The second ad set is not missing. Its spend has been merged into the same row as the first. The sync combines API rows that share the same date, campaign name and ad name ("Final Expense $6.74"). It adds their spend and impressions together but keeps only the first row's details.
- Evidence: the 14 Oct row reads $554.52 in total, yet its stored details show ad set 06756162 with only $138.18. So other API rows (the other ad set, or several pieces of the day) were added into it. On 12–13 Oct the stored ad set is 4d99c2d9 ($48.73, $227.14). On 14 Oct the stored ad set is 06756162. That is two different ad set IDs in the same campaign (82a2d652), both named "Final Expense $6.74".
- Other tables: ad_campaigns, ad_sets and universal_ads_geo_metrics have no Universal rows for Cannaball over 10–14 Oct. The latest geo report jobs wrote 0 rows.
- The sync does not filter by ad set, campaign or status. It pulls every ad-level row for the ad account and drops only rows with zero spend and zero impressions. A new ad set is therefore included, but its spend is merged with any other ad set that has the same ad name.
- Last pull: 01:00:11 UTC 15 Oct. It rewrote the 12, 13 and 14 Oct rows and gave $554.52 for 14 Oct. The per-ad-set split cannot be recovered from the database because only the first part's details are kept.
- Total spend is not lost. The split between the two ad sets is. A possible fix (not done): include the ad set ID when combining rows, so each ad set gets its own row.
