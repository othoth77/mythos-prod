#!/usr/bin/env bash
# =====================================================
# MYTHOS TRADING CONTROL CENTER — smoke test of a running instance
# projects/mythos-trading-control-center/deploy/smoke.sh
#
#   deploy/smoke.sh <base-url> [expected-commit]
#   deploy/smoke.sh http://127.0.0.1:8210
#   deploy/smoke.sh https://trading.mythosprod.xyz 9150942f…
#
# Read-only, and needs no credentials: it checks what an anonymous caller
# sees. With TCC_SMOKE_USER and TCC_SMOKE_PASSWORD_FILE set it also signs in
# and checks the mode, the LIVE lock and the session cookie, then signs out.
# (TCC_SMOKE_ORIGIN names the public origin when the URL is the loopback port.)
# It never changes a setting.
#
# Exit status 0 only if every check passed. Each check prints PASS or FAIL.
# =====================================================
set -uo pipefail

BASE="${1:-}"
WANT_COMMIT="${2:-}"
[ -n "$BASE" ] || { echo "usage: smoke.sh <base-url> [expected-commit]" >&2; exit 2; }
BASE="${BASE%/}"
FAILS=0
JAR="$(mktemp)"; BODY="$(mktemp)"; HDRS="$(mktemp)"
trap 'rm -f "$JAR" "$BODY" "$HDRS"' EXIT

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (expected $3, got $2)"; fi; }
code() { curl -s -o "$BODY" -D "$HDRS" -w '%{http_code}' --max-time 15 "$@"; }
header() { grep -i "^$1:" "$HDRS" | head -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//'; }

# --- liveness ---------------------------------------------------------------
check "GET /api/health answers 200" "$(code "$BASE/api/health")" 200
grep -q '"ok":true' "$BODY" && pass "health body is ok" || fail "health body is not ok: $(head -c 200 "$BODY")"

# --- nothing is readable without a session ----------------------------------
for p in /api/status /api/config /api/dashboard /api/trades /api/audit /api/system /api/testing /api/research /api/paper/stream; do
  check "GET $p without a session is 401" "$(code "$BASE$p")" 401
done
check "POST /api/config/mode {to: LIVE} without a session is 401" \
  "$(code -X POST -H 'Content-Type: application/json' -d '{"to":"LIVE","reason":"smoke test"}' "$BASE/api/config/mode")" 401
check "POST /api/backtest without a session is 401" "$(code -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/backtest")" 401

# --- the interface: login page reachable, application behind the session -----
check "GET /login answers 200" "$(code "$BASE/login")" 200
grep -q 'login-form' "$BODY" && pass "the login page is the login page" || fail "the login page has no login form"
C="$(code "$BASE/dashboard")"
if [ "$C" = "302" ] || [ "$C" = "303" ]; then pass "GET /dashboard without a session redirects ($C → $(header location))"; else fail "GET /dashboard without a session answered $C"; fi

# --- security headers on a page and on an API error --------------------------
code "$BASE/login" >/dev/null
[ -n "$(header content-security-policy)" ] && pass "Content-Security-Policy is set" || fail "no Content-Security-Policy"
case "$(header content-security-policy)" in *"default-src 'self'"*) pass "CSP is default-src 'self'";; *) fail "CSP is not default-src 'self'";; esac
case "$(header content-security-policy)" in *unsafe-inline*|*unsafe-eval*) fail "CSP allows unsafe-inline or unsafe-eval";; *) pass "CSP allows no inline script or eval";; esac
check "X-Frame-Options" "$(header x-frame-options)" "DENY"
check "X-Content-Type-Options" "$(header x-content-type-options)" "nosniff"
check "Referrer-Policy" "$(header referrer-policy)" "no-referrer"
[ -n "$(header strict-transport-security)" ] && pass "Strict-Transport-Security is set" || fail "no Strict-Transport-Security"
code "$BASE/api/status" >/dev/null
[ -z "$(header access-control-allow-origin)" ] && pass "no CORS header" || fail "a CORS header is sent: $(header access-control-allow-origin)"
case "$(header cache-control)" in *no-store*) pass "API responses are no-store";; *) fail "API responses are cacheable: $(header cache-control)";; esac

# --- nothing that should not be served is served -----------------------------
for p in /.env /.git/config /COMMIT /package.json /server/server.js /server/api.js /tests/helpers.js /bin/tcc-user.js /users.json \
         /state/audit.jsonl /deploy/release.sh /docs/API.md /assets/../server/server.js /node_modules/ /api/live /api/orders /api/execute; do
  C="$(code "$BASE$p")"
  case "$C" in 404|400|401|302|303) pass "GET $p is not served ($C)";; *) fail "GET $p answered $C";; esac
