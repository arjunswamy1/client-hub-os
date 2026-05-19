
-- =============================================================
-- 4Js Final Expense: DID attribution + Ringba calls + spend
-- =============================================================

-- 1) DID registry --------------------------------------------------
CREATE TABLE public.client_dids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  did TEXT NOT NULL,                 -- E.164: +18004758818
  did_formatted TEXT,                -- 1-800-475-8818
  platform TEXT,                     -- 'roku' | 'universal' | 'google_demand_gen'
  creative_name TEXT,
  audience_cluster TEXT,
  campaign_name TEXT,
  ad_length TEXT,
  targeting_notes TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','not_in_use')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by_id UUID REFERENCES public.team_members(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, did)
);

CREATE INDEX idx_dids_client ON public.client_dids(client_id, did);
CREATE INDEX idx_dids_status ON public.client_dids(client_id, status);

-- 2) DID assignment history ---------------------------------------
CREATE TABLE public.client_did_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  did_id UUID NOT NULL REFERENCES public.client_dids(id) ON DELETE CASCADE,
  platform TEXT,
  creative_name TEXT,
  audience_cluster TEXT,
  campaign_name TEXT,
  ad_length TEXT,
  status TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_id UUID REFERENCES public.team_members(id)
);
CREATE INDEX idx_did_history_did ON public.client_did_history(did_id, changed_at DESC);

-- Auto-history trigger: snapshot previous values on UPDATE if any
-- attribution field changed.
CREATE OR REPLACE FUNCTION public.client_dids_log_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.platform         IS DISTINCT FROM OLD.platform OR
    NEW.creative_name    IS DISTINCT FROM OLD.creative_name OR
    NEW.audience_cluster IS DISTINCT FROM OLD.audience_cluster OR
    NEW.campaign_name    IS DISTINCT FROM OLD.campaign_name OR
    NEW.ad_length        IS DISTINCT FROM OLD.ad_length OR
    NEW.status           IS DISTINCT FROM OLD.status
  ) THEN
    INSERT INTO public.client_did_history
      (did_id, platform, creative_name, audience_cluster, campaign_name, ad_length, status, changed_by_id)
    VALUES
      (OLD.id, OLD.platform, OLD.creative_name, OLD.audience_cluster, OLD.campaign_name, OLD.ad_length, OLD.status,
       get_team_member_id(auth.uid()));
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_client_dids_history
BEFORE UPDATE ON public.client_dids
FOR EACH ROW EXECUTE FUNCTION public.client_dids_log_history();

-- 3) Ringba calls (4Js dedicated) ---------------------------------
CREATE TABLE public.ringba_calls_4js (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  ringba_call_id TEXT NOT NULL,
  did TEXT NOT NULL,                 -- inbound number dialed (join key)
  caller_number TEXT,
  caller_state TEXT,
  caller_city TEXT,
  call_start TIMESTAMPTZ NOT NULL,
  call_duration_seconds INTEGER DEFAULT 0,
  connected BOOLEAN DEFAULT false,
  connection_duration_seconds INTEGER DEFAULT 0,
  payout NUMERIC(10,2) DEFAULT 0,
  buyer_name TEXT,
  campaign_name TEXT,
  publisher_name TEXT,
  target_name TEXT,
  disposition TEXT,
  tags JSONB DEFAULT '{}'::jsonb,
  -- derived from client_dids at sync time:
  platform TEXT,
  creative_name TEXT,
  audience_cluster TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, ringba_call_id)
);
CREATE INDEX idx_ringba_4js_did   ON public.ringba_calls_4js(did);
CREATE INDEX idx_ringba_4js_date  ON public.ringba_calls_4js(client_id, call_start DESC);
CREATE INDEX idx_ringba_4js_plat  ON public.ringba_calls_4js(client_id, platform, call_start DESC);

-- 4) Platform spend (Google API + Roku/Universal CSV) -------------
CREATE TABLE public.platform_spend_4js (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  platform TEXT NOT NULL,            -- 'roku' | 'universal' | 'google_demand_gen'
  campaign_name TEXT,
  creative_name TEXT,
  audience_cluster TEXT,
  spend NUMERIC(12,2) DEFAULT 0,
  impressions BIGINT DEFAULT 0,
  completed_views BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual_upload'
    CHECK (source IN ('api','manual_upload','csv_import')),
  uploaded_by_id UUID REFERENCES public.team_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Unique key: nullable cols collapsed via COALESCE in a unique index
CREATE UNIQUE INDEX idx_spend_4js_unique
  ON public.platform_spend_4js (
    client_id, date, platform,
    COALESCE(campaign_name, ''),
    COALESCE(creative_name, ''),
    COALESCE(audience_cluster, '')
  );
CREATE INDEX idx_spend_4js_date ON public.platform_spend_4js(client_id, date, platform);

CREATE TRIGGER trg_spend_4js_updated_at
BEFORE UPDATE ON public.platform_spend_4js
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_client_dids_updated_at
BEFORE UPDATE ON public.client_dids
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- RLS
-- =============================================================
ALTER TABLE public.client_dids         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_did_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ringba_calls_4js    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_spend_4js  ENABLE ROW LEVEL SECURITY;

-- client_dids: admins + users with access to that client can view; admins+AMs can write
CREATE POLICY "dids_select" ON public.client_dids FOR SELECT TO authenticated
  USING (is_admin(auth.uid()) OR has_client_access(auth.uid(), client_id));
CREATE POLICY "dids_insert" ON public.client_dids FOR INSERT TO authenticated
  WITH CHECK (is_admin(auth.uid()) OR has_client_access(auth.uid(), client_id));
CREATE POLICY "dids_update" ON public.client_dids FOR UPDATE TO authenticated
  USING (is_admin(auth.uid()) OR has_client_access(auth.uid(), client_id));
CREATE POLICY "dids_delete" ON public.client_dids FOR DELETE TO authenticated
  USING (is_admin(auth.uid()));

-- history: read-only for those with client access (joined via did)
CREATE POLICY "did_history_select" ON public.client_did_history FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_dids d
      WHERE d.id = client_did_history.did_id
        AND (is_admin(auth.uid()) OR has_client_access(auth.uid(), d.client_id))
    )
  );
-- writes only by trigger (security definer) or admins
CREATE POLICY "did_history_insert_admin" ON public.client_did_history FOR INSERT TO authenticated
  WITH CHECK (is_admin(auth.uid()));

-- ringba_calls_4js: client-scoped read; writes are service-role (edge function)
CREATE POLICY "ringba_4js_select" ON public.ringba_calls_4js FOR SELECT TO authenticated
  USING (is_admin(auth.uid()) OR has_client_access(auth.uid(), client_id));

-- platform_spend_4js: client-scoped read; admins+AMs can upload
CREATE POLICY "spend_4js_select" ON public.platform_spend_4js FOR SELECT TO authenticated
  USING (is_admin(auth.uid()) OR has_client_access(auth.uid(), client_id));
CREATE POLICY "spend_4js_insert" ON public.platform_spend_4js FOR INSERT TO authenticated
  WITH CHECK (is_admin(auth.uid()) OR has_client_access(auth.uid(), client_id));
CREATE POLICY "spend_4js_update" ON public.platform_spend_4js FOR UPDATE TO authenticated
  USING (is_admin(auth.uid()) OR has_client_access(auth.uid(), client_id));
CREATE POLICY "spend_4js_delete" ON public.platform_spend_4js FOR DELETE TO authenticated
  USING (is_admin(auth.uid()));
