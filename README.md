# Client Hub OS

# CPM Client Hub — Product Requirements Document & Build Prompt

## Project Overview

**Product Name:** CPM Client Hub
**Purpose:** A centralized client management portal for a performance marketing agency that serves as both an operational hub (task management, creative workflows, call agendas) and an AI context layer (aggregating all client communications, performance data, and meeting recordings into a queryable knowledge base for AI agents).

**Tech Stack:** Vite + React 18 + TypeScript, Supabase (Auth + DB + Edge Functions), TanStack React Query, Tailwind CSS + shadcn/ui, Recharts, React Router v6
**Auth:** Supabase Auth (Google OAuth + email/password) with role-based access control via `team_members` + `client_assignments` tables
**Deployment Target:** Lovable (existing Lovable project extended)
**Current Scale:** 1–5 clients (design for 20+ but optimize UX for small roster)
**Existing Codebase:** `https://github.com/arjunswamy1/creaitivapp` — 25 DB tables, 30+ Edge Functions, full ad platform integrations

---

## Team Structure & Roles

The system has four distinct roles with strict visibility rules:

| Role | People | Access Scope |
|---|---|---|
| **Admin** | You + Charles | Full access to everything. Can manage team, assign AMs to clients, configure integrations, view all data across all clients. |
| **Account Manager (AM)** | Henry, Omar, Belu | See ONLY clients they are assigned to. Full operational access within those clients (tasks, agendas, briefs, AI, context). Cannot see unassigned clients at all — they don't appear in the sidebar or search. |
| **Designer** | Malena | Sees creative briefs assigned to her across all clients she's been given access to. Has her own queue/workspace. Time tracking per brief. Cannot access context feed, AI assistant, or internal comms. |
| **Client** | External client contacts | See only their own client dashboard. Read-only performance data, published agendas, creative status. No internal views. |

**Key rule:** Clients can be shared across multiple AMs. For example, Henry and Omar might both be assigned to the same client. Admins control all client ↔ AM assignments from a dedicated admin panel.

### Admin-Only Features
- **Team Management:** Add/edit/deactivate team members, set roles
- **Client-AM Assignment Panel:** A dedicated interface where Admins can assign one or more AMs to each client, and view/edit assignments in a matrix view (clients as rows, AMs as columns with checkboxes). Changes take effect immediately — if an AM is removed from a client, that client disappears from their sidebar on next load.
- **Global Views:** Cross-client dashboards showing all tasks, all hours, all clients — aggregated views that AMs cannot access
- **Integration Configuration:** Only admins can connect/disconnect third-party integrations
- **Audit Log:** Who did what, when, across all clients

### Account Manager Views
When an AM logs in, their experience is:
- **Sidebar client list** shows ONLY their assigned clients — no indication other clients exist
- **"My Tasks" view** aggregates their tasks across assigned clients only
- **"My Agendas" view** shows upcoming calls for their clients
- **Cross-client overview** (AM-scoped): a home screen showing a summary card per assigned client with key stats (open tasks, next call date, overdue items)
- Within any client hub, AMs have full access: tasks, agendas, creative briefs, context feed, AI assistant

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                 FRONTEND (Vite + React)              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Internal  │ │ Client   │ │ AI Query │            │
│  │ Hub Views │ │Dashboard │ │Interface │            │
│  │ (NEW)     │ │(EXISTING)│ │ (NEW)    │            │
│  └──────────┘ └──────────┘ └──────────┘            │
├─────────────────────────────────────────────────────┤
│           SUPABASE EDGE FUNCTIONS (30+ existing)     │
│  sync-meta-ads │ sync-google-ads │ optimization-    │
│  engine │ forecast │ budget-planner │ api-* │ etc.  │
├─────────────────────────────────────────────────────┤
│               CONTEXT ENGINE (NEW - Phase 2)         │
│  Ingests → Normalizes → Indexes → Serves to AI      │
├─────────────────────────────────────────────────────┤
│              INTEGRATIONS (Existing + New)            │
│  EXISTING: Meta │ Google │ Shopify │ Ringba │        │
│            Subbly │ TripleWhale │ Stellar │ Notion   │
│  NEW: Fathom │ Teams │ Slack │ Gmail │ Google Drive  │
├─────────────────────────────────────────────────────┤
│              DATA LAYER (Supabase/Postgres)           │
│  EXISTING: 25 tables (ads, campaigns, metrics, etc.) │
│  NEW: tasks │ agendas │ briefs │ context_items │     │
│       team_members │ client_assignments              │
└─────────────────────────────────────────────────────┘
```


---

## Pre-Phase: Dashboard Migration Strategy

### What Already Exists
The **Creaitiv App** (`https://github.com/arjunswamy1/creaitivapp`) — a full client-facing reporting, analytics, and optimization dashboard. After auditing the complete codebase:

**Stack (identical to Lovable output — zero framework conversion needed):**
- Vite + React 18 + TypeScript
- React Router v6 (BrowserRouter)
- Supabase (Auth + Database + Edge Functions)
- TanStack React Query for data fetching
- Tailwind CSS + shadcn/ui (full Radix component library)
- Recharts for charting
- date-fns for date handling
- react-hook-form + Zod for forms

**Database (25 Supabase tables):**

