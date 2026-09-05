#!/usr/bin/env bash
# =============================================================================
# MYTHOS WP — the check pipeline (build · syntax · lint · no-secret scan · tests)
# projects/mythos-wp/tools/check.sh          run from anywhere; exit 0 = green
#
# "Build" for this service is: every module loads (node --check on each file,
# then a require() of the server graph). There is no bundler by design — the
# browser loads ES modules directly and the CSP forbids inline code, so the
# production build is the tree itself.
#
# Tests need the test database and catalogue fixture created by
# deploy/provision-db.sh (mythos_wp_test) and MYTHOS_WP_TEST_DB_URL /
# MYTHOS_WP_TEST_CATALOG_URL in the environment; without them the suite
# reports SKIPPED for the database section and exits non-zero unless
# MYTHOS_WP_ALLOW_SKIP=1.
# =============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
fail=0
step() { printf '\n== %s\n' "$1"; }

step "syntax (node --check)"
while IFS= read -r f; do node --check "$f" || fail=1; done < <(find "$HERE/reference" "$HERE/bin" -type f \( -name '*.js' -o -name 'mythos-wp' \) -not -path '*/node_modules/*')
node --check "$ROOT/projects/automotive/comms/bin/mythos-auto-reply-receiver" || fail=1
echo "syntax: $([ $fail = 0 ] && echo ok || echo FAIL)"

step "module graph loads (build)"
( cd "$HERE" && node -e "require('./reference/server.js'); require('./reference/comms/integration.js'); require('./reference/autoreply.js'); console.log('graph ok')" ) || fail=1

step "lint (eslint, flat config)"
if command -v eslint >/dev/null 2>&1; then
  ( cd "$HERE" && eslint --no-eslintrc -c .eslintrc.json reference bin/mythos-wp ) && echo "lint: ok" || fail=1
else
  echo "lint: eslint not installed"; fail=1
fi

step "design-system rules (no literal colour, no !important in wp.css)"
hex=$(grep -cE '#[0-9a-fA-F]{3,8}\b' "$HERE/reference/web/wp.css" || true)
imp=$(grep -c '!important' "$HERE/reference/web/wp.css" | tr -d ' ' || true)
# the header comment mentions "!important" once; anything beyond that is a violation
if [ "$hex" != "0" ] || [ "${imp:-0}" -gt 1 ]; then echo "design: FAIL (hex=$hex important=$imp)"; fail=1; else echo "design: ok"; fi
if grep -nE '[ <]on[a-z]+="' "$HERE/reference/web/index.html" "$HERE/reference/web/login.html" >/dev/null; then echo "csp: inline handler found"; fail=1; else echo "csp: no inline handlers"; fi

step "no-secret scan (tracked files of this project)"
if ( cd "$ROOT" && git ls-files projects/mythos-wp tests/mythos-wp-test.js | xargs grep -nEi '(password|passwd|secret|api_?key|token)\s*[:=]\s*["'"'"'][A-Za-z0-9+/=_-]{12,}["'"'"']|postgres(ql)?://[^:]+:[^@]+@|-----BEGIN [A-Z ]*PRIVATE KEY' 2>/dev/null | grep -v 'not-a-real\|test-\|example\|nonexistent\|encodeURIComponent' ); then echo "secrets: FAIL"; fail=1; else echo "secrets: ok"; fi

step "tests"
( cd "$ROOT" && timeout 300 node tests/mythos-wp-test.js ) || fail=1

printf '\n== result: %s\n' "$([ $fail = 0 ] && echo GREEN || echo RED)"
exit $fail
