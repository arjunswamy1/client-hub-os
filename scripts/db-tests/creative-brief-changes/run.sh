#!/usr/bin/env bash
# Real-Postgres tests for the creative request change log, on_hold and the
# mcp-hub creative tools (migrations 0043 + 0044 applied verbatim; the access
# functions are the live definitions, not stubs).
set -euo pipefail
# initdb refuses root: only the server runs as an unprivileged uid; psql and vitest run as the caller.
AS=""; [ "$(id -u)" = 0 ] && AS="setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=/tmp PATH=$PATH"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
D=$(mktemp -d); PORT=${DBTEST_PORT:-55433}; [ -n "$AS" ] && chown 65534:65534 "$D"
$AS initdb -D "$D/data" -U postgres -A trust >/dev/null
$AS pg_ctl -D "$D/data" -o "-p $PORT -k $D -c listen_addresses=''" -l "$D/log" start >/dev/null
trap '$AS pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT
P="psql -X -q -t -A -h $D -p $PORT -U postgres -v ON_ERROR_STOP=1"
setup() {
  $P -c "DROP DATABASE IF EXISTS t" -c "CREATE DATABASE t" >/dev/null
  $P -d t -f "$HERE/stub_schema.sql" >/dev/null
  for m in 0043_creative_brief_on_hold_and_change_log 0044_creative_brief_hold_and_log_hardening; do $P -d t -f "$ROOT/drizzle/migrations/$m.sql" >/dev/null; done
}
OUT=""
setup; OUT+=$(cd "$HERE" && $P -d t -f tests.sql); OUT+=$'\n'
setup; OUT+=$(cd "$HERE" && $P -d t -f roles_tests.sql); OUT+=$'\n'
# mcp-hub tool handlers against this database (psql-backed client).
setup
OUT+=$(cd "$ROOT" && DBTEST_PG="-h $D -p $PORT -U postgres -d t" node_modules/.bin/vitest run src/test/creativeHoldDb.test.ts --configLoader runner --reporter=json --outputFile=/tmp/dbtest-vitest.json >/tmp/dbtest-vitest.log 2>&1; cat /tmp/dbtest-vitest.json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s.slice(s.indexOf("{")));for(const f of j.testResults)for(const t of f.assertionResults)console.log((t.status==="passed"?"PASS ":"FAIL ")+"[mcp] "+t.title+(t.status==="passed"?"":" :: "+(t.failureMessages||[]).join(" ").slice(0,300)));if(!j.numTotalTests)console.log("FAIL [mcp] no tests ran")})')
echo "$OUT" | grep -E '^(PASS|FAIL)'
P_=$(grep -c '^PASS' <<<"$OUT" || true); F_=$(grep -c '^FAIL' <<<"$OUT" || true)
echo "DB tests: $P_ passed, $F_ failed"; [ "$F_" = 0 ]