| Table | Purpose | Has client_id? |
|---|---|---|
| `clients` | Client records (name, slug, logo, brand_colors) | N/A (is the client table) |
| `client_members` | User-to-client access mapping with roles | Yes (is the join) |
| `client_dashboard_config` | Per-client settings (enabled platforms, KPIs, revenue source, Triple Whale config) | Yes |
| `client_invites` | Pending invitations for client users | Yes |
| `profiles` | User profile data | No |
| `platform_connections` | OAuth tokens for Meta, Google, Shopify, etc. | Yes |
| `ad_campaigns` | Campaign-level data (Meta + Google) with bid strategy details | Yes |
| `ad_daily_metrics` | Daily aggregated ad metrics (spend, clicks, conversions, CPC, CPM, CTR) | Yes |
| `ad_sets` | Ad set / ad group level data | Yes |
| `ads` | Individual ad-level creative performance data | Yes |
| `ad_sync_log` | Sync status tracking per platform per client | Yes |
| `keywords` | Google Ads keyword data | Yes |
| `search_terms` | Google Ads search term reports | Yes |
| `ringba_calls` | Ringba call tracking data | Yes |
| `shopify_orders` | Shopify order data | Yes |
| `subbly_invoices` | Subbly billing data | Yes |
| `subbly_subscriptions` | Subbly subscription data | Yes |
| `triplewhale_ad_attribution` | Triple Whale attribution data | Yes |
| `triplewhale_summary` | Triple Whale summary metrics | Yes |
| `forecast_snapshots` | Budget forecast data | Yes |
| `optimization_recommendations` | AI-generated optimization suggestions | Yes |
| `variance_reports` | Performance variance analysis | Yes |
| `alert_settings` | Alert configuration per client | Yes |
| `login_events` | User login tracking | No |
| `notion_oauth_tokens` | Notion integration tokens | No |

**Supabase Edge Functions (30+):**

| Category | Functions |
|---|---|
| **Meta Ads** | `meta-oauth-initiate`, `meta-oauth-callback`, `sync-meta-ads` |
| **Google Ads** | `google-oauth-initiate`, `google-oauth-callback`, `sync-google-ads` |
| **Shopify** | `shopify-install`, `shopify-oauth-initiate`, `shopify-oauth-callback`, `sync-shopify-orders` |
| **Other Data Sources** | `sync-ringba-calls`, `sync-subbly`, `sync-triplewhale` |
| **API Endpoints** | `api-ads`, `api-campaigns`, `api-clients`, `api-daily-summary`, `api-keywords`, `api-revenue`, `api-ringba`, `api-stellar` |
| **Intelligence** | `optimization-engine` (43K), `forecast` (20K), `budget-planner` (19K), `check-anomalies`, `billy-daily-insights` |
| **Alerts** | `daily-summary-alert` |
| **Integrations** | `notion-oauth-redirect`, `notion-check-token`, `slack-channels`, `invite-client-user` |

**Frontend Pages:**

| Page | Route | What It Does |
|---|---|---|
| `Index` | `/` | Main dashboard — tabbed view with Revenue Engine, Daily Trends, Trend Analysis, Google Ads, Meta Ads, CRO Tests. Has client-specific rendering (Billy gets custom vertical-based layout) |
| `BudgetPlanner` | `/budget-planner` | Budget planning and flight forecasting tool |
| `OptimizationEngine` | `/optimization` | AI-powered optimization: ads to kill, CAC trends, scenario simulator, variance monitor, recommendation feed |
| `ClientManagementHub` | `/client-management` | Client settings and invite management |
| `AdminPortal` | `/admin` | Admin-only login tracking dashboard (hardcoded to aj@creaitivapp.com and charles@connectpaidmedia.com) |
| `Settings` | `/settings` | Platform connections (Meta/Google/Shopify OAuth), dashboard config, alert settings |
| `Auth` | `/auth` | Login/signup with Google OAuth + email/password |

**Key Components (non-UI):**

| Component | Purpose |
|---|---|
| `DashboardHeader` | Top bar with client switcher, date range picker, account selector |
| `CrossChannelView` | Blended cross-channel metrics overview with KPI cards |
| `MetaDashboard` / `BillyMetaDashboard` | Meta Ads campaign tables and metrics |
| `GoogleDashboard` / `BillyGoogleDashboard` | Google Ads campaign tables and metrics |
| `BillyDashboard` | Client-specific revenue engine with Ringba, Subbly, Shopify, Triple Whale data |
| `BillyDailyTrends` / `BillyTrendAnalysis` | Daily and trend analysis visualizations |
| `CampaignTable` | Sortable, filterable campaign performance table (29K — the largest component) |
| `KPICard` / `SubblyKPIRow` | Metric display cards with trend indicators |
| `SpendRevenueChart` / `FunnelChart` / `ConversionRateTrend` | Recharts-based visualizations |
| `ForecastCard` / `FlightsForecastCard` / `FlightsRecommendations` | Budget forecasting UI |
| `CreativeReporting` | Creative-level performance analysis |
| `CROTestsTab` / `ExperimentCard` / `CROSummary` | Stellar A/B test results display |
| `optimization/*` | AdsToKillCard, CACTrendCard, ScenarioSimulator, VarianceMonitor, RecommendationFeed |
| `ClientSwitcher` | Client dropdown selector |
| `ClientInviteManager` | Invite external users to client dashboards |

**Custom Hooks (17, all TanStack Query + Supabase):**
`useAdData` (30K — core metrics with period-over-period), `useCrossChannelData`, `useBillyKPIs`, `useBillyDailyTrends`, `useCreativeData`, `useFlightsForecast`, `useBudgetPlanner`, `useOptimizationEngine`, `useRingbaData`, `useRingbaByPlatform`, `useRingbaByVertical`, `useSubblyData`, `useTripleWhaleData`, `useClientRevenue`, `useStellarExperiments`

**Contexts:**
`AuthContext` (Supabase auth state), `ClientContext` (client list + active client + dashboard config + agency admin check via `client_members` table), `BrandingContext` (client-specific brand colors), `DateRangeContext` (global date range), `VerticalContext` (Billy-specific segment selector)

**Existing Auth/Access Model:**
- `client_members` table maps `user_id` → `client_id` with a `role` field
- Roles include `agency_admin` (checked via `client_members.role`)
- Admin access also hardcoded: `ADMIN_EMAILS = ["aj@creaitivapp.com", "charles@connectpaidmedia.com"]`
- `ClientContext` fetches only clients where user has a `client_members` row

