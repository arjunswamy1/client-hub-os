-- Service identities (non-human team members, e.g. Grokbot)
ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS is_service_account boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS service_owner_id uuid REFERENCES public.team_members(id);
COMMENT ON COLUMN public.team_members.is_service_account IS 'Non-human identity (agent). Never a brief/task assignee, never DMed, never in digests or designer capacity. Client access = all active clients.';

-- Close-out of terminal briefs without pretending they were delivered today
ALTER TABLE public.creative_briefs
  ADD COLUMN IF NOT EXISTS closed_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_out_by_id uuid REFERENCES public.team_members(id),
  ADD COLUMN IF NOT EXISTS closed_out_note text;

-- Agent feedback fields
ALTER TABLE public.task_feedback
  ADD COLUMN IF NOT EXISTS verdict text,
  ADD COLUMN IF NOT EXISTS subject_ref text;
ALTER TABLE public.task_feedback DROP CONSTRAINT IF EXISTS task_feedback_verdict_check;
ALTER TABLE public.task_feedback ADD CONSTRAINT task_feedback_verdict_check CHECK (verdict IS NULL OR verdict IN ('wrong','incomplete','unhelpful','good'));

-- Status history for creative briefs (every status change, with the acting identity)
CREATE TABLE public.creative_brief_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id uuid NOT NULL REFERENCES public.creative_briefs(id),
  from_status text,
  to_status text NOT NULL,
  changed_by_id uuid REFERENCES public.team_members(id),
  via text NOT NULL DEFAULT 'hub',
  note text,
  forced boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.creative_brief_status_history TO authenticated;
GRANT ALL ON public.creative_brief_status_history TO service_role;
ALTER TABLE public.creative_brief_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read brief status history with brief access" ON public.creative_brief_status_history FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.creative_briefs b WHERE b.id = brief_id AND (public.is_admin(auth.uid()) OR b.client_id IS NULL OR public.has_client_access(auth.uid(), b.client_id))));
CREATE INDEX creative_brief_status_history_brief_idx ON public.creative_brief_status_history (brief_id, created_at);

CREATE OR REPLACE FUNCTION public.creative_brief_log_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid; v_via text; v_note text; v_forced boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  v_actor := NULLIF(current_setting('app.actor_id', true), '')::uuid;
  IF v_actor IS NULL AND auth.uid() IS NOT NULL THEN v_actor := public.get_team_member_id(auth.uid()); END IF;
  v_via := COALESCE(NULLIF(current_setting('app.via', true), ''), 'hub');
  v_note := NULLIF(current_setting('app.note', true), '');
  v_forced := COALESCE(NULLIF(current_setting('app.forced', true), '')::boolean, false);
  INSERT INTO public.creative_brief_status_history (brief_id, from_status, to_status, changed_by_id, via, note, forced)
  VALUES (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, COALESCE(NEW.status, 'draft'), v_actor, v_via, v_note, v_forced);
  RETURN NEW;
END $$;
CREATE TRIGGER creative_briefs_log_status AFTER INSERT OR UPDATE OF status ON public.creative_briefs
  FOR EACH ROW EXECUTE FUNCTION public.creative_brief_log_status();

-- A service account is never a valid assignee
CREATE OR REPLACE FUNCTION public.refuse_service_account_assignee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  v_id := CASE TG_TABLE_NAME WHEN 'creative_briefs' THEN NEW.assigned_to_id ELSE NEW.assignee_id END;
  IF v_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.team_members WHERE id = v_id AND is_service_account) THEN
    RAISE EXCEPTION 'a service account cannot be assigned work' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER creative_briefs_no_service_assignee BEFORE INSERT OR UPDATE OF assigned_to_id ON public.creative_briefs
  FOR EACH ROW EXECUTE FUNCTION public.refuse_service_account_assignee();
CREATE TRIGGER tasks_no_service_assignee BEFORE INSERT OR UPDATE OF assignee_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.refuse_service_account_assignee();

-- The single write path for agent changes to a brief: optimistic concurrency + attribution, atomically.
CREATE OR REPLACE FUNCTION public.agent_write_creative_brief(
  p_brief_id uuid, p_actor_id uuid, p_expected_updated_at timestamptz, p_patch jsonb,
  p_comment text, p_via text, p_note text, p_forced boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before public.creative_briefs; v_after public.creative_briefs;
BEGIN
  SELECT * INTO v_before FROM public.creative_briefs WHERE id = p_brief_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'not_found'); END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('outcome', 'refused_stale', 'current_updated_at', v_before.updated_at);
  END IF;
  PERFORM set_config('app.actor_id', p_actor_id::text, true);
  PERFORM set_config('app.via', COALESCE(p_via, 'agent'), true);
  PERFORM set_config('app.note', COALESCE(p_note, ''), true);
  PERFORM set_config('app.forced', COALESCE(p_forced, false)::text, true);
  UPDATE public.creative_briefs SET
    status = CASE WHEN p_patch ? 'status' THEN p_patch->>'status' ELSE status END,
    assigned_to_id = CASE WHEN p_patch ? 'assigned_to_id' THEN (p_patch->>'assigned_to_id')::uuid ELSE assigned_to_id END,
    due_date = CASE WHEN p_patch ? 'due_date' THEN (p_patch->>'due_date')::date ELSE due_date END,
    submitted_at = CASE WHEN p_patch ? 'submitted_at' THEN (p_patch->>'submitted_at')::timestamptz ELSE submitted_at END,
    approved_at = CASE WHEN p_patch ? 'approved_at' THEN (p_patch->>'approved_at')::timestamptz ELSE approved_at END,
    delivered_at = CASE WHEN p_patch ? 'delivered_at' THEN (p_patch->>'delivered_at')::timestamptz ELSE delivered_at END,
    closed_out_at = CASE WHEN p_patch ? 'closed_out_at' THEN (p_patch->>'closed_out_at')::timestamptz ELSE closed_out_at END,
    closed_out_by_id = CASE WHEN p_patch ? 'closed_out_at' THEN p_actor_id ELSE closed_out_by_id END,
    closed_out_note = CASE WHEN p_patch ? 'closed_out_note' THEN p_patch->>'closed_out_note' ELSE closed_out_note END
  WHERE id = p_brief_id
  RETURNING * INTO v_after;
  IF p_comment IS NOT NULL AND length(p_comment) > 0 THEN
    INSERT INTO public.creative_brief_comments (brief_id, author_id, content) VALUES (p_brief_id, p_actor_id, p_comment);
  END IF;
  RETURN jsonb_build_object('outcome', 'ok', 'before', to_jsonb(v_before), 'after', to_jsonb(v_after));
END $$;
REVOKE ALL ON FUNCTION public.agent_write_creative_brief(uuid, uuid, timestamptz, jsonb, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_write_creative_brief(uuid, uuid, timestamptz, jsonb, text, text, text, boolean) TO service_role;