CREATE TABLE IF NOT EXISTS public.bot_runtime_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cpm_bot_replies boolean NOT NULL DEFAULT true,
  outbound_sender text NOT NULL DEFAULT 'hub' CHECK (outbound_sender IN ('hub','grokbot')),
  dm_username text,
  dm_icon_url text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT, UPDATE ON public.bot_runtime_settings TO authenticated;
GRANT ALL ON public.bot_runtime_settings TO service_role;
ALTER TABLE public.bot_runtime_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Internal team reads bot settings" ON public.bot_runtime_settings FOR SELECT TO authenticated USING (public.get_team_member_id(auth.uid()) IS NOT NULL);
CREATE POLICY "Admins update bot settings" ON public.bot_runtime_settings FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
INSERT INTO public.bot_runtime_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.slack_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  channel_id text NOT NULL,
  channel_name text,
  thread_ts text,
  text text,
  blocks jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','skipped')),
  sent_ts text,
  handled_at timestamptz,
  handled_by uuid REFERENCES public.team_members(id),
  skip_reason text
);
CREATE INDEX IF NOT EXISTS slack_outbox_pending_idx ON public.slack_outbox (created_at) WHERE status = 'pending';
GRANT SELECT ON public.slack_outbox TO authenticated;
GRANT ALL ON public.slack_outbox TO service_role;
ALTER TABLE public.slack_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read outbox" ON public.slack_outbox FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
COMMENT ON TABLE public.slack_outbox IS 'Channel posts the hub has cleared through the Slack allowlist, waiting for Grokbot to send. Only written by _shared/slack-post.ts.';