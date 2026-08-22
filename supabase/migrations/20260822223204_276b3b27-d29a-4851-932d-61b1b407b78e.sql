CREATE TABLE public.ai_optimizer_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'buyology',
  product_line text NOT NULL,
  line_label text,
  range_label text,
  source text NOT NULL DEFAULT 'manual',
  plan jsonb NOT NULL,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  attribution_rate numeric,
  period_key text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ai_optimizer_briefs_period_uq
  ON public.ai_optimizer_briefs (client_id, scope, product_line, period_key)
  WHERE source = 'scheduled';
CREATE INDEX ai_optimizer_briefs_lookup
  ON public.ai_optimizer_briefs (client_id, scope, product_line, generated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_optimizer_briefs TO authenticated;
GRANT ALL ON public.ai_optimizer_briefs TO service_role;
ALTER TABLE public.ai_optimizer_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can view optimizer briefs"
  ON public.ai_optimizer_briefs FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), client_id));
CREATE POLICY "Team can write optimizer briefs"
  ON public.ai_optimizer_briefs FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), client_id));
CREATE POLICY "Team can delete optimizer briefs"
  ON public.ai_optimizer_briefs FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), client_id));

CREATE TABLE public.ai_optimizer_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'buyology',
  enabled boolean NOT NULL DEFAULT false,
  cadence text NOT NULL DEFAULT 'weekly',
  run_hour_utc integer NOT NULL DEFAULT 12,
  product_lines text[] NOT NULL DEFAULT ARRAY['tubs','bath'],
  notes text,
  status text NOT NULL DEFAULT 'active',
  pause_reason text,
  paused_at timestamptz,
  last_run_at timestamptz,
  last_error text,
  next_run_at timestamptz,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_optimizer_schedules_cadence_chk CHECK (cadence IN ('daily','weekly')),
  CONSTRAINT ai_optimizer_schedules_status_chk CHECK (status IN ('active','paused')),
  CONSTRAINT ai_optimizer_schedules_hour_chk CHECK (run_hour_utc BETWEEN 0 AND 23),
  CONSTRAINT ai_optimizer_schedules_uq UNIQUE (client_id, scope)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_optimizer_schedules TO authenticated;
GRANT ALL ON public.ai_optimizer_schedules TO service_role;
ALTER TABLE public.ai_optimizer_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can view optimizer schedules"
  ON public.ai_optimizer_schedules FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), client_id));
CREATE POLICY "Team can manage optimizer schedules"
  ON public.ai_optimizer_schedules FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), client_id))
  WITH CHECK (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), client_id));

CREATE TRIGGER trg_ai_optimizer_schedules_updated
  BEFORE UPDATE ON public.ai_optimizer_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();