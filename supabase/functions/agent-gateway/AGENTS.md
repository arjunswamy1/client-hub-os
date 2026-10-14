# agent-gateway

- Agent Access Gateway lives only in `supabase/functions/agent-gateway` (own hashed keys in `agent_gateway_tokens`, separate from mcp-hub's `agent_tokens`); secrets are resolved at call time through the `SecretsProvider` interface and never stored in the database. Why: mcp-hub auth stays untouched and no secret value can land in a table or log.
