#!/usr/bin/env bash
# tests/erp-frontend-drill.sh — Phase 6 (FRONTEND gate) evidence: the real
# browser application rendered by a real headless Chromium against the real API
# on a throwaway PostgreSQL 15, on one loopback origin.
#
#   throwaway PG15 → migrations + grants → bootstrap super_admin (pty) →
#   API with ERP_SERVE_APP=1 → curl login (cookie + csrf) → seed data through
#   the API → cookie-injecting proxy → chromium --headless --dump-dom per route
#   → assertions on the rendered DOM.
#
# Nothing here touches production. Never run against production.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="$ROOT/sites/erp.mythosprod.xyz/api"
DB="$ROOT/sites/erp.mythosprod.xyz/db"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
C="erp-frontend-$TS"
PW="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
ADMIN_PW="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
ADMIN_EMAIL="owner+frontend@mythos.test"
API_PORT=$((21000 + RANDOM % 9000)); PROXY_PORT=$((API_PORT + 1))
API_PID=""; PROXY_PID=""
WORK="$(mktemp -d)"
CHROME="${CHROME:-$(command -v chromium-browser || command -v chromium || command -v google-chrome || true)}"
PASS=0; FAIL=0
ok()    { PASS=$((PASS+1)); echo "  PASS $1"; }
bad()   { FAIL=$((FAIL+1)); echo "  FAIL $1 — $2"; }
check() { if eval "$2"; then ok "$1"; else bad "$1" "$3"; fi; }
cleanup() {
  [ -n "$PROXY_PID" ] && kill "$PROXY_PID" >/dev/null 2>&1 || true
  [ -n "$API_PID" ] && kill "$API_PID" >/dev/null 2>&1 || true
  docker rm -f -v "$C" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
[ -n "$CHROME" ] || { echo "no chromium binary found (set CHROME=)"; exit 2; }
if [ ! -d "$API/node_modules/pg" ]; then
  export NODE_PATH="${ERP_NODE_MODULES:-/home/deploy/projects/mythos-prod/sites/erp.mythosprod.xyz/api/node_modules}"
fi

cat > "$WORK/drive.py" <<'PYEOF'
import os, pty, sys, select, json
tool = sys.argv[1]; answers = json.load(open(sys.argv[2]))
script = [(a[0].encode(), a[1].encode() + b"\n") for a in answers]
pid, fd = pty.fork()
if pid == 0: os.execvp('node', ['node', tool])
out = b""; seen = 0
while True:
    r, _, _ = select.select([fd], [], [], 40)
    if not r: break
    try: data = os.read(fd, 4096)
    except OSError: break
    if not data: break
    out += data
    if script and script[0][0] in out[seen:]:
        seen = len(out); os.write(fd, script.pop(0)[1])
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
PYEOF

echo "[frontend-drill] throwaway PostgreSQL 15: $C"
docker run -d --name "$C" -P -e POSTGRES_USER=erp_owner -e POSTGRES_DB=mythos_erp -e POSTGRES_PASSWORD="$PW" postgres:15-alpine >/dev/null
OKS=0; for i in $(seq 1 90); do if docker exec "$C" pg_isready -U erp_owner -q 2>/dev/null; then OKS=$((OKS+1)); [ $OKS -ge 2 ] && break; else OKS=0; fi; sleep 1; [ "$i" -lt 90 ] || { echo "db never ready" >&2; exit 1; }; done
PORT="$(docker port "$C" 5432/tcp | head -1 | sed 's/.*://')"
for f in schema.sql schema-auth.sql schema-tenant.sql 0004-prospects.sql 0005-accounting.sql; do
  docker cp "$DB/$f" "$C:/tmp/$f" >/dev/null
  docker exec "$C" psql -U erp_owner -d mythos_erp -q -v ON_ERROR_STOP=1 -f "/tmp/$f" >/dev/null
done
docker exec -i "$C" psql -U erp_owner -d mythos_erp -q -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE erp_app LOGIN PASSWORD '$PW';
GRANT USAGE ON SCHEMA public TO erp_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO erp_app;
GRANT DELETE ON invoice_lines TO erp_app;
GRANT SELECT, INSERT, UPDATE ON accounts, journals, fiscal_periods, accounting_counters, journal_entries, journal_lines TO erp_app;
GRANT DELETE ON journal_lines TO erp_app;   -- draft lines are replaced wholesale; the trigger freezes posted ones
REVOKE UPDATE, DELETE ON audit_log FROM erp_app;
GRANT INSERT, SELECT ON audit_log TO erp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;
REVOKE INSERT, UPDATE ON schema_migrations FROM erp_app;
SQL
OWNER_URL="postgres://erp_owner:$PW@127.0.0.1:$PORT/mythos_erp"
APP_URL="postgres://erp_app:$PW@127.0.0.1:$PORT/mythos_erp"
q() { docker exec "$C" psql -U erp_owner -d mythos_erp -Atc "$1"; }

umask 077
printf '[["Tenant key","mythos"],["email:","%s"],["Display name:","Owner"],["Password (","%s"],["Confirm password:","%s"]]\n' "$ADMIN_EMAIL" "$ADMIN_PW" "$ADMIN_PW" > "$WORK/answers.json"
ERP_DATABASE_URL="$OWNER_URL" python3 "$WORK/drive.py" "$API/bin/create-super-admin.js" "$WORK/answers.json" >/dev/null 2>&1 || { echo "bootstrap failed"; exit 1; }
rm -f "$WORK/answers.json"
echo "[frontend-drill] super_admin bootstrapped"

ERP_DATABASE_URL="$APP_URL" ERP_API_PORT="$API_PORT" ERP_SERVE_APP=1 node "$API/server.js" >"$WORK/api.log" 2>&1 &
API_PID=$!
for i in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$API_PORT/api/v1/health" && break; sleep 0.25; done
B="http://127.0.0.1:$API_PORT"; J="$WORK/b"; H="$WORK/h"
code() { curl -s -o "$J" -D "$H" -w '%{http_code}' "$@"; }

echo "§1 static app served on the API origin (opt-in)"
R=$(code "$B/");                     check "GET / → 200 index.html" "[ $R = 200 ] && grep -q 'Mythos ERP' $J" "$R"
check "index.html carries the app CSP (script-src 'self', no inline)" "grep -qi \"script-src 'self'\" $H && grep -qi 'frame-ancestors' $H" "$(grep -i content-security $H)"
check "index.html is no-store" "grep -qi 'Cache-Control: no-store' $H" ""
R=$(code "$B/assets/js/app.js");     check "ES module served as text/javascript" "[ $R = 200 ] && grep -qi 'text/javascript' $H" "$R"
R=$(code "$B/assets/erp.css");       check "stylesheet served, cacheable" "[ $R = 200 ] && grep -qi 'max-age' $H" "$R"
R=$(code "$B/.git/config");          check "dotfile → 404" "[ $R = 404 ]" "$R"
R=$(code "$B/assets/../api/server.js"); check "traversal → 404" "[ $R = 404 ]" "$R"
R=$(code "$B/index.html.bak");       check "unknown extension → 404" "[ $R = 404 ]" "$R"
R=$(code -X POST "$B/index.html");   check "POST on static → 405" "[ $R = 405 ]" "$R"

echo "§2 login through the same origin, seed data through the API"
printf '%s' "$ADMIN_PW" | python3 -c 'import json,sys; print(json.dumps({"email": sys.argv[1], "password": sys.stdin.read()}), end="")' "$ADMIN_EMAIL" > "$WORK/login.json"
R=$(code -X POST "$B/api/v1/auth/login" -H 'content-type: application/json' --data-binary "@$WORK/login.json"); rm -f "$WORK/login.json"
check "login 200" "[ $R = 200 ]" "$R $(cat $J)"
COOKIE=$(grep -i '^set-cookie:' "$H" | sed -E 's/^[Ss]et-[Cc]ookie: *//; s/;.*//' | tr -d '\r')
CSRF=$(python3 -c "import json; print(json.load(open('$J'))['csrf'])")
auth() { code -H "Cookie: $COOKIE" -H "x-csrf-token: $CSRF" "$@"; }
R=$(auth "$B/api/v1/meta"); check "GET /meta → 200 with resources, statuses, modules" "[ $R = 200 ] && python3 -c \"import json; d=json.load(open('$J')); assert 'clients' in d['resources'] and d['statuses']['invoice'] and 'invoices' in d['modules']\"" "$R $(head -c 200 $J)"
R=$(auth -X POST "$B/api/v1/clients" -H 'content-type: application/json' -d '{"name":"Client Drill <b>x</b>","email":"drill@client.test","city":"Tunis"}'); check "seed client → 201" "[ $R = 201 ]" "$R $(cat $J)"
CLIENT=$(python3 -c "import json; print(json.load(open('$J'))['id'])")
R=$(auth -X POST "$B/api/v1/projects" -H 'content-type: application/json' -d "{\"title\":\"Projet Drill\",\"client_id\":\"$CLIENT\",\"status\":\"active\"}"); check "seed project → 201" "[ $R = 201 ]" "$R $(cat $J)"
R=$(auth -X POST "$B/api/v1/invoices" -H 'content-type: application/json' -d "{\"client_id\":\"$CLIENT\",\"issued_on\":\"$(date -u +%F)\",\"currency\":\"TND\",\"lines\":[{\"description\":\"Prestation drill\",\"quantity\":2,\"unit_price\":100,\"vat_rate\":19}]}"); check "seed invoice → 201" "[ $R = 201 ]" "$R $(cat $J)"
INV=$(python3 -c "import json; print(json.load(open('$J'))['id'])"); INVNUM=$(python3 -c "import json; print(json.load(open('$J'))['number'])")
R=$(auth -X PATCH "$B/api/v1/invoices/$INV" -H 'content-type: application/json' -d '{"status":"sent"}'); check "invoice → sent" "[ $R = 200 ]" "$R $(cat $J)"
R=$(auth -X POST "$B/api/v1/invoices/$INV/payments" -H 'content-type: application/json' -d "{\"paid_on\":\"$(date -u +%F)\",\"amount\":100,\"method\":\"virement\"}"); check "partial payment → 201, status part_paid" "[ $R = 201 ] && grep -q part_paid $J" "$R $(cat $J)"
# Seed everything BEFORE the browser runs: the SPA restores its session via GET /session, which rotates the CSRF token.
R=$(auth -X POST "$B/api/v1/prospects" -H 'content-type: application/json' -d '{"name":"Prospect Drill","status":"qualified","source":"web","expected_value":1200}'); check "seed prospect → 201" "[ $R = 201 ]" "$R $(cat $J)"

echo "§3 headless Chromium renders the authenticated app (cookie-injecting proxy)"
ERP_PROXY_COOKIE="$COOKIE" ERP_PROXY_CSRF="$CSRF" node "$ROOT/tests/lib/erp-cookie-proxy.js" "$PROXY_PORT" "$API_PORT" >"$WORK/proxy.log" 2>&1 &
PROXY_PID=$!
for i in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PROXY_PORT/api/v1/health" && break; sleep 0.25; done
P="http://127.0.0.1:$PROXY_PORT"
# The SPA restores its session through GET /session (cookie injected by the
# proxy; the server rotates and returns the CSRF token), exactly as a new tab
# does for a real user. --dump-dom prints the DOM after the virtual-time budget.
dom() {
  timeout 90 "$CHROME" --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --hide-scrollbars \
    --virtual-time-budget=8000 --run-all-compositor-stages-before-draw --window-size=1440,1000 \
    --dump-dom "$1" > "$WORK/dom.html" 2>/dev/null || true
  python3 - "$WORK/dom.html" > "$WORK/dom.txt" <<'PYX'
import html,re,sys
s=open(sys.argv[1],encoding='utf8',errors='replace').read()
t=re.sub(r'<(script|style)[^>]*>.*?</\1>','',s,flags=re.S)
t=re.sub(r'<[^>]+>',' ',t); print(html.unescape(re.sub(r'\s+',' ',t)))
PYX
}
has() { grep -q -- "$1" "$WORK/dom.html"; }
txt() { grep -q -- "$1" "$WORK/dom.txt"; }

dom "$P/#/dashboard"
check "authenticated: app shell visible, login hidden" "has 'id=\"app\"' && ! has 'id=\"app\" hidden' && has 'id=\"login\" hidden'" "$(grep -o 'id=\"\(app\|login\)\"[^>]*' $WORK/dom.html | head -2 | tr '\n' ' ')"
check "topbar shows the user, rail lists the enabled modules" "txt 'Owner' && has 'data-module=\"clients\"' && has 'data-module=\"finance\"' && has 'data-module=\"audit\"'" "$(head -c 300 $WORK/dom.txt)"
cat > "$WORK/stats.py" <<'PYX'
import re,sys
s=open(sys.argv[1],encoding='utf8',errors='replace').read()
out=[]
for k in ['clients','open_projects','unpaid_invoices']:
    m=re.search(r'data-stat="'+k+r'".*?stat-value[^>]*>([^<]*)<',s,re.S)
    out.append(m.group(1).strip() if m else 'MISSING')
print(' '.join(out))
PYX
STATS=$(python3 "$WORK/stats.py" "$WORK/dom.html")
check "dashboard counters measured by the API (1 client, 1 open project, 1 open invoice)" "[ \"$STATS\" = '1 1 1' ]" "$STATS"
check "revenue chart rendered as SVG bars from /reports/revenue" "has 'class=\"chart\"' && grep -c 'class=\"bar' $WORK/dom.html | grep -q -v '^0$'" "$(grep -c 'class=\"bar' $WORK/dom.html) bars | card: $(grep -o "Chiffre d.affaires par mois.\{0,400\}" $WORK/dom.txt | head -c 400) | api: $(auth "$B/api/v1/reports/revenue" >/dev/null; head -c 300 $J)"
check "receivables card shows the open invoice" "txt \"$INVNUM\"" "$(grep -o 'Créances[^§]\{0,200\}' $WORK/dom.txt | head -c 200)"
check "no mock / placeholder wording" "! txt 'Maquette' && ! txt 'Stage 3' && ! txt 'non connect'" "found mock wording"

dom "$P/#/clients"
check "clients list renders the seeded row as TEXT (markup escaped, not injected)" "txt 'Client Drill <b>x</b>' && ! has '<b>x</b>'" "$(grep -o 'Client Drill[^<]*' $WORK/dom.html | head -1)"
check "tabs Clients / Contacts present, Clients selected" "has 'role=\"tab\"' && grep -q 'aria-selected=\"true\"[^>]*>Clients\|id=\"tab-clients\"[^>]*aria-selected=\"true\"' $WORK/dom.html" "$(grep -o 'role=\"tab\"[^>]*>[^<]*' $WORK/dom.html | tr '\n' ' ')"
check "pagination shows 1–1 sur 1 and a Nouveau button" "txt '1–1 sur 1' && txt 'Nouveau'" "$(grep -o 'pagination.\{0,160\}' $WORK/dom.txt | head -c 160)"
check "row actions Détail / Modifier / Retirer" "txt 'Détail' && txt 'Modifier' && txt 'Retirer'" ""

dom "$P/#/clients/contacts"
check "empty state for a resource with no rows (honest, not fake)" "txt 'Aucun enregistrement'" "$(head -c 300 $WORK/dom.txt)"

dom "$P/#/finance/invoices"
check "invoices list shows the seeded number and part_paid badge" "txt \"$INVNUM\" && txt 'part_paid'" "$(grep -o 'Factures.\{0,240\}' $WORK/dom.txt | head -c 240)"
dom "$P/#/finance/invoices/$INV"
check "invoice detail: server totals HT 200.000 / TTC 238.000 / payé 100.000 / reste 138.000" "txt '200,000' && txt '238,000' && txt '100,000' && txt '138,000'" "$(grep -o 'Totaux.\{0,300\}' $WORK/dom.txt | head -c 300)"
check "invoice detail: lines table and payments table" "txt 'Prestation drill' && txt 'virement'" ""
check "invoice detail: payment action offered for part_paid, edit hidden (not draft)" "txt 'Enregistrer un paiement' && ! txt 'Marquer envoyée'" ""

dom "$P/#/reports/revenue"
check "reports: revenue tab with chart and month table" "has 'class=\"chart\"' && txt '$(date -u +%Y-%m)'" "$(grep -o 'Analyse.\{0,400\}' $WORK/dom.txt | head -c 400)"
dom "$P/#/settings"
check "settings: tenant identity form + module toggles" "has 'name=\"display_name\"' && has 'id=\"mod-invoices\"' && txt 'Mythos Prod'" ""
dom "$P/#/users"
check "users: the super admin is listed with role badge" "txt 'owner+frontend@mythos.test' && txt 'super_admin'" "$(head -c 300 $WORK/dom.txt)"
dom "$P/#/audit"
# login.success / logout are platform-level rows (tenant_id NULL): the tenant
# journal cannot see them by RLS design, so the assertion uses tenant-tagged rows.
check "audit: tenant journal shows record.created and record.updated" "txt 'record.created' && txt 'record.updated'" "$(grep -o 'Journal.\{0,400\}' $WORK/dom.txt | head -c 400) | api: $(auth "$B/api/v1/audit?limit=3" >/dev/null; head -c 300 $J)"
dom "$P/#/prospects"
check "prospects view: rail entry, row, status badge, convert action" "has 'data-module=\"prospects\"' && txt 'Prospect Drill' && txt 'qualified' && txt 'Convertir en client'" "$(grep -o 'Prospects.\{0,300\}' $WORK/dom.txt | head -c 300)"
dom "$P/#/accounting"
check "comptabilité view: tabs, automatic entries from the seeded invoice + payment, VT/BQ journals, posted" "has 'data-module=\"accounting\"' && txt 'Grand livre' && txt 'Balance' && txt 'posted' && txt 'invoices' && txt 'payments'" "$(grep -o 'Comptabilit.\{0,300\}' $WORK/dom.txt | head -c 300)"
dom "$P/#/accounting/trial-balance"
check "balance view: totals balanced, 411 / 706 / 4367 present" "txt 'équilibrée' && txt '411' && txt '706' && txt '4367'" "$(grep -o 'Balance.\{0,300\}' $WORK/dom.txt | head -c 300)"
dom "$P/#/planning"
check "planning: honest empty state" "txt 'Aucun enregistrement'" ""
dom "$P/#/nope/../x"
check "unknown / traversal route falls back to the dashboard" "has 'data-stat=\"clients\"'" ""

echo "§4 session restore + CSRF rotation contract"
R=$(code -H "Cookie: $COOKIE" "$B/api/v1/session"); check "GET /session → 200 with a csrf token" "[ $R = 200 ] && grep -q '\"csrf\"' $J" "$R"
NEWCSRF=$(python3 -c "import json; print(json.load(open('$J'))['csrf'])")
R=$(code -X POST -H "Cookie: $COOKIE" -H "x-csrf-token: $CSRF" -H 'content-type: application/json' "$B/api/v1/session/tenant" -d '{"tenant_id":"00000000-0000-4000-8000-000000000000"}')
check "old csrf token refused after rotation (403 csrf_failed)" "[ $R = 403 ] && grep -q csrf_failed $J" "$R $(cat $J)"
R=$(code -X POST -H "Cookie: $COOKIE" -H "x-csrf-token: $NEWCSRF" -H 'content-type: application/json' "$B/api/v1/session/tenant" -d '{"tenant_id":"00000000-0000-4000-8000-000000000000"}')
check "new csrf token accepted (reaches membership check → 403 forbidden, not csrf)" "[ $R = 403 ] && grep -q '\"forbidden\"' $J" "$R $(cat $J)"
check "API log carries no password" "! grep -qF \"$ADMIN_PW\" $WORK/api.log" ""

echo
echo "erp-frontend-drill: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
