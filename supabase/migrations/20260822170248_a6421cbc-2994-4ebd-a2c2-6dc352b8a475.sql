-- Keep only the newest Roku connection per client, then enforce one per client
DELETE FROM public.platform_connections pc
USING public.platform_connections keep
WHERE pc.platform = 'roku'
  AND keep.platform = 'roku'
  AND pc.client_id = keep.client_id
  AND pc.id <> keep.id
  AND (keep.updated_at, keep.id) > (pc.updated_at, pc.id);

CREATE UNIQUE INDEX IF NOT EXISTS platform_connections_roku_client_idx
  ON public.platform_connections (client_id)
  WHERE platform = 'roku';