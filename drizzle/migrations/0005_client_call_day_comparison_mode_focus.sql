ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS client_call_day smallint
    CHECK (client_call_day BETWEEN 0 AND 6),
  ADD COLUMN IF NOT EXISTS client_call_day_source text
    CHECK (client_call_day_source IN ('manual','wispr_derived')),
  ADD COLUMN IF NOT EXISTS daily_comparison_mode text
    CHECK (daily_comparison_mode IN ('same_weekday','prior_day','auto'))
    DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS daily_comparison_mode_reason text,
  ADD COLUMN IF NOT EXISTS daily_comparison_mode_resolved text
    CHECK (daily_comparison_mode_resolved IN ('same_weekday','prior_day')),
  ADD COLUMN IF NOT EXISTS daily_comparison_mode_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_focus text,
  ADD COLUMN IF NOT EXISTS current_focus_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_focus_source text
    CHECK (current_focus_source IN ('manual','context_derived'));

COMMENT ON COLUMN public.clients.client_call_day IS 'Weekday of the recurring client call, 0 = Sunday. Null = unknown; the weekly rollup is then never shown.';
COMMENT ON COLUMN public.clients.daily_comparison_mode_resolved IS 'What auto resolved to at the last weekly refresh. Ignored when daily_comparison_mode is not auto.';
COMMENT ON COLUMN public.clients.current_focus IS 'What CPM is working on for this client; printed by holding-mode daily updates. manual values are never overwritten.';