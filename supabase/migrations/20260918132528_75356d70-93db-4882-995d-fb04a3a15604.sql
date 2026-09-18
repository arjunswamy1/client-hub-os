ALTER EXTENSION pg_trgm SET SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.find_similar_open_tasks(
  p_client_id uuid,
  p_text text,
  p_threshold numeric DEFAULT 0.45,
  p_limit integer DEFAULT 5
)
RETURNS TABLE(id uuid, title text, status text, assignee_id uuid, similarity numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT t.id, t.title, t.status, t.assignee_id,
         extensions.similarity(lower(t.title), lower(p_text))::numeric AS similarity
  FROM public.tasks t
  WHERE (p_client_id IS NULL OR t.client_id = p_client_id)
    AND t.status NOT IN ('done','archived')
    AND t.type_data->>'archived_reason' IS NULL
    AND extensions.similarity(lower(t.title), lower(p_text)) >= p_threshold
  ORDER BY extensions.similarity(lower(t.title), lower(p_text)) DESC
  LIMIT p_limit
$$;

REVOKE EXECUTE ON FUNCTION public.find_similar_open_tasks(uuid, text, numeric, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_similar_open_tasks(uuid, text, numeric, integer) TO authenticated, service_role;