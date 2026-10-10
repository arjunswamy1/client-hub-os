ALTER TABLE public.agent_query_log ADD COLUMN IF NOT EXISTS auth_method text NOT NULL DEFAULT 'agent_token';
ALTER TABLE public.agent_query_log ADD COLUMN IF NOT EXISTS oauth_client_id text;
COMMENT ON COLUMN public.agent_query_log.auth_method IS 'agent_token (hashed token from /settings/agent-tokens) or oauth (team member signed in through an MCP client such as Claude).';