#!/usr/bin/env bash
# sites/erp.mythosprod.xyz/deploy/live-smoke.sh — owner-run authenticated smoke
# test of the PRODUCTION API on loopback. The password is read at the terminal
# without echo, used for exactly one login, and never written anywhere: not to
# argv, not to a file, not to the journal. Output is status codes only.
#
#   bash sites/erp.mythosprod.xyz/deploy/live-smoke.sh [email]
#
# Evidence it leaves behind (readable by the agent without the credential):
# audit rows login.success and logout for the given actor.
set -euo pipefail
B="http://127.0.0.1:${ERP_API_PORT:-8787}/api/v1"

# Build the login body from stdin (email on argv, password on stdin) with NO
# trailing newline. The first version used a bash here-string (<<<"$PW"), which
# appends "\n" — the API received password+newline and, correctly, answered 401
# (2026-09-05 17:00, two login.failure audit rows). `--selftest` proves the
# encoding without any network or credential.
payload() {  # payload <email>  (password on stdin)
  python3 -c 'import json,sys; print(json.dumps({"email": sys.argv[1], "password": sys.stdin.read()}), end="")' "$1"
}
if [ "${1:-}" = "--selftest" ]; then
  got=$(printf '%s' 'abc' | payload 'x@y.z')
  exp='{"email": "x@y.z", "password": "abc"}'
  [ "$got" = "$exp" ] && { echo "selftest PASS: $got"; exit 0; } || { echo "selftest FAIL: $got"; exit 1; }
fi
EMAIL="${1:-}"
[ -t 0 ] || { echo "REFUSED: run this at a terminal (the password is typed, never piped)"; exit 3; }
[ -n "$EMAIL" ] || read -r -p "Email: " EMAIL
read -r -s -p "Password (not echoed): " PW; echo
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
J="$W/b"; H="$W/h"
code() { curl -s -o "$J" -D "$H" -w '%{http_code}' "$@"; }
PASS=0; FAIL=0
t() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  PASS $1 → $2"; else FAIL=$((FAIL+1)); echo "  FAIL $1 → $2 (expected $3)"; fi; }

t "health" "$(code "$B/health")" 200
# one login, password via stdin to curl (never in argv)
R=$(printf '%s' "$PW" | payload "$EMAIL" \
    | curl -s -o "$J" -D "$H" -w '%{http_code}' -X POST "$B/auth/login" -H 'content-type: application/json' --data-binary @-)
unset PW
t "login" "$R" 200
COOKIE=$(grep -i '^set-cookie:' "$H" | sed -E 's/^[Ss]et-[Cc]ookie: *//; s/;.*//' | tr -d '\r')
CSRF=$(python3 -c "import json; print(json.load(open('$J')).get('csrf',''))" 2>/dev/null || true)
TENANT=$(python3 -c "import json; print(json.load(open('$J')).get('active_tenant_id',''))" 2>/dev/null || true)
echo "  info  active tenant id: ${TENANT:-none}; tenants listed: $(python3 -c "import json; print(','.join(t['key'] for t in json.load(open('$J')).get('tenants',[])))" 2>/dev/null)"
t "GET /session" "$(code -H "Cookie: $COOKIE" "$B/session")" 200
# GET /session rotates the CSRF token (server stores only its hash); use the new one from here on.
NEWCSRF=$(python3 -c "import json; print(json.load(open('$J')).get('csrf',''))" 2>/dev/null || true); [ -n "$NEWCSRF" ] && CSRF="$NEWCSRF"
t "GET /tenants" "$(code -H "Cookie: $COOKIE" "$B/tenants")" 200
t "GET /users (users.read)" "$(code -H "Cookie: $COOKIE" "$B/users")" 200
t "GET /audit (audit.read)" "$(code -H "Cookie: $COOKIE" "$B/audit")" 200
t "GET /dashboard" "$(code -H "Cookie: $COOKIE" "$B/dashboard")" 200
t "GET /invoices (tenant-scoped, empty)" "$(code -H "Cookie: $COOKIE" "$B/invoices")" 200
t "switch to non-member tenant" "$(code -X POST -H "Cookie: $COOKIE" -H "x-csrf-token: $CSRF" -H 'content-type: application/json' "$B/session/tenant" -d '{"tenant_id":"00000000-0000-4000-8000-000000000000"}')" 403
R=$(code -X POST -H "Cookie: $COOKIE" -H 'content-type: application/json' "$B/session/tenant" -d "{\"tenant_id\":\"$TENANT\"}"); [ "$R" = 401 ] && R=403
t "POST without CSRF header refused" "$R" 403
t "logout" "$(code -X POST -H "Cookie: $COOKIE" -H "x-csrf-token: $CSRF" "$B/auth/logout")" 200
t "session dead after logout" "$(code -H "Cookie: $COOKIE" "$B/session")" 401
echo "live-smoke: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
