CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE public.task_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  source text NOT NULL,
  source_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_text text NOT NULL,
  proposed_title text NOT NULL,
  proposed_assignee_id uuid REFERENCES public.team_members(id),
  owner_raw text,
  owner_side text,
  status text NOT NULL DEFAULT 'pending',
  confidence numeric,
  gate_results jsonb NOT NULL DEFAULT '{}'::jsonb,
  rejected_reason text,
  duplicate_of_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  promoted_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  reviewed_by_id uuid REFERENCES public.team_members(id),
  reviewed_at timestamptz,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_candidates_status_check CHECK (status IN ('pending','promoted','rejected','merged','expired')),
  CONSTRAINT task_candidates_owner_side_check CHECK (owner_side IS NULL OR owner_side IN ('cpm','client','unknown'))
);

CREATE UNIQUE INDEX task_candidates_dedupe_key_idx ON public.task_candidates (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX task_candidates_status_idx ON public.task_candidates (status, client_id, created_at DESC);
CREATE INDEX task_candidates_title_trgm_idx ON public.task_candidates USING gin (proposed_title gin_trgm_ops);

GRANT SELECT, INSERT, UPDATE ON public.task_candidates TO authenticated;
GRANT ALL ON public.task_candidates TO service_role;
ALTER TABLE public.task_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members read candidates" ON public.task_candidates
  FOR SELECT TO authenticated USING (public.get_team_member_id(auth.uid()) IS NOT NULL);
CREATE POLICY "Team members create candidates" ON public.task_candidates
  FOR INSERT TO authenticated WITH CHECK (public.get_team_member_id(auth.uid()) IS NOT NULL);
CREATE POLICY "Team members review candidates" ON public.task_candidates
  FOR UPDATE TO authenticated USING (public.get_team_member_id(auth.uid()) IS NOT NULL)
  WITH CHECK (public.get_team_member_id(auth.uid()) IS NOT NULL);
CREATE POLICY "Service role manages candidates" ON public.task_candidates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER task_candidates_set_updated_at
  BEFORE UPDATE ON public.task_candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.task_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES public.task_candidates(id) ON DELETE CASCADE,
  team_member_id uuid REFERENCES public.team_members(id),
  action text NOT NULL,
  original_text text,
  corrected_text text,
  comment text,
  surface text NOT NULL,
  distilled_into_rule_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_feedback_action_check CHECK (action IN ('not_a_task','not_mine','duplicate','reworded','confirmed')),
  CONSTRAINT task_feedback_surface_check CHECK (surface IN ('slack','hub'))
);

CREATE INDEX task_feedback_candidate_idx ON public.task_feedback (candidate_id);
CREATE INDEX task_feedback_task_idx ON public.task_feedback (task_id);

GRANT SELECT, INSERT ON public.task_feedback TO authenticated;
GRANT ALL ON public.task_feedback TO service_role;
ALTER TABLE public.task_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members read feedback" ON public.task_feedback
  FOR SELECT TO authenticated USING (public.get_team_member_id(auth.uid()) IS NOT NULL);
CREATE POLICY "Team members write feedback" ON public.task_feedback
  FOR INSERT TO authenticated WITH CHECK (public.get_team_member_id(auth.uid()) IS NOT NULL);
CREATE POLICY "Service role manages feedback" ON public.task_feedback
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Near-duplicate lookup against open tasks for one client. Trigram similarity only;
-- a near match is never treated as a duplicate without model confirmation upstream.
CREATE OR REPLACE FUNCTION public.find_similar_open_tasks(
  p_client_id uuid,
  p_text text,
  p_threshold numeric DEFAULT 0.45,
  p_limit integer DEFAULT 5
)
RETURNS TABLE(id uuid, title text, status text, assignee_id uuid, similarity numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.title, t.status, t.assignee_id,
         similarity(lower(t.title), lower(p_text))::numeric AS similarity
  FROM public.tasks t
  WHERE (p_client_id IS NULL OR t.client_id = p_client_id)
    AND t.status NOT IN ('done','archived')
    AND t.type_data->>'archived_reason' IS NULL
    AND similarity(lower(t.title), lower(p_text)) >= p_threshold
  ORDER BY similarity(lower(t.title), lower(p_text)) DESC
  LIMIT p_limit
$$;

GRANT EXECUTE ON FUNCTION public.find_similar_open_tasks(uuid, text, numeric, integer) TO authenticated, service_role;