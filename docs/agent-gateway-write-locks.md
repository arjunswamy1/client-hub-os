# Agent Access Gateway — how the write locks are enforced

Applies to Meta write actions (`agent_write_requests`, migrations 0034 and 0036).

## Who can change write controls
- `agent_gateway_settings` write columns (`writes_enabled`, approvers, caps, per-day limit, TTLs) and adding `write` to any `agent_grants.scopes` are refused by BEFORE triggers unless the signed-in user is the write owner (`agent_gateway_write_owner()`, AJ).
- **No role bypass.** The triggers no longer skip when `auth.uid()` is null. Service-role clients (edge functions), cron, and migrations have no signed-in user, so they are refused like anyone else. Non-write columns (e.g. `gateway_enabled`, `default_vault`) stay editable.
- The lock and alert triggers are `ENABLE ALWAYS`, so they also fire under `session_replication_role = replica` (restore / maintenance sessions).
- Every accepted change (by AJ) writes an `agent_access_log` row (`outcome = write_control_changed`) and an in-hub notification to AJ.

## What can still get around it
Only the table owner / a superuser can `ALTER TABLE ... DISABLE TRIGGER` or replace the trigger functions. That needs a migration, which is reviewed and lands in `drizzle/migrations` history. No application path, edge function or bot key has that privilege.

## Approvals
`decide_agent_write_request` is the only way a request becomes `approved`. It refuses: anyone not in the approver list (`not_write_approver`), the requesting bot's owner (`denied_self_approval`) unless that owner is the write owner (AJ, `agent_gateway_write_owner()`), and any approval for a bot with no owner (`denied_ownerless_agent`). So: AJ's bots are approved by AJ or Charles; Charles's bots by AJ only; other owners' bots by AJ or Charles. Notifications go only to approvers allowed to decide. The gateway also refuses ownerless bots at request time.

## Execution safety
- Request limit: `agent_write_request_create` counts and inserts under a per-agent advisory lock; the day starts at midnight America/Chicago.
- Execution re-reads Meta and re-checks USD, the ±% cap against the live budget, the $/day ceiling, drift, and a 24h cooldown after any budget change on the same object that executed or ended with an unknown outcome (`failed_upstream_timeout`, `failed_upstream_unreachable`, `failed_stuck_executing`, `failed_upstream` with 5xx), checked at request and at execution.
- Meta POST has a 20s timeout. Requests stuck in `executing` over 10 minutes are swept to `failed_stuck_executing` (every 10 minutes, and on status poll) and audited.
- Campaign duplicates are named with `[cpm:<request_id>]`. After any unknown outcome (timeout, unreachable, stuck, 5xx) the gateway looks for a tagged copy before accepting a new duplicate request and again before executing one; the lookup filters `effective_status` to the campaign-valid statuses ACTIVE, PAUSED, ARCHIVED, DELETED, IN_PROCESS, WITH_ISSUES (`COPY_LOOKUP_STATUSES`), so archived and deleted copies are found.
- Meta's synchronous deep copy only handles small campaigns. The gateway counts ad sets + ads up front (request and execution) and refuses above `SYNC_COPY_MAX_CHILDREN` in `_shared/agent-write-actions.ts` (currently 3 ad sets + ads combined; **UNVERIFIED**, pending a live Meta test; change it only there) (`denied_copy_too_large` / `failed_copy_too_large`); a Meta copy-limit error is also reported as `failed_copy_too_large`. Async batch copy is not implemented.
- **Live Meta verification pending:** the copy limit value, the copy-limit error text, the `effective_status` filter and the `[cpm:]` name filter are from Meta docs and tested only against mocks.

## 1Password service account
- The Meta token is read through `OP_SERVICE_ACCOUNT_TOKEN`. Scope that service account to the single vault holding the Meta token, read-only; no other vaults.
- Tests never read it: `OnePasswordProvider` takes the token only as an explicit argument and every test injects a mock client. Run gateway tests with `env -u OP_SERVICE_ACCOUNT_TOKEN deno test -A supabase/functions/agent-gateway/` to prove it.
- Action for AJ: rotate the service-account token (it has been present in the build sandbox) and confirm its vault scope.

## Tests
- Unit (mocked Meta): `supabase/functions/agent-gateway/write_test.ts`.
- Real Postgres: `bash scripts/db-tests/agent-gateway-writes/run.sh` applies migrations 0034+ verbatim to a throwaway local Postgres and checks the approval function, self/ownerless approval, lock triggers, Chicago limit, sweep, and two concurrency races.

## Owner snapshot and owner lock

- Each write request stores the requesting bot's owner at creation (`agent_write_requests.agent_owner_team_member_id`, set inside `agent_write_request_create`). `decide_agent_write_request` applies the self-approval and ownerless rules to that snapshot, never the live `agents` row, so changing a bot's owner afterwards cannot change who may approve an existing request.
- `agent_owner_write_lock` (BEFORE UPDATE on `agents`, `ENABLE ALWAYS`) refuses any change to `owner_team_member_id` on an agent that has a write-scoped grant unless the signed-in user is the write owner (AJ). There is no service-role bypass and it fires in replica/maintenance sessions.

## Gateway keys and grant removals (migration 0040)

- `agent_gateway_token_write_lock` (BEFORE INSERT/UPDATE, `ENABLE ALWAYS`): for any agent holding an active write grant, only the write owner may create a key, change its hash (rotate), move it to the agent, un-revoke it or extend its expiry. Service role and replica sessions are refused like anyone else. Anyone may still revoke.
- Every key records `created_by_id`: taken from the signed-in user on insert (a supplied value is ignored), required when there is none, never changeable.
- `agent_write_request_create` stores the key the request arrived on (`token_id`) and its creator (`token_created_by_id`); unknown keys are refused (`denied_unknown_key`). `decide_agent_write_request` refuses the key's creator (`denied_key_creator`) for approve and deny, except the write owner (AJ, migration 0041).
- `agent_grants_write_alert` now also fires on DELETE (`ENABLE ALWAYS`), and un-revoking a write grant counts as giving write scope (locked) while revoking counts as removal (alerted and stamped `write_scope_removed_at` / owner then).
- `agent_owner_history` records every owner change (all roles). The Agent access page shows the current owner and owner changes since write was last held, and needs an explicit confirmation before giving write scope.
- Migration 0039 is an accidental no-op (`SELECT 1`); 0040 holds the substance.