done

# --- this is a production build, not a development server --------------------
code "$BASE/login" >/dev/null
if grep -Eq 'src="/assets/[a-z/]+\.[0-9a-f]{8,}\.js"' "$BODY"; then pass "the interface is the fingerprinted production build"
else fail "the login page references unfingerprinted scripts: the unbuilt sources are being served"; fi
grep -Eqi 'localhost:|webpack|vite|hot-update|sourceMappingURL' "$BODY" && fail "the page references a development server" || pass "no development-server reference in the page"

# --- no secret in the frontend ------------------------------------------------
# Every script and stylesheet a page references is fetched and searched for
# anything shaped like a credential, a stored hash, a key or a host path.
SECRET_RE='scrypt\$|passwordHash|"salt"[[:space:]]*:|BEGIN [A-Z ]*PRIVATE KEY|tcc_session=[0-9a-f]{8}|(api[_-]?key|secret|token|passwd)["'"'"' ]*[:=][[:space:]]*["'"'"'][A-Za-z0-9+/_=-]{16,}["'"'"']|/home/deploy|users\.json|TCC_USERS_FILE'
scan_assets() {   # scan_assets <label> <html-file> [cookie]
  local label="$1" html="$2" cookie="${3:-}" n=0 bad=0 a tmp
  tmp="$(mktemp)"
  grep -Eiq "$SECRET_RE" "$html" && { bad=$((bad + 1)); printf '      in the page itself\n'; }
  for a in $(grep -Eo '(src|href)="/assets/[^"]+\.(js|css)"' "$html" | cut -d'"' -f2 | sort -u); do
    if [ -n "$cookie" ]; then curl -s --max-time 15 -H "Cookie: $cookie" -o "$tmp" "$BASE$a"; else curl -s --max-time 15 -o "$tmp" "$BASE$a"; fi
    n=$((n + 1))
    grep -Eiq "$SECRET_RE" "$tmp" && { bad=$((bad + 1)); printf '      in %s\n' "$a"; }
  done
  rm -f "$tmp"
  if [ "$n" -lt 2 ]; then fail "$label: only $n asset(s) found to scan"
  elif [ "$bad" -eq 0 ]; then pass "$label: no secret in the page or its $n assets"
  else fail "$label: a secret-shaped string in $bad file(s)"; fi
}
scan_assets "login page" "$BODY"

# --- robots -------------------------------------------------------------------
check "GET /robots.txt answers 200" "$(code "$BASE/robots.txt")" 200
grep -q 'Disallow: /' "$BODY" && pass "robots are told to stay out" || fail "robots.txt does not disallow everything"

# --- TLS (only meaningful against the public name) ----------------------------
case "$BASE" in
  https://*)
    HOST="${BASE#https://}"
    V="$(curl -s -o /dev/null -w '%{ssl_verify_result}' --max-time 15 "$BASE/api/health")"
    check "the TLS certificate verifies" "$V" 0
    C="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://$HOST/api/health")"
    R="$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 15 "http://$HOST/api/health")"
    case "$C:$R" in 301:https://$HOST/*|308:https://$HOST/*) pass "plain HTTP redirects to HTTPS on the same name";; *) fail "plain HTTP answered $C → $R";; esac
    EXP="$(echo | openssl s_client -servername "$HOST" -connect "$HOST:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
    [ -n "$EXP" ] && pass "certificate valid until $EXP" || fail "could not read the certificate"
    ;;
  *) printf 'SKIP  TLS checks (not an https:// URL)\n';;
esac

