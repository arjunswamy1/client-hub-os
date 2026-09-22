ALTER TABLE public.cannaball_daily_metrics
  ADD COLUMN IF NOT EXISTS slack_channel_id text,
  ADD COLUMN IF NOT EXISTS slack_ts text;