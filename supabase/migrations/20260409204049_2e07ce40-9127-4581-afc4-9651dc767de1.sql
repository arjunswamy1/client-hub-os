
-- Add columns needed by sync functions to platform_connections
ALTER TABLE public.platform_connections
  ADD COLUMN IF NOT EXISTS access_token text,
  ADD COLUMN IF NOT EXISTS account_name text,
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS account_id text,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS selected_ad_account jsonb;

-- Unique constraint: one connection per user + platform + client
CREATE UNIQUE INDEX IF NOT EXISTS platform_connections_user_platform_client_idx
  ON public.platform_connections (user_id, platform, client_id);
