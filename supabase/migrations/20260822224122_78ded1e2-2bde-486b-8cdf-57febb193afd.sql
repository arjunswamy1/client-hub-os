CREATE TABLE public.cron_invocation_tokens (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.cron_invocation_tokens TO service_role;
ALTER TABLE public.cron_invocation_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: only backend jobs (service role) may read or write these one-time tokens.