# Meta write actions on the Agent Access Gateway (approval-gated)

Plan only. Nothing ships until AJ confirms. No grant gets `write` in this change.

## What changes for people

- A bot can ask to pause/activate a campaign, ad set or ad, change a daily budget, or duplicate a campaign (the copy is created paused).
- Nothing happens on Meta until AJ approves that one request on the Agent access page. Charles and other admins see the request but cannot approve or deny it.
- After approval the hub makes the change itself, once, within 30 minutes. Otherwise the request expires.
- A separate "Gateway writes" switch turns all of this off without affecting reads.

## 1. Named write actions (Meta integration 55694453 only)

| Action | Meta call | Body |
|---|---|---|
| meta.campaign.pause / .activate | POST /v21.0/{campaign_id} | status=PAUSED / ACTIVE |
| meta.adset.pause / .activate | POST /v21.0/{adset_id} | status=PAUSED / ACTIVE |
| meta.ad.pause / .activate | POST /v21.0/{ad_id} | status=PAUSED / ACTIVE |
| meta.campaign.update_budget | POST /v21.0/{campaign_id} | daily_budget (minor units) |
| meta.adset.update_budget | POST /v21.0/{adset_id} | daily_budget (minor units) |
| meta.campaign.duplicate | POST /v21.0/{campaign_id}/copies | status_option=PAUSED, deep_copy=true |

Caller input: `{ account_id, object_id, new_daily_budget_usd? , reason }`. `object_id` validated `^[0-9]{1,32}$`. Any other param is refused. Excluded in v1: deletes, ad/creative creation, spend caps, lifetime budgets, bid changes, billing. Unknown write names return `denied_unknown_action`.

## 2. Request flow and state machine

```text
bot POST scope=write ──► checks ──► live fetch "before" from Meta ──► row pending (202 write_pending_approval + request_id + diff)
pending ──AJ approve──► approved ──execute──► executing ──► executed | failed
pending ──AJ deny──► denied (final)
pending ──24h no decision──► expired (final)
approved ──30 min not executed──► expired (final)
executing ──drift/permission/upstream error──► failed (final)
```

- Diff returned and stored: account id + name, object type, id, name, field, before → after (e.g. `status ACTIVE → PAUSED`, `daily_budget $120.00 → $150.00`, duplicate: `source campaign X → new paused copy`).
- Bot polls `{ write: "status", request_id }` → `{ status, diff, decided_at, executed_at, result }`; `result` holds the Meta response (scrubbed) and, for duplicates, the new campaign id.
- Execution trigger, no cron:
  1. AJ's approve click calls a new `agent-gateway-write-exec` function immediately.
  2. Fallback: the bot's status poll executes an approved, unexpired row if step 1 didn't finish.
  Expiry is derived from timestamps at read time and persisted lazily on the next touch.
- Exactly-once: execution claims the row with a single conditional update `approved → executing WHERE status='approved' AND approval_expires_at > now()`; only the winner calls Meta. Duplicate copies additionally pass a stored idempotency key; a failed claim returns `write_already_executing` / the final state.
- Pending dedupe: one open request per (agent, object_id, action); a repeat returns the existing request_id.

## 3. Guardrails (checked at request time and again at execution)

1. Gateway on, writes switch on, agent active, grant present, `'write'` in grant scopes.
2. `account_id` in the grant's `allowed_account_refs` (a write grant with an empty list is refused).
3. Ownership verified via Meta: GET `/{object_id}?fields=account_id,name,status,daily_budget,effective_status` (ad set / ad also return `campaign_id`); `account_id` must equal the caller's. Caller-supplied ownership is never trusted.
4. Budget: change within ±50% of current (configurable `write_max_budget_change_pct`), new value ≤ $1,000/day per object (`write_max_daily_budget_usd`), > 0. Refused if the object uses a lifetime budget or campaign budget optimisation doesn't apply (ad-set budget on a CBO campaign → `denied_budget_not_on_object`).
5. Rate: 20 write requests/day per agent (`write_requests_per_day`), counted on create, separate from read limits.
6. Drift: at execution, re-fetch; if status/daily_budget/name differs from the stored "before", refuse with `failed_drift` and store both values.
7. Permission check: at execution (and from a "Check write permission" button for admins) call `GET /me/permissions` / `debug_token`-style check for `ads_management`; missing → `failed_missing_ads_management`, Meta not called. Token only from the existing 1Password reference.

## 4. Approval authority (only AJ)

- New settings column `write_approver_team_member_id` set to AJ (1fdd684e).
- Approve/deny only through a security-definer SQL function `decide_agent_write_request(request_id, approve, note)` that checks `get_team_member_id(auth.uid())` equals that column; everyone else gets `not_write_approver`. No direct UPDATE grants on the table.
- A trigger lets only the current approver change `write_approver_team_member_id` and the writes switch, so another admin cannot reassign themselves.

