---
name: Billy.com dashboard vertical logic
description: Billy dashboard — vertical filtering, 4-step funnel, Ringba attribution, AI insights, trend analysis, drill-down tables, creative reporting, QS audit, agent APIs, cross-platform view
type: feature
---

## Architecture
- Verticals configured in `src/config/billyVerticals.ts` with per-platform patterns + account IDs
- `matchesVertical()` does case-insensitive contains (or exactMatch for pest control ringba)
- `matchesVerticalAccount()` for account ID scoping
- Campaign data filtered client-side from single `ad_campaigns` table
- CampaignRow interface includes bidStrategyDetails + accountId fields

## Hooks
- `useBillyData.ts` — useVerticalKPIs, useVerticalCampaigns (shows all statuses, up to 30 campaigns), useVerticalDailyTrends
- `useRingbaData.ts` — useRingbaRevenue (all calls by vertical)
- `useRingbaByPlatform.ts` — platform-attributed Ringba calls (direct UTM first, spend-proportional fallback)
- `useBillyDailyTrends.ts` — full funnel daily rows with day-over-day deltas
- `useDrillDown.ts` — useCampaignAdSets, useAdGroupKeywords, useSearchTerms, useAdSetAds
- `useCreativeReporting.ts` — useCreativePerformance, useFormatComparison, useFatigueAlerts
- `useQualityScoreAudit.ts` — useQualityScoreData, useQSAuditRecommendations

## Dashboard Tabs
1. Revenue Engine — 4-step lead-gen funnel (Traffic → LP → Calls → Monetization)
2. Cross-Platform — blended KPIs, platform comparison cards, budget split insights, ROAS gap detection
3. Daily Trends — trend charts, alert system, AI insights, daily table with step tabs
4. Trend Analysis — weekly/monthly aggregated performance
5. Meta Ads — 12 KPI cards (incl ROAS, profit, CPM), creative reporting, drill-down table
6. Google Ads — 12 KPI cards (incl ROAS, profit, CPM), QS audit, drill-down table

## Drill-Down Table Features
- Campaign search/filter (name, type, strategy)
- Show/hide paused campaigns toggle
- Sortable columns (spend, clicks, impressions, conversions, CPC, CTR, ROAS, IS%, CPA)
- Totals row at top
- Budget pacing indicator (daily budget vs actual spend with progress bar)
- Status badges with play/pause icons
- CSV export
- Negative keyword badges in keyword rows
- Bid strategy popover with details (Max CPC, Target CPA, Target ROAS)

## Drill-Down Hierarchy
- Google: Campaign → Ad Group → Keyword (w/ QS, negative badge) → Search Term
- Meta: Campaign → Ad Set → Ad (with creative thumbnails)
- Google ad groups have "SQR" button for search query reports
- Bid strategy popover with details (Max CPC, Target CPA, Target ROAS)

## Creative Reporting (Meta only)
- Top Creatives tab: sorted by spend, with thumbnails and video views
- Format Comparison tab: aggregated by Video/Static/Carousel
- Fatigue Alerts tab: high frequency (>3.0) flagged ads

## Quality Score Audit (Google only)
- QS distribution overview card (good/fair/poor + wasted spend)
- Low-QS keyword table sorted by spend
- AI-powered recommendations via `quality-score-audit` edge function
- CSV export of audit data

## Edge Functions
- `billy-daily-insights` — AI insights via Lovable AI Gateway (gemini-3-flash-preview)
- `sync-ringba-calls` — bulk sync filtered to CPM publisher + allowed campaigns
- `quality-score-audit` — AI QS optimization recs (gemini-2.5-flash)
- `campaign-recommendations` — full optimization analysis for AI agents (analyze/list/resolve actions)

## AI Agent API (campaign-recommendations)
- `action: "analyze"` — runs full campaign analysis, stores recs in `ai_optimization_recommendations` table
- `action: "list"` — returns stored recommendations
- `action: "resolve"` — marks recommendation as resolved
- Internal-only, service-role auth

## DB Tables
- `ad_sets` — ad group/ad set level data
- `search_terms` — Google search term reports
- `ai_optimization_recommendations` — stored AI recommendations with severity/impact/status

## Verticals
- Flights: campaign name contains "Flight"
- Porta Potties: contains "Porta"/"Potty", Google account 1939246766
- Pest Control: contains "Pest"/"Bed Bug", Meta accounts scoped, Ringba uses exactMatch
