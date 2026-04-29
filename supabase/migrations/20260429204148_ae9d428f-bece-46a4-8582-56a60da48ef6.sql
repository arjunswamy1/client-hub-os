ALTER TABLE public.platform_connections
  ADD COLUMN IF NOT EXISTS customer_id text,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS last_sync_records integer,
  ADD COLUMN IF NOT EXISTS sync_error text;

COMMENT ON COLUMN public.platform_connections.customer_id IS 'For Google Ads: the specific customer (account) ID this client maps to. When set, sync only pulls data for this customer instead of all accessible customers in metadata.';