# --- signed-in checks (optional; read-only) -----------------------------------
if [ -n "${TCC_SMOKE_USER:-}" ] && [ -n "${TCC_SMOKE_PASSWORD_FILE:-}" ] && [ -r "$TCC_SMOKE_PASSWORD_FILE" ]; then
  PAYLOAD="$(node -e 'process.stdout.write(JSON.stringify({user: process.argv[1], password: require("fs").readFileSync(process.argv[2], "utf8").replace(/\n$/, "")}))' "$TCC_SMOKE_USER" "$TCC_SMOKE_PASSWORD_FILE")"
  # Behind the proxy the server accepts state-changing requests from its public
  # origin only; when testing the loopback port directly, name that origin.
  ORIGIN="${TCC_SMOKE_ORIGIN:-$BASE}"
  check "sign-in answers 200" "$(printf '%s' "$PAYLOAD" | code -c "$JAR" -X POST -H 'Content-Type: application/json' -H "Origin: $ORIGIN" --data-binary @- "$BASE/api/auth/login")" 200
  CSRF="$(node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).result.csrf||"")}catch(e){}' "$BODY")"
  SC="$(grep -i '^set-cookie:' "$HDRS" | head -1)"
  case "$SC" in *HttpOnly*) pass "the session cookie is HttpOnly";; *) fail "the session cookie is not HttpOnly";; esac
  case "$SC" in *Secure*) pass "the session cookie is Secure";; *) fail "the session cookie is not Secure";; esac
  case "$SC" in *SameSite=Strict*) pass "the session cookie is SameSite=Strict";; *) fail "the session cookie is not SameSite=Strict";; esac
  # curl will not send a Secure cookie over plain http, so pass it explicitly.
  COOKIE="$(awk '$6 == "tcc_session" { print $6 "=" $7 }' "$JAR")"
  check "GET /api/status with the session is 200" "$(code -H "Cookie: $COOKIE" "$BASE/api/status")" 200
  grep -q '"mode":"BACKTEST"' "$BODY" && pass "the mode is BACKTEST" || { grep -q '"mode":"PAPER"' "$BODY" && pass "the mode is PAPER (owner-approved)" || fail "the mode is neither BACKTEST nor PAPER: $(head -c 300 "$BODY")"; }
  grep -q '"modesAvailable":\["BACKTEST","PAPER"\]' "$BODY" && pass "the only modes are BACKTEST and PAPER" || fail "modesAvailable is not [BACKTEST, PAPER]"
  grep -q '"liveExecution":{"available":false' "$BODY" && pass "LIVE execution is reported not available" || fail "liveExecution is not reported unavailable"
  if [ -n "$WANT_COMMIT" ]; then grep -q "\"commit\":\"$WANT_COMMIT" "$BODY" && pass "the running commit is $WANT_COMMIT" || fail "the running commit is not $WANT_COMMIT"; fi
  C="$(code -H "Cookie: $COOKIE" -H "X-TCC-CSRF: $CSRF" -H "Origin: $ORIGIN" -X POST -H 'Content-Type: application/json' -d '{"to":"LIVE","reason":"smoke test: LIVE must be refused"}' "$BASE/api/config/mode")"
  check "asking for LIVE with a session is refused (403)" "$C" 403
  grep -Eq 'LIVE_NOT_AVAILABLE|FORBIDDEN' "$BODY" && pass "the refusal names LIVE_NOT_AVAILABLE (or the role is below OPERATOR)" || fail "LIVE was not refused by name: $(head -c 200 "$BODY")"
  check "GET /api/audit/verify is 200" "$(code -H "Cookie: $COOKIE" "$BASE/api/audit/verify")" 200
  grep -q '"ok":true' "$BODY" && pass "the audit chain verifies" || fail "the audit chain does not verify: $(head -c 300 "$BODY")"
  check "GET /api/system is 200" "$(code -H "Cookie: $COOKIE" "$BASE/api/system")" 200
  grep -q '"refusalVerified":true' "$BODY" && pass "the live adapter's refusal is verified by a health check" || fail "the live adapter's refusal is not verified"
  grep -q '"built":false' "$BODY" && fail "the server reports it is serving unbuilt sources" || pass "the server reports a built interface"
  check "GET /dashboard with the session is 200" "$(code -H "Cookie: $COOKIE" "$BASE/dashboard")" 200
  SHELL_HTML="$(mktemp)"; cp "$BODY" "$SHELL_HTML"
  scan_assets "application shell" "$SHELL_HTML" "$COOKIE"
  rm -f "$SHELL_HTML"
  check "sign-out answers 200" "$(code -H "Cookie: $COOKIE" -H "X-TCC-CSRF: $CSRF" -H "Origin: $ORIGIN" -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/auth/logout")" 200
  check "the session is gone after sign-out" "$(code -H "Cookie: $COOKIE" "$BASE/api/status")" 401
else
  printf 'SKIP  signed-in checks (set TCC_SMOKE_USER and TCC_SMOKE_PASSWORD_FILE to run them)\n'
fi

if [ "$FAILS" -eq 0 ]; then printf '\nSMOKE: PASS\n'; exit 0; fi
printf '\nSMOKE: FAIL (%s check(s) failed)\n' "$FAILS"
exit 1
