-- House style reference, editable without a code change.
CREATE TABLE IF NOT EXISTS public.daily_update_style (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  guidance text NOT NULL DEFAULT '',
  example_text text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_update_style TO authenticated;
GRANT ALL ON public.daily_update_style TO service_role;
ALTER TABLE public.daily_update_style ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can read daily update style"
  ON public.daily_update_style FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()));

CREATE POLICY "Admins and AMs manage daily update style"
  ON public.daily_update_style FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()));

-- One drafted daily update per client per day.
CREATE TABLE IF NOT EXISTS public.client_daily_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  for_date date NOT NULL,
  kind text NOT NULL DEFAULT 'draft' CHECK (kind IN ('draft','prompt')),
  draft_text text NOT NULL,
  final_text text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','edited','sent')),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  slack_channel_id text,
  slack_ts text,
  edited_by_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, for_date)
);

CREATE INDEX IF NOT EXISTS client_daily_updates_date_idx ON public.client_daily_updates (for_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_daily_updates TO authenticated;
GRANT ALL ON public.client_daily_updates TO service_role;
ALTER TABLE public.client_daily_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can read client daily updates"
  ON public.client_daily_updates FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), client_id));

CREATE POLICY "Team can write client daily updates"
  ON public.client_daily_updates FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), client_id))
  WITH CHECK (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), client_id));

CREATE TRIGGER client_daily_updates_updated_at
  BEFORE UPDATE ON public.client_daily_updates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER daily_update_style_updated_at
  BEFORE UPDATE ON public.daily_update_style
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();