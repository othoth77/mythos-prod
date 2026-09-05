#!/usr/bin/env bash
# tests/erp-bootstrap-drill.sh — Phase 4 (AUTH gate) evidence: stand up a throwaway
# PostgreSQL 15, apply the real migrations and grants, bootstrap the first
# super_admin through bin/create-super-admin.js exactly as an operator would (at a
# pseudo-TTY; the password exists only inside this script's process and the
# container that dies at exit), then prove authentication, tenant association,
# authorization and the audit trail against the real API over a real socket.
#
# Nothing here touches production: the container is created and destroyed by this
# script and every connection string points at it. Never run the bootstrap tool
# this way against production — there the password is typed by a human.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="$ROOT/sites/erp.mythosprod.xyz/api"
DB="$ROOT/sites/erp.mythosprod.xyz/db"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
C="erp-bootstrap-$TS"
PW="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
ADMIN_PW="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
ADMIN_EMAIL="owner+bootstrap@mythos.test"
API_PORT=$((20000 + RANDOM % 20000))
API_PID=""
WORK="$(mktemp -d)"
PASS=0; FAIL=0
ok()    { PASS=$((PASS+1)); echo "  PASS $1"; }
bad()   { FAIL=$((FAIL+1)); echo "  FAIL $1 — $2"; }
check() { if eval "$2"; then ok "$1"; else bad "$1" "$3"; fi; }

cleanup() {
  [ -n "$API_PID" ] && kill "$API_PID" >/dev/null 2>&1 || true
  docker rm -f "$C" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# pg is a dependency of the API package, installed only in the production checkout
# (node_modules is untracked). A worktree therefore borrows it via NODE_PATH.
if [ ! -d "$API/node_modules/pg" ]; then
  export NODE_PATH="${ERP_NODE_MODULES:-/home/deploy/projects/mythos-prod/sites/erp.mythosprod.xyz/api/node_modules}"
fi

# The pty driver: answers each prompt only once it has appeared, like a human.
# Answers come from a file (0600, in a private temp dir) so they never sit in argv.
cat > "$WORK/drive.py" <<'PYEOF'
import os, pty, sys, select, json
tool = sys.argv[1]
answers = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else []
script = [(a[0].encode(), a[1].encode() + b"\n") for a in answers]
pid, fd = pty.fork()
if pid == 0:
    os.execvp('node', ['node', tool])
out = b""; seen = 0
while True:
    r, _, _ = select.select([fd], [], [], 40)
    if not r:
        break
    try:
        data = os.read(fd, 4096)
    except OSError:
        break
    if not data:
        break
    out += data
    if script and script[0][0] in out[seen:]:
        seen = len(out)
        os.write(fd, script.pop(0)[1])
_, status = os.waitpid(pid, 0)
sys.stdout.write(out.decode('utf8', 'replace'))
sys.exit(os.waitstatus_to_exitcode(status))
PYEOF

echo "[bootstrap-drill] starting throwaway PostgreSQL 15: $C"
docker run -d --name "$C" -P \
  -e POSTGRES_USER=erp_owner -e POSTGRES_DB=mythos_erp -e POSTGRES_PASSWORD="$PW" \
  postgres:15-alpine >/dev/null
for i in $(seq 1 60); do
  docker exec "$C" pg_isready -U erp_owner -q 2>/dev/null && break
  sleep 1; [ "$i" -lt 60 ] || { echo "container never became ready" >&2; exit 1; }
done
PORT="$(docker port "$C" 5432/tcp | head -1 | sed 's/.*://')"
for f in schema.sql schema-auth.sql schema-tenant.sql; do
  docker cp "$DB/$f" "$C:/tmp/$f" >/dev/null
  docker exec "$C" psql -U erp_owner -d mythos_erp -q -v ON_ERROR_STOP=1 -f "/tmp/$f" >/dev/null
done
docker exec -i "$C" psql -U erp_owner -d mythos_erp -q -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE erp_app LOGIN PASSWORD '$PW';
GRANT USAGE ON SCHEMA public TO erp_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO erp_app;
GRANT DELETE ON invoice_lines TO erp_app;
REVOKE UPDATE, DELETE ON audit_log FROM erp_app;
GRANT INSERT, SELECT ON audit_log TO erp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;
REVOKE INSERT, UPDATE ON schema_migrations FROM erp_app;
SQL
echo "[bootstrap-drill] migrations + grants applied"
OWNER_URL="postgres://erp_owner:$PW@127.0.0.1:$PORT/mythos_erp"
APP_URL="postgres://erp_app:$PW@127.0.0.1:$PORT/mythos_erp"
q() { docker exec "$C" psql -U erp_owner -d mythos_erp -Atc "$1"; }

echo "§1 bootstrap tool refusals"
set +e
OUT=$(ERP_DATABASE_URL="$OWNER_URL" node "$API/bin/create-super-admin.js" </dev/null 2>&1); RC=$?
set -e
check "non-TTY stdin is refused (exit 3)" "[ $RC -eq 3 ]" "rc=$RC"
check "refusal names the TTY requirement" "grep -q 'not a TTY' <<<\"$OUT\"" "$OUT"
set +e
OUT=$(env -u ERP_DATABASE_URL python3 "$WORK/drive.py" "$API/bin/create-super-admin.js" 2>&1); RC=$?
set -e
check "missing ERP_DATABASE_URL is refused at a TTY (exit 3)" "[ $RC -eq 3 ]" "rc=$RC $OUT"

echo "§2 interactive bootstrap at a pseudo-TTY"
umask 077
printf '[["Tenant key","mythos"],["email:","%s"],["Display name:","Owner"],["Password (","%s"],["Confirm password:","%s"]]\n' \
  "$ADMIN_EMAIL" "$ADMIN_PW" "$ADMIN_PW" > "$WORK/answers.json"
set +e
OUT=$(ERP_DATABASE_URL="$OWNER_URL" python3 "$WORK/drive.py" "$API/bin/create-super-admin.js" "$WORK/answers.json" 2>&1); RC=$?
set -e
rm -f "$WORK/answers.json"
check "bootstrap exits 0" "[ $RC -eq 0 ]" "rc=$RC $OUT"
check "bootstrap reports the tenant" "grep -q 'in tenant mythos' <<<\"$OUT\"" "$OUT"
check "the password never appears in the tool output (raw mode, no echo)" "! grep -qF \"$ADMIN_PW\" <<<\"$OUT\"" "leaked"
N_USERS=$(q 'select count(*) from users')
N_HASH=$(q "select count(*) from users where password_algo='scrypt' and left(password_hash,8)='\$scrypt\$'")
N_PLAIN=$(q "select count(*) from users where password_hash like '%$ADMIN_PW%'")
N_MEMB=$(q "select count(*) from tenant_memberships tm join tenants t on t.id=tm.tenant_id where t.key='mythos' and tm.status='active' and tm.is_default")
N_ROLE=$(q "select count(*) from user_roles ur join roles r on r.id=ur.role_id join tenants t on t.id=ur.tenant_id where r.key='super_admin' and t.key='mythos'")
N_PERM=$(q 'select count(*) from user_effective_permissions')
N_AUD=$(q "select count(*) from audit_log a join tenants t on t.id=a.tenant_id where action in ('user.created','membership.granted','role.assigned') and (detail->>'bootstrap')='true'")
N_AUDPW=$(q "select count(*) from audit_log where detail::text like '%$ADMIN_PW%'")
check "one user exists" "[ $N_USERS = 1 ]" "$N_USERS"
check "user has a scrypt hash and no plaintext" "[ $N_HASH = 1 ] && [ $N_PLAIN = 0 ]" "hash=$N_HASH plain=$N_PLAIN"
check "membership in mythos, active, default" "[ $N_MEMB = 1 ]" "$N_MEMB"
check "super_admin role scoped to mythos" "[ $N_ROLE = 1 ]" "$N_ROLE"
check "31 effective permissions in mythos" "[ $N_PERM = 31 ]" "$N_PERM"
check "audit: user.created + membership.granted + role.assigned, tenant-tagged" "[ $N_AUD = 3 ]" "$(q 'select action from audit_log' | tr '\n' ' ')"
check "audit detail carries no password" "[ $N_AUDPW = 0 ]" ""

echo "§3 second bootstrap is refused"
set +e
OUT=$(ERP_DATABASE_URL="$OWNER_URL" python3 "$WORK/drive.py" "$API/bin/create-super-admin.js" 2>&1); RC=$?
set -e
check "second run refused (exit 3) before any prompt" "[ $RC -eq 3 ] && grep -q 'already exists' <<<\"$OUT\"" "rc=$RC $OUT"
N_USERS=$(q 'select count(*) from users')
check "still exactly one user" "[ $N_USERS = 1 ]" "$N_USERS"

echo "§4 real API: authentication, tenant, authorization, audit (runtime role = erp_app)"
ERP_DATABASE_URL="$APP_URL" ERP_API_PORT="$API_PORT" node "$API/server.js" >"$WORK/api.log" 2>&1 &
API_PID=$!
for i in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$API_PORT/api/v1/health" && break; sleep 0.25; done
B="http://127.0.0.1:$API_PORT/api/v1"
J="$WORK/body.json"; H="$WORK/headers.txt"
code() { curl -s -o "$J" -D "$H" -w '%{http_code}' "$@"; }
login() { code -X POST "$B/auth/login" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}"; }

R=$(code "$B/health");                                 check "health 200 = DB readiness as erp_app" "[ $R = 200 ] && grep -q '\"db\":\"ready\"' $J && grep -q '\"role\":\"erp_app\"' $J" "$R $(cat $J)"
R=$(login "$ADMIN_EMAIL" "definitely-not-it-12345");   check "wrong password → 401" "[ $R = 401 ]" "$R $(cat $J)"
R=$(login "nobody@mythos.test" "definitely-not-it-12345"); check "unknown user → 401 (same shape)" "[ $R = 401 ]" "$R"
R=$(login "$ADMIN_EMAIL" "$ADMIN_PW");                 check "correct password → 200" "[ $R = 200 ]" "$R $(cat $J)"
COOKIE=$(grep -i '^set-cookie:' "$H" | sed -E 's/^[Ss]et-[Cc]ookie: *//; s/;.*//' | tr -d '\r')
CSRF=$(python3 -c "import json; print(json.load(open('$J'))['csrf'])")
TENANT=$(python3 -c "import json; print(json.load(open('$J'))['active_tenant_id'])")
check "session cookie is __Host- HttpOnly Secure" "grep -q '__Host-erp_session=' <<<\"$COOKIE\" && grep -qi 'httponly' $H && grep -qi 'secure' $H" "$(grep -i set-cookie $H)"
check "login lists tenant mythos and sets it active" "python3 -c \"import json; d=json.load(open('$J')); m=[t for t in d['tenants'] if t['key']=='mythos']; assert m and d['active_tenant_id']==m[0]['id']\"" "$(cat $J)"
check "login body carries no hash and no password" "! grep -q 'scrypt' $J && ! grep -qF \"$ADMIN_PW\" $J" ""
R=$(code -H "Cookie: $COOKIE" "$B/session");            check "GET /session with cookie → 200, same tenant" "[ $R = 200 ] && grep -q \"$TENANT\" $J" "$R $(cat $J)"
R=$(code "$B/users");                                   check "GET /users without cookie → 401" "[ $R = 401 ]" "$R"
R=$(code -H "Cookie: $COOKIE" "$B/users");              check "GET /users as super_admin (users.read) → 200" "[ $R = 200 ]" "$R $(cat $J)"
R=$(code -H "Cookie: $COOKIE" "$B/audit");              check "GET /audit as super_admin (audit.read) → 200 listing the bootstrap rows" "[ $R = 200 ] && grep -q 'user.created' $J && grep -q 'role.assigned' $J" "$R $(head -c 300 $J)"
R=$(code -X POST -H "Cookie: $COOKIE" -H "x-csrf-token: $CSRF" -H 'content-type: application/json' "$B/session/tenant" -d '{"tenant_id":"00000000-0000-4000-8000-000000000000"}')
check "switch to a non-member tenant → 403" "[ $R = 403 ]" "$R $(cat $J)"
R=$(code -X POST -H "Cookie: $COOKIE" -H 'content-type: application/json' "$B/session/tenant" -d "{\"tenant_id\":\"$TENANT\"}")
check "POST without CSRF header is refused (401/403)" "[ $R = 403 ] || [ $R = 401 ]" "$R $(cat $J)"
R=$(code -X POST -H "Cookie: $COOKIE" -H "x-csrf-token: $CSRF" "$B/auth/logout"); check "logout → 200 and cookie cleared" "[ $R = 200 ] && grep -qi 'Max-Age=0' $H" "$R $(grep -i set-cookie $H)"
R=$(code -H "Cookie: $COOKIE" "$B/session");            check "session invalid after logout → 401" "[ $R = 401 ]" "$R"
AUD_OK=$(q "select count(*) filter (where action='login.failure')>=1 and count(*) filter (where action='login.success')=1 and count(*) filter (where action='logout')=1 and count(*) filter (where action='permission.denied')>=1 from audit_log")
check "audit trail exact: login.failure ≥1, login.success 1, logout 1 (no spurious rows), permission.denied ≥1" "[ $AUD_OK = t ]" "$(q 'select action, count(*) from audit_log group by 1' | tr '\n' ' ')"
N_ANON=$(q "select count(*) from audit_log where actor_label='anonymous'")
check "no anonymous audit rows (every row has an actor)" "[ $N_ANON = 0 ]" "$N_ANON"
check "API log carries no password" "! grep -qF \"$ADMIN_PW\" $WORK/api.log" ""

echo "§5 runtime role guard"
set +e
OUT=$(ERP_DATABASE_URL="$OWNER_URL" ERP_API_PORT=$((API_PORT+1)) timeout 20 node "$API/server.js" 2>&1); RC=$?
set -e
check "server refuses to start as erp_owner (exit 3)" "[ $RC -eq 3 ] && grep -q 'expected erp_app' <<<\"$OUT\"" "rc=$RC $OUT"
set +e
OUT=$(ERP_DATABASE_URL="postgres://erp_app:x@127.0.0.1:1/mythos_erp" ERP_API_PORT=$((API_PORT+2)) timeout 20 node "$API/server.js" 2>&1); RC=$?
set -e
check "server refuses to start without a database (exit 2)" "[ $RC -eq 2 ]" "rc=$RC $OUT"

echo
echo "erp-bootstrap-drill: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
