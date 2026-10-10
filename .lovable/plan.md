# Cannaball reporting fixes (Grokbot issue report, 10 Oct)

## Findings

**Issue 1: spend double-counted (confirmed).** Cannaball's spend is configured to add up two tables: `roku_daily_metrics` and `cannaball_spend`. But `cannaball_spend` also holds `platform='roku'` rows that copy Roku exactly.
- On 10/1 there is one Roku row of $2,072.22 in each table. On 9/29 each table holds $2,403.43 across 3 rows. The hub adds them together.
- `cannaball_spend` has 357 Roku rows from 25 Jun to 10 Oct. Every one of those days also exists in `roku_daily_metrics`, so no Roku spend lives only in `cannaball_spend`.
- The doubling therefore goes back to June, not just late September. It was easier to spot once Universal stopped on 9/23, because Roku then made up all of the spend.
- The changing row count per day is real Roku campaign detail and is not a separate problem.
- The 9/29 spend AJ shared ($2,087.72) is lower than either table's Roku total ($2,403.43). That gap needs AJ to say which figure is right. It is not something deduping fixes.

**Issue 2: comparison reads fewer calls (likely cause, still to confirm).** The comparison loads 28 days of calls in one go, and the hub pulls those in pages of rows. The call read pages with `.range()` but no sort order, so the database can return overlapping pages, which drops some calls and repeats others. A single-day read fits in one page, which is why `get_performance` is correct. Step 1 below confirms this before any change.

**Issue 3: no scope events recorded.** Nothing writes a scope event when a spend source stops or restarts. `client_scope_events` is only filled in by hand, and none were ever entered for Cannaball.

**Issue 4: conflicting provisional flags (not yet diagnosed).** Single-day reads, the 30-day read and data health each decide "provisional" with different rules. Diagnosis is step 1 of that fix.

## Fix plan

1. **Spend source of truth.** Roku spend comes only from `roku_daily_metrics`. Cannaball reads `cannaball_spend` for `universal_ads` only. This is a filter on how the hub reads spend; no stored rows are deleted or changed. Then re-check 9/10 to 10/9 and list each day's spend before and after.
2. **Duplicate check in data health.** For each client, flag days where two spend sources report the same platform and amount for the same day, or where a single source has repeated rows. Shown in `get_data_health` and on the Data Health page.
3. **Stable call paging.** First reproduce the 10/9 gap (40 vs 129 calls). Then add a stable sort order to every paged read in the shared metrics code, and test that 1-day, 28-day and 30-day reads agree day by day.
4. **Pause/restart detection.** A daily check records a proposed scope event when a spend source goes from spend to $0 for 2 or more weekdays, or back again. It would backfill 9/23 (Universal paused) and 10/9 (restarted). The comparison layer already treats scope events as breaks in the comparison.
5. **Provisional flags.** Trace each of the three rules, then make all three use the single provisional rule that already exists, so they agree. Add a test.
6. **After the fixes.** Rerun the 9/29, 10/2 and 10/9 figures with the comparisons and send them to AJ.

## Technical details
- Spend filter: a new client setting, for example a per-source platform filter on Cannaball's spend sources, so the hub reads Universal only from `cannaball_spend`, instead of writing the rule in code for this one client.
- Paging: `client-metrics.ts` `fetchAll` calls need `.order('id')`, or the date column plus `id`.
- Scope events are written only by the new detector, marked as auto-detected, and can be edited by a person.
- Tests added for the dedupe, paging consistency, the scope detector and provisional agreement. A `build_log` row is written at the end.

## Needs AJ
- Was $2,087.72 for 9/29 net of a credit or fee, or a different date range?
- Should auto-detected pause/restart events count straight away, or wait for someone to approve them?
