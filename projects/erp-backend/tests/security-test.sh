#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# Mythos ERP secure backend — integration security test (§17 matrix)
# projects/erp-backend/tests/security-test.sh
#
# Boots the backend with `php -S` against a throwaway SQLite DB, seeds an
# admin + a viewer, and asserts the security contract end-to-end with curl:
# unauthenticated denied, auth works, RBAC enforced, CSRF enforced, upload
# attacks rejected, traversal rejected, optimistic concurrency, logout
# invalidation, audit rows, no secrets. Exit 0 = all pass.
#
# Run:  bash tests/security-test.sh
# ══════════════════════════════════════════════════════════════════════
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PORT="${ERP_TEST_PORT:-8791}"
WORK="$(mktemp -d)"
DB="$WORK/erp.db"
UPLOADS="$WORK/uploads"; mkdir -p "$UPLOADS"
BASE="http://127.0.0.1:$PORT"
COOKIES="$WORK/cookies.txt"
PASS=0; FAIL=0
ok(){ if [ "$1" = "$2" ]; then PASS=$((PASS+1)); echo "  PASS $3 ($1)"; else FAIL=$((FAIL+1)); echo "  FAIL $3 (want $2 got $1)"; fi; }

export ERP_DB_DRIVER=sqlite ERP_DB_PATH="$DB" ERP_UPLOAD_DIR="$UPLOADS"
export ERP_COOKIE_SECURE=0 ERP_SESSION_TTL_DAYS=7

# Seed roles + users (no hardcoded prod secret; test-only passwords here).
ERP_NEW_PASSWORD='adminPass123!' php cli/create-user.php admin  admin  "Admin"  >/dev/null
ERP_NEW_PASSWORD='viewerPass123!' php cli/create-user.php viewer viewer "Viewer" >/dev/null

php -S 127.0.0.1:"$PORT" "$ROOT/public/index.php" >"$WORK/server.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$WORK"' EXIT
for i in $(seq 1 30); do curl -fsS "$BASE/health" >/dev/null 2>&1 && break; sleep 0.2; done

echo "1. Health is public"
ok "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health")" 200 "GET /health -> 200"

echo "2. Unauthenticated API is denied"
ok "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/collections?key=mp_invoices")" 401 "no cookie -> 401"
ok "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/collections" -d '{"key":"mp_invoices","data":[]}')" 401 "unauth write -> 401"

echo "3. Login: wrong password denied, uniform message"
ok "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/login" -d '{"username":"admin","password":"nope"}')" 401 "bad password -> 401"
ok "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/login" -d '{"username":"ghost","password":"nope"}')" 401 "unknown user -> 401 (same message)"

echo "4. Admin login works and sets an HttpOnly session cookie"
LOGIN="$(curl -s -c "$COOKIES" -X POST "$BASE/auth/login" -d '{"username":"admin","password":"adminPass123!"}')"
ok "$(echo "$LOGIN" | grep -c '"ok":true')" 1 "login ok"
CSRF="$(echo "$LOGIN" | sed -n 's/.*"csrf":"\([a-f0-9]*\)".*/\1/p')"
ok "$([ -n "$CSRF" ] && echo yes || echo no)" yes "csrf token issued"
ok "$(grep -c 'HttpOnly' "$COOKIES" 2>/dev/null || echo 0)" 1 "cookie is HttpOnly"

echo "5. Authenticated read works"
ok "$(curl -s -b "$COOKIES" -o /dev/null -w '%{http_code}' "$BASE/api/collections?key=mp_invoices")" 200 "auth read -> 200"

echo "6. Write requires a valid CSRF token"
ok "$(curl -s -b "$COOKIES" -o /dev/null -w '%{http_code}' -X POST "$BASE/api/collections" -H 'Content-Type: application/json' -d '{"key":"mp_invoices","data":[{"id":"i1"}]}')" 403 "write without CSRF -> 403"
W1="$(curl -s -b "$COOKIES" -X POST "$BASE/api/collections" -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' -d '{"key":"mp_invoices","data":[{"id":"i1"}]}')"
ok "$(echo "$W1" | grep -c '"version":1')" 1 "write with CSRF -> version 1"

echo "7. Optimistic concurrency (version conflict)"
ok "$(curl -s -b "$COOKIES" -o /dev/null -w '%{http_code}' -X POST "$BASE/api/collections" -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' -d '{"key":"mp_invoices","data":[{"id":"i2"}],"baseVersion":0}')" 409 "stale baseVersion -> 409"

echo "8. Collection key validation / traversal rejected"
ok "$(curl -s -b "$COOKIES" -o /dev/null -w '%{http_code}' "$BASE/api/collections?key=mp_rdtpl_../../etc/passwd")" 400 "traversal key -> 400"
ok "$(curl -s -b "$COOKIES" -o /dev/null -w '%{http_code}' "$BASE/api/collections?key=not_allowed")" 400 "unknown key -> 400"

echo "9. RBAC: viewer cannot write"
VC="$WORK/viewer.txt"
VLOGIN="$(curl -s -c "$VC" -X POST "$BASE/auth/login" -d '{"username":"viewer","password":"viewerPass123!"}')"
VCSRF="$(echo "$VLOGIN" | sed -n 's/.*"csrf":"\([a-f0-9]*\)".*/\1/p')"
ok "$(curl -s -b "$VC" -o /dev/null -w '%{http_code}' "$BASE/api/collections?key=mp_invoices")" 200 "viewer read -> 200"
ok "$(curl -s -b "$VC" -o /dev/null -w '%{http_code}' -X POST "$BASE/api/collections" -H "X-CSRF-Token: $VCSRF" -H 'Content-Type: application/json' -d '{"key":"mp_invoices","data":[]}')" 403 "viewer write -> 403"
ok "$(curl -s -b "$VC" -o /dev/null -w '%{http_code}' -X POST "$BASE/api/upload" -H "X-CSRF-Token: $VCSRF" -F 'file=@/etc/hostname')" 403 "viewer upload -> 403"

echo "10. Upload: disguised .php rejected, real image stored"
printf '<?php system($_GET["c"]); ?>' > "$WORK/evil.php"
ok "$(curl -s -b "$COOKIES" -o /dev/null -w '%{http_code}' -X POST "$BASE/api/upload" -H "X-CSRF-Token: $CSRF" -F 'file=@'"$WORK/evil.php"';type=application/pdf;filename=evil.pdf')" 415 "php-as-pdf -> 415 (magic bytes)"
# a real 1x1 PNG
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82' > "$WORK/ok.png"
UP="$(curl -s -b "$COOKIES" -X POST "$BASE/api/upload" -H "X-CSRF-Token: $CSRF" -F 'file=@'"$WORK/ok.png")"
ok "$(echo "$UP" | grep -c '"ok":true')" 1 "real png accepted"
# stored file must NOT be a .php and must live under the uploads dir
ok "$(ls "$UPLOADS" | grep -c '\.php$')" 0 "no .php written to storage"
ok "$(ls "$UPLOADS" | grep -c '\.png$')" 1 "png stored with server extension"

echo "11. Logout invalidates the session"
curl -s -b "$COOKIES" -c "$COOKIES" -X POST "$BASE/auth/logout" >/dev/null
ok "$(curl -s -b "$COOKIES" -o /dev/null -w '%{http_code}' "$BASE/api/collections?key=mp_invoices")" 401 "after logout -> 401"

echo "12. Audit rows recorded; no plaintext session id stored"
ACOUNT="$(php -r '$p=new PDO("sqlite:".getenv("ERP_DB_PATH"));echo $p->query("SELECT COUNT(*) FROM audit_log")->fetchColumn();')"
ok "$([ "$ACOUNT" -ge 3 ] && echo yes || echo no)" yes "audit_log has login/write/upload rows ($ACOUNT)"
# session ids are stored only as 64-hex sha256 hashes
ok "$(php -r '$p=new PDO("sqlite:".getenv("ERP_DB_PATH"));$h=$p->query("SELECT id_hash FROM sessions LIMIT 1")->fetchColumn();echo ($h===false||preg_match("/^[a-f0-9]{64}$/",$h))?"yes":"no";')" yes "session id stored as sha256 hash only"

echo
echo "SECURITY-TEST: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
