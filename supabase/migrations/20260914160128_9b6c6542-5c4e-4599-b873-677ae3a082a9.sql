CREATE TABLE public.media_brain_platform_conversions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform text NOT NULL,
  entity_level text NOT NULL,
  entity_ref text NOT NULL,
  entity_name text,
  date date NOT NULL,
  event_name text NOT NULL,
  count numeric NOT NULL DEFAULT 0,
  value numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'insights',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT media_brain_platform_conversions_level_chk
    CHECK (entity_level IN ('account','campaign','adset','ad')),
  CONSTRAINT media_brain_platform_conversions_uniq
    UNIQUE (client_id, platform, entity_level, entity_ref, date, event_name)
);

GRANT SELECT ON public.media_brain_platform_conversions TO authenticated;
GRANT ALL ON public.media_brain_platform_conversions TO service_role;

ALTER TABLE public.media_brain_platform_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view platform conversions"
  ON public.media_brain_platform_conversions FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Assigned team can view platform conversions"
  ON public.media_brain_platform_conversions FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

CREATE INDEX idx_mb_platform_conv_lookup
  ON public.media_brain_platform_conversions (client_id, platform, entity_level, date);

CREATE TRIGGER trg_mb_platform_conversions_updated
  BEFORE UPDATE ON public.media_brain_platform_conversions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();