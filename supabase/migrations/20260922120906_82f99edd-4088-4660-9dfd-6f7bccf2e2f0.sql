CREATE TABLE IF NOT EXISTS public.ringfuel_import_staging (
  call_id text PRIMARY KEY,
  call_start text,
  caller_number text,
  did text,
  campaign_name text,
  publisher_name text,
  target_name text,
  buyer_name text,
  disposition text,
  duration_seconds text,
  connection_duration_seconds text,
  revenue text,
  converted text,
  caller_state text,
  caller_city text,
  recording_url text,
  did_name text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ringfuel_import_staging TO authenticated;
GRANT ALL ON public.ringfuel_import_staging TO service_role;
ALTER TABLE public.ringfuel_import_staging ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage ringfuel import staging" ON public.ringfuel_import_staging FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));