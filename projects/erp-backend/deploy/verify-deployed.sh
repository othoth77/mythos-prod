#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# Mythos ERP backend — ON-HOST security gate (§9/§18)
# projects/erp-backend/deploy/verify-deployed.sh <base-url>
#
# Run this AFTER the backend is deployed but BEFORE opening public access.
# It exercises the security contract against the LIVE deployed backend over
# the network (not a throwaway server). Every gate must pass; a single FAIL
# means DO NOT open public access.
#
# Prerequisite: an admin, a viewer and an editor user exist. Provide their
# passwords by environment (defaults match the deploy runbook's test users;
# override in production):
#   ERP_ADMIN_PASS  ERP_VIEWER_PASS  ERP_EDITOR_PASS
# ══════════════════════════════════════════════════════════════════════
set -u
BASE="${1:-${BASE:-}}"
[ -z "$BASE" ] && { echo "usage: verify-deployed.sh <base-url>"; exit 2; }
BASE="${BASE%/}"
AP="${ERP_ADMIN_PASS:-adminPass123!}"
VP="${ERP_VIEWER_PASS:-viewerPass123!}"
EP="${ERP_EDITOR_PASS:-editorPass123!}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
PASS=0; FAIL=0
ok(){ if [ "$1" = "$2" ]; then PASS=$((PASS+1)); echo "  PASS $3 ($1)"; else FAIL=$((FAIL+1)); echo "  FAIL $3 (want $2 got $1)"; fi; }
code(){ curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "Target: $BASE"
ok "$(code "$BASE/health")" 200 "health public"
ok "$(code "$BASE/api/collections?key=mp_invoices")" 401 "unauthenticated read -> 401"
ok "$(code -X POST "$BASE/auth/login" -d '{"username":"admin","password":"WRONG"}')" 401 "bad password -> 401"
ok "$(code -X POST "$BASE/auth/login" -d '{"username":"ghost","password":"x"}')" 401 "unknown user -> 401 (uniform)"

AL="$(curl -s -c "$WORK/a.txt" -X POST "$BASE/auth/login" -d "{\"username\":\"admin\",\"password\":\"$AP\"}")"
ACSRF="$(echo "$AL" | sed -n 's/.*"csrf":"\([a-f0-9]*\)".*/\1/p')"
ok "$([ -n "$ACSRF" ] && echo yes || echo no)" yes "admin login issues a CSRF token"
ok "$(grep -c 'HttpOnly' "$WORK/a.txt" 2>/dev/null || echo 0)" 1 "session cookie is HttpOnly"
ok "$(code -b "$WORK/a.txt" "$BASE/api/collections?key=mp_invoices")" 200 "admin read -> 200"
ok "$(code -b "$WORK/a.txt" -X POST "$BASE/api/collections" -H 'Content-Type: application/json' -d '{"key":"mp_invoices","data":[]}')" 403 "write without CSRF -> 403"
ok "$(code -b "$WORK/a.txt" -X POST "$BASE/api/collections" -H "X-CSRF-Token: $ACSRF" -H 'Content-Type: application/json' -d '{"key":"mp_invoices","data":[{"id":"probe"}]}')" 200 "admin write with CSRF -> 200"
ok "$(code -b "$WORK/a.txt" "$BASE/api/collections?key=mp_rdtpl_../../etc/passwd")" 400 "traversal key -> 400"

# Upload: disguised php rejected, real png accepted.
printf '<?php system($_GET["c"]); ?>' > "$WORK/evil.php"
ok "$(code -b "$WORK/a.txt" -X POST "$BASE/api/upload" -H "X-CSRF-Token: $ACSRF" -F 'file=@'"$WORK/evil.php"';type=application/pdf;filename=x.pdf')" 415 "php-as-pdf upload -> 415"
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82' > "$WORK/ok.png"
ok "$(curl -s -b "$WORK/a.txt" -X POST "$BASE/api/upload" -H "X-CSRF-Token: $ACSRF" -F 'file=@'"$WORK/ok.png" | grep -c '"ok":true')" 1 "real png upload accepted"

# RBAC: viewer denied, editor allowed.
VL="$(curl -s -c "$WORK/v.txt" -X POST "$BASE/auth/login" -d "{\"username\":\"viewer\",\"password\":\"$VP\"}")"
VCSRF="$(echo "$VL" | sed -n 's/.*"csrf":"\([a-f0-9]*\)".*/\1/p')"
ok "$(code -b "$WORK/v.txt" "$BASE/api/collections?key=mp_invoices")" 200 "viewer read -> 200"
ok "$(code -b "$WORK/v.txt" -X POST "$BASE/api/collections" -H "X-CSRF-Token: $VCSRF" -H 'Content-Type: application/json' -d '{"key":"mp_invoices","data":[]}')" 403 "viewer write -> 403"
EL="$(curl -s -c "$WORK/e.txt" -X POST "$BASE/auth/login" -d "{\"username\":\"editor\",\"password\":\"$EP\"}")"
ECSRF="$(echo "$EL" | sed -n 's/.*"csrf":"\([a-f0-9]*\)".*/\1/p')"
ok "$(code -b "$WORK/e.txt" -X POST "$BASE/api/collections" -H "X-CSRF-Token: $ECSRF" -H 'Content-Type: application/json' -d '{"key":"mp_invoices","data":[{"id":"e1"}]}')" 200 "editor write -> 200"

# Logout invalidation.
curl -s -b "$WORK/a.txt" -c "$WORK/a.txt" -X POST "$BASE/auth/logout" >/dev/null
ok "$(code -b "$WORK/a.txt" "$BASE/api/collections?key=mp_invoices")" 401 "after logout -> 401"

# HTTPS + secure-cookie expectations (only meaningful on the public URL).
case "$BASE" in
  https://*) ok "$(curl -s -I "$BASE/health" | grep -ci 'strict-transport\|^HTTP/.* 200')" 1 "https reachable (add HSTS at the edge)";;
  *) echo "  NOTE base is http:// — production MUST be https:// with Secure cookies (§11)";;
esac

echo
echo "VERIFY-DEPLOYED: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "-> SECURITY GATE PASSED — safe to proceed to public access" || echo "-> GATE FAILED — DO NOT open public access"
[ "$FAIL" -eq 0 ]