### Why This Migration Is Low-Risk
The Creaitiv App uses the **exact same stack** Lovable generates. There is **zero framework conversion** needed. The migration is:
1. Use the existing repo as the starting point for CPM Client Hub
2. Restructure files into feature-based directories
3. Extend the auth system from `client_members` → `client_assignments` with the new role hierarchy
4. Build new features on top

### Migration Plan

**Step 1: Fork/copy the Creaitiv App as the CPM Client Hub base**
Use the existing repo as the starting point. All working code, edge functions, and migrations are preserved.

**Target directory structure after restructure:**
```
src/
├── features/
│   ├── dashboard/          ← Existing dashboard components, hooks, pages
│   │   ├── components/     ← KPICard, CampaignTable, Charts, CrossChannelView, etc.
│   │   ├── hooks/          ← useAdData, useCrossChannelData, useBillyKPIs, etc.
│   │   ├── contexts/       ← DateRangeContext, VerticalContext, BrandingContext
│   │   └── pages/          ← Index, BudgetPlanner, OptimizationEngine
│   ├── tasks/              ← NEW (Phase 1)
│   ├── agendas/            ← NEW (Phase 1)
│   ├── creative-briefing/  ← NEW (Phase 3)
│   ├── context-engine/     ← NEW (Phase 2)
│   ├── ai-assistant/       ← NEW (Phase 2)
│   ├── landing-pages/      ← NEW (Phase 4)
│   └── client-portal/      ← NEW (Phase 4)
├── components/ui/          ← Existing shadcn components (shared)
├── contexts/               ← AuthContext + ClientContext (extended)
├── integrations/supabase/  ← Existing Supabase client + types (extended)
├── lib/                    ← Existing utilities
└── types/                  ← Existing + new type definitions
supabase/
├── functions/              ← ALL existing edge functions preserved
└── migrations/             ← Existing + new migrations appended
```

**Step 2: Extend auth from `client_members` → `client_assignments`**

| Current | New |
|---|---|
| `client_members` (user_id, client_id, role) | Keep for external client access |
| Hardcoded `ADMIN_EMAILS` array | Replace with `team_members.role = 'admin'` |
| `isAgencyAdmin` from `client_members.role` | Check `team_members.role` instead |
| No AM-level access control | `client_assignments` table + RLS |

**Step 3: Add new tables alongside existing ones (zero conflicts)**
New tables: `team_members`, `client_assignments`, `tasks`, `task_comments`, `task_time_entries`, `call_agendas`, `call_action_items`, `creative_briefs`, `creative_deliverables`, `creative_reviews`, `context_items`, `context_sync_log`

**Step 4: No OAuth re-auth needed if keeping same Supabase project**
If you keep the same Supabase project (recommended), all existing OAuth tokens in `platform_connections` remain valid. The existing Edge Functions continue working unchanged.

### What to Tell Lovable (Prompt 0 — Run Before Prompt 1)

> This project is based on the existing Creaitiv App codebase (GitHub: `https://github.com/arjunswamy1/creaitivapp`). It's a Vite + React + TypeScript app with Supabase, shadcn/ui, Tailwind, TanStack React Query, Recharts, and React Router. It has 25 database tables, 30+ Edge Functions handling Meta/Google/Shopify/Ringba/Subbly/TripleWhale syncs, an optimization engine, forecasting, and anomaly detection.
>
> I'm extending this into "CPM Client Hub" — an internal agency operating system. **DO NOT rebuild or remove any existing code.** All existing features stay intact.
>
> Here's what I need:
>
> 1. **Reorganize into feature directories:** Move existing dashboard components (BillyDashboard, CrossChannelView, CampaignTable, KPICard, MetaDashboard, GoogleDashboard, all chart components, CreativeReporting, CRO components, optimization components, ForecastCard, FlightsForecastCard, etc.) into `src/features/dashboard/components/`. Move hooks (useAdData, useCrossChannelData, useBillyKPIs, useBillyDailyTrends, useCreativeData, useFlightsForecast, useBudgetPlanner, useOptimizationEngine, useRingba*, useSubblyData, useTripleWhaleData, useClientRevenue, useStellarExperiments) into `src/features/dashboard/hooks/`. Move DateRangeContext, VerticalContext, BrandingContext into `src/features/dashboard/contexts/`. Move dashboard pages (Index, BudgetPlanner, OptimizationEngine) into `src/features/dashboard/pages/`. Keep `src/components/ui/` shared. Keep `src/integrations/supabase/` as-is. Update all import paths.
>
> 2. **Create `team_members` table:** Columns: `id` (uuid, PK), `user_id` (uuid, FK to auth.users, nullable — for linking to Supabase auth), `name` (text), `email` (text, unique), `role` (text, CHECK IN ('admin', 'account_manager', 'designer', 'client')), `avatar_url` (text, nullable), `is_active` (boolean, default true), `created_at`, `updated_at`. Seed with: Your name (admin, aj@creaitivapp.com), Charles (admin, charles@connectpaidmedia.com), Henry (account_manager), Omar (account_manager), Belu (account_manager), Malena (designer).
>
> 3. **Create `client_assignments` table:** Columns: `id` (uuid, PK), `client_id` (uuid, FK to clients), `team_member_id` (uuid, FK to team_members), `role_on_account` (text, nullable), `assigned_by_id` (uuid, FK to team_members, nullable), `assigned_at` (timestamp, default now()). UNIQUE constraint on (client_id, team_member_id).
>
> 4. **Extend `ClientContext`:** For users with a `team_members` record: if role = 'admin', show all clients. If role = 'account_manager', show only clients with a `client_assignments` row for their team_member_id. For users WITHOUT a `team_members` record (external client users), fall back to the existing `client_members` table query. Remove the hardcoded `ADMIN_EMAILS` check in AdminPortal.tsx — use `team_members.role = 'admin'` instead. Keep the existing `isAgencyAdmin` field but source it from `team_members.role`.
>
> 5. **Build new layout shell:** Add a persistent, collapsible dark sidebar (slate-900, Geist font) with: "CPM" logo at top, the existing ClientSwitcher dropdown (now role-filtered per step 4), navigation links for the selected client: Dashboard (existing), Tasks (placeholder), Agendas (placeholder), Creative Briefing (placeholder), Landing Pages (placeholder), Context Feed (placeholder), AI Assistant (placeholder). Bottom section: Settings (existing), Admin (existing, admin-only), Team. The existing dashboard pages render when "Dashboard" is selected. Existing Settings page renders when "Settings" is selected. Other items show "Coming Soon" placeholder pages.
>
> 6. **Rebuild AdminPortal:** Replace the current AdminPortal (which only shows login events) with a new admin area containing three tabs: (a) **Team Management** — CRUD for team_members, (b) **Client Management** — existing client management enhanced with the ability to set communication_channel and status fields, (c) **Client-AM Assignment Matrix** — clients as rows, AMs as columns, checkboxes to toggle assignments. Show a summary: "Henry: N clients | Omar: N clients | Belu: N clients". Keep the login events tracking as a fourth "Activity" tab.
>
> 7. **Add AM home screen:** When an Account Manager logs in, their landing page is a cross-client overview (not the single-client dashboard). Show a summary card per assigned client: client name + brand color, a link to enter that client's hub. Task counts and call dates will be added later.
>
> 8. **Keep ALL existing functionality working:** The performance dashboard, all ad platform syncs, optimization engine, budget planner, forecasting, CRO tests, all 30+ Edge Functions, all 25 Supabase tables, all RLS policies, Settings page with platform connections — everything must continue working exactly as before, now accessed via the sidebar navigation.
## Phase 1 — Client Hub + Task/Project Management (MVP)

