# Agent Access Gateway

## Goal
AI agents (AJ's and the team's) use shared accounts such as Meta Ads, CallGrid, Roku and Slack through the hub. The hub checks what each agent is allowed to do, fetches the secret from 1Password when the call is made, calls the service itself and returns only the result. Agents never see a raw key, and the hub never stores a plaintext secret.

## What exists today (checked)
- `agent_tokens` already holds hashed hub tokens (team_member_id, token_hash, prefix, label, scopes, revoked_at, expires_at, last_used_at).
- `agent_query_log` already records every `mcp-hub` call.
- Agents act as a `team_members` row. Grokbot is a service account; Charles and Arjun Swamy are the only active admins.
- `mcp-hub` is read and draft only, and it must never import the Slack sender.

The design extends these instead of building a second token system.

## 1. Agent identities
New table `agents`: id, name, kind (`ai_agent` | `teammate_agent`), owner_team_member_id, team (`media` | `creative` | `client` | `ops`), acts_as_team_member_id, status (`active` | `suspended` | `killed`), killed_at/by/reason, notes, created_by, timestamps.
- Additive change to `agent_tokens`: a nullable `agent_id` column. Existing tokens keep working.
- Each token is still hashed with SHA-256 and shown once. It is revocable, must have an expiry (max 1 year), and can be limited to a set of IP addresses.

## 2. Integrations and grants
- `integrations`: one row per connected account. Fields: id, provider (`meta_ads`, `callgrid`, `roku`, `universal_ads`, `ringfuel`, `slack_bot`, `google_ads`, …), label, client_id (nullable), account_ref (for example a Meta act_ id), **op_secret_ref** (`op://CPM-Agents/<item>/<field>`, a pointer only, never a value), base_url, allowed_hosts[], auth_style (bearer | header | query | basic | oauth_refresh), is_browser_login, enabled.
- `agent_grants`: agent_id, integration_id, scopes[] (`read`, `write`, `browser_handoff`), allowed_actions[] (an allowlist of named actions, defined below), rate limits (per_minute, per_day), expires_at, granted_by, reason.
- `integration_actions`: a catalog of named actions per provider, for example `meta.insights.read` (GET /act_{id}/insights) or `meta.adset.pause` (POST, write). Each action has a method, a path template, a parameter schema and a write flag. Agents call actions by name, never by raw URL, so they can't send a key to another host.

## 3. Gateway function `agent-gateway`
```text
agent --(hub token, action, params)--> agent-gateway
  1 hash token -> agent_tokens -> agents (active, not killed, not expired)
  2 grant lookup (agent x integration x action, scope, grant expiry)
  3 write action? -> requires 'write' scope + a per-integration write switch
  4 rate limit check (atomic counter in the database)
  5 validate params against the action schema; build the URL; host must be in allowed_hosts
  6 1Password Connect/SDK: resolve op_secret_ref with the service account token (an edge secret)
  7 call the service; strip auth headers and any echoed secret from the response
  8 write the audit row; return { ok, status, data }
```
- The secret lives only in memory for that one request. It is never logged, returned or cached. Any value that came from 1Password is scrubbed from error text.
- The gateway is a separate function from `mcp-hub`, so the hub's read-only and no-send rules stay intact. `mcp-hub` gets one read-only tool, `list_my_grants`, so agents can see what they're allowed to do.
- Slack sends through the gateway are **out of scope**. Slack posting stays only on the existing sender and outbox, so the channel allowlist can't be bypassed.
- **Browser-login exception:** the action `browser_handoff` needs a dedicated scope, a written reason and an approval from AJ or Charles in the hub, each time unless pre-approved. It returns a short-lived 1Password item share link (or a one-time-view URL), never the value itself. The audit row records `handoff` with the approver.

## 4. Audit log
`agent_access_log` (insert-only, with a trigger that refuses UPDATE/DELETE, like the metric revision log): agent_id, token_id, integration_id, action, scope, client_id, outcome (`ok` | `denied_*` | `upstream_error` | `rate_limited` | `killed`), upstream_status, duration_ms, request_fingerprint (a hash of the parameters, never their values), ip, user_agent, handoff_approved_by, created_at. Parameters are stored only after redaction against the action schema's "safe fields".

## 5. Admin screens (AJ and Charles only)
`/settings/agent-tokens` grows into **Settings, Agent access**, with these tabs:
1. **Agents:** create, suspend or kill an agent (a big red kill switch), set owner and team, see last used.
2. **Tokens:** mint (shown once), revoke, rotate (issue a new token with a short overlap, then revoke the old one), see expiry and last used.
3. **Integrations:** add an account by entering only the 1Password reference, then a **Test** button that resolves and calls a harmless read action. No secret field exists anywhere in the UI.
4. **Grants:** an agent by integration grid with scope and action checkboxes, rate limits and an expiry.
5. **Audit log:** filter by agent, integration, outcome and date; CSV export.
6. **Hand-off requests:** pending, approve or deny.

## 6. Safeguards
- **Database security:** every new table is readable and writable by admins only (`is_admin`). The gateway uses its server-side role. Non-admins get no read access. Tokens stay hash-only.
- **Rate limits:** per grant (minute and day) plus a global cap per agent. Over the limit means a 429 and an audit row.
- **Kill switches:** per agent (`status=killed`) and one global `agent_gateway_enabled` setting. Both are checked before 1Password is touched.
- **No secrets in logs:** the request fingerprint is a hash; a scrubber removes the secret value and Authorization/Cookie headers. Tests enforce that the gateway never `console.log`s headers.
- **Least privilege in 1Password:** a single `CPM-Agents` vault and a read-only service account. Rotating a credential happens in 1Password with no hub change.
- **Anomaly alerts:** an internal-only alert after five denied attempts in ten minutes, or the first use of a write action. This goes through the existing internal sender.

## Migration order
1. `agents` table and the nullable `agent_tokens.agent_id` column (backfill: one agent per existing token, including Grokbot).
2. `integrations` and `integration_actions`, seeded with read actions for Meta, CallGrid and Roku.
3. `agent_grants`.
4. `agent_access_log` with its insert-only trigger, plus the rate-limit counter table and its atomic increment function.
5. The `agent_gateway_enabled` setting (default **off**).
6. Deploy `agent-gateway` with the 1Password secret, test it against a single read action, then turn on the admin screens.
7. Add write actions one provider at a time, each behind its own switch.

## Tests
Unknown, expired or killed token is refused; a missing grant is refused before 1Password is called; a write needs the write scope; a host outside the allowlist is refused; the response and the audit row never contain the secret; rate limit returns a 429; the audit log refuses UPDATE/DELETE; non-admins can't read grants or tokens; `mcp-hub` still has no import path to the Slack sender.

## Open questions
1. 1Password access method: a Service Account with the SDK/CLI (simplest) or a self-hosted Connect server?
2. Vault name and the item and field naming convention.
3. The first integrations and actions for version one: read-only Meta, CallGrid and Roku?
4. Write actions: allowed in version one at all? If so, does each write need human approval (in line with "nothing auto-executes")?
5. Browser hand-off: approve each time, or pre-approve per grant? Which share mechanism?
6. Are teammates' own agents tied to a teammate's account (and limited to that teammate's clients), or given grants independently?
7. Default token lifetime and default rate limits.
8. Who receives the anomaly alerts, and in which internal channel?
9. Should Slack bot access be excluded from the gateway entirely (recommended)?
