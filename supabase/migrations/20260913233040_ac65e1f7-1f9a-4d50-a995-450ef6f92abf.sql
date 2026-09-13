CREATE TABLE public.media_brain_economics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  vertical text,
  platforms text[],
  ad_account_ids text[],
  tracking_platform text CHECK (tracking_platform IN ('ringba','ringba_4js','ringfuel','moja','cannaball','jacuzzi','other')),
  payout_mode text NOT NULL CHECK (payout_mode IN ('static','rtb')),
  payout numeric,
  billable_min_duration_seconds integer,
  billable_filters jsonb DEFAULT '{}',
  bid_floor numeric,
  bid_ceiling numeric,
  avg_bid numeric,
  duration_min_seconds integer,
  duration_max_seconds integer,
  daily_budget numeric,
  expected_cost_per_call numeric,
  expected_cost_per_billable_call numeric,
  funnel_type text CHECK (funnel_type IN ('landing_page','click_to_call')),
  funnel_cta text,
  has_ivr boolean DEFAULT false,
  steps_to_live_person integer,
  buyer_hours jsonb DEFAULT '{}',
  reporting_format text,
  reporting_cadence text,
  campaign_state text CHECK (campaign_state IN ('new_build','existing')),
  existing_structure_notes text,
  known_problems text,
  routing_mode text NOT NULL DEFAULT 'recommend_only',
  unknown_fields text[] DEFAULT '{}',
  last_reviewed_at date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_brain_economics TO authenticated;
GRANT ALL ON public.media_brain_economics TO service_role;
ALTER TABLE public.media_brain_economics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage all media brain economics" ON public.media_brain_economics FOR ALL TO authenticated USING (is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client media brain economics" ON public.media_brain_economics FOR ALL TO authenticated USING (has_client_access(auth.uid(), client_id));

CREATE TABLE public.media_brain_instances (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  economics_id uuid REFERENCES public.media_brain_economics(id) ON DELETE CASCADE,
  target_margin numeric NOT NULL DEFAULT 0.20,
  min_margin numeric NOT NULL DEFAULT 0.10,
  actionable_gap numeric NOT NULL DEFAULT 0.40,
  baseline_rpc numeric,
  allowable_cost_per_call numeric,
  kill_threshold numeric,
  min_calls integer,
  expected_billable_calls_per_week numeric,
  volume_tier text,
  cut_cadence text,
  scale_cadence text,
  cost_per_angle numeric,
  max_angles integer,
  test_budget_pct numeric,
  lifecycle_stage text CHECK (lifecycle_stage IN ('launch','mature')) DEFAULT 'launch',
  naming_convention jsonb DEFAULT '{}',
  flags jsonb DEFAULT '[]',
  computed_at timestamptz DEFAULT now(),
  is_stale boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_brain_instances TO authenticated;
GRANT ALL ON public.media_brain_instances TO service_role;
ALTER TABLE public.media_brain_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage all media brain instances" ON public.media_brain_instances FOR ALL TO authenticated USING (is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client media brain instances" ON public.media_brain_instances FOR ALL TO authenticated USING (has_client_access(auth.uid(), client_id));

CREATE TABLE public.media_brain_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  instance_id uuid REFERENCES public.media_brain_instances(id) ON DELETE SET NULL,
  cadence text NOT NULL CHECK (cadence IN ('daily','weekly','monthly')),
  window_start date NOT NULL,
  window_end date NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved')),
  totals jsonb DEFAULT '{}',
  breakers jsonb DEFAULT '[]',
  diagnostics jsonb DEFAULT '[]',
  pull_ok boolean NOT NULL DEFAULT false,
  pull_error text,
  created_by_id uuid,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_brain_reviews TO authenticated;
GRANT ALL ON public.media_brain_reviews TO service_role;
ALTER TABLE public.media_brain_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage all media brain reviews" ON public.media_brain_reviews FOR ALL TO authenticated USING (is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client media brain reviews" ON public.media_brain_reviews FOR ALL TO authenticated USING (has_client_access(auth.uid(), client_id));

CREATE TABLE public.media_brain_dispositions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  instance_id uuid REFERENCES public.media_brain_instances(id) ON DELETE CASCADE,
  review_id uuid REFERENCES public.media_brain_reviews(id) ON DELETE CASCADE,
  entity_level text NOT NULL CHECK (entity_level IN ('campaign','adset','ad')),
  entity_ref text NOT NULL,
  entity_name text,
  verdict text NOT NULL CHECK (verdict IN ('keep','cut','hold')),
  reason text,
  evidence jsonb DEFAULT '{}',
  confidence_state text CHECK (confidence_state IN ('sufficient','insufficient','decisive_zero')),
  awaiting_evidence text,
  review_date date,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected')),
  decided_by_id uuid,
  decided_at timestamptz,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT media_brain_hold_requires_evidence_and_date CHECK (
    verdict <> 'hold' OR (awaiting_evidence IS NOT NULL AND review_date IS NOT NULL)
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_brain_dispositions TO authenticated;
GRANT ALL ON public.media_brain_dispositions TO service_role;
ALTER TABLE public.media_brain_dispositions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage all media brain dispositions" ON public.media_brain_dispositions FOR ALL TO authenticated USING (is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client media brain dispositions" ON public.media_brain_dispositions FOR ALL TO authenticated USING (has_client_access(auth.uid(), client_id));

CREATE TABLE public.media_brain_change_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  change_date date NOT NULL DEFAULT current_date,
  entity_level text,
  entity_ref text,
  entity_name text,
  change_description text NOT NULL,
  why text NOT NULL,
  expected_result text NOT NULL,
  review_date date NOT NULL,
  is_changepoint boolean NOT NULL DEFAULT false,
  outcome text,
  reviewed_at timestamptz,
  created_by_id uuid,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_brain_change_log TO authenticated;
GRANT ALL ON public.media_brain_change_log TO service_role;
ALTER TABLE public.media_brain_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage all media brain change log" ON public.media_brain_change_log FOR ALL TO authenticated USING (is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client media brain change log" ON public.media_brain_change_log FOR ALL TO authenticated USING (has_client_access(auth.uid(), client_id));

CREATE INDEX idx_mb_economics_client ON public.media_brain_economics(client_id);
CREATE INDEX idx_mb_instances_client ON public.media_brain_instances(client_id);
CREATE INDEX idx_mb_reviews_client ON public.media_brain_reviews(client_id);
CREATE INDEX idx_mb_dispositions_client ON public.media_brain_dispositions(client_id);
CREATE INDEX idx_mb_change_log_client ON public.media_brain_change_log(client_id);
CREATE INDEX idx_mb_reviews_client_window ON public.media_brain_reviews(client_id, window_start, window_end);
CREATE INDEX idx_mb_change_log_client_review ON public.media_brain_change_log(client_id, review_date);

CREATE TRIGGER update_mb_economics_updated_at BEFORE UPDATE ON public.media_brain_economics FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_mb_instances_updated_at BEFORE UPDATE ON public.media_brain_instances FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();