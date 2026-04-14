CREATE TABLE public.slack_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL UNIQUE,
  bot_access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.slack_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON public.slack_tokens
  FOR ALL USING (false);
