# agent-gateway

- Agent Access Gateway lives only in `supabase/functions/agent-gateway` (own hashed keys in `agent_gateway_tokens`, separate from mcp-hub's `agent_tokens`); secrets resolve at call time through `SecretsProvider` in `_shared/agent-secrets.ts`, and only `_shared/op-sdk.ts` loads the 1Password SDK. Why: mcp-hub auth stays untouched and no secret value can land in a table or log.
- Agents call named actions from `actions.ts` only (provider + host allowlist per integration); writes are refused while `WRITES_ENABLED` is false; Slack providers are refused. Why: no raw URLs, no key sent to an unexpected host.
