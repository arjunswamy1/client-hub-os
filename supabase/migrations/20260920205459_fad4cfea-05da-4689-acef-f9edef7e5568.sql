-- 1. Client aliases ---------------------------------------------------------
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';

UPDATE public.clients SET aliases = v.aliases FROM (VALUES
  ('rrm',              ARRAY['River Road','River Road Marketing','RRM']),
  ('tinned-fish-club', ARRAY['TFC','tinned fish','tinnedfish']),
  ('buyologyiq',       ARRAY['Buyology','Biology','BIQ','buyology iq']),
  ('hear-com',         ARRAY['hear com','hearcom','hear.com']),
  ('spektrafin',       ARRAY['Spektra','Spectrafin','Spektrafin Final Expense']),
  ('cannaball',        ARRAY['Canna','Cannabal','Canna Ball']),
  ('jacuzzi',          ARRAY['Jacuzzi Bath','Jacuzzi Bath Remodel','JBR']),
  ('ppc-media',        ARRAY['PPC','PPC Media Group']),
  ('ratequote',        ARRAY['Rate Quote','RQ']),
  ('hablyte',          ARRAY['Hablyte Insurance']),
  ('billy',            ARRAY['Billy','billy.com','KWCA']),
  ('phantasmagorical', ARRAY['Phantas','Phant']),
  ('leadgen',          ARRAY['Lead Gen','LeadGen Creative'])
) AS v(slug, aliases)
WHERE public.clients.slug = v.slug;

-- 2. Bot question log -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bot_qa_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asked_by_slack_id text,
  team_member_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  channel_id text,
  channel_name text,
  thread_ts text,
  question text NOT NULL,
  resolved_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  answer text,
  metrics_used text[] NOT NULL DEFAULT '{}',
  sql_used text,
  had_uncaptured_data boolean,
  tokens_in int,
  tokens_out int,
  latency_ms int,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.bot_qa_log TO authenticated;
GRANT ALL ON public.bot_qa_log TO service_role;
ALTER TABLE public.bot_qa_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bot_qa_log' AND policyname='Admins and AMs can read the bot log') THEN
    CREATE POLICY "Admins and AMs can read the bot log" ON public.bot_qa_log
      FOR SELECT TO authenticated
      USING (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS bot_qa_log_created_idx ON public.bot_qa_log (created_at DESC);
CREATE INDEX IF NOT EXISTS bot_qa_log_asker_idx ON public.bot_qa_log (asked_by_slack_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bot_qa_log_channel_idx ON public.bot_qa_log (channel_id, created_at DESC);

-- 3. A genuinely read-only identity for the bot's direct-query fallback -----
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bot_readonly') THEN
    BEGIN
      CREATE ROLE bot_readonly NOLOGIN NOINHERIT BYPASSRLS;
    EXCEPTION WHEN insufficient_privilege THEN
      CREATE ROLE bot_readonly NOLOGIN NOINHERIT;
    END;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO bot_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO bot_readonly;

-- Secrets and credentials are unreachable for that identity, whatever the query.
REVOKE ALL ON public.slack_tokens              FROM bot_readonly;
REVOKE ALL ON public.slack_token_refresh_log   FROM bot_readonly;
REVOKE ALL ON public.platform_connections      FROM bot_readonly;
REVOKE ALL ON public.cron_invocation_tokens    FROM bot_readonly;
REVOKE ALL ON public.onboarding_tokens         FROM bot_readonly;
REVOKE ALL ON public.email_unsubscribe_tokens  FROM bot_readonly;
REVOKE ALL ON public.client_invites            FROM bot_readonly;
REVOKE ALL ON public.team_invites              FROM bot_readonly;

CREATE OR REPLACE FUNCTION public.bot_readonly_select(p_sql text, p_row_limit int DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  s text := btrim(coalesce(p_sql, ''));
  lim int := least(greatest(coalesce(p_row_limit, 200), 1), 1000);
  v jsonb;
BEGIN
  -- One statement only. A trailing semicolon is tolerated; anything else is not.
  s := btrim(regexp_replace(s, ';\s*$', ''));
  IF s = '' THEN
    RAISE EXCEPTION 'bot_readonly_select: empty query';
  END IF;
  IF position(';' IN s) > 0 THEN
    RAISE EXCEPTION 'bot_readonly_select: only a single statement is allowed';
  END IF;
  IF s !~* '^(with|select)\s' THEN
    RAISE EXCEPTION 'bot_readonly_select: only SELECT (or WITH ... SELECT) is allowed';
  END IF;
  IF s ~ '(--|/\*)' THEN
    RAISE EXCEPTION 'bot_readonly_select: comments are not allowed';
  END IF;
  IF s ~* '\y(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|merge|call|do|vacuum|reindex|cluster|comment|listen|notify|lock|prepare|execute|set|reset|import|nextval|setval|dblink)\y' THEN
    RAISE EXCEPTION 'bot_readonly_select: the query contains a forbidden keyword';
  END IF;
  IF s ~* '(auth\.|vault\.|storage\.|realtime\.|supabase_functions\.|pgsodium|pg_catalog|pg_class|pg_shadow|pg_authid|pg_roles|information_schema|slack_tokens|platform_connections|cron_invocation_tokens|onboarding_tokens|email_unsubscribe_tokens|client_invites|team_invites|token|secret|password|decrypted)' THEN
    RAISE EXCEPTION 'bot_readonly_select: the query touches a blocked schema, table or column';
  END IF;

  SET LOCAL statement_timeout = '5s';
  SET LOCAL ROLE bot_readonly;

  EXECUTE format(
    'SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (SELECT * FROM (%s) q LIMIT %s) t',
    s, lim
  ) INTO v;

  RETURN v;
END
$fn$;

REVOKE ALL ON FUNCTION public.bot_readonly_select(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bot_readonly_select(text, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_readonly_select(text, int) TO service_role;