#!/usr/bin/env bash
# Real-Postgres tests for the creative request change log + on_hold status (migration 0043 applied verbatim).
set -euo pipefail
if [ "$(id -u)" = 0 ]; then exec setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=/tmp PATH="$PATH" bash "$0" "$@"; fi
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../../.."
D=$(mktemp -d); PORT=${DBTEST_PORT:-55433}
initdb -D "$D/data" -U postgres -A trust >/dev/null
pg_ctl -D "$D/data" -o "-p $PORT -k $D -c listen_addresses=''" -l "$D/log" start >/dev/null
trap 'pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1; rm -rf "$D"' EXIT
P="psql -X -q -t -A -h $D -p $PORT -U postgres -v ON_ERROR_STOP=1"
$P -c "CREATE DATABASE t" >/dev/null
$P -d t -f "$HERE/stub_schema.sql" >/dev/null
$P -d t -f "$ROOT"/drizzle/migrations/0043_creative_brief_on_hold_and_change_log.sql >/dev/null
OUT=$(cd "$HERE" && $P -d t -f tests.sql)
echo "$OUT" | grep -E '^(PASS|FAIL)'
P_=$(grep -c '^PASS' <<<"$OUT" || true); F_=$(grep -c '^FAIL' <<<"$OUT" || true)
echo "DB tests: $P_ passed, $F_ failed"; [ "$F_" = 0 ]
