# Project Memory

## Core
CPM Client Hub — agency operating system for Connect Paid Media.
Inter font. Green primary (HSL 94 55% 28%). Dark sidebar (slate-900), light content.
Supabase backend with RLS via security definer functions (is_admin, has_client_access).
Roles: admin, account_manager, designer, client. Stored in team_members table.
Logo at /logo.png. Favicon uses same logo.
Dashboard ported from Creaitiv App (arjunswamy1/creaitivapp) — Cross-Channel, Google Ads, Meta Ads tabs.

## Memories
- [Team & roles](mem://features/team-roles) — Role hierarchy, access rules, team member list
- [DB schema](mem://features/db-schema) — All tables, RLS patterns, security definer functions
- [All phases](mem://features/phases) — Phase completion status and feature list
- [Dashboard architecture](mem://features/dashboard) — Ad data tables, hooks, dashboard config system
