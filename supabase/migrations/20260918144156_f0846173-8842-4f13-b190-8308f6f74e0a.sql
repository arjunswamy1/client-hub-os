CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

ALTER TABLE public.task_candidates
  ADD COLUMN IF NOT EXISTS merged_into_candidate_id uuid
  REFERENCES public.task_candidates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS task_candidates_merged_into_idx
  ON public.task_candidates (merged_into_candidate_id)
  WHERE merged_into_candidate_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.find_similar_pending_candidates(
  p_client_id uuid,
  p_text text,
  p_exclude_id uuid,
  p_threshold real DEFAULT 0.45,
  p_limit integer DEFAULT 5
)
RETURNS TABLE (id uuid, proposed_title text, confidence numeric, sim real)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT c.id, c.proposed_title, c.confidence,
         extensions.similarity(lower(c.proposed_title), lower(p_text))::real AS sim
  FROM public.task_candidates c
  WHERE c.status = 'pending'
    AND c.id <> p_exclude_id
    AND (c.client_id IS NOT DISTINCT FROM p_client_id)
    AND extensions.similarity(lower(c.proposed_title), lower(p_text)) >= p_threshold
  ORDER BY sim DESC, c.id ASC
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.find_similar_pending_candidates(uuid, text, uuid, real, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_similar_pending_candidates(uuid, text, uuid, real, integer) TO authenticated, service_role;