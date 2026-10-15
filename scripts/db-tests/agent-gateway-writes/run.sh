#!/usr/bin/env bash
# Real-Postgres tests for the gateway write SQL (migrations 0034 + 0035 applied verbatim).
# Usage: bash scripts/db-tests/agent-gateway-writes/run.sh   (needs initdb/pg_ctl/psql on PATH)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../../.."
D=$(mktemp -d); PORT=${DBTEST_PORT:-55432}
initdb -D "$D/data" -U postgres -A trust >/dev/null
pg_ctl -D "$D/data" -o "-p $PORT -k $D -c listen_addresses=''" -l "$D/log" start >/dev/null
trap 'pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT
P="psql -X -q -t -A -h $D -p $PORT -U postgres -v ON_ERROR_STOP=1"
setup() {
  $P -c "DROP DATABASE IF EXISTS t" -c "CREATE DATABASE t" >/dev/null
  $P -d t -f "$HERE/stub_schema.sql" >/dev/null
  for m in "$ROOT"/drizzle/migrations/0034_*.sql "${M35:-$(ls "$ROOT"/drizzle/migrations/0035_*.sql)}"; do $P -d t -f "$m" >/dev/null; done
}
setup
OUT=$(cd "$HERE" && $P -d t -f tests.sql)
# Concurrency 1: eight executors race approved -> executing; exactly one may win.
setup; (cd "$HERE" && $P -d t -f fixtures.sql >/dev/null)
RID=$($P -d t -c "INSERT INTO agent_write_requests (agent_id, grant_id, integration_id, action, account_id, object_type, object_id, before, after, diff_text, decision_expires_at, status, approval_expires_at)
  SELECT agent_id, id, integration_id, 'meta.ad.pause','111','ad','c1','{}','{}','d', now()+interval '1 day','approved', now()+interval '30 min' FROM agent_grants WHERE agent_id='b0000000-0000-4000-8000-00000000000a' RETURNING id" | head -1)
race() { # $1 = SQL each worker runs after the barrier opens; prints one line per worker
  local sql="$1" pids=() f; exec 3> >($P -d t >/dev/null); echo "SELECT pg_advisory_lock(42); SELECT pg_sleep(1.5); SELECT pg_advisory_unlock(42);" >&3
  sleep 0.3
  for i in 1 2 3 4 5 6 7 8; do ( $P -d t -c "SELECT pg_advisory_lock_shared(42)" -c "$sql" > "$D/w$i" ) & pids+=($!); done
  exec 3>&-; wait "${pids[@]}"; cat "$D"/w*; rm -f "$D"/w*
}
WIN=$(race "UPDATE agent_write_requests SET status='executing', execution_started_at=now() WHERE id='$RID' AND status='approved' AND approval_expires_at > now() RETURNING id" | grep -c "$RID" || true)
[ "$WIN" = 1 ] && OUT+=$'\n'"PASS concurrency: 8 executors race approved->executing, exactly 1 wins" || OUT+=$'\n'"FAIL concurrency: approved->executing winners=$WIN"
# Concurrency 2: 19 requests today, eight concurrent creates on different objects; exactly one fits under 20/day.
$P -d t -c "INSERT INTO agent_write_requests (agent_id, grant_id, integration_id, action, account_id, object_type, object_id, before, after, diff_text, decision_expires_at, status)
  SELECT agent_id, id, integration_id, 'meta.ad.pause','111','ad','p'||k,'{}','{}','d', now()+interval '1 day','denied' FROM agent_grants, generate_series(1,18) k WHERE agent_id='b0000000-0000-4000-8000-00000000000a'" >/dev/null
OKS=$(race "SELECT agent_write_request_create(jsonb_build_object('agent_id','b0000000-0000-4000-8000-00000000000a','grant_id',(SELECT id FROM agent_grants WHERE agent_id='b0000000-0000-4000-8000-00000000000a'),'integration_id','55694453-95b2-4c49-829b-517a50952d7b','action','meta.ad.pause','account_id','111','object_type','ad','object_id','race'||pg_backend_pid(),'before','{}'::jsonb,'after','{}'::jsonb,'diff_text','d','decision_expires_at',now()+interval '1 day'), 20)->>'ok'")
NT=$(grep -c '^true$' <<<"$OKS" || true); NF=$(grep -c '^false$' <<<"$OKS" || true)
TOTAL=$($P -d t -c "SELECT count(*) FROM agent_write_requests WHERE agent_id='b0000000-0000-4000-8000-00000000000a' AND requested_at >= agent_write_day_start(now())")
[ "$NT" = 1 ] && [ "$NF" = 7 ] && [ "$TOTAL" = 20 ] && OUT+=$'\n'"PASS concurrency: 8 concurrent requests at 19/20, exactly 1 accepted, total stays 20" || OUT+=$'\n'"FAIL concurrency: limit accepted=$NT refused=$NF total=$TOTAL"
echo "$OUT" | grep -E '^(PASS|FAIL)'
P_=$(grep -c '^PASS' <<<"$OUT" || true); F_=$(grep -c '^FAIL' <<<"$OUT" || true)
echo "DB tests: $P_ passed, $F_ failed"; [ "$F_" = 0 ]
