---
name: Dashboard architecture
description: Ad performance dashboard with cross-channel, Google, and Meta tabs — ported from Creaitiv App
type: feature
---

## Database Tables
- `ad_daily_metrics` — daily ad data by platform (date, platform, spend, revenue, impressions, clicks, conversions, add_to_cart, client_id)
- `ad_campaigns` — campaign-level daily data (campaign_name, platform, spend, revenue, status, roas, impression_share, bidding_strategy_type, etc.)
- `dashboard_configs` — per-client config (enabled_platforms, enabled_kpis, revenue_source)
- `platform_connections` — OAuth connection tracking for ad platforms

## Data Hooks (src/hooks/)
- `useAdData.ts` — useKPIs, useDailyMetrics, useChannelBreakdown, useTopCampaigns, useCrossChannelKPIs
- `useDashboardConfig.ts` — useDashboardConfig

## Contexts
- `DateRangeContext` — date range state with presets (7D/14D/30D/custom)

## UI Components (src/components/dashboard/)
- KPICard, DateRangePicker, CrossChannelView, SpendRevenueChart, ChannelBreakdown
- CampaignTable, GoogleDashboard, MetaDashboard

## Origin
Ported from Creaitiv App (arjunswamy1/creaitivapp). Key differences:
- Removed Billy-specific verticals, Ringba, TripleWhale, Subbly integrations
- Simplified cross-channel KPIs to use conversions instead of subscriptions
- Uses CPM green branding instead of Creaitiv purple
