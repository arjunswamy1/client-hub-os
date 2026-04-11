---
name: Billy.com dashboard vertical logic
description: Billy dashboard — vertical filtering, 4-step funnel, Ringba attribution, AI insights, trend analysis
type: feature
---

## Architecture
- Verticals configured in `src/config/billyVerticals.ts` with per-platform patterns + account IDs
- `matchesVertical()` does case-insensitive contains (or exactMatch for pest control ringba)
- `matchesVerticalAccount()` for account ID scoping
- Campaign data filtered client-side from single `ad_campaigns` table

## Hooks
- `useBillyData.ts` — useVerticalKPIs, useVerticalCampaigns, useVerticalDailyTrends
- `useRingbaData.ts` — useRingbaRevenue (all calls by vertical)
- `useRingbaByPlatform.ts` — platform-attributed Ringba calls (direct UTM first, spend-proportional fallback)
- `useBillyDailyTrends.ts` — full funnel daily rows with day-over-day deltas

## Dashboard Tabs
1. Revenue Engine — 4-step lead-gen funnel (Traffic → LP → Calls → Monetization)
2. Daily Trends — trend charts, alert system, AI insights, daily table with step tabs
3. Trend Analysis — weekly/monthly aggregated performance
4. Meta Ads — 8 KPI cards with Ringba attribution + campaign table (active only)
5. Google Ads — 8 KPI cards with Ringba attribution + campaign table

## Edge Functions
- `billy-daily-insights` — AI insights via Lovable AI Gateway (gemini-3-flash-preview)
- `sync-ringba-calls` — bulk sync filtered to CPM publisher + allowed campaigns

## Verticals
- Flights: campaign name contains "Flight"
- Porta Potties: contains "Porta"/"Potty", Google account 1939246766
- Pest Control: contains "Pest"/"Bed Bug", Meta accounts scoped, Ringba uses exactMatch
