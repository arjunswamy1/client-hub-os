-- WHY: which table holds an account's calls was hardcoded per slug inside the
-- bot's metric layer, with a silent fallback to ringba_calls for anything
-- unlisted. A new account therefore read as "zero calls" from a feed that was
-- never its own. Where an account's data lives is an account fact, so it is
-- recorded on the account, and an unrecorded account must say so rather than
-- fall back to anything.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS call_source_tables  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS spend_source_tables text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.clients.call_source_tables IS
  'Tables holding this account''s calls/leads (e.g. ringfuel_calls, ringba_calls, cannaball_calls, moja_calls, ringba_calls_4js). Empty = not recorded yet; readers must report that as a gap, never fall back to another feed.';
COMMENT ON COLUMN public.clients.spend_source_tables IS
  'Tables holding this account''s media spend (e.g. roku_daily_metrics, ad_daily_metrics, universal_ads_geo_metrics, platform_spend_4js, cannaball_spend). Empty = not recorded yet.';