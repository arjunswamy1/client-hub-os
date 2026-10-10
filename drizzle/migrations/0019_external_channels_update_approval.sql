ALTER TABLE public.slack_channel_mappings
  ADD COLUMN IF NOT EXISTS proposed_client_id uuid REFERENCES public.clients(id),
  ADD COLUMN IF NOT EXISTS proposal_reason text,
  ADD COLUMN IF NOT EXISTS discovered_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_enabled_by_id uuid REFERENCES public.team_members(id),
  ADD COLUMN IF NOT EXISTS sync_enabled_at timestamptz;
COMMENT ON COLUMN public.slack_channel_mappings.proposed_client_id IS 'Name-based suggestion only. Never read as a mapping; client_id is set only by a person.';

CREATE TABLE IF NOT EXISTS public.slack_channel_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id text NOT NULL,
  channel_name text,
  action text NOT NULL CHECK (action IN ('enabled','disabled')),
  client_id uuid,
  team_member_id uuid NOT NULL REFERENCES public.team_members(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.slack_channel_sync_log TO authenticated;
GRANT ALL ON public.slack_channel_sync_log TO service_role;
ALTER TABLE public.slack_channel_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read channel sync log" ON public.slack_channel_sync_log FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

ALTER TABLE public.client_daily_updates
  ADD COLUMN IF NOT EXISTS approved_by_id uuid REFERENCES public.team_members(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS narrative_by text,
  ADD COLUMN IF NOT EXISTS narrative_at timestamptz;

ALTER TABLE public.slack_outbox ADD COLUMN IF NOT EXISTS internal_only boolean NOT NULL DEFAULT false;

ALTER TABLE public.bot_runtime_settings ADD COLUMN IF NOT EXISTS client_auto_send text NOT NULL DEFAULT 'off';
ALTER TABLE public.bot_runtime_settings ADD CONSTRAINT bot_runtime_settings_client_auto_send_off CHECK (client_auto_send = 'off');
COMMENT ON COLUMN public.bot_runtime_settings.client_auto_send IS 'Client-facing auto-send. Decided 2026-10-12: every client-facing update needs a named human; off is the only supported value.';

CREATE OR REPLACE FUNCTION public.set_channel_sync(p_channel_id text, p_enabled boolean, p_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := public.get_team_member_id(auth.uid()); v_row public.slack_channel_mappings;
BEGIN
  IF NOT public.is_admin(auth.uid()) OR v_me IS NULL THEN RAISE EXCEPTION 'admins only'; END IF;
  SELECT * INTO v_row FROM public.slack_channel_mappings WHERE channel_id = p_channel_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown channel'; END IF;
  IF p_enabled AND p_client_id IS NULL AND v_row.client_id IS NULL THEN RAISE EXCEPTION 'choose the client before enabling sync'; END IF;
  UPDATE public.slack_channel_mappings SET
    sync_enabled = p_enabled,
    client_id = COALESCE(p_client_id, client_id),
    sync_enabled_by_id = v_me, sync_enabled_at = now(), updated_at = now()
  WHERE channel_id = p_channel_id;
  INSERT INTO public.slack_channel_sync_log (channel_id, channel_name, action, client_id, team_member_id)
  VALUES (p_channel_id, v_row.channel_name, CASE WHEN p_enabled THEN 'enabled' ELSE 'disabled' END, COALESCE(p_client_id, v_row.client_id), v_me);
  RETURN jsonb_build_object('ok', true, 'channel_id', p_channel_id, 'sync_enabled', p_enabled);
END $$;
REVOKE ALL ON FUNCTION public.set_channel_sync(text, boolean, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_channel_sync(text, boolean, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_daily_update(p_update_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := public.get_team_member_id(auth.uid()); v_client uuid;
BEGIN
  SELECT client_id INTO v_client FROM public.client_daily_updates WHERE id = p_update_id;
  IF v_client IS NULL THEN RAISE EXCEPTION 'unknown update'; END IF;
  IF v_me IS NULL OR NOT (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), v_client)) THEN RAISE EXCEPTION 'not authorised'; END IF;
  UPDATE public.client_daily_updates SET approved_by_id = v_me, approved_at = now(), updated_at = now() WHERE id = p_update_id;
  RETURN jsonb_build_object('ok', true, 'approved_by_id', v_me);
END $$;
REVOKE ALL ON FUNCTION public.approve_daily_update(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.approve_daily_update(uuid) TO authenticated;