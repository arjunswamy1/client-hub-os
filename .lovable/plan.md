
# Cannaball Dashboard Setup

Mirrors the 4JS single-vertical dashboard (Roku spend + call KPIs). Since Roku Ads API access isn't provisioned yet, spend intake starts as manual/CSV and can be swapped to API later without touching the dashboard. CallGrid is wired via webhook now.

## What gets built

### 1. Client record
- Insert `Cannaball` into `clients` (via insert tool, not migration — table already exists).
- Seed default assignments so the current admin sees it in the client switcher.

### 2. Call data (CallGrid webhook)
New table `cannaball_calls` mirroring the shape of `ringba_calls_4js` but simpler (CallGrid's fields):
- `call_id` (from CallGrid), `caller_number`, `did`, `caller_state`, `call_start`, `duration_seconds`, `connection_duration_seconds`, `connected`, `payout`, `recording_url`, `raw_payload jsonb`.
- RLS: admins full access; assigned team members via `has_client_access`.

New edge function `callgrid-webhook`:
- Public endpoint (`verify_jwt = false`), verifies a shared secret from a `CALLGRID_WEBHOOK_SECRET` header.
- Upserts on `call_id`.
- Returns 200 fast; logs raw payload for debugging.

You'll paste the endpoint URL + secret into CallGrid's webhook settings.

### 3. Roku spend (interim)
Reuse the existing spend upload pattern:
- New table `cannaball_spend` (date, campaign_name, spend, impressions, clicks, raw).
- Extend `SpendUploadPage` with a Cannaball/Roku CSV template, OR add a small manual entry form on the dashboard. I'll go with CSV upload to match existing muscle memory.
- Placeholder edge function `sync-roku-ads` stubbed out and disabled — ready to wire up once you have API credentials. It will need `ROKU_CLIENT_ID` / `ROKU_CLIENT_SECRET` secrets later.

### 4. Dashboard
- New component `CannaballDashboard.tsx` cloned from `FourJsDashboard.tsx`:
  - KPIs: Spend, Calls, Connected, Connect %, Cost/Call, Cost/Connection, Revenue, ROAS.
  - Tabs: Creative, Trend, Call Log (drop the Platform tab since there's only Roku; drop Cluster unless you want it).
  - Sync buttons: "Refresh calls" (re-queries) and "Upload Roku spend" (routes to upload page). Roku API sync button hidden until creds land.
- New hook `useCannaballData.ts` (calls + spend queries).
- Route it into `DashboardPage` so when the active client is Cannaball, this dashboard renders (same pattern as 4JS).

## Technical details

- Tables use `client_id` FK to `clients` so `has_client_access` RLS works out of the box.
- Webhook secret stored via `add_secret` after the function is deployed, so you have the URL ready to configure in CallGrid in one visit.
- No changes to existing dashboards or shared components.

## What I need from you after this ships

1. Confirm CallGrid's webhook payload shape — if you have sample JSON or their docs, share it so I can map fields exactly. Otherwise I'll build against their standard post-call payload and adjust once real events arrive.
2. Once Roku Ads API access is granted, share the OAuth credentials and I'll finish `sync-roku-ads`.

Approve and I'll build it.
