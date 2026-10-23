-- DRAFT (not applied): remove the Lovable sandbox role's write access to agent/gateway tables.
-- sandbox_exec = Lovable agent sandbox DB login (LOGIN, BYPASSRLS, member grant from postgres); gets INSERT+SELECT on every
-- public table via postgres' default privileges. Observed use (pg_stat_statements): psql \d introspection, build_log inserts,
-- data imports (jacuzzi_*, ringfuel_*, clients, tasks, cron_invocation_tokens), ONE agent_tokens insert. No observed writes to
-- any other table below. SELECT is kept everywhere (Lovable introspection/reads keep working). No BEGIN/COMMIT: the Lovable
-- migration tool wraps this in one transaction.

-- 1. Gateway / agent tables: revoke all write privileges (INSERT is the only one currently granted; the rest are belt-and-braces).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  public.agent_grant_audit, public.agent_write_granters,
  public.agent_grants, public.agents, public.agent_gateway_tokens, public.agent_gateway_settings, public.agent_tokens,
  public.agent_access_log, public.agent_write_requests, public.agent_owner_history, public.agent_client_scopes,
  public.agent_handoff_requests, public.agent_gateway_rate_counters, public.agent_query_log,
  public.agent_hub_read_usage_daily, public.agent_read_usage_daily,
  public.gateway_account_blocklist, public.gateway_cache_epoch, public.gateway_grant_renewal_prompts,
  public.gateway_token_expired_alerts, public.gateway_unmapped_account_alerts, public.gateway_visible_accounts_cache,
  public.client_ad_accounts
FROM sandbox_exec;
REVOKE USAGE, UPDATE ON SEQUENCE public.agent_grant_audit_id_seq FROM sandbox_exec;

-- 2. Future tables: postgres' default privileges stop handing sandbox_exec INSERT on new public tables
--    (SELECT stays). NOTE: this applies to ALL new public tables, not only gateway ones (Postgres can't scope default
--    privileges by name). New tables Lovable must bulk-load via psql then need an explicit GRANT INSERT ... TO sandbox_exec
--    in their migration.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM sandbox_exec;