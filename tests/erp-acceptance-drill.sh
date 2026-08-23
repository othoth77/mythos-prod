#!/usr/bin/env bash
# tests/erp-acceptance-drill.sh — stand up a throwaway PostgreSQL 15, apply the
# real migrations, and run the two-tenant acceptance suite against a real API
# server over a real socket.
#
# Nothing here touches production: the container is created and destroyed by
# this script, and it refuses to run against a production connection string.
set -euo pipefail

KEEP=false
[ "${1:-}" = "--keep" ] && KEEP=true

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="$ROOT/sites/erp.mythosprod.xyz/db"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
C="erp-acceptance-$TS"
PW="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"

cleanup() { [ "$KEEP" = true ] || docker rm -f "$C" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "[acceptance] starting throwaway PostgreSQL 15: $C"
docker run -d --name "$C" -P \
  -e POSTGRES_USER=erp_owner -e POSTGRES_DB=mythos_erp -e POSTGRES_PASSWORD="$PW" \
  postgres:15-alpine >/dev/null
for i in $(seq 1 60); do
  docker exec "$C" pg_isready -U erp_owner -q 2>/dev/null && break
  sleep 1
  [ "$i" -lt 60 ] || { echo "container never became ready" >&2; exit 1; }
done
PORT="$(docker port "$C" 5432/tcp | head -1 | sed 's/.*://')"

for f in schema.sql schema-auth.sql schema-tenant.sql; do
  docker cp "$DB/$f" "$C:/tmp/$f" >/dev/null
  docker exec "$C" psql -U erp_owner -d mythos_erp -q -v ON_ERROR_STOP=1 -f "/tmp/$f" >/dev/null
  echo "[acceptance] applied $f"
done

# The application role owns nothing, so RLS applies to it in full.
docker exec -i "$C" psql -U erp_owner -d mythos_erp -q -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE erp_app LOGIN PASSWORD '$PW';
GRANT USAGE ON SCHEMA public TO erp_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO erp_app;
GRANT DELETE ON invoice_lines TO erp_app;   -- lines are replaced wholesale on edit
REVOKE UPDATE, DELETE ON audit_log FROM erp_app;
GRANT INSERT, SELECT ON audit_log TO erp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;
SQL
echo "[acceptance] roles and grants applied"

export ERP_DATABASE_URL="postgres://erp_owner:$PW@127.0.0.1:$PORT/mythos_erp"
export ERP_APP_DATABASE_URL="postgres://erp_app:$PW@127.0.0.1:$PORT/mythos_erp"
node "$ROOT/tests/erp-acceptance-test.js"
