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
`decide_agent_write_request` is the only way a request becomes `approved`. It refuses: anyone not in the approver list (`not_write_approver`), the requesting bot's owner (`denied_self_approval`), and any approval for a bot with no owner (`denied_ownerless_agent`). The gateway also refuses ownerless bots at request time.

## Execution safety
- Request limit: `agent_write_request_create` counts and inserts under a per-agent advisory lock; the day starts at midnight America/Chicago.
- Execution re-reads Meta and re-checks USD, the ±% cap against the live budget, the $/day ceiling, drift, and a 24h cooldown after any executed budget change on the same object.
- Meta POST has a 20s timeout. Requests stuck in `executing` over 10 minutes are swept to `failed_stuck_executing` (every 10 minutes, and on status poll) and audited.
- Campaign duplicates are named with `[cpm:<request_id>]`; before copying, and before accepting a new duplicate after an unknown outcome, the gateway looks for an existing tagged copy.

## Tests
- Unit (mocked Meta): `supabase/functions/agent-gateway/write_test.ts`.
- Real Postgres: `bash scripts/db-tests/agent-gateway-writes/run.sh` applies migrations 0034+ verbatim to a throwaway local Postgres and checks the approval function, self/ownerless approval, lock triggers, Chicago limit, sweep, and two concurrency races.