### 1.1 Global Navigation

**Sidebar (persistent, collapsible):**
- Agency logo ("CPM") + name at top
- Client selector dropdown (switches entire hub context) — **only shows clients the logged-in user has access to.** Admins see all clients. AMs see only assigned clients. Designers see clients with briefs assigned to them. Client users see only their own.
- Navigation items per client:
  - Dashboard (overview)
  - Tasks & Projects
  - Call Agendas & Notes
  - Creative Briefing
  - Landing Pages
  - Context Feed (AI data layer)
  - AI Assistant
- Bottom: Settings, Team Members, Integrations

**Top bar:**
- Current client name + color-coded badge
- Search (global across all clients)
- Notifications bell
- User avatar + role indicator

### 1.2 Client Hub — Dashboard (per client)

A single-screen overview for each client showing:

- **Status card row:** Active tasks count, overdue tasks, pending approvals, hours logged this week
- **Recent activity feed:** Last 10 actions across all modules (task updates, new notes, creative uploads, messages ingested)
- **Upcoming:** Next scheduled call, pending deadlines (next 7 days)
- **Quick actions:** New task, New creative brief, Prep call agenda, Ask AI

### 1.3 Tasks & Projects

Kanban-style board with list view toggle.

**Columns (default):** Backlog → To Do → In Progress → In Review → Done

**Task card fields:**
- Title (required)
- Description (rich text)
- Assignee (team member or client contact)
- Priority: Urgent / High / Medium / Low
- Due date
- Tags / Labels (e.g., "Meta Ads", "Landing Page", "Reporting")
- Client (auto-set from hub context)
- Linked items: Can link to creative briefs, landing pages, call notes
- Subtasks (checklist)
- Comments thread
- File attachments
- Time tracking (start/stop timer or manual entry)

**Views:**
- Kanban board (drag-and-drop)
- List view (sortable, filterable table)
- Calendar view (tasks by due date)
- My Tasks view (filtered to current user across all clients)

**Filters:** By assignee, priority, tag, due date range, status

### 1.4 Call Agendas & Notes

**Weekly Call Agenda Builder:**
- Auto-generated agenda template based on:
  - Tasks completed / in progress this week
  - Key metrics changes (pulled from context layer once integrated)
  - Open questions / blockers
  - Upcoming deadlines
- Editable rich text — team can add/remove/reorder agenda items
- "Publish to Client" button → creates a read-only client-facing version
- Status: Draft → Published → Completed
- After call: space to add meeting notes, action items (which auto-create tasks)

**Ad Hoc Call Notes:**
- Quick note creation with date, attendees, summary
- Action items extracted → convert to tasks with one click
- Tag by type: Strategy, Creative Review, Performance Review, Kickoff, etc.

**Fathom Integration (Phase 2 placeholder):**
- Display area for embedded Fathom recordings
- Auto-transcription display
- AI-generated call summary

### 1.5 Data Model (Phase 1)

```sql
-- Core tables
clients (
  id, name, slug, color, logo_url,
  communication_channel ENUM('slack', 'teams', 'email'),
  status ENUM('active', 'paused', 'offboarded'),
  created_at, updated_at
)

team_members (
  id, name, email,
  role ENUM('admin', 'account_manager', 'designer', 'client'),
  avatar_url, is_active BOOLEAN DEFAULT true,
  created_at, updated_at
)

-- Client ↔ AM assignment (many-to-many, admin-managed)
-- This is THE access control table. If an AM doesn't have a row here, they cannot see the client.
client_assignments (
  id, client_id, team_member_id,
  role_on_account VARCHAR, -- e.g., 'lead AM', 'supporting AM', 'designer'
  assigned_by_id, -- admin who made the assignment
  assigned_at TIMESTAMP DEFAULT now(),
  UNIQUE(client_id, team_member_id)
)

-- RLS Policy: AMs can only query rows in ANY table where client_id
-- matches a client_assignments row for their team_member_id.
-- Admins bypass this filter entirely.
-- Designers are filtered via client_assignments with role_on_account = 'designer'
-- Client users are filtered by their linked client_id on the team_members table

tasks (
  id, client_id, title, description,
  status ENUM('backlog', 'todo', 'in_progress', 'in_review', 'done'),
  priority ENUM('urgent', 'high', 'medium', 'low'),
  assignee_id, created_by_id,
  due_date, completed_at,
  parent_task_id (for subtasks),
  position (for ordering within columns),
  tags TEXT[],
  created_at, updated_at
)

task_comments (
  id, task_id, author_id, content, created_at
)

task_time_entries (
  id, task_id, team_member_id,
  started_at, ended_at, duration_minutes,
  description, created_at
)

call_agendas (
  id, client_id, call_date, call_type ENUM('weekly', 'adhoc', 'strategy', 'creative_review'),
  title, agenda_content JSONB,
  notes_content JSONB,
  status ENUM('draft', 'published', 'completed'),
  published_at, created_by_id,
  created_at, updated_at
)

call_action_items (
  id, call_agenda_id, task_id (nullable, linked when converted),
  description, assignee_id, due_date, completed BOOLEAN
)
```

