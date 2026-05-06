-- 1) Extend compute_tech_cost to support 'seconds' and 'characters' units
CREATE OR REPLACE FUNCTION public.compute_tech_cost(
  p_service text,
  p_model text,
  p_unit text,
  p_quantity numeric DEFAULT 0,
  p_input_tokens bigint DEFAULT 0,
  p_output_tokens bigint DEFAULT 0,
  p_cache_read_tokens bigint DEFAULT 0,
  p_cache_write_tokens bigint DEFAULT 0
)
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Quantity-based pricing (calls, gb_month, emails, seconds, characters)
  IF p_quantity > 0 AND p_unit IN ('calls', 'gb_month', 'emails', 'seconds', 'characters') THEN
    SELECT rate_per_unit_usd INTO v_rate FROM public.tech_pricing
    WHERE service = p_service
      AND (model = p_model OR (model IS NULL AND p_model IS NULL))
      AND unit = p_unit
      AND (effective_to IS NULL OR effective_to > now())
    ORDER BY effective_from DESC LIMIT 1;
    v_cost := v_cost + (p_quantity * COALESCE(v_rate, 0));
  END IF;

  RETURN v_cost;
END;
$function$;

-- 2) Seed pricing for Veo, ElevenLabs, Gemini (best-effort public rates; admins can update)
INSERT INTO public.tech_pricing (service, model, unit, rate_per_unit_usd, notes) VALUES
  ('google_veo',   'veo-3.1-generate-preview',  'seconds',       0.40,        'Veo 3.1 with audio — public preview pricing'),
  ('elevenlabs',   'eleven_multilingual_v2',    'characters',    0.00015,     'ElevenLabs TTS Creator-tier blended rate (~$0.15 per 1k chars)'),
  ('elevenlabs',   'music',                     'seconds',       0.08,        'ElevenLabs Music API estimate per generated second'),
  ('google',       'gemini-2.5-pro',            'input_tokens',  0.00000125,  'Gemini 2.5 Pro input ($1.25 / 1M)'),
  ('google',       'gemini-2.5-pro',            'output_tokens', 0.00001,     'Gemini 2.5 Pro output ($10 / 1M)'),
  ('google',       'gemini-2.5-flash',          'input_tokens',  0.0000003,   'Gemini 2.5 Flash input'),
  ('google',       'gemini-2.5-flash',          'output_tokens', 0.0000025,   'Gemini 2.5 Flash output'),
  ('google',       'gemini-2.5-flash-lite',     'input_tokens',  0.0000001,   'Gemini 2.5 Flash Lite input'),
  ('google',       'gemini-2.5-flash-lite',     'output_tokens', 0.0000004,   'Gemini 2.5 Flash Lite output')
ON CONFLICT DO NOTHING;