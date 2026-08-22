-- de-dupe any existing duplicate connections before adding the constraint
DELETE FROM public.platform_connections p
USING public.platform_connections q
WHERE p.user_id = q.user_id
  AND p.platform = q.platform
  AND p.client_id IS NOT DISTINCT FROM q.client_id
  AND p.created_at < q.created_at;

ALTER TABLE public.platform_connections
  ADD CONSTRAINT platform_connections_user_platform_client_key
  UNIQUE NULLS NOT DISTINCT (user_id, platform, client_id);