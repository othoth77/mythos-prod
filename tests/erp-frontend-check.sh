#!/usr/bin/env bash
# tests/erp-frontend-check.sh — static checks for sites/erp.mythosprod.xyz/app.
# Design-system rules (docs/ERP_DESIGN_SYSTEM.md, docs/MYTHOS_DESIGN_DECISIONS.md)
# and CSP rules, enforced mechanically:
#   - erp.css: no literal colour (hex / rgb / hsl), no !important, only tokens
#     that exist in tokens.css, tokens.css byte-identical to the Hub's
#   - index.html: no inline style=, no inline on*= handlers, no inline <script>
#   - every referenced asset exists; every ES module parses; imports resolve
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/sites/erp.mythosprod.xyz/app"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1 — $2"; }

echo "§1 design-system rules (erp.css)"
# strip comments before counting so the header's own explanation does not count
CSS_NOCOMMENT="$(python3 -c 'import re,sys; print(re.sub(r"/\*.*?\*/", "", open(sys.argv[1]).read(), flags=re.S))' "$APP/assets/erp.css")"
hex=$(grep -c -E '#[0-9a-fA-F]{3,8}\b' <<<"$CSS_NOCOMMENT" || true)
rgb=$(grep -c -E '\b(rgba?|hsla?)\(' <<<"$CSS_NOCOMMENT" || true)
imp=$(grep -c '!important' <<<"$CSS_NOCOMMENT" || true)
[ "$hex" = 0 ] && ok "no literal hex colour" || bad "no literal hex colour" "$hex occurrences"
[ "$rgb" = 0 ] && ok "no rgb()/hsl() literal" || bad "no rgb()/hsl() literal" "$rgb occurrences"
[ "$imp" = 0 ] && ok "no !important" || bad "no !important" "$imp occurrences"
missing=0
for tok in $(grep -o -E 'var\(--mythos-[a-z0-9-]+' <<<"$CSS_NOCOMMENT" | sed 's/var(//' | sort -u); do
  grep -q -E "^\s*$tok\s*:" "$APP/assets/tokens.css" || { missing=$((missing+1)); echo "     unknown token $tok"; }
done
[ "$missing" = 0 ] && ok "every var(--mythos-*) exists in tokens.css" || bad "every var(--mythos-*) exists in tokens.css" "$missing unknown"
cmp -s "$APP/assets/tokens.css" "$ROOT/assets/brand/tokens/tokens.css" && ok "tokens.css byte-identical to assets/brand/tokens/tokens.css" || bad "tokens.css identical to the Hub's" "differs"
gest=$(grep -c -E '^\s*\.[a-zA-Z0-9_-]+::after\s*\{' <<<"$CSS_NOCOMMENT" || true)   # decorative pseudo-elements on components; the universal reset is not one
[ "$gest" -le 1 ] && ok "one 35° gesture rule at most (A-012)" || bad "one 35° gesture" "$gest ::after rules"
grep -q 'prefers-reduced-motion' "$APP/assets/erp.css" && ok "prefers-reduced-motion honoured (A-018)" || bad "prefers-reduced-motion" "absent"

echo "§2 CSP rules (index.html)"
grep -q -E 'style=' "$APP/index.html" && bad "no inline style=" "found" || ok "no inline style="
grep -q -E '\son[a-z]+=' "$APP/index.html" && bad "no inline on*= handler" "found" || ok "no inline on*= handler"
grep -E -q '<script[^>]*>[^<]+</script>' "$APP/index.html" && bad "no inline <script> body" "found" || ok "no inline <script> body"
grep -q 'type="module" src="assets/js/app.js"' "$APP/index.html" && ok "app.js loaded as an ES module" || bad "app.js module tag" "missing"
grep -q -i 'maquette' "$APP/index.html" && bad "no mock badge left" "found" || ok "no mock badge left"
grep -q 'data-stage3' "$APP/index.html" && bad "no data-stage3 inert controls" "found" || ok "no data-stage3 inert controls"
grep -q 'id="toasts"' "$APP/index.html" && grep -q 'id="modal-root"' "$APP/index.html" && ok "toast + modal roots present" || bad "overlay roots" "missing"
grep -q 'aria-live' "$APP/index.html" && grep -q 'skip-link' "$APP/index.html" && ok "aria-live route announcer + skip link" || bad "a11y landmarks" "missing"

echo "§3 assets and modules"
for ref in $(grep -o -E '(href|src)="assets/[^"]+"' "$APP/index.html" | sed -E 's/.*="//; s/"$//'); do
  [ -f "$APP/$ref" ] && ok "asset exists: $ref" || bad "asset exists: $ref" "missing"
done
for f in $(find "$APP/assets/js" -name '*.js' | sort); do
  if node --input-type=module --check < "$f" 2>/dev/null; then ok "parses: ${f#$APP/}"; else bad "parses: ${f#$APP/}" "syntax error"; fi
  for imp in $(grep -o -E "from '[^']+'" "$f" | sed -E "s/from '//; s/'$//"); do
    target="$(cd "$(dirname "$f")" && realpath -m "$imp")"
    [ -f "$target" ] || bad "import resolves in ${f#$APP/}" "$imp"
  done
done
ok "imports resolved (any failure listed above)"
grep -rq -E '\.(innerHTML|outerHTML)\s*[=+]|insertAdjacentHTML' "$APP/assets/js" && bad "no innerHTML/outerHTML/insertAdjacentHTML assignment" "found" || ok "no innerHTML/outerHTML/insertAdjacentHTML assignment (text nodes only)"
grep -rq -E 'localStorage' "$APP/assets/js" && bad "no localStorage for session" "found" || ok "session state in sessionStorage only"
grep -rq -E "credentials: 'same-origin'" "$APP/assets/js/api.js" && ok "fetch uses same-origin credentials" || bad "same-origin credentials" "missing"
grep -rq -E "x-csrf-token" "$APP/assets/js/api.js" && ok "CSRF header on unsafe verbs" || bad "CSRF header" "missing"
grep -q 'REFUSED\|mock\|fake' "$APP/assets/js/app.js" && bad "no mock data paths in app.js" "found" || ok "no mock data paths in app.js"

echo
echo "erp-frontend-check: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
