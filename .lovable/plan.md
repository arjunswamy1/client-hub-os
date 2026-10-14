# Per-person hub tokens for teammates' Grok Bots

## What I found
- There is no `CPM_HUB_TOKEN` setting anywhere in the code. AJ's Grokbot key is a hashed row in `agent_tokens` (read, draft, creative-write), checked by `mcp-hub`. Sign-in via Claude (OAuth) is the other way in. **Neither changes.**
- The gateway already has `agents` (owner, team, status/kill switch) and `agent_gateway_tokens` (hashed, prefix, required expiry, revoke, last-used). I'll reuse both.
- `mcp-hub` has no tool to create a brief. It already has `add_brief_comment` and `update_brief_status`.
- Clients: Connatria, OneShare, Hablyte, BuyologyIQ, RRM and Tinned Fish Club all match exactly. **"Found" matches "Found Media"** (one row, slug `found-media`).
- People: **Juan has no team member record.** **Belu exists but is marked inactive.** Henry and Charles are active (later).

## What gets built
1. **Hub keys on the same agents.** A key can be marked "hub" (works on `mcp-hub`) or "gateway" (works on the account gateway), so one agent's hub key can't open 1Password accounts. Minted on the Agent access → Keys tab, shown once, 90 days by default, revocable one at a time.
2. **Allowed clients per agent.** A new list of clients on each agent. A hub key only ever sees those clients. If the owner isn't assigned to a client, it isn't allowed (owner's access is the ceiling).
3. **mcp-hub accepts a third key type.** Order: Claude sign-in → existing `agent_tokens` (AJ, unchanged) → new hub key. Killed agent, expired/revoked key, or inactive owner = refused and logged.
4. **Filtering everywhere.** Every tool that takes a client refuses others (logged as denied). Tools without a client (list_clients, creative queue, data health, designer load, follow-ups, get_brief by id) return only allowed clients' rows. Tools that are global or about people (get_schema, bot accuracy, outbox, designer check-ins, propose_improvement) are hidden from hub keys.
5. **Writes allowed for hub keys, own clients only:** new `create_brief`, `add_brief_comment`, `update_brief_status`. Everything else that writes is refused. Approved/delivered briefs stay protected (no force for hub keys).
6. **New `create_brief` tool.** Client, title, brief type, description, due date, priority, deliverables; status starts `submitted`, submitted by the agent's owner; normal designer notification runs as it would from the hub form. Agent-written text is stored as data.
7. **Logging.** Every write and every refusal in full in `agent_access_log` (agent, key, tool, client, brief, fingerprint, outcome). Successful reads only add to the daily counter.
8. **Screens.** Agents tab: allowed-clients picker. Keys tab: key type + hub server address. Activity shows hub calls alongside gateway calls.
9. **Agents created, no keys:** "Juan's Grok Bot" (Connatria, OneShare, Hablyte, Found Media) and "Belu's Grok Bot" (BuyologyIQ, RRM, Tinned Fish Club). See open questions about owners.

## Tests
- Hub key for client A: reads of client B refused and logged; list_clients/creative queue/briefs/tasks show only A.
- create_brief / comment / status for B refused; for A allowed and logged in full.
- Other writes (draft_update, assign_brief, outbox) refused.
- Gateway key refused by mcp-hub and hub key refused by gateway; killed agent refused.
- Existing `agent_tokens` and Claude sign-in behave exactly as today (existing tests unchanged).
- Successful read writes no log row, only bumps the daily count.

## Open questions
1. **Juan** isn't in the team. Should I add him (name, email, role), or create his agent with no owner until he's added? With no owner, no key can be minted.
2. **Belu** is inactive. Reactivate her, or keep inactive (her key would be refused until reactivated)?
3. Since a teammate's owner must also be assigned to those clients, should I also add the matching client assignments for Juan and Belu?
4. Confirm "Found" = Found Media.

## Technical details
- Migration (additive, gateway tables only): `agent_gateway_tokens.audience text not null default 'gateway' check in ('gateway','hub')`; new `agent_client_scopes(agent_id, client_id, created_by_id, created_at)` unique pair, admin-manage RLS, service-role grants, admin audit trigger. `agent_access_log` gets nullable `client_id`, `tool`, `auth_surface` ('gateway'|'hub'). Gateway rejects `audience='hub'` keys.
- `mcp-hub/hub.ts`: `authenticate()` adds the gateway-key branch after `agent_tokens` lookup; Caller gains `authMethod: 'hub_agent'`, `agentId`, `clientIds = scopes ∩ owner access`, `allClients=false`, and a tool allowlist. Existing `agent_query_log` writes continue; hub-agent calls also write `agent_access_log` / `agent_read_usage_daily` via the existing `agent_gateway_count_read()`.
- `create_brief` lives in `mcp-hub/creative.ts`, scope `creative_write`, inserts into `creative_briefs` respecting the existing designer-notification trigger. Exposed to existing creative-write tokens too.
- mcp-hub never imports `_shared/slack-post.ts` (still enforced by test). No change to gateway switch or 1Password accounts.
- Build log row written at the start of the build turn (plan mode can't write data) and again at the end.
