CREATE TABLE public.media_brain_location_score_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL CHECK (source IN ('upload','live')),
  source_label TEXT,
  payout_mode TEXT,
  id_col TEXT NOT NULL,
  volume_col TEXT NOT NULL,
  success_col TEXT NOT NULL,
  value_col TEXT,
  hard_fail_col TEXT,
  hard_fail_rate_max NUMERIC NOT NULL,
  min_success_rate NUMERIC NOT NULL,
  confidence_min INTEGER NOT NULL,
  confidence_high INTEGER NOT NULL,
  weight_success NUMERIC NOT NULL,
  weight_value NUMERIC NOT NULL,
  weight_volume NUMERIC NOT NULL,
  launch_tier_pct NUMERIC NOT NULL,
  expand_tier_pct NUMERIC NOT NULL,
  launch_size INTEGER NOT NULL,
  budget_daily NUMERIC,
  locations_total INTEGER NOT NULL DEFAULT 0,
  locations_scored INTEGER NOT NULL DEFAULT 0,
  locations_excluded INTEGER NOT NULL DEFAULT 0,
  launch_qualifying INTEGER NOT NULL DEFAULT 0,
  launch_list_size INTEGER NOT NULL DEFAULT 0,
  weight_redistribution_note TEXT,
  publisher_scoping_note TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_brain_location_score_runs TO authenticated;
GRANT ALL ON public.media_brain_location_score_runs TO service_role;
ALTER TABLE public.media_brain_location_score_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage all media brain location score runs"
  ON public.media_brain_location_score_runs FOR ALL TO authenticated
  USING (is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client location score runs"
  ON public.media_brain_location_score_runs FOR ALL TO authenticated
  USING (has_client_access(auth.uid(), client_id));

CREATE TABLE public.media_brain_location_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.media_brain_location_score_runs(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL CHECK (source IN ('upload','live')),
  id_col TEXT NOT NULL,
  volume_col TEXT NOT NULL,
  success_col TEXT NOT NULL,
  value_col TEXT,
  hard_fail_col TEXT,
  hard_fail_rate_max NUMERIC NOT NULL,
  min_success_rate NUMERIC NOT NULL,
  confidence_min INTEGER NOT NULL,
  confidence_high INTEGER NOT NULL,
  weight_success NUMERIC NOT NULL,
  weight_value NUMERIC NOT NULL,
  weight_volume NUMERIC NOT NULL,
  location_id TEXT NOT NULL,
  volume NUMERIC NOT NULL DEFAULT 0,
  success NUMERIC NOT NULL DEFAULT 0,
  success_rate NUMERIC,
  value NUMERIC,
  hard_fail NUMERIC,
  hard_fail_rate NUMERIC,
  score NUMERIC,
  score_percentile NUMERIC,
  confidence TEXT,
  tier TEXT,
  in_launch_list BOOLEAN NOT NULL DEFAULT false,
  excluded BOOLEAN NOT NULL DEFAULT false,
  exclude_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_brain_location_scores TO authenticated;
GRANT ALL ON public.media_brain_location_scores TO service_role;
ALTER TABLE public.media_brain_location_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage all media brain location scores"
  ON public.media_brain_location_scores FOR ALL TO authenticated
  USING (is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client location scores"
  ON public.media_brain_location_scores FOR ALL TO authenticated
  USING (has_client_access(auth.uid(), client_id));

CREATE INDEX idx_mb_location_scores_run ON public.media_brain_location_scores(run_id);
CREATE INDEX idx_mb_location_scores_client ON public.media_brain_location_scores(client_id, run_at DESC);
CREATE INDEX idx_mb_location_score_runs_client ON public.media_brain_location_score_runs(client_id, run_at DESC);

CREATE TRIGGER trg_mb_location_score_runs_updated
  BEFORE UPDATE ON public.media_brain_location_score_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();