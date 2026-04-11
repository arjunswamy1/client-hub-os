---
name: Billy.com dashboard vertical logic
description: Billy dashboard — vertical filtering, 4-step funnel, Ringba attribution, AI insights, trend analysis, drill-down tables, creative reporting, QS audit, agent APIs
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
- `useDrillDown.ts` — useCampaignAdSets, useAdGroupKeywords, useSearchTerms, useAdSetAds
- `useCreativeReporting.ts` — useCreativePerformance, useFormatComparison, useFatigueAlerts
- `useQualityScoreAudit.ts` — useQualityScoreData, useQSAuditRecommendations

## Dashboard Tabs
1. Revenue Engine — 4-step lead-gen funnel (Traffic → LP → Calls → Monetization)
2. Daily Trends — trend charts, alert system, AI insights, daily table with step tabs
3. Trend Analysis — weekly/monthly aggregated performance
4. Meta Ads — 8 KPI cards, creative reporting (Top/Format/Fatigue), drill-down table
5. Google Ads — 8 KPI cards, QS audit, drill-down table (Campaign→AdGroup→Keyword→SearchTerm)

## Drill-Down Hierarchy
- Google: Campaign → Ad Group → Keyword (w/ QS) → Search Term
- Meta: Campaign → Ad Set → Ad (with creative thumbnails)
- Google ad groups have "Search Terms" button for ad-group-level search terms
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
