-- ============================================================================
-- TECH PRICING (rate card)
-- ============================================================================
CREATE TABLE public.tech_pricing (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  service TEXT NOT NULL,
  model TEXT,
  unit TEXT NOT NULL, -- 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'calls', 'gb_month', 'emails'
  rate_per_unit_usd NUMERIC NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tech_pricing_lookup ON public.tech_pricing(service, model, unit, effective_from DESC);

ALTER TABLE public.tech_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all pricing"
  ON public.tech_pricing FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()));

-- Seed current pricing (per 1 unit of measure — divide by 1M for token rates)
-- Anthropic Claude Sonnet 4.5
INSERT INTO public.tech_pricing (service, model, unit, rate_per_unit_usd, notes) VALUES
  ('anthropic', 'claude-sonnet-4-5-20250929', 'input_tokens',       0.000003,  '$3 / 1M input tokens'),
  ('anthropic', 'claude-sonnet-4-5-20250929', 'output_tokens',      0.000015,  '$15 / 1M output tokens'),
  ('anthropic', 'claude-sonnet-4-5-20250929', 'cache_read_tokens',  0.0000003, '$0.30 / 1M cache read'),
  ('anthropic', 'claude-sonnet-4-5-20250929', 'cache_write_tokens', 0.00000375,'$3.75 / 1M cache write'),
  ('anthropic', 'claude-haiku-4-5-20251001', 'input_tokens',        0.000001,  '$1 / 1M input tokens'),
  ('anthropic', 'claude-haiku-4-5-20251001', 'output_tokens',       0.000005,  '$5 / 1M output tokens'),
  ('anthropic', 'claude-opus-4-1-20250805',  'input_tokens',        0.000015,  '$15 / 1M input tokens'),
  ('anthropic', 'claude-opus-4-1-20250805',  'output_tokens',       0.000075,  '$75 / 1M output tokens'),
  ('openai',    'gpt-5',                     'input_tokens',        0.0000025, '$2.50 / 1M input'),
  ('openai',    'gpt-5',                     'output_tokens',       0.00001,   '$10 / 1M output'),
  ('openai',    'gpt-5-mini',                'input_tokens',        0.00000025,'$0.25 / 1M input'),
  ('openai',    'gpt-5-mini',                'output_tokens',       0.000002,  '$2 / 1M output'),
  ('supabase',  NULL,                        'gb_month',            0.021,     '$0.021 / GB-month storage'),
  ('supabase',  NULL,                        'calls',               0.000002,  'Edge function invocation est ~$2/M'),
  ('resend',    NULL,                        'emails',              0.0004,    '$0.40 / 1k emails'),
  ('meta_api',  NULL,                        'calls',               0,         'Free tier'),
  ('google_api',NULL,                        'calls',               0,         'Free tier'),
  ('ringba_api',NULL,                        'calls',               0,         'Included in subscription'),
  ('fathom_api',NULL,                        'calls',               0,         'Included in subscription'),
  ('slack_api', NULL,                        'calls',               0,         'Free tier');

-- ============================================================================
-- TECH USAGE EVENTS (per-call log)
-- ============================================================================
CREATE TABLE public.tech_usage_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('ai', 'integration', 'storage', 'email')),
  service TEXT NOT NULL,
  surface TEXT, -- 'ai-assistant', 'slack-ai-bot', 'cron', 'manual', 'webhook'
  model TEXT,
  input_tokens BIGINT DEFAULT 0,
  output_tokens BIGINT DEFAULT 0,
  cache_read_tokens BIGINT DEFAULT 0,
  cache_write_tokens BIGINT DEFAULT 0,
  quantity NUMERIC DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'calls',
  cost_usd NUMERIC NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tech_usage_events_client_date ON public.tech_usage_events(client_id, created_at DESC);
CREATE INDEX idx_tech_usage_events_category    ON public.tech_usage_events(category, created_at DESC);
CREATE INDEX idx_tech_usage_events_service     ON public.tech_usage_events(service, created_at DESC);

ALTER TABLE public.tech_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all usage events"
  ON public.tech_usage_events FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()));

