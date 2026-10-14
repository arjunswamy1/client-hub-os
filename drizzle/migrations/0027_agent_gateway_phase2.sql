ALTER TABLE public.agent_gateway_tokens ALTER COLUMN expires_at SET DEFAULT (now() + interval '90 days');
ALTER TABLE public.integrations ADD COLUMN is_browser_login boolean NOT NULL DEFAULT false;
ALTER TABLE public.integrations ADD CONSTRAINT integrations_no_slack CHECK (lower(provider) NOT LIKE '%slack%');
ALTER TABLE public.agent_grants ADD COLUMN allow_browser_handoff boolean NOT NULL DEFAULT false;

CREATE TABLE public.agent_handoff_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  grant_id uuid REFERENCES public.agent_grants(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 5 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','used','expired')),
  decided_by_id uuid REFERENCES public.team_members(id),
  decided_at timestamptz,
  decision_note text,
  approval_expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.agent_handoff_requests TO authenticated;
GRANT ALL ON public.agent_handoff_requests TO service_role;
ALTER TABLE public.agent_handoff_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read handoffs" ON public.agent_handoff_requests FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.decide_agent_handoff(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := public.get_team_member_id(auth.uid()); n int;
BEGIN
  IF v_me IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'admins only'; END IF;
  UPDATE agent_handoff_requests SET
    status = CASE WHEN p_approve THEN 'approved' ELSE 'denied' END,
    decided_by_id = v_me, decided_at = now(), decision_note = left(p_note, 500),
    approval_expires_at = CASE WHEN p_approve THEN now() + interval '15 minutes' END
  WHERE id = p_request_id AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'request is not pending'; END IF;
  RETURN jsonb_build_object('ok', true, 'approved', p_approve);
END $$;
REVOKE ALL ON FUNCTION public.decide_agent_handoff(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_agent_handoff(uuid,boolean,text) TO authenticated;

CREATE TRIGGER agent_handoff_requests_admin_audit AFTER UPDATE ON public.agent_handoff_requests FOR EACH ROW EXECUTE FUNCTION public.agent_gateway_admin_audit();