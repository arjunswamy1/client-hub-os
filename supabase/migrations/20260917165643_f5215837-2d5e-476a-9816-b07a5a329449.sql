ALTER TABLE public.slack_channel_mappings
  ADD COLUMN IF NOT EXISTS is_external boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_private boolean,
  ADD COLUMN IF NOT EXISTS is_shared boolean,
  ADD COLUMN IF NOT EXISTS is_ext_shared boolean,
  ADD COLUMN IF NOT EXISTS is_org_shared boolean,
  ADD COLUMN IF NOT EXISTS channel_purpose text,
  ADD COLUMN IF NOT EXISTS classified_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.slack_channel_mappings
    ADD CONSTRAINT slack_channel_purpose_check
    CHECK (channel_purpose IS NULL OR channel_purpose IN
      ('media','creative','client_internal','client_shared','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.slack_post_refusals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id text NOT NULL,
  channel_name text,
  method text NOT NULL,
  reason text NOT NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.slack_post_refusals TO authenticated;
GRANT ALL ON public.slack_post_refusals TO service_role;
ALTER TABLE public.slack_post_refusals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins and AMs can view slack post refusals"
  ON public.slack_post_refusals FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()));

CREATE INDEX IF NOT EXISTS slack_post_refusals_created_idx
  ON public.slack_post_refusals (created_at DESC);

CREATE TABLE IF NOT EXISTS public.slack_token_refresh_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL,
  detail text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.slack_token_refresh_log TO authenticated;
GRANT ALL ON public.slack_token_refresh_log TO service_role;
ALTER TABLE public.slack_token_refresh_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins and AMs can view slack token refresh log"
  ON public.slack_token_refresh_log FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()));