## 5. Audit and switches

- `agent_access_log` gets an event per step: `write_requested`, `write_approved`, `write_denied`, `write_expired`, `write_executed`, `write_failed`, plus every refusal. `target` = request id; `approved_by_id` set. Never tokens, secrets, raw Meta bodies with tokens (scrubbed).
- `agent_gateway_settings.writes_enabled boolean default false`, independent of `gateway_enabled`. The code constant `WRITES_ENABLED` is removed in favour of this row (both off by default).

## 6. Optional Slack ping to AJ

The gateway must not import the Slack sender. Proposal: the write request row insert queues a notification row; an existing hub notifier sends it via `postDirectMessage()` to AJ only, with request id and diff, no buttons. If that's more than small, v1 shows an in-hub notification only.

## 7. Tests (Deno, alongside gateway_test.ts)

- Each of the 9 actions builds the right Meta URL/body; unknown and excluded actions refused.
- Writes switch off → `denied_writes_disabled` (reads still work); scope without `write` → `denied_scope`.
- Allowlist: unlisted account, empty list, object owned by another account (Meta says) all refused.
- Budget: +51%, −51%, > $1,000, ≤ 0, lifetime budget refused; ±50% and $1,000 exactly allowed; caps read from settings.
- Rate limit: 21st write request in a day → 429.
- Authz: approver AJ succeeds; Charles/other admin/bot get `not_write_approver`; approver change by another admin refused.
- Expiry: pending > 24h and approved > 30 min both become `expired`, never execute.
- One-time: two concurrent executions → one Meta call; repeated status polls after execution don't re-call.
- Drift: before-state changed → `failed_drift`, no Meta write.
- Missing `ads_management` → `failed_missing_ads_management`, no write.
- No token or secret appears in any response or log row.

## Technical details

Files:
- `supabase/functions/agent-gateway/write-actions.ts` (new, pure): action defs, validators, diff builder, budget/cap rules.
- `supabase/functions/agent-gateway/gateway.ts`: write branch (request + status) after grant/rate checks.
- `supabase/functions/agent-gateway/write-exec.ts` (pure execution with claim/drift/permission) + `supabase/functions/agent-gateway-write-exec/index.ts` (approver-authenticated entry).
- `supabase/functions/agent-gateway/write_test.ts` (new).
- `src/pages/AgentAccessPage.tsx`: "Write requests" tab (pending list with diff, Approve/Deny visible as enabled only for AJ), writes switch, permission check button.
- `supabase/functions/agent-gateway/AGENTS.md`: replace the "writes refused" rule.

Migration (additive):
- `agent_write_requests`: id, agent_id, grant_id, integration_id, action, account_id, object_type, object_id, object_name, before jsonb, after jsonb, diff_text, reason, status (check: pending/approved/denied/expired/executing/executed/failed), requested_at, decision_expires_at (+24h), decided_by_id, decided_at, decision_note, approval_expires_at (+30 min), executed_at, result jsonb, failure_outcome, idempotency_key unique; partial unique index on (agent_id, action, object_id) where status in (pending, approved). RLS: admins select; no insert/update for authenticated; service_role all.
- `agent_gateway_settings`: writes_enabled (false), write_approver_team_member_id, write_max_budget_change_pct (50), write_max_daily_budget_usd (1000), write_requests_per_day (20), write_pending_ttl_minutes (1440), write_approval_ttl_minutes (30).
- Functions: `decide_agent_write_request`, `agent_gateway_write_hit` (daily counter), approver-lock trigger.

New outcomes: write_pending_approval (202), write_status, denied_writes_disabled, denied_account_not_allowed, denied_object_not_in_account, denied_budget_change_too_large, denied_budget_over_cap, denied_budget_not_on_object, denied_duplicate_pending, write_rate_limited (429), not_write_approver, write_expired, write_denied, write_already_executing, failed_drift, failed_missing_ads_management, failed_upstream.

## Open questions and risks

1. Pending TTL: how long may a request wait for AJ's decision? Plan assumes 24h.
2. Budget currency: caps assume USD accounts; any non-USD account is refused until confirmed.
3. CBO campaigns: should ad-set budget changes be refused when the campaign holds the budget? Plan refuses.
4. Duplicate: deep copy (ad sets + ads) or campaign shell only? Plan assumes deep copy, all paused; copies may count toward Meta object limits.
5. Activate on a copy or on a paused-by-Meta object can start spend immediately — AJ's approval is the only guard; confirm that's acceptable.
6. Single approver: if AJ is unavailable nothing can be approved. Do you want a named backup, or keep AJ-only?
7. The token copy in 1Password must match the one with ads_management; the permission check will tell us, but a mismatch blocks all writes.
8. Slack ping: confirm whether in-hub notification is enough for v1.
9. Bot status polling uses its gateway key; polling counts toward read rate limits unless exempted — plan exempts status calls.
