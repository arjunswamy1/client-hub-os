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
- Campaign duplicates are named with `[cpm:<request_id>]`. After any unknown outcome (timeout, unreachable, stuck, 5xx) the gateway looks for a tagged copy before accepting a new duplicate request and again before executing one; the lookup filters `effective_status` across every status, so ARCHIVED and DELETED copies are found.
- Meta's synchronous deep copy only handles small campaigns. The gateway counts ad sets + ads up front (request and execution) and refuses above `SYNC_COPY_MAX_CHILDREN` (`denied_copy_too_large` / `failed_copy_too_large`); a Meta copy-limit error is also reported as `failed_copy_too_large`. Async batch copy is not implemented.
- **Live Meta verification pending:** the copy limit value, the copy-limit error text, the `effective_status` filter and the `[cpm:]` name filter are from Meta docs and tested only against mocks.

## 1Password service account
- The Meta token is read through `OP_SERVICE_ACCOUNT_TOKEN`. Scope that service account to the single vault holding the Meta token, read-only; no other vaults.
- Tests never read it: `OnePasswordProvider` takes the token only as an explicit argument and every test injects a mock client. Run gateway tests with `env -u OP_SERVICE_ACCOUNT_TOKEN deno test -A supabase/functions/agent-gateway/` to prove it.
- Action for AJ: rotate the service-account token (it has been present in the build sandbox) and confirm its vault scope.

## Tests
- Unit (mocked Meta): `supabase/functions/agent-gateway/write_test.ts`.
- Real Postgres: `bash scripts/db-tests/agent-gateway-writes/run.sh` applies migrations 0034+ verbatim to a throwaway local Postgres and checks the approval function, self/ownerless approval, lock triggers, Chicago limit, sweep, and two concurrency races.