---

## Phase 2 — AI Context Layer + Integrations

### 2.1 Context Engine

The core differentiator. Every piece of client-related communication and data gets ingested, normalized, and indexed so AI agents can query it.

**Context Sources (per client):**

| Source | Data Type | Sync Method |
|---|---|---|
| Fathom | Call recordings + transcripts | Webhook / API poll |
| Microsoft Teams | Channel messages for client channels | MS Graph API |
| Slack | Channel messages for client channels | Slack API (Events) |
| Gmail | Email threads tagged/labeled per client | Gmail API (watch + pull) |
| Google Drive | Shared folders, docs, sheets | Drive API |
| Ad Platforms | Meta, Google, TikTok performance data | Platform APIs |
| Internal | Task updates, call notes, creative briefs | Direct DB events |

**Context Feed (per client):**
- Chronological feed of all ingested items
- Filterable by source (Slack, Teams, Email, Calls, Internal)
- Searchable (full-text)
- Each item shows: source icon, timestamp, preview, participants, link to original
- Items are chunked and embedded for vector search (used by AI Assistant)

**Data Model Additions:**

```sql
context_items (
  id, client_id,
  source ENUM('fathom', 'teams', 'slack', 'gmail', 'drive', 'meta_ads', 'google_ads', 'tiktok_ads', 'internal'),
  source_id (original ID from the platform),
  content_type ENUM('message', 'email', 'transcript', 'document', 'metric', 'file', 'note'),
  title, content TEXT, metadata JSONB,
  participants TEXT[],
  occurred_at TIMESTAMP,
  embedding VECTOR(1536),
  created_at
)

context_sync_log (
  id, client_id, source, last_sync_at,
  status ENUM('success', 'failed', 'in_progress'),
  items_synced INTEGER, error_message
)
```

### 2.2 AI Assistant (per client)

A chat interface scoped to each client's context.

**Features:**
- Natural language Q&A: "What did we discuss about creative testing in last week's call?"
- Retrieval-augmented generation using the context engine's vector embeddings
- Source attribution: Every AI answer cites which context items it drew from (linked)
- Conversation history preserved per user per client
- Suggested questions based on recent context (e.g., "You had a call yesterday — want a summary?")

**Use Cases:**
- "Summarize all communication with [Client] this week"
- "What are the open action items from our last call?"
- "What was the Meta CPL trend over the last 4 weeks?"
- "Draft a weekly call agenda based on this week's activity"
- "What creative concepts have we tested for this client?"

**Implementation Notes:**
- Use Anthropic API (Claude) for generation
- pgvector in Supabase for embeddings storage
- Retrieval: top-k context items by cosine similarity + recency weighting
- System prompt includes client name, account team, current tasks, recent metrics

### 2.3 Integration Configuration (Settings)

Per-client integration settings page:

- **Slack:** Workspace connection (OAuth), channel mapping (which channels belong to which client)
- **Teams:** Tenant connection, channel mapping
- **Gmail:** Gmail account connection, label/filter mapping per client
- **Fathom:** API key, auto-tag by meeting title pattern
- **Google Drive:** Shared folder URL per client
- **Ad Platforms:** Account IDs per platform per client

Each integration shows: connection status, last sync time, items synced count, sync now button

---

## Phase 3 — Creative Briefing & Approvals

### 3.1 Creative Brief Builder

**Brief Creation Form:**
- Client (auto-set)
- Brief title
- Creative type: Static Image, Video, Carousel, Story/Reel, UGC, Other
- Platform(s): Meta, Google, TikTok, Email, Landing Page
- Objective: Awareness, Consideration, Conversion, Retargeting
- Target audience description
- Key message / CTA
- Copy / headline suggestions (text fields)
- Reference assets: Upload or link from Google Drive (thumbnail previews)
- Brand guidelines link
- Due date
- Priority
- Assigned to (default: Malena)
- Notes / special instructions

**Brief Status Flow:**
Draft → Submitted → In Design → Ready for Review → Revision Requested → Approved → Delivered

### 3.2 Designer Workspace (Malena's View)

A dedicated view for the designer:

- **My Queue:** All briefs assigned, sorted by priority then due date
- **Active Brief View:**
  - Full brief details
  - Time tracker: Start/stop per brief (auto-logs to task_time_entries)
  - Upload completed files (drag-and-drop, multi-file)
  - Version history per deliverable
  - Submit for review button
- **Hours Dashboard:**
  - Total hours this week / month
  - Hours per client (pie chart)
  - Hours per brief (table)
  - Exportable timesheet

### 3.3 Review & Approval Flow

- When designer submits for review → notification to brief creator
- Reviewer can:
  - Approve (moves to Approved, files become final)
  - Request revision (adds revision note, moves back to In Design)
  - Comment inline (threaded comments on the brief)
- Approval history logged with timestamps
- Final approved assets auto-linked to Google Drive folder (if integrated)

### 3.4 Data Model Additions

```sql
creative_briefs (
  id, client_id, title,
  creative_type ENUM('static', 'video', 'carousel', 'story_reel', 'ugc', 'other'),
  platforms TEXT[],
  objective ENUM('awareness', 'consideration', 'conversion', 'retargeting'),
  target_audience TEXT,
  key_message TEXT,
  copy_suggestions JSONB,
  brand_guidelines_url TEXT,
  reference_assets JSONB, -- [{url, thumbnail, name, source: 'upload'|'drive'}]
  due_date, priority,
  assigned_to_id, created_by_id,
  status ENUM('draft', 'submitted', 'in_design', 'ready_for_review', 'revision_requested', 'approved', 'delivered'),
  notes TEXT,
  created_at, updated_at
)

creative_deliverables (
  id, brief_id,
  file_url, file_name, file_type, file_size,
  version INTEGER DEFAULT 1,
  drive_url TEXT, -- Google Drive link if synced
  uploaded_by_id, uploaded_at
)

creative_reviews (
  id, brief_id, reviewer_id,
  action ENUM('approved', 'revision_requested'),
  comments TEXT,
  created_at
)
```

---

## Phase 4 — Landing Page Tracker & Client Dashboard

### 4.1 Landing Page Project Tracker

**Page Registry:**
- Each landing page entry: Title, URL, client, status, platform (Lovable / custom), created date
- Status: In Development → Staging → Live → Testing → Paused → Archived

**Lovable Integration:**
- Pull in project list from Lovable (via API if available, or manual link + embed)
- Show deployment status, last updated

**Stellar Integration:**
- Pull in active A/B tests per client
- Show: Test name, variant count, status, current winner, statistical significance
- Link to full Stellar dashboard

**Page Performance (when ad platform data is available):**
- Conversion rate, bounce rate, avg. time on page
- Per-variant performance if A/B testing

### 4.2 Client-Facing Dashboard

A separate, clean view accessible to client logins.

**Sections:**

**Performance Overview:**
- Key metrics cards: Spend, Leads/Conversions, CPL/CPA, ROAS (pulled from ad platforms)
- Trend charts: Last 7 days, 30 days, 90 days toggle
- Platform breakdown: Meta vs Google vs TikTok

**Weekly Call Agenda (published):**
- Read-only view of the latest published agenda
- Historical agendas accessible

**Creative Status:**
- Active briefs and their status
- Recently delivered assets (downloadable)

**Landing Pages:**
- Active pages with performance metrics
- Active tests and results

**Access Control:**
- Clients see ONLY their own data
- No access to: internal tasks, time tracking, internal notes, Slack/Teams messages, AI assistant
- Row-level security in Supabase enforcing client_id scoping

---

## UI/UX Design Direction

### Visual System
- **Aesthetic:** Clean, professional, modern SaaS — think Linear meets Notion
- **Color palette:** Dark sidebar (slate-900), white/light content area, client accent colors for badges and highlights
- **Typography:** Clean sans-serif (e.g., Geist, Satoshi, or similar modern choice)
- **Spacing:** Generous whitespace, 8px grid system
- **Cards:** Subtle shadows, rounded corners (8px), hover states
- **Data density:** Comfortable — not cramped, not wasteful. Scannable.

### Key UX Principles
1. **Client context is always clear** — current client name/color visible at all times
2. **Two clicks to anything** — from client selector to any module, max 2 clicks
3. **Progressive disclosure** — overview first, drill into details
4. **Real-time feel** — optimistic UI updates, presence indicators for team
5. **Mobile-responsive** — works on tablet for call prep, phone for quick checks

### Page Layouts

**Dashboard:** 4-column metric cards → 2-column layout (activity feed left, upcoming/actions right)

**Tasks/Kanban:** Full-width board with collapsible column options, task detail as slide-over panel from right

**Call Agendas:** Split view — agenda list left (1/3), selected agenda content right (2/3)

**Creative Briefing:** Card grid of briefs with status badges, brief detail as full page

**AI Assistant:** Chat interface occupying main content area, sources panel collapsible on right

---

## Role-Based Access Control

| Feature | Admin (You + Charles) | Account Manager (Henry, Omar, Belu) | Designer (Malena) | Client (External) |
|---|---|---|---|---|
| Client visibility | All clients | Assigned clients ONLY | Clients with assigned briefs | Own client only |
| Client-AM assignments | ✅ Manage all | ❌ Cannot see | ❌ | ❌ |
| Team management | ✅ Full CRUD | ❌ | ❌ | ❌ |
| Tasks (CRUD) | ✅ All clients | ✅ Assigned clients | Own assigned tasks only | View tasks assigned to them |
| Call agendas | ✅ All clients | ✅ Assigned clients | ❌ | Published agendas only |
| Creative briefs | ✅ All clients | ✅ Create/edit in assigned clients | Full access to assigned briefs + upload/time tracking | View status of their briefs |
| Time tracking | View all, all clients | View own + team on assigned clients | Own time per brief | ❌ |
| AI Assistant | ✅ All clients | ✅ Assigned clients | ❌ | ❌ |
| Context feed | ✅ All clients | ✅ Assigned clients | ❌ | ❌ |
| Client dashboard | ✅ All clients | ✅ Assigned clients | ❌ | ✅ Own only |
| Integration settings | ✅ | ❌ | ❌ | ❌ |
| Global cross-client views | ✅ All clients aggregated | ✅ Assigned clients aggregated | ❌ | ❌ |
| Audit log | ✅ | ❌ | ❌ | ❌ |
| Settings | ✅ | ❌ | ❌ | ❌ |

### Supabase RLS Implementation Notes

Every table with a `client_id` column must enforce visibility:

```sql
-- Example RLS policy for the tasks table
CREATE POLICY "Admins see all tasks" ON tasks
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.id = auth.uid()
      AND team_members.role = 'admin'
    )
  );

CREATE POLICY "AMs see assigned client tasks" ON tasks
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM client_assignments
      WHERE client_assignments.client_id = tasks.client_id
      AND client_assignments.team_member_id = auth.uid()
    )
  );

-- Repeat pattern for: call_agendas, creative_briefs, context_items, etc.
```

---

## Lovable Build Sequence (Recommended Prompt Order)

Since Lovable works best with focused, incremental prompts, here is the suggested build order. **Start with Prompt 0** to migrate your existing dashboard, then build the new features on top.

### Prompt 0: Restructure + Auth Extension (see Pre-Phase section above)
> Copy the prompt from the "What to Tell Lovable" section in the Pre-Phase above. This is the most critical prompt — it restructures the existing codebase, adds the team/assignment tables, extends auth, adds the sidebar layout, and rebuilds the admin panel. Run this first.

### Prompt 1: Task Management
> Add a Tasks & Projects module to the CPM Client Hub. Create the `tasks`, `task_comments`, and `task_time_entries` database tables (see Phase 1 data model for schema). All task queries must be filtered through `client_assignments` RLS — AMs only see tasks for their assigned clients. Build a Kanban board view with columns: Backlog, To Do, In Progress, In Review, Done. Tasks are draggable between columns. Each task card shows title, assignee avatar, priority badge, due date, and tag chips. Clicking a task opens a slide-over detail panel with full description (rich text), subtask checklist, comments thread, file attachments, time tracking (start/stop + manual entry), and linked items. Add a list view toggle that shows tasks in a sortable/filterable table. Add filters for assignee, priority, tags, and due date range. Add a global "My Tasks" view accessible from the sidebar that shows the current user's tasks across all their accessible clients, grouped by client. Replace the Tasks placeholder page from Prompt 0.

### Prompt 2: Call Agendas & Notes
> Add a Tasks & Projects module to the CPM Client Hub. Create the `tasks`, `task_comments`, and `task_time_entries` database tables. All task queries must be filtered through `client_assignments` RLS — AMs only see tasks for their assigned clients. Build a Kanban board view with columns: Backlog, To Do, In Progress, In Review, Done. Tasks are draggable between columns. Each task card shows title, assignee avatar, priority badge, due date, and tag chips. Clicking a task opens a slide-over detail panel with full description (rich text), subtask checklist, comments thread, file attachments, time tracking (start/stop + manual entry), and linked items. Add a list view toggle that shows tasks in a sortable/filterable table. Add filters for assignee, priority, tags, and due date range. Add a global "My Tasks" view accessible from the sidebar that shows the current user's tasks across all their accessible clients, grouped by client.

### Prompt 2: Call Agendas & Notes
> Add a Call Agendas & Notes module to the CPM Client Hub. Create the `call_agendas` and `call_action_items` tables. Build a split-panel layout: agenda list on the left (sortable by date, filterable by type), selected agenda content on the right. Agenda editor supports rich text with sections for Topics, Metrics Review, Action Items, and Open Questions. Each agenda has a status flow: Draft → Published → Completed. Action items can be converted to tasks with one click (creates a linked task). Add a "Publish to Client" button that sets the agenda to published status — published agendas become visible to client-role users in their dashboard. Include a separate "Ad Hoc Notes" quick-create for non-weekly calls. Add a "My Agendas" view in the sidebar showing upcoming calls across all assigned clients for the current AM.

### Prompt 3: Creative Briefing
> Add a Creative Briefing module to the CPM Client Hub. Create the `creative_briefs`, `creative_deliverables`, and `creative_reviews` tables. Build a brief creation form with fields: title, creative type (static/video/carousel/story/ugc), platforms (multi-select), objective, target audience, key message, copy suggestions, reference assets (upload with thumbnails), due date, priority, assigned designer (defaults to Malena). Briefs display as a card grid with status badges. Brief detail page shows all info plus a deliverables section where the designer can upload files (drag-and-drop, version tracking), log time, and submit for review. Reviewers can approve or request revisions with comments. Add a **"Designer Workspace"** — a dedicated view for the designer role showing: My Queue (all assigned briefs sorted by priority/due date), active time tracker per brief, upload area, and an Hours Dashboard showing total hours this week/month, hours per client (pie chart), and hours per brief (exportable table). Admins can see all designer hours; AMs can see hours for their assigned clients only.

### Prompt 4: Context Feed & Integrations Setup
> Add a Context Feed module and Integration Settings to the CPM Client Hub. Create the `context_items` and `context_sync_log` tables. Build the context feed as a chronological, filterable stream of items with source icons (Slack, Teams, Gmail, Fathom, Internal), timestamps, content preview, and participants. Add full-text search across items. The context feed is visible to Admins and AMs only (not designers or clients). Build an Integration Settings page (admin-only) per client where admins can configure: Slack workspace + channels, Teams tenant + channels, Gmail labels, Fathom API key, Google Drive folder URL, and ad platform account IDs. Each integration shows connection status and last sync time. For MVP, create the UI and data model — actual API connections will be added incrementally.

### Prompt 5: AI Assistant
> Add an AI Assistant chat interface per client to the CPM Client Hub. Accessible to Admins and AMs only. Build a chat UI in the main content area with a collapsible sources panel on the right. The assistant uses the Anthropic API (Claude) with retrieval-augmented generation. When the user sends a question, retrieve the top relevant context items from the context_items table using vector similarity search (pgvector), include them in the system prompt along with client metadata (name, team, active tasks, recent metrics), and stream the response. Each AI response should cite which context items it referenced (clickable links to the source). Preserve conversation history per user per client. Show suggested questions based on recent context items.

### Prompt 6: Client-Facing Dashboard (Already Built — Enhance)
> The client-facing performance dashboard already exists in the codebase (the Index page with CrossChannelView, Meta/Google dashboards, KPI cards, charts, CRO tests, etc.). Now enhance it for the CPM Client Hub: Ensure that for users with the "client" role (external clients via `client_members`), this dashboard is their default and only view — when they log in, they land directly here with no sidebar navigation to internal modules. They get a simplified top nav with just their client name, logo, and logout button. Layer in: the latest published weekly call agenda (pulled from `call_agendas` where status = 'published'), active creative brief statuses with downloadable deliverables, and active landing pages. Admins and AMs should also be able to access any client's dashboard view from within the hub (add a "View as Client" button on the internal overview that opens this view). The existing dashboard functionality (ad metrics, optimization engine, budget planner, CRO tests) all remain intact.

### Prompt 7: Landing Page Tracker
> Add a Landing Page tracker module to the CPM Client Hub. Create a pages registry table with fields: title, URL, client, status (In Development/Staging/Live/Testing/Paused/Archived), platform source (Lovable/custom), created date. Build a card + table view for pages. Include placeholder sections for Lovable project sync and Stellar A/B test results. Each page entry can link to its live URL, staging URL, and associated creative briefs or tasks. Visible to Admins and AMs for their assigned clients.

---

## Integration API Reference

### Already Built (in existing codebase)

| Integration | Edge Functions | Status |
|---|---|---|
| Meta Ads | `meta-oauth-initiate`, `meta-oauth-callback`, `sync-meta-ads` | ✅ Working |
| Google Ads | `google-oauth-initiate`, `google-oauth-callback`, `sync-google-ads` | ✅ Working |
| Shopify | `shopify-install`, `shopify-oauth-initiate`, `shopify-oauth-callback`, `sync-shopify-orders` | ✅ Working |
| Ringba | `ringba-webhook`, `sync-ringba-calls` | ✅ Working |
| Subbly | `sync-subbly` | ✅ Working |
| Triple Whale | `sync-triplewhale` | ✅ Working |
| Stellar | `api-stellar` | ✅ Working |
| Notion | `notion-oauth-redirect`, `notion-check-token` | ✅ Working |
| Slack (partial) | `slack-channels` | ✅ Channel listing works |

### New (to build for Context Engine — Phase 2)

| Integration | API | Auth | Key Endpoints |
|---|---|---|---|
| Slack (messages) | Slack Events API | OAuth 2.0 | Real-time message ingestion for context feed |
| Microsoft Teams | MS Graph API | OAuth 2.0 (Azure AD) | /teams/{id}/channels/{id}/messages |
| Gmail | Gmail API | OAuth 2.0 (Google) | users.messages.list, users.messages.get |
| Google Drive | Drive API v3 | OAuth 2.0 (Google) | files.list, files.get, files.export |
| Fathom | Fathom API | API Key | /calls, /calls/{id}/transcript |

---

## Success Metrics

**Internal:**
- Time to prep weekly call < 15 minutes (down from 45+)
- All client communication queryable in one place
- Designer utilization tracked and visible
- AI can answer 80%+ of "what happened with this client" questions accurately

**Client-facing:**
- Client can self-serve performance data without asking the team
- Weekly agendas published before calls automatically
- Creative approval cycle < 48 hours

---

## Notes for Builder

- **Prompt 0 is the most important prompt.** It restructures the existing Creaitiv App into the CPM Client Hub architecture without breaking anything. Every subsequent prompt builds on top of it.
- **The existing codebase is the foundation, not a migration target.** This is NOT a "copy components into a new project" situation. The Creaitiv App IS the project — we're extending it with a sidebar, new auth layer, and new modules. Same repo, same Supabase project, same Edge Functions.
- **Zero framework conversion needed.** The Creaitiv App is already Vite + React + TypeScript + React Router + Supabase + shadcn/ui + Tailwind + TanStack Query. This is identical to what Lovable generates. No Next.js patterns to convert.
- **If keeping the same Supabase project (recommended), all existing OAuth tokens for Meta, Google, Shopify, Ringba, etc. remain valid.** No re-authentication needed. All 30+ Edge Functions continue working.
- **Do NOT rename existing tables.** The 25 existing tables (ad_campaigns, ad_daily_metrics, etc.) keep their names. New CPM tables (tasks, call_agendas, creative_briefs, etc.) are all new names with no conflicts.
- The `client_members` table stays for external client access. The new `client_assignments` table handles internal team access. Both filter by `client_id`.
- **RLS is non-negotiable from Prompt 0.** The `client_assignments` table is the single source of truth for internal team visibility. The existing `client_members` table continues to control external client visibility. Both must be enforced at the database level.
- Seed `team_members` in Prompt 0 with the real team: [You] (admin, aj@creaitivapp.com), Charles (admin, charles@connectpaidmedia.com), Henry (account_manager), Omar (account_manager), Belu (account_manager), Malena (designer). Link the two admin user_ids to their existing Supabase auth records.
- The existing `AdminPortal` hardcodes `ADMIN_EMAILS` — Prompt 0 replaces this with a `team_members.role = 'admin'` check. Preserve the login events tracking from the old AdminPortal as a tab in the new one.
- The optimization engine Edge Function is 43K lines — it's by far the most complex piece of existing code. Don't touch it.
- The context engine (Phase 2) is the highest-value NEW feature — it turns this from "a dashboard with a project management layer" into an AI-native agency operating system.
- For the AI Assistant, use Claude Sonnet for speed on routine queries, Claude Opus for complex analysis
- All file uploads should go through Supabase Storage with signed URLs
- Design for webhook-based real-time sync where possible (Slack Events API, Gmail push notifications) rather than polling
- The Admin client-AM assignment panel is a critical management surface — it should feel fast and intuitive (think checkbox matrix, not form submissions)
- AMs should never have any UI hint that clients they're not assigned to exist — no "you don't have access" messages, no locked icons. Those clients simply don't appear.
- The existing Billy-specific components (BillyDashboard, BillyDailyTrends, BillyTrendAnalysis, BillyMetaDashboard, BillyGoogleDashboard, VerticalContext) and the client-specific rendering logic in Index.tsx must be preserved — they demonstrate the per-client customization capability that can be extended to other clients.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://connectpaidmedia.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/0b34c690-732b-4181-8ed8-49eb66878781).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