-- ============================================================================
-- TECH USAGE DAILY (rollup)
-- ============================================================================
CREATE TABLE public.tech_usage_daily (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  category TEXT NOT NULL,
  service TEXT NOT NULL,
  total_input_tokens BIGINT NOT NULL DEFAULT 0,
  total_output_tokens BIGINT NOT NULL DEFAULT 0,
  total_cache_read_tokens BIGINT NOT NULL DEFAULT 0,
  total_cache_write_tokens BIGINT NOT NULL DEFAULT 0,
  total_quantity NUMERIC NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_tech_usage_daily ON public.tech_usage_daily(COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid), date, category, service);
CREATE INDEX idx_tech_usage_daily_date ON public.tech_usage_daily(date DESC);
CREATE INDEX idx_tech_usage_daily_client ON public.tech_usage_daily(client_id, date DESC);

ALTER TABLE public.tech_usage_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all daily usage"
  ON public.tech_usage_daily FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()));

-- ============================================================================
-- COST CALCULATION HELPER
-- ============================================================================
CREATE OR REPLACE FUNCTION public.compute_tech_cost(
  p_service TEXT,
  p_model TEXT,
  p_unit TEXT,
  p_quantity NUMERIC DEFAULT 0,
  p_input_tokens BIGINT DEFAULT 0,
  p_output_tokens BIGINT DEFAULT 0,
  p_cache_read_tokens BIGINT DEFAULT 0,
  p_cache_write_tokens BIGINT DEFAULT 0
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost NUMERIC := 0;
  v_rate NUMERIC;
BEGIN
  -- Token-based pricing
  IF p_input_tokens > 0 THEN
    SELECT rate_per_unit_usd INTO v_rate FROM public.tech_pricing
    WHERE service = p_service AND (model = p_model OR (model IS NULL AND p_model IS NULL))
      AND unit = 'input_tokens'
      AND (effective_to IS NULL OR effective_to > now())
    ORDER BY effective_from DESC LIMIT 1;
    v_cost := v_cost + (p_input_tokens * COALESCE(v_rate, 0));
  END IF;

  IF p_output_tokens > 0 THEN
    SELECT rate_per_unit_usd INTO v_rate FROM public.tech_pricing
    WHERE service = p_service AND (model = p_model OR (model IS NULL AND p_model IS NULL))
      AND unit = 'output_tokens'
      AND (effective_to IS NULL OR effective_to > now())
    ORDER BY effective_from DESC LIMIT 1;
    v_cost := v_cost + (p_output_tokens * COALESCE(v_rate, 0));
  END IF;

  IF p_cache_read_tokens > 0 THEN
    SELECT rate_per_unit_usd INTO v_rate FROM public.tech_pricing
    WHERE service = p_service AND (model = p_model OR (model IS NULL AND p_model IS NULL))
      AND unit = 'cache_read_tokens'
      AND (effective_to IS NULL OR effective_to > now())
    ORDER BY effective_from DESC LIMIT 1;
    v_cost := v_cost + (p_cache_read_tokens * COALESCE(v_rate, 0));
  END IF;

  IF p_cache_write_tokens > 0 THEN
    SELECT rate_per_unit_usd INTO v_rate FROM public.tech_pricing
    WHERE service = p_service AND (model = p_model OR (model IS NULL AND p_model IS NULL))
      AND unit = 'cache_write_tokens'
      AND (effective_to IS NULL OR effective_to > now())
    ORDER BY effective_from DESC LIMIT 1;
    v_cost := v_cost + (p_cache_write_tokens * COALESCE(v_rate, 0));
  END IF;

  -- Non-token pricing (calls, gb_month, emails)
  IF p_quantity > 0 AND p_unit IN ('calls', 'gb_month', 'emails') THEN
    SELECT rate_per_unit_usd INTO v_rate FROM public.tech_pricing
    WHERE service = p_service AND (model IS NULL OR model = p_model)
      AND unit = p_unit
      AND (effective_to IS NULL OR effective_to > now())
    ORDER BY effective_from DESC LIMIT 1;
    v_cost := v_cost + (p_quantity * COALESCE(v_rate, 0));
  END IF;

  RETURN v_cost;
END;
$$;