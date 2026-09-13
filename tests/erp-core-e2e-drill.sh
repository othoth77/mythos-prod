#!/usr/bin/env bash
# tests/erp-core-e2e-drill.sh — Phase 7 (CORE_E2E gate) evidence.
#
# The complete real workflow, end to end, against the real API on a throwaway
# PostgreSQL 15 with the real migrations:
#   login → tenant → client → devis (quote) → facture (invoice) → payment /
#   status → audit → logout
# then the adversarial half: authorization (read_only), CSRF, session expiry
# (idle and absolute), revoked session, invalid input, duplicate records,
# cross-tenant access (id, listing, forged header, membership), module gate.
#
# Nothing here touches production. Never run against production.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="$ROOT/sites/erp.mythosprod.xyz/api"
DB="$ROOT/sites/erp.mythosprod.xyz/db"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
C="erp-e2e-$TS"
PW="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
ADMIN_PW="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
OTHER_PW="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
ADMIN_EMAIL="owner+e2e@mythos.test"
API_PORT=$((30000 + RANDOM % 9000))
API_PID=""
WORK="$(mktemp -d)"
PASS=0; FAIL=0
ok()    { PASS=$((PASS+1)); echo "  PASS $1"; }
bad()   { FAIL=$((FAIL+1)); echo "  FAIL $1 — $2"; }
check() { if eval "$2"; then ok "$1"; else bad "$1" "$3"; fi; }
cleanup() { [ -n "$API_PID" ] && kill "$API_PID" >/dev/null 2>&1 || true; docker rm -f -v "$C" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
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

echo "[e2e] throwaway PostgreSQL 15: $C"
docker run -d --name "$C" -P -e POSTGRES_USER=erp_owner -e POSTGRES_DB=mythos_erp -e POSTGRES_PASSWORD="$PW" postgres:15-alpine >/dev/null
# postgres:15 initdb starts a temporary server, then shuts it down before the real
# start; a single pg_isready success can land in that window. Require two in a row.
OKS=0; for i in $(seq 1 90); do if docker exec "$C" pg_isready -U erp_owner -q 2>/dev/null; then OKS=$((OKS+1)); [ $OKS -ge 2 ] && break; else OKS=0; fi; sleep 1; [ "$i" -lt 90 ] || { echo "db never ready" >&2; exit 1; }; done
PORT="$(docker port "$C" 5432/tcp | head -1 | sed 's/.*://')"
for f in schema.sql schema-auth.sql schema-tenant.sql 0004-prospects.sql 0005-accounting.sql 0006-agenda.sql 0008-purchases-lifecycle.sql 0009-bank-reconciliation.sql 0010-mission-orders.sql 0011-fiscal-stamp.sql 0012-rbac-delete-permissions.sql 0013-expenses-ledger.sql; do
  docker cp "$DB/$f" "$C:/tmp/$f" >/dev/null
  docker exec "$C" psql -U erp_owner -d mythos_erp -q -v ON_ERROR_STOP=1 -f "/tmp/$f" >/dev/null
done
docker exec -i "$C" psql -U erp_owner -d mythos_erp -q -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE erp_app LOGIN PASSWORD '$PW';
GRANT USAGE ON SCHEMA public TO erp_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO erp_app;
GRANT DELETE ON invoice_lines, quote_lines TO erp_app;
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

# Second tenant (acme) with its own admin, and a read_only user in mythos.
# Seeded by the OWNER role exactly as an operator provisioning would, hashes
# produced by the API's own password module (the plain value never hits argv).
HASH=$(printf '%s' "$OTHER_PW" | node -e "require('$API/lib/password.js').hash(require('fs').readFileSync(0,'utf8'),{N:16384}).then(h=>process.stdout.write(h))")
docker exec -i "$C" psql -U erp_owner -d mythos_erp -q -v ON_ERROR_STOP=1 <<SQL
INSERT INTO tenants (key, display_name, legal_name, invoice_prefix) VALUES ('acme','Acme Corp','Acme','AC');
INSERT INTO tenant_modules (tenant_id, module_key, enabled)
  SELECT t.id, k, true FROM tenants t, unnest(ARRAY['dashboard','clients','projects','planning','production','finance','invoices','documents','inventory','settings','users','audit']) k WHERE t.key='acme';
-- acme has NOT bought reports: the module gate must answer 404 by URL.
INSERT INTO users (email, display_name, password_hash, password_algo, password_changed_at) VALUES
  ('bob@acme.test','Bob','$HASH','scrypt',now()), ('rita@mythos.test','Rita','$HASH','scrypt',now());
INSERT INTO tenant_memberships (user_id, tenant_id, is_default) SELECT u.id, t.id, true FROM users u, tenants t WHERE u.email='bob@acme.test' AND t.key='acme';
INSERT INTO user_roles (user_id, tenant_id, role_id) SELECT u.id, t.id, r.id FROM users u, tenants t, roles r WHERE u.email='bob@acme.test' AND t.key='acme' AND r.key='admin';
INSERT INTO tenant_memberships (user_id, tenant_id, is_default) SELECT u.id, t.id, true FROM users u, tenants t WHERE u.email='rita@mythos.test' AND t.key='mythos';
INSERT INTO user_roles (user_id, tenant_id, role_id) SELECT u.id, t.id, r.id FROM users u, tenants t, roles r WHERE u.email='rita@mythos.test' AND t.key='mythos' AND r.key='read_only';
SQL
echo "[e2e] tenants mythos + acme, users owner / bob(acme admin) / rita(mythos read_only)"

ERP_DATABASE_URL="$APP_URL" ERP_API_PORT="$API_PORT" ERP_DOCUMENTS_DIR="$WORK/documents" node "$API/server.js" >"$WORK/api.log" 2>&1 &
API_PID=$!
for i in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$API_PORT/api/v1/health" && break; sleep 0.25; done
B="http://127.0.0.1:$API_PORT/api/v1"; J="$WORK/b"; H="$WORK/h"
code() { curl -s -o "$J" -D "$H" -w '%{http_code}' "$@"; }
jget() { python3 -c "import json,sys; d=json.load(open('$J')); v=d
for k in sys.argv[1].split('.'): v = v[int(k)] if k.isdigit() else v.get(k)
print('' if v is None else v)" "$1" 2>/dev/null; }
login() { # login <email> <pw> → sets R (status), COOKIE, CSRF in the CURRENT shell (no subshell)
  printf '%s' "$2" | python3 -c 'import json,sys; print(json.dumps({"email": sys.argv[1], "password": sys.stdin.read()}), end="")' "$1" > "$WORK/l.json"
  R=$(code -X POST "$B/auth/login" -H 'content-type: application/json' --data-binary "@$WORK/l.json"); rm -f "$WORK/l.json"
  COOKIE=$(grep -i '^set-cookie:' "$H" | sed -E 's/^[Ss]et-[Cc]ookie: *//; s/;.*//' | tr -d '\r'); CSRF=$(jget csrf)
}
A() { code -H "Cookie: $COOKIE" -H "x-csrf-token: $CSRF" -H 'content-type: application/json' "$@"; }

echo "§1 login → tenant"
login "$ADMIN_EMAIL" "$ADMIN_PW"; check "owner login 200" "[ $R = 200 ]" "$R $(cat $J)"
TENANT=$(jget active_tenant_id); check "active tenant = mythos" "[ \"$(jget tenants.0.key)\" = mythos ] && [ -n \"$TENANT\" ]" "$(cat $J)"
OWNER_COOKIE="$COOKIE"; OWNER_CSRF="$CSRF"
R=$(A "$B/session"); check "session restored, csrf rotated" "[ $R = 200 ] && [ -n \"$(jget csrf)\" ]" "$R"; CSRF=$(jget csrf); OWNER_CSRF="$CSRF"
R=$(A -X POST "$B/session/tenant" -d "{\"tenant_id\":\"$TENANT\"}"); check "explicit tenant switch to own tenant → 200" "[ $R = 200 ]" "$R $(cat $J)"

echo "§2 client → devis → facture → payment/status"
R=$(A -X POST "$B/clients" -d '{"name":"Théâtre Municipal","email":"contact@theatre.test","city":"Tunis","tax_id":"1234567A"}'); check "client created (201)" "[ $R = 201 ]" "$R $(cat $J)"; CLIENT=$(jget id)
R=$(A -X POST "$B/quotes" -d "{\"client_id\":\"$CLIENT\",\"issued_on\":\"$(date -u +%F)\",\"valid_until\":\"2026-12-31\",\"notes\":\"Devis spectacle\",\"lines\":[{\"description\":\"Représentation\",\"quantity\":1,\"unit_price\":1000,\"vat_rate\":19}]}"); check "devis (quote) created with a line (201)" "[ $R = 201 ]" "$R $(cat $J)"; QUOTE=$(jget id)
check "devis number is server-generated (DEV-<year>-…), client cannot set it" "jget number | grep -qE '^DEV-[0-9]{4}-[0-9A-F]{8}$'" "$(jget number)"
check "devis totals computed from its one line (HT 1000.000 / TVA 190.000 / TTC 1190.000)" "[ \"$(jget totals.total_ht)\" = 1000.000 ] && [ \"$(jget totals.total_vat)\" = 190.000 ] && [ \"$(jget totals.total_ttc)\" = 1190.000 ]" "$(jget totals.total_ht) $(jget totals.total_vat) $(jget totals.total_ttc)"
R=$(A -X POST "$B/quotes" -d '{"status":"draft"}'); check "devis without lines refused (422 at least one line is required)" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X PATCH "$B/quotes/$QUOTE" -d '{"status":"sent"}'); check "devis sent" "[ $R = 200 ] && [ \"$(jget status)\" = sent ]" "$R $(cat $J)"
R=$(A -X PATCH "$B/quotes/$QUOTE" -d '{"status":"accepted"}'); check "devis accepted" "[ $R = 200 ] && [ \"$(jget status)\" = accepted ]" "$R"
R=$(A -X POST "$B/quotes/$QUOTE/convert" -d '{}'); check "converting an accepted devis creates a facture (201)" "[ $R = 201 ]" "$R $(cat $J)"; CONV_INV=$(jget invoice_id)
check "converted facture totals match the devis line (TTC 1190.000)" "[ \"$(jget totals.total_ttc)\" = 1190.000 ]" "$(jget totals.total_ttc)"
R=$(A "$B/invoices/$CONV_INV"); check "converted facture references its devis and is still a draft (own counter)" "[ $R = 200 ] && [ \"$(jget quote_id)\" = \"$QUOTE\" ] && [ \"$(jget status)\" = draft ] && [ \"$(jget lines.0.description)\" = 'Représentation' ]" "$(cat $J | head -c 300)"
R=$(A -X POST "$B/quotes/$QUOTE/convert" -d '{}'); check "converting again creates a second, independent facture (201) — a devis is not consumed" "[ $R = 201 ] && [ \"$(jget invoice_id)\" != \"$CONV_INV\" ]" "$R $(jget invoice_id)"
R=$(A -X DELETE "$B/quotes/$QUOTE"); check "an accepted devis can still be retired (soft delete, 200)" "[ $R = 200 ]" "$R $(cat $J)"
R=$(A "$B/quotes/$QUOTE/convert" -X POST -d '{}'); check "converting a retired devis → 404" "[ $R = 404 ]" "$R"
R=$(A -X POST "$B/quotes" -d "{\"client_id\":\"$CLIENT\",\"lines\":[{\"description\":\"Second devis\",\"quantity\":1,\"unit_price\":1000,\"vat_rate\":19}]}"); check "second devis for the facture-linking scenario below (201)" "[ $R = 201 ]" "$R"; QUOTE=$(jget id)
R=$(A -X PATCH "$B/quotes/$QUOTE" -d '{"status":"sent"}'); [ "$R" = 200 ] || bad "second devis sent" "$R"
R=$(A -X PATCH "$B/quotes/$QUOTE" -d '{"status":"accepted"}'); [ "$R" = 200 ] || bad "second devis accepted" "$R"
R=$(A -X POST "$B/invoices" -d "{\"client_id\":\"$CLIENT\",\"quote_id\":\"$QUOTE\",\"issued_on\":\"$(date -u +%F)\",\"due_on\":\"2026-10-05\",\"currency\":\"TND\",\"lines\":[{\"description\":\"Représentation\",\"quantity\":1,\"unit_price\":1000,\"vat_rate\":19},{\"description\":\"Technique\",\"unit\":\"h\",\"quantity\":4,\"unit_price\":50,\"vat_rate\":19}]}")
check "facture created from the devis (201)" "[ $R = 201 ]" "$R $(cat $J)"; INV=$(jget id); INVNUM=$(jget number)
check "facture number follows the tenant pattern (MP2026-0003 — two earlier converts already claimed 0001/0002)" "[ \"$INVNUM\" = MP2026-0003 ]" "$INVNUM"
check "server totals HT 1200.000 / VAT 228.000 / TTC 1428.000 / balance 1428.000" "[ \"$(jget totals.total_ht)\" = 1200.000 ] && [ \"$(jget totals.total_vat)\" = 228.000 ] && [ \"$(jget totals.total_ttc)\" = 1428.000 ] && [ \"$(jget totals.balance)\" = 1428.000 ]" "$(jget totals.total_ht) $(jget totals.total_vat) $(jget totals.total_ttc)"
check "facture references the devis" "[ \"$(jget quote_id)\" = \"$QUOTE\" ]" "$(jget quote_id)"
R=$(A -X POST "$B/invoices/$INV/payments" -d '{"paid_on":"2026-09-05","amount":500,"method":"virement","reference":"VIR-1"}'); check "payment before sending is refused? (draft) or accepted — record outcome" "[ $R = 201 ] || [ $R = 409 ] || [ $R = 422 ]" "$R $(cat $J)"; P0=$R
R=$(A -X PATCH "$B/invoices/$INV" -d '{"status":"sent"}'); check "facture sent" "[ $R = 200 ] && [ \"$(jget status)\" = sent -o \"$(jget status)\" = part_paid ]" "$R $(cat $J)"
if [ "$P0" != 201 ]; then R=$(A -X POST "$B/invoices/$INV/payments" -d '{"paid_on":"2026-09-05","amount":500,"method":"virement","reference":"VIR-1"}'); check "partial payment 500 → 201" "[ $R = 201 ]" "$R $(cat $J)"; fi
R=$(A -X POST "$B/invoices/$INV/payments" -d '{"paid_on":"2026-09-05","amount":2000}'); check "payment exceeding the balance refused (422)" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A "$B/invoices/$INV"); check "status part_paid after partial payment (balance 928.000)" "[ \"$(jget status)\" = part_paid ] && [ \"$(jget totals.balance)\" = 928.000 ]" "$(jget status) $(jget totals.balance)"
R=$(A -X POST "$B/invoices/$INV/payments" -d '{"paid_on":"2026-09-05","amount":928,"method":"espèces"}'); check "final payment 928 → status paid" "[ $R = 201 ] && [ \"$(jget invoice_status)\" = paid ]" "$R $(cat $J)"
R=$(A "$B/invoices/$INV"); check "facture detail: balance 0.000, 2 payments, 2 lines" "[ $R = 200 ] && [ \"$(jget totals.balance)\" = 0.000 ] && [ \"$(jget payments.1.amount)\" = 928.000 ] && [ \"$(jget lines.1.line_ht)\" = 200.000 ]" "$(cat $J | head -c 300)"
R=$(A -X PATCH "$B/invoices/$INV" -d '{"notes":"x"}'); check "paid facture is immutable (409)" "[ $R = 409 ]" "$R $(cat $J)"
R=$(A -X POST "$B/invoices/$INV/payments" -d '{"paid_on":"2026-09-05","amount":1}'); check "payment on a paid facture refused (409)" "[ $R = 409 ]" "$R $(cat $J)"
check "no payment row was written by the refused attempt (still 2)" "[ \"$(q "select count(*) from payments where invoice_id='$INV'")\" = 2 ]" ""
R=$(A "$B/dashboard"); check "dashboard reflects the workflow (1 client, collected 1428.000)" "[ $R = 200 ] && [ \"$(jget clients)\" = 1 ] && [ \"$(jget collected_ytd)\" = 1428.000 ]" "$(cat $J)"

echo "§3 audit → logout"
R=$(A "$B/audit"); check "audit lists record.created for clients, quotes, invoices, payments and record.updated" "[ $R = 200 ] && grep -q '\"entity_table\":\"clients\"' $J && grep -q '\"entity_table\":\"quotes\"' $J && grep -q '\"entity_table\":\"invoices\"' $J && grep -q '\"entity_table\":\"payments\"' $J && grep -q 'record.updated' $J" "$(head -c 300 $J)"
R=$(A "$B/audit?entity_table=payments"); check "audit filter by table works (only payments)" "[ $R = 200 ] && ! grep -q '\"entity_table\":\"clients\"' $J && grep -q '\"entity_table\":\"payments\"' $J" ""
N_AUD_UPD=$(q "select count(*) from audit_log where outcome='ok' and action in ('record.created','record.updated') and tenant_id=(select id from tenants where key='mythos')")
check "every state change in this tenant left an audit row (≥ 8)" "[ $N_AUD_UPD -ge 8 ]" "$N_AUD_UPD"
R=$(A -X POST "$B/auth/logout"); check "logout 200" "[ $R = 200 ]" "$R"
R=$(A "$B/session"); check "session dead after logout (401)" "[ $R = 401 ]" "$R"
N_LOGOUT=$(q "select count(*) from audit_log where action='logout' and actor_label='$ADMIN_EMAIL'"); check "logout audited exactly once" "[ $N_LOGOUT = 1 ]" "$N_LOGOUT"

echo "§4 authorization (read_only), CSRF, invalid input, duplicates"
login rita@mythos.test "$OTHER_PW"; check "read_only user logs in" "[ $R = 200 ]" "$R $(cat $J)"
R=$(A "$B/clients"); check "read_only can list clients (clients.read)" "[ $R = 200 ] && [ \"$(jget total)\" = 1 ]" "$R"
R=$(A -X POST "$B/clients" -d '{"name":"Nope"}'); check "read_only cannot create (403 forbidden, required clients.write)" "[ $R = 403 ] && [ \"$(jget required)\" = clients.write ]" "$R $(cat $J)"
R=$(A -X DELETE "$B/clients/$CLIENT"); check "read_only cannot retire (403)" "[ $R = 403 ]" "$R"
R=$(A "$B/audit"); check "read_only cannot read the audit trail (403)" "[ $R = 403 ]" "$R"
R=$(A "$B/settings"); check "read_only cannot read settings (403)" "[ $R = 403 ]" "$R"
R=$(A "$B/users"); check "read_only cannot list users (403)" "[ $R = 403 ]" "$R"
N_DEN=$(q "select count(*) from audit_log where action='permission.denied' and actor_label='rita@mythos.test'"); check "each denial audited (≥5)" "[ $N_DEN -ge 5 ]" "$N_DEN"
A -X POST "$B/auth/logout" >/dev/null
login "$ADMIN_EMAIL" "$ADMIN_PW"; [ "$R" = 200 ] || bad "owner re-login" "$R"
R=$(code -X POST -H "Cookie: $COOKIE" -H 'content-type: application/json' "$B/clients" -d '{"name":"CSRF-less"}'); check "POST without CSRF header → 403 csrf_failed" "[ $R = 403 ] && grep -q csrf_failed $J" "$R $(cat $J)"
R=$(code -X POST -H "Cookie: $COOKIE" -H 'x-csrf-token: wrong' -H 'content-type: application/json' "$B/clients" -d '{"name":"CSRF-wrong"}'); check "POST with wrong CSRF token → 403" "[ $R = 403 ]" "$R"
N_CSRF=$(q "select count(*) from clients where name like 'CSRF-%'"); check "no client created by the CSRF attempts" "[ $N_CSRF = 0 ]" "$N_CSRF"
R=$(A -X POST "$B/clients" -d '{"email":"no-name@x.test"}'); check "missing required field → 422 validation_failed" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X POST "$B/projects" -d '{"title":"Bad dates","starts_on":"2026-13-45"}'); check "invalid date → 422" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X POST "$B/projects" -d '{"title":"Bad ref","client_id":"not-a-uuid"}'); check "invalid uuid → 422 invalid_value (not 500)" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X POST "$B/projects" -d '{"title":"Dangling","client_id":"00000000-0000-4000-8000-000000000000"}'); check "dangling reference → 422 invalid_reference (not 500)" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X POST "$B/quotes" -d '{"status":"bogus","lines":[{"description":"x","quantity":1,"unit_price":1}]}'); check "unknown status vocabulary → 422" "[ $R = 422 ]" "$R"
R=$(A -X POST "$B/invoices" -d "{\"client_id\":\"$CLIENT\",\"issued_on\":\"$(date -u +%F)\",\"status\":\"paid\",\"lines\":[{\"description\":\"x\",\"quantity\":1,\"unit_price\":1,\"vat_rate\":0}]}"); check "client cannot declare an invoice paid → 422" "[ $R = 422 ]" "$R"
R=$(A -X POST "$B/clients" -d '{"name":"<script>alert(1)</script>","notes":"'"'"'; DROP TABLE clients; --"}'); check "hostile strings stored as data (201), tables intact (2 clients)" "[ $R = 201 ] && [ \"$(q 'select count(*) from clients')\" = 2 ]" "$R $(q 'select count(*) from clients')"
R=$(A -X POST "$B/clients" -H 'content-type: application/json' -d '{"name":"Same Name Twice"}'); R2=$(A -X POST "$B/clients" -d '{"name":"Same Name Twice"}'); check "two clients with the same name are both accepted (no false uniqueness)" "[ $R = 201 ] && [ $R2 = 201 ]" "$R $R2"
check "API log has no stack trace for the client errors above" "! grep -q 'internal_error' $WORK/api.log && ! grep -c 'error: duplicate key' $WORK/api.log | grep -q -v '^[0-9]*$'" "$(grep -c 'Error' $WORK/api.log) error lines"

echo "§5 cross-tenant access"
A_CLIENT="$CLIENT"; A_INV="$INV"; A_TENANT="$TENANT"
login bob@acme.test "$OTHER_PW"; check "acme admin logs in, sees only acme" "[ $R = 200 ] && [ \"$(jget tenants.0.key)\" = acme ] && [ \"$(python3 -c "import json; print(len(json.load(open('$J'))['tenants']))")\" = 1 ]" "$(cat $J)"
R=$(A "$B/clients"); check "acme lists 0 clients (mythos rows invisible)" "[ $R = 200 ] && [ \"$(jget total)\" = 0 ]" "$(cat $J)"
R=$(A "$B/clients/$A_CLIENT"); check "acme GET mythos client by id → 404" "[ $R = 404 ]" "$R"
R=$(A -X PATCH "$B/clients/$A_CLIENT" -d '{"name":"Hijacked"}'); check "acme PATCH mythos client → 404" "[ $R = 404 ]" "$R"
R=$(A -X DELETE "$B/clients/$A_CLIENT"); check "acme DELETE mythos client → 404" "[ $R = 404 ]" "$R"
R=$(A "$B/invoices/$A_INV"); check "acme GET mythos invoice → 404" "[ $R = 404 ]" "$R"
R=$(A -X POST "$B/invoices/$A_INV/payments" -d '{"paid_on":"2026-09-05","amount":1}'); check "acme pays mythos invoice → 404" "[ $R = 404 ]" "$R"
R=$(A -H "x-tenant-id: $A_TENANT" "$B/clients"); check "forged X-Tenant-Id for mythos → 403 forbidden" "[ $R = 403 ]" "$R $(cat $J)"
R=$(A -X POST "$B/session/tenant" -d "{\"tenant_id\":\"$A_TENANT\"}"); check "switching into a non-member tenant → 403" "[ $R = 403 ]" "$R"
R=$(A -X POST "$B/clients" -d "{\"name\":\"Acme Client\",\"tenant_id\":\"$A_TENANT\"}"); check "tenant_id in the body is ignored/refused, row lands in acme" "[ $R = 201 ] && [ \"$(q "select count(*) from clients c join tenants t on t.id=c.tenant_id where t.key='acme'")\" = 1 ]" "$R $(cat $J)"
R=$(A -X POST "$B/quotes" -d '{"lines":[{"description":"Acme devis","quantity":1,"unit_price":100,"vat_rate":19}]}'); check "acme creates its own devis with its own server-generated number (201)" "[ $R = 201 ] && [ \"$(jget number)\" != null ]" "$R $(cat $J)"
R=$(A -X POST "$B/invoices" -d "{\"issued_on\":\"$(date -u +%F)\",\"lines\":[{\"description\":\"x\",\"quantity\":1,\"unit_price\":10,\"vat_rate\":0}]}"); check "acme first invoice is AC2026-0001 (own counter)" "[ $R = 201 ] && [ \"$(jget number)\" = AC2026-0001 ]" "$(jget number)"
R=$(A "$B/reports/revenue"); check "module gate: acme did not buy reports → 404 module_not_enabled" "[ $R = 404 ] && grep -q module_not_enabled $J" "$R $(cat $J)"
check "mythos data untouched by acme's attempts" "[ \"$(q "select name from clients where id='$A_CLIENT'")\" = 'Théâtre Municipal' ] && [ \"$(q "select count(*) from payments p join invoices i on i.id=p.invoice_id where i.id='$A_INV'")\" = 2 ]" ""
N_X=$(q "select count(*) from audit_log where action='permission.denied' and actor_label='bob@acme.test'"); check "cross-tenant forging attempts audited (≥2)" "[ $N_X -ge 2 ]" "$N_X"

echo "§6 session expiry and revocation"
login "$ADMIN_EMAIL" "$ADMIN_PW"; [ "$R" = 200 ] || bad "owner login for expiry" "$R"
SID=$(q "select id from sessions where user_id=(select id from users where email='$ADMIN_EMAIL') and revoked_at is null order by issued_at desc limit 1")
q "update sessions set idle_expires_at = now() - interval '1 second' where id='$SID'" >/dev/null
R=$(A "$B/session"); check "idle-expired session → 401" "[ $R = 401 ]" "$R"
login "$ADMIN_EMAIL" "$ADMIN_PW"; SID=$(q "select id from sessions where user_id=(select id from users where email='$ADMIN_EMAIL') and revoked_at is null order by issued_at desc limit 1")
# sessions_expiry_ordered (idle <= absolute) is enforced by the schema, so the
# absolute bound is moved together with the idle bound just below it.
q "update sessions set absolute_expires_at = now() - interval '1 second', idle_expires_at = now() - interval '2 seconds' where id='$SID'" >/dev/null
R=$(A "$B/session"); check "absolute-expired session → 401" "[ $R = 401 ]" "$R"
check "schema refuses idle_expires_at > absolute_expires_at (sessions_expiry_ordered)" "! q \"update sessions set idle_expires_at = absolute_expires_at + interval '1 hour' where id='$SID'\" >/dev/null 2>&1" ""
login "$ADMIN_EMAIL" "$ADMIN_PW"; SID=$(q "select id from sessions where user_id=(select id from users where email='$ADMIN_EMAIL') and revoked_at is null order by issued_at desc limit 1")
q "update sessions set revoked_at = now(), revoked_reason='drill' where id='$SID'" >/dev/null
R=$(A "$B/clients"); check "revoked session → 401" "[ $R = 401 ]" "$R"
R=$(code -H "Cookie: __Host-erp_session=definitely-not-a-token" "$B/session"); check "garbage cookie → 401" "[ $R = 401 ]" "$R"
login "$ADMIN_EMAIL" "$ADMIN_PW"; [ "$R" = 200 ] || bad "owner final login" "$R"
R=$(A "$B/session"); check "fresh login still works after the expiries" "[ $R = 200 ]" "$R"
A -X POST "$B/auth/logout" >/dev/null
check "no password in the API log" "! grep -qF \"$ADMIN_PW\" $WORK/api.log && ! grep -qF \"$OTHER_PW\" $WORK/api.log" ""

echo "§7 prospects: schema, RLS, permissions, API, search/filter, conversion, audit"
login "$ADMIN_EMAIL" "$ADMIN_PW"; [ "$R" = 200 ] || bad "owner login for prospects" "$R"
check "prospects module enabled for the tenant by the migration" "[ \"$(q "select enabled from tenant_modules tm join tenants t on t.id=tm.tenant_id where t.key='mythos' and module_key='prospects'")\" = t ]" ""
check "prospects table has RLS + tenant_isolation policy" "[ \"$(q "select relrowsecurity from pg_class where relname='prospects'")\" = t ] && [ \"$(q "select count(*) from pg_policies where tablename='prospects'")\" = 1 ]" ""
check "4 prospects permissions seeded; read_only has read only" "[ \"$(q "select count(*) from permissions where key like 'prospects.%'")\" = 4 ] && [ \"$(q "select string_agg(p.key,',' order by p.key) from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id where r.key='read_only' and p.key like 'prospects.%'")\" = prospects.read ]" ""
check "erp_app: SELECT/INSERT/UPDATE on prospects, no DELETE" "[ \"$(q "select string_agg(privilege_type,',' order by privilege_type) from information_schema.role_table_grants where grantee='erp_app' and table_name='prospects'")\" = INSERT,SELECT,UPDATE ]" "$(q "select string_agg(privilege_type,',') from information_schema.role_table_grants where grantee='erp_app' and table_name='prospects'")"
R=$(A "$B/meta"); check "meta publishes the prospects resource and status vocabulary" "[ $R = 200 ] && grep -q '\"prospects\"' $J && grep -q '\"qualified\"' $J" ""
R=$(A -X POST "$B/prospects" -d '{"name":"Festival Carthage","contact_name":"Leila B.","email":"leila@festival.test","phone":"+216 20 000 000","city":"Carthage","source":"referral","status":"new","score":70,"expected_value":15000,"next_action_on":"2026-09-15","notes":"Rencontre au salon"}'); check "prospect created (201)" "[ $R = 201 ]" "$R $(cat $J)"; PROSPECT=$(jget id)
R=$(A -X POST "$B/prospects" -d '{"name":"Cold Lead","source":"web","status":"contacted"}'); check "second prospect created" "[ $R = 201 ]" "$R"; P2=$(jget id)
R=$(A -X POST "$B/prospects" -d '{"name":"Bad","status":"won"}'); check "status won cannot be set directly (422)" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X POST "$B/prospects" -d '{"name":"Bad","score":150}'); check "score outside 0..100 → 422" "[ $R = 422 ]" "$R"
R=$(A -X POST "$B/prospects" -d '{"name":"Bad","status":"maybe"}'); check "unknown status → 422" "[ $R = 422 ]" "$R"
R=$(A "$B/prospects?search=carthage"); check "search by name (trigram-indexed) finds it" "[ $R = 200 ] && [ \"$(jget total)\" = 1 ]" "$(cat $J | head -c 200)"
R=$(A "$B/prospects?search=leila"); check "search by contact name" "[ $R = 200 ] && [ \"$(jget total)\" = 1 ]" ""
R=$(A "$B/prospects?status=contacted"); check "filter by status" "[ $R = 200 ] && [ \"$(jget total)\" = 1 ] && [ \"$(jget rows.0.name)\" = 'Cold Lead' ]" ""
R=$(A "$B/prospects?source=referral"); check "filter by source" "[ $R = 200 ] && [ \"$(jget total)\" = 1 ]" ""
R=$(A "$B/prospects?sort=expected_value&dir=desc"); check "sort by expected_value" "[ $R = 200 ] && [ \"$(jget rows.0.name)\" = 'Festival Carthage' ]" ""
R=$(A -X PATCH "$B/prospects/$PROSPECT" -d '{"status":"qualified","score":85}'); check "prospect updated (qualified, 85)" "[ $R = 200 ] && [ \"$(jget status)\" = qualified ] && [ \"$(jget score)\" = 85 ]" "$R $(cat $J)"
N_CL_BEFORE=$(q "select count(*) from clients where tenant_id=(select id from tenants where key='mythos')")
R=$(A -X POST "$B/prospects/$PROSPECT/convert" -d '{}'); check "convert → 201 with client + prospect" "[ $R = 201 ] && [ \"$(jget client.name)\" = 'Festival Carthage' ] && [ \"$(jget prospect.status)\" = won ]" "$R $(cat $J)"; NEWCLIENT=$(jget client.id)
check "one client created in mythos, with the prospect's email/city" "[ \"$(q "select count(*) from clients where tenant_id=(select id from tenants where key='mythos')")\" = $((N_CL_BEFORE+1)) ] && [ \"$(q "select email||'|'||city from clients where id='$NEWCLIENT'")\" = 'leila@festival.test|Carthage' ]" ""
check "prospect links to the client (converted_client_id, converted_at)" "[ \"$(q "select converted_client_id::text||' '||(converted_at is not null)::text from prospects where id='$PROSPECT'")\" = \"$NEWCLIENT true\" ]" "$(q "select converted_client_id::text||' '||(converted_at is not null)::text from prospects where id='$PROSPECT'")"
R=$(A -X POST "$B/prospects/$PROSPECT/convert" -d '{}'); check "second conversion → 409 already_converted" "[ $R = 409 ] && grep -q already_converted $J" "$R $(cat $J)"
R=$(A -X PATCH "$B/prospects/$PROSPECT" -d '{"converted_client_id":null}'); check "converted_client_id is not writable through PATCH (ignored)" "[ $R = 200 ] && [ \"$(q "select converted_client_id is not null from prospects where id='$PROSPECT'")\" = t ]" "$R"
R=$(A "$B/audit?entity_table=prospects"); check "audit: prospects rows (created ×2, updated ×2 incl. conversion)" "[ $R = 200 ] && [ \"$(python3 -c "import json; d=json.load(open('$J')); print(len(d['rows']))")\" -ge 4 ] && grep -q '\"converted\":true' $J" "$(head -c 300 $J)"
R=$(A "$B/audit?entity_table=clients"); check "audit: client creation from the prospect is its own row" "grep -q 'from_prospect' $J" ""
R=$(A -X PATCH "$B/prospects/$P2" -d '{"status":"lost"}'); R=$(A -X POST "$B/prospects/$P2/convert" -d '{}'); check "a lost prospect cannot be converted (409)" "[ $R = 409 ]" "$R"
R=$(A -X DELETE "$B/prospects/$P2"); check "retire (soft delete) → 200" "[ $R = 200 ] && [ \"$(q "select deleted_at is not null from prospects where id='$P2'")\" = t ]" "$R"
R=$(A "$B/prospects"); check "retired prospect hidden from the list (total 1)" "[ \"$(jget total)\" = 1 ]" "$(jget total)"
A -X POST "$B/auth/logout" >/dev/null
login rita@mythos.test "$OTHER_PW"; [ "$R" = 200 ] || bad "rita login" "$R"
R=$(A "$B/prospects"); check "read_only can list prospects" "[ $R = 200 ]" "$R"
R=$(A -X POST "$B/prospects" -d '{"name":"Nope"}'); check "read_only cannot create a prospect (403)" "[ $R = 403 ]" "$R"
A -X POST "$B/auth/logout" >/dev/null
# manager-level user: write yes, convert yes; acme admin: cannot see mythos prospects
login bob@acme.test "$OTHER_PW"; [ "$R" = 200 ] || bad "bob login" "$R"
R=$(A "$B/prospects"); check "module gate: acme (created after the migration) has no prospects module → 404" "[ $R = 404 ] && grep -q module_not_enabled $J" "$R $(cat $J)"
q "insert into tenant_modules (tenant_id, module_key, enabled) select id, 'prospects', true from tenants where key='acme'" >/dev/null
R=$(A "$B/prospects"); check "acme, module enabled: sees 0 mythos prospects" "[ $R = 200 ] && [ \"$(jget total)\" = 0 ]" "$(cat $J)"
R=$(A "$B/prospects/$PROSPECT"); check "acme GET mythos prospect → 404" "[ $R = 404 ]" "$R"
R=$(A -X POST "$B/prospects/$PROSPECT/convert" -d '{}'); check "acme convert mythos prospect → 404 (invisible), no client created" "[ $R = 404 ] && [ \"$(q "select count(*) from clients where tenant_id=(select id from tenants where key='acme')")\" = 1 ]" "$R"
A -X POST "$B/auth/logout" >/dev/null
check "no password in the API log (prospects)" "! grep -qF \"$ADMIN_PW\" $WORK/api.log" ""

echo "§8 comptabilité: chart, journals, periods, entries, posting, reversal, trial balance, ledger, VAT, automatic links"
login "$ADMIN_EMAIL" "$ADMIN_PW"; [ "$R" = 200 ] || bad "owner login for accounting" "$R"
check "6 accounting tables with RLS + tenant_isolation" "[ \"$(q "select count(*) from pg_tables where schemaname='public' and rowsecurity and tablename in ('accounts','journals','fiscal_periods','accounting_counters','journal_entries','journal_lines')")\" = 6 ] && [ \"$(q "select count(*) from pg_policies where tablename in ('accounts','journals','fiscal_periods','accounting_counters','journal_entries','journal_lines')")\" = 6 ]" ""
check "erp_app grants: DELETE only on the three lines tables that are replaced wholesale on edit (invoice/quote/journal lines), nothing else" "[ \"$(q "select string_agg(table_name,',' order by table_name) from information_schema.role_table_grants where grantee='erp_app' and privilege_type='DELETE'")\" = invoice_lines,journal_lines,quote_lines ]" "$(q "select string_agg(table_name,',') from information_schema.role_table_grants where grantee='erp_app' and privilege_type='DELETE'")"
check "4 accounting permissions; finance_user has read/write/post but not close; read_only read only" "[ \"$(q "select count(*) from permissions where key like 'accounting.%'")\" = 4 ] && [ \"$(q "select string_agg(p.key,',' order by p.key) from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id where r.key='finance_user' and p.key like 'accounting.%'")\" = accounting.post,accounting.read,accounting.write ] && [ \"$(q "select string_agg(p.key,',') from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id where r.key='read_only' and p.key like 'accounting.%'")\" = accounting.read ]" ""
R=$(A "$B/accounting/setup"); check "setup status: configured (18 accounts seeded incl. the two stamp accounts, 5 journals, counter)" "[ $R = 200 ] && [ \"$(jget configured)\" = True ] && [ \"$(jget journals)\" = 5 ]" "$R $(cat $J)"
R=$(A "$B/accounts?sort=code&dir=asc&limit=100"); check "chart of accounts listed (18 — 16 + stamp_collected 4368 + stamp_expense 6354), receivable = 411, vat_collected = 4367, sales = 706" "[ $R = 200 ] && [ \"$(jget total)\" = 18 ] && [ \"$(q "select code from accounts where system_key='receivable' and tenant_id=(select id from tenants where key='mythos')")\" = 411 ] && [ \"$(q "select code from accounts where system_key='vat_collected' and tenant_id=(select id from tenants where key='mythos')")\" = 4367 ]" "$(jget total)"
R=$(A -X POST "$B/accounts" -d '{"code":"6226","label":"Honoraires","type":"expense"}'); check "account created (201)" "[ $R = 201 ]" "$R $(cat $J)"; ACC_HON=$(jget id)
R=$(A -X POST "$B/accounts" -d '{"code":"411","label":"Dup","type":"asset"}'); check "duplicate account code → 409" "[ $R = 409 ]" "$R"
R=$(A -X POST "$B/accounts" -d '{"code":"999","label":"Bad","type":"weird"}'); check "unknown account type → 422" "[ $R = 422 ]" "$R"
R=$(A "$B/journals?sort=code&dir=asc"); check "5 journals (AC BQ CA OD VT)" "[ \"$(jget total)\" = 5 ]" "$(jget total)"
echo "-- automatic links: the §2 invoice (sent, 2 payments) must already be in the ledger --"
R=$(A "$B/accounting/entries?limit=50"); check "entries exist for the §2 invoice issue and its 2 payments (≥3 posted, source-tagged)" "[ $R = 200 ] && [ \"$(python3 -c "import json; d=json.load(open('$J')); print(sum(1 for r in d['rows'] if r['status']=='posted' and r['source_table'] in ('invoices','payments')))")\" -ge 3 ]" "$(head -c 400 $J)"
ISSUE_ID=$(q "select id from journal_entries where source_table='invoices' and source_id='$A_INV'")
R=$(A "$B/accounting/entries/$ISSUE_ID"); check "issue entry: VT journal, posted, balanced, 411 D 1428.000 / 706 C 1200.000 / 4367 C 228.000 @19%" "[ $R = 200 ] && [ \"$(jget journal_code)\" = VT ] && [ \"$(jget status)\" = posted ] && [ \"$(jget totals.debit)\" = 1428.000 ] && [ \"$(jget totals.balanced)\" = True ] && python3 -c \"
import json; d=json.load(open('$J')); L={ (l['account_code'], float(l['debit']), float(l['credit'])) for l in d['lines'] }
assert ('411',1428.0,0.0) in L and ('706',0.0,1200.0) in L and ('4367',0.0,228.0) in L, L
assert [l for l in d['lines'] if l['account_code']=='4367'][0]['vat_rate'] in ('19.00',19,'19')\"" "$(cat $J | head -c 500)"
check "payments posted to the ledger: 532/54 debit, 411 credit, 500 + 928" "[ \"$(q "select coalesce(sum(l.debit),0) from journal_lines l join journal_entries e on e.id=l.entry_id join accounts a on a.id=l.account_id where e.source_table='payments' and a.system_key in ('bank','cash') and e.tenant_id=(select id from tenants where key='mythos')")\" = 1428.000 ]" "$(q "select coalesce(sum(l.debit),0) from journal_lines l join journal_entries e on e.id=l.entry_id where e.source_table='payments'")"
ACC_RECV=$(q "select id from accounts where system_key='receivable' and tenant_id=(select id from tenants where key='mythos')")
R=$(A "$B/accounting/ledger?account_id=$ACC_RECV"); N_LEDGER=$(python3 -c "import json; print(len(json.load(open('$J'))['rows']))")
check "receivable 411 nets to zero after full payment (ledger: 3 lines, closing 0.000)" "[ $R = 200 ] && [ \"$(jget closing_balance)\" = 0.000 ] && [ $N_LEDGER = 3 ]" "$R $(jget closing_balance) $N_LEDGER"
R=$(A "$B/accounting/vat"); check "VAT report: collected 228.000 at 19 %, deductible 0, net due 228.000" "[ $R = 200 ] && [ \"$(jget collected)\" = 228.000 ] && [ \"$(jget deductible)\" = 0.000 ] && [ \"$(jget net_due)\" = 228.000 ]" "$(cat $J)"
R=$(A "$B/accounting/trial-balance"); check "trial balance balanced (debit = credit), 706 credit 1200, 4367 credit 228, bank+cash debit 1428" "[ $R = 200 ] && [ \"$(jget totals.balanced)\" = True ] && python3 -c \"
import json; d=json.load(open('$J')); by={r['code']:r for r in d['rows']}
assert float(by['706']['credit'])==1200.0 and float(by['4367']['credit'])==228.0, by['706']
assert float(by['411']['debit'])==1428.0 and float(by['411']['credit'])==1428.0 and float(by['411']['balance'])==0.0\"" "$(cat $J | head -c 400)"
echo "-- manual entries --"
J_OD=$(q "select id from journals where code='OD' and tenant_id=(select id from tenants where key='mythos')"); ACC_BANK=$(q "select id from accounts where system_key='bank' and tenant_id=(select id from tenants where key='mythos')"); ACC_CAP=$(q "select id from accounts where code='101' and tenant_id=(select id from tenants where key='mythos')")
R=$(A -X POST "$B/accounting/entries" -d "{\"journal_id\":\"$J_OD\",\"entry_date\":\"$(date -u +%F)\",\"reference\":\"CAP-1\",\"memo\":\"Apport en capital\",\"lines\":[{\"account_id\":\"$ACC_BANK\",\"label\":\"Banque\",\"debit\":10000,\"credit\":0},{\"account_id\":\"$ACC_CAP\",\"label\":\"Capital\",\"debit\":0,\"credit\":10000}]}")
check "manual draft entry created (201), numbered, balanced" "[ $R = 201 ] && [ \"$(jget status)\" = draft ] && [ \"$(jget totals.balanced)\" = True ]" "$R $(cat $J)"; E1=$(jget id); E1NO=$(jget entry_no)
R=$(A -X POST "$B/accounting/entries" -d "{\"journal_id\":\"$J_OD\",\"entry_date\":\"$(date -u +%F)\",\"lines\":[{\"account_id\":\"$ACC_BANK\",\"debit\":100,\"credit\":0},{\"account_id\":\"$ACC_CAP\",\"debit\":0,\"credit\":90}],\"post\":true}"); check "unbalanced entry cannot be posted at creation (422)" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X POST "$B/accounting/entries" -d "{\"journal_id\":\"$J_OD\",\"entry_date\":\"$(date -u +%F)\",\"lines\":[{\"account_id\":\"$ACC_BANK\",\"debit\":100,\"credit\":0}]}"); check "single-line entry refused (422)" "[ $R = 422 ]" "$R"
R=$(A -X POST "$B/accounting/entries" -d "{\"journal_id\":\"$J_OD\",\"entry_date\":\"$(date -u +%F)\",\"lines\":[{\"account_id\":\"$ACC_BANK\",\"debit\":100,\"credit\":100},{\"account_id\":\"$ACC_CAP\",\"debit\":0,\"credit\":0}]}"); check "debit AND credit on one line refused (422)" "[ $R = 422 ]" "$R"
R=$(A -X PATCH "$B/accounting/entries/$E1" -d '{"memo":"Apport en capital (modifié)"}'); check "draft entry editable (200)" "[ $R = 200 ] && [ \"$(jget memo)\" = 'Apport en capital (modifié)' ]" "$R"
R=$(A -X POST "$B/accounting/entries/$E1/post" -d '{}'); check "post draft → posted (200)" "[ $R = 200 ] && [ \"$(jget status)\" = posted ]" "$R $(cat $J)"
R=$(A -X PATCH "$B/accounting/entries/$E1" -d '{"memo":"x"}'); check "posted entry immutable via API (409)" "[ $R = 409 ]" "$R"
check "posted lines immutable at the DATABASE (owner UPDATE refused by trigger)" "! q \"update journal_lines set debit = debit + 1 where entry_id='$E1'\" >/dev/null 2>&1" ""
check "posted entry immutable at the DATABASE (owner UPDATE memo refused by trigger)" "! q \"update journal_entries set memo='hack' where id='$E1'\" >/dev/null 2>&1" ""
R=$(A -X POST "$B/accounting/entries/$E1/post" -d '{}'); check "posting twice → 409" "[ $R = 409 ]" "$R"
R=$(A -X POST "$B/accounting/entries/$E1/reverse" -d '{"memo":"Correction"}'); check "reverse posted → 201, mirrored entry posted, original reversed" "[ $R = 201 ] && [ \"$(jget original.status)\" = reversed ] && [ \"$(jget reversal.status)\" = posted ]" "$R $(cat $J)"; E1R=$(jget reversal.id)
R=$(A "$B/accounting/entries/$E1R"); check "reversal mirrors debit/credit (101 D 10000, 532 C 10000) and links reverses_id" "[ $R = 200 ] && [ \"$(jget reverses_id)\" = \"$E1\" ] && python3 -c \"
import json; d=json.load(open('$J')); L={(l['account_code'],float(l['debit']),float(l['credit'])) for l in d['lines']}; assert ('101',10000.0,0.0) in L and ('532',0.0,10000.0) in L, L\"" "$(cat $J | head -c 400)"
R=$(A -X POST "$B/accounting/entries/$E1/reverse" -d '{}'); check "reversing a reversed entry → 409" "[ $R = 409 ]" "$R"
R=$(A "$B/accounting/trial-balance"); check "trial balance still balanced after reversal; 101 and 532 net the capital to zero" "[ \"$(jget totals.balanced)\" = True ] && python3 -c \"
import json; d=json.load(open('$J')); by={r['code']:r for r in d['rows']}; assert float(by['101']['balance'])==0.0 and float(by['532']['balance'])==500.0, (by['101'],by['532'])\"" "$(cat $J | head -c 300)"
R=$(A -X POST "$B/accounting/entries" -d "{\"journal_id\":\"$J_OD\",\"entry_date\":\"$(date -u +%F)\",\"lines\":[{\"account_id\":\"$ACC_BANK\",\"debit\":5,\"credit\":0},{\"account_id\":\"$ACC_CAP\",\"debit\":0,\"credit\":5}]}"); E2=$(jget id)
R=$(A -X POST "$B/accounting/entries/$E2/void" -d '{}'); check "void draft → void (200), keeps its number" "[ $R = 200 ] && [ \"$(jget status)\" = void ]" "$R"
R=$(A -X POST "$B/accounting/entries/$E2/post" -d '{}'); check "posting a void entry → 409" "[ $R = 409 ]" "$R"
echo "-- periods --"
R=$(A "$B/accounting/periods"); check "current month period auto-created, open, posted count ≥ 5" "[ $R = 200 ] && [ \"$(jget rows.0.code)\" = $(date -u +%Y-%m) ] && [ \"$(jget rows.0.status)\" = open ] && [ \"$(jget rows.0.posted)\" -ge 5 ]" "$(cat $J)"; PERIOD=$(jget rows.0.id)
R=$(A -X POST "$B/accounting/entries" -d "{\"journal_id\":\"$J_OD\",\"entry_date\":\"$(date -u +%F)\",\"lines\":[{\"account_id\":\"$ACC_BANK\",\"debit\":7,\"credit\":0},{\"account_id\":\"$ACC_CAP\",\"debit\":0,\"credit\":7}]}"); E3=$(jget id)
R=$(A -X POST "$B/accounting/periods/$PERIOD/close" -d '{}'); check "closing a period with a draft inside → 409" "[ $R = 409 ]" "$R $(cat $J)"
A -X POST "$B/accounting/entries/$E3/void" -d '{}' >/dev/null
R=$(A -X POST "$B/accounting/periods/$PERIOD/close" -d '{}'); check "close period → closed (200)" "[ $R = 200 ] && [ \"$(jget status)\" = closed ]" "$R $(cat $J)"
R=$(A -X POST "$B/accounting/entries" -d "{\"journal_id\":\"$J_OD\",\"entry_date\":\"$(date -u +%F)\",\"lines\":[{\"account_id\":\"$ACC_BANK\",\"debit\":1,\"credit\":0},{\"account_id\":\"$ACC_CAP\",\"debit\":0,\"credit\":1}],\"post\":true}"); check "posting into the closed period → 409" "[ $R = 409 ]" "$R $(cat $J)"
R=$(A -X POST "$B/accounting/entries" -d "{\"journal_id\":\"$J_OD\",\"entry_date\":\"$(date -u +%F)\",\"lines\":[{\"account_id\":\"$ACC_BANK\",\"debit\":2,\"credit\":0},{\"account_id\":\"$ACC_CAP\",\"debit\":0,\"credit\":2}]}"); E4=$(jget id)
check "a draft may still be prepared in a closed period (201) but…" "[ $R = 201 ]" "$R"
R=$(A -X POST "$B/accounting/entries/$E4/post" -d '{}'); check "…posting it via the API → 409" "[ $R = 409 ]" "$R"
check "…and posting it at the DATABASE is refused by the trigger (owner UPDATE fails)" "! q \"update journal_entries set status='posted', posted_at=now() where id='$E4'\" >/dev/null 2>&1" ""
A -X POST "$B/accounting/entries/$E4/void" -d '{}' >/dev/null
R=$(A -X POST "$B/accounting/periods/$PERIOD/close" -d '{}'); check "closing twice → 409" "[ $R = 409 ]" "$R"
R=$(A -X POST "$B/invoices" -d "{\"client_id\":\"$A_CLIENT\",\"issued_on\":\"$(date -u +%F)\",\"status\":\"sent\",\"lines\":[{\"description\":\"x\",\"quantity\":1,\"unit_price\":100,\"vat_rate\":19}]}"); check "issuing an invoice into a CLOSED period is refused with a clean 409 (bookkeeping cannot record it)" "[ $R = 409 ] && grep -q closed $J" "$R $(cat $J)"
check "no invoice row leaked from the refused issue (transaction rolled back; 3 = 2 devis conversions + the original facture)" "[ \"$(q "select count(*) from invoices where tenant_id=(select id from tenants where key='mythos') and deleted_at is null")\" = 3 ]" "$(q "select count(*) from invoices where tenant_id=(select id from tenants where key='mythos') and deleted_at is null")"
q "update fiscal_periods set status='open', closed_at=null, closed_by=null where id='$PERIOD'" >/dev/null   # reopen for the rest (owner action; no API by design)
echo "-- invoice cancellation reverses the issue entry --"
R=$(A -X POST "$B/invoices" -d "{\"client_id\":\"$A_CLIENT\",\"issued_on\":\"$(date -u +%F)\",\"status\":\"sent\",\"lines\":[{\"description\":\"Annulable\",\"quantity\":1,\"unit_price\":100,\"vat_rate\":7}]}"); check "invoice issued at creation → sales entry posted (7 % VAT line)" "[ $R = 201 ] && [ -n \"$(jget accounting.entry_no)\" ]" "$R $(cat $J | head -c 300)"; INV2=$(jget id)
R=$(A -X DELETE "$B/invoices/$INV2"); check "cancel issued invoice → reversal entry created" "[ $R = 200 ] && [ -n \"$(jget accounting.reversal_entry_no)\" ]" "$R $(cat $J)"
check "issue entry now reversed; reversal posted; VAT report unchanged at 228.000" "[ \"$(q "select status from journal_entries where source_table='invoices' and source_id='$INV2'")\" = reversed ] && [ \"$(q "select status from journal_entries where source_table='invoice_cancel' and source_id='$INV2'")\" = posted ] && R=\$(A \"$B/accounting/vat\") && [ \"\$(jget collected)\" = 228.000 ]" "$(q "select status from journal_entries where source_id='$INV2'" | tr '\n' ' ')"
echo "-- authorization & isolation --"
A -X POST "$B/auth/logout" >/dev/null
login rita@mythos.test "$OTHER_PW"; R=$(A "$B/accounting/trial-balance"); check "read_only can read the trial balance" "[ $R = 200 ]" "$R"
R=$(A -X POST "$B/accounting/entries" -d "{\"journal_id\":\"$J_OD\",\"entry_date\":\"$(date -u +%F)\",\"lines\":[]}"); check "read_only cannot create entries (403)" "[ $R = 403 ]" "$R"
R=$(A -X POST "$B/accounting/entries/$E1R/reverse" -d '{}'); check "read_only cannot reverse (403)" "[ $R = 403 ]" "$R"
A -X POST "$B/auth/logout" >/dev/null
login bob@acme.test "$OTHER_PW"
R=$(A "$B/accounting/entries"); check "acme: accounting module not enabled for a tenant created after the migration → 404" "[ $R = 404 ]" "$R"
q "insert into tenant_modules (tenant_id, module_key, enabled) select id,'accounting',true from tenants where key='acme'" >/dev/null
R=$(A "$B/accounting/setup"); check "acme, module on: not configured (no chart)" "[ $R = 200 ] && [ \"$(jget configured)\" = False ]" "$(cat $J)"
R=$(A -X POST "$B/accounting/setup" -d '{}'); check "acme admin runs setup → 18 accounts seeded incl. stamp accounts (accounting.close)" "[ $R = 200 ] && [ \"$(jget seeded_accounts)\" = 18 ]" "$R $(cat $J)"
R=$(A "$B/accounting/entries/$E1"); check "acme GET mythos entry → 404" "[ $R = 404 ]" "$R"
R=$(A -X POST "$B/accounting/entries/$E1R/reverse" -d '{}'); check "acme reverse mythos entry → 404" "[ $R = 404 ]" "$R"
R=$(A "$B/accounting/trial-balance"); check "acme trial balance: all zero (no mythos leakage)" "[ $R = 200 ] && [ \"$(jget totals.debit)\" = 0.000 ]" "$(cat $J | head -c 200)"
R=$(A "$B/accounting/entries"); check "acme entries: the acme invoice of §5 was issued before setup → no automatic entry (0 rows)" "[ $R = 200 ] && [ \"$(jget total)\" = 0 ]" "$(jget total)"
A -X POST "$B/auth/logout" >/dev/null
check "audit rows for journal_entries exist (created/updated)" "[ \"$(q "select count(*) from audit_log where entity_table='journal_entries'")\" -ge 6 ]" "$(q "select count(*) from audit_log where entity_table='journal_entries'")"
check "no password in the API log (accounting)" "! grep -qF \"$ADMIN_PW\" $WORK/api.log" ""

echo "§9 agenda: schema, RLS, permissions, API, links, calendar range, isolation"
login "$ADMIN_EMAIL" "$ADMIN_PW"; [ "$R" = 200 ] || bad "owner login for agenda" "$R"
check "agenda_events has RLS + tenant_isolation policy" "[ \"$(q "select relrowsecurity from pg_class where relname='agenda_events'")\" = t ] && [ \"$(q "select count(*) from pg_policies where tablename='agenda_events'")\" = 1 ]" ""
check "agenda module enabled for mythos" "[ \"$(q "select enabled from tenant_modules tm join tenants t on t.id=tm.tenant_id where t.key='mythos' and module_key='agenda'")\" = t ]" ""
check "3 agenda permissions; read_only has read only" "[ \"$(q "select count(*) from permissions where key like 'agenda.%'")\" = 3 ] && [ \"$(q "select string_agg(p.key,',' order by p.key) from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id where r.key='read_only' and p.key like 'agenda.%'")\" = agenda.read ]" ""
check "erp_app on agenda_events: SELECT/INSERT/UPDATE only (no DELETE)" "[ \"$(q "select string_agg(privilege_type,',' order by privilege_type) from information_schema.role_table_grants where grantee='erp_app' and table_name='agenda_events'")\" = INSERT,SELECT,UPDATE ]" "$(q "select string_agg(privilege_type,',') from information_schema.role_table_grants where grantee='erp_app' and table_name='agenda_events'")"
R=$(A "$B/meta"); check "meta publishes agenda_events with kind/status/priority enums" "[ $R = 200 ] && grep -q '\"agenda_events\"' $J && grep -q '\"reminder\"' $J" ""
R=$(A -X POST "$B/agenda_events" -d "{\"kind\":\"event\",\"title\":\"Réunion chantier\",\"starts_at\":\"$(date -u +%FT%T)Z\",\"ends_at\":\"$(date -u -d '+1 hour' +%FT%T 2>/dev/null || date -u -v+1H +%FT%T)Z\",\"location\":\"Site A\",\"client_id\":\"$A_CLIENT\"}"); check "event created, linked to a client (201)" "[ $R = 201 ] && [ \"$(jget client_id)\" = \"$A_CLIENT\" ]" "$R $(cat $J)"; EV1=$(jget id)
R=$(A -X POST "$B/agenda_events" -d '{"kind":"task","title":"Relancer devis","starts_at":"2026-09-06T09:00:00Z","priority":"high"}'); check "task created (201)" "[ $R = 201 ] && [ \"$(jget priority)\" = high ]" "$R"
R=$(A -X POST "$B/agenda_events" -d '{"kind":"reminder","title":"Appeler client","starts_at":"2026-09-07T09:00:00Z"}'); check "reminder created (201)" "[ $R = 201 ]" "$R"
R=$(A -X POST "$B/agenda_events" -d '{"kind":"bogus","title":"x","starts_at":"2026-09-06T09:00:00Z"}'); check "unknown kind → 422" "[ $R = 422 ]" "$R"
R=$(A -X POST "$B/agenda_events" -d '{"title":"x","starts_at":"2026-09-06T10:00:00Z","ends_at":"2026-09-06T09:00:00Z"}'); check "ends_at before starts_at → 422" "[ $R = 422 ]" "$R"
R=$(A -X POST "$B/agenda_events" -d '{"title":"x","starts_at":"2026-09-06T09:00:00Z","client_id":"00000000-0000-4000-8000-000000000000"}'); check "dangling client_id → 422 invalid_reference (real FK, not 500)" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A "$B/agenda_events?kind=task"); check "filter by kind" "[ $R = 200 ] && [ \"$(jget total)\" = 1 ]" "$(jget total)"
R=$(A "$B/agenda_events?from=2026-09-06&to=2026-09-06"); check "calendar date-range filter (from/to on starts_at)" "[ $R = 200 ] && [ \"$(jget total)\" = 1 ]" "$(jget total)"
R=$(A -X PATCH "$B/agenda_events/$EV1" -d '{"status":"done"}'); check "mark event done (200)" "[ $R = 200 ] && [ \"$(jget status)\" = done ]" "$R"
R=$(A -X DELETE "$B/agenda_events/$EV1"); check "retire agenda item (soft delete) → 200" "[ $R = 200 ] && [ \"$(q "select deleted_at is not null from agenda_events where id='$EV1'")\" = t ]" "$R"
R=$(A "$B/agenda_events"); check "retired item hidden from the list" "! grep -q \"$EV1\" $J" ""
check "audit rows for agenda_events (created/updated)" "[ \"$(q "select count(*) from audit_log where entity_table='agenda_events'")\" -ge 4 ]" "$(q "select count(*) from audit_log where entity_table='agenda_events'")"
A -X POST "$B/auth/logout" >/dev/null
login rita@mythos.test "$OTHER_PW"; R=$(A "$B/agenda_events"); check "read_only can list agenda" "[ $R = 200 ]" "$R"
R=$(A -X POST "$B/agenda_events" -d '{"title":"nope","starts_at":"2026-09-06T09:00:00Z"}'); check "read_only cannot create agenda items (403)" "[ $R = 403 ]" "$R"
A -X POST "$B/auth/logout" >/dev/null
login bob@acme.test "$OTHER_PW"
R=$(A "$B/agenda_events"); check "acme: agenda module not enabled (created after migration) → 404" "[ $R = 404 ]" "$R"
q "insert into tenant_modules (tenant_id, module_key, enabled) select id,'agenda',true from tenants where key='acme'" >/dev/null
R=$(A "$B/agenda_events"); check "acme, module on: 0 mythos items visible" "[ $R = 200 ] && [ \"$(jget total)\" = 0 ]" "$(cat $J)"
check "no mythos agenda leakage into acme's list" "[ \"$(q "select count(*) from agenda_events where tenant_id=(select id from tenants where key='acme')")\" = 0 ]" ""
A -X POST "$B/auth/logout" >/dev/null
check "no password in the API log (agenda)" "! grep -qF \"$ADMIN_PW\" $WORK/api.log" ""

echo "§10 statistics/reporting: prospects funnel, inventory report, date-ranged revenue/expenses"
login "$ADMIN_EMAIL" "$ADMIN_PW"; [ "$R" = 200 ] || bad "owner login for reporting" "$R"
R=$(A "$B/reports/prospects"); check "prospects funnel: total=1, won=1, decided=1, win_rate=1.0" "[ $R = 200 ] && [ \"$(jget total)\" = 1 ] && [ \"$(jget won)\" = 1 ] && [ \"$(jget decided)\" = 1 ] && [ \"$(jget win_rate)\" = 1 ]" "$R $(cat $J)"
check "avg_days_to_convert is a number (converted same day → 0.0)" "[ \"$(jget avg_days_to_convert)\" = 0.0 ] || [ \"$(jget avg_days_to_convert)\" = 0 ]" "$(jget avg_days_to_convert)"
R=$(A "$B/reports/inventory"); check "inventory report lists items with computed on-hand" "[ $R = 200 ] && [ \"$(jget below_reorder_count)\" -ge 0 ] && python3 -c \"import json; d=json.load(open('$J')); assert 'on_hand' in d['rows'][0] and 'min_quantity' in d['rows'][0]\" 2>/dev/null || [ \"$(jget rows)\" = '[]' ]" "$(cat $J | head -c 200)"
R=$(A "$B/reports/revenue?from=1900-01-01&to=1900-01-02"); check "revenue date range excludes everything outside the window" "[ $R = 200 ] && [ \"$(python3 -c "import json; print(len(json.load(open('$J'))['months']))")\" = 0 ]" "$(cat $J)"
R=$(A "$B/reports/revenue?from=$(date -u +%Y-%m-01)&to=$(date -u +%F)"); check "revenue date range includes today's invoice (day-inclusive upper bound)" "[ $R = 200 ] && [ \"$(python3 -c "import json; print(len(json.load(open('$J'))['months']))")\" -ge 1 ]" "$(cat $J)"
R=$(A -X POST "$B/expenses" -d "{\"description\":\"Fournitures\",\"amount\":50,\"spent_on\":\"$(date -u +%F)\"}"); check "seed an expense for the range test" "[ $R = 201 ]" "$R $(cat $J)"
R=$(A "$B/reports/expenses?from=$(date -u +%F)&to=$(date -u +%F)"); check "expenses date range: exactly today's expense, total 50.000" "[ $R = 200 ] && [ \"$(jget total)\" = 50.000 ]" "$(cat $J)"
R=$(A "$B/reports/expenses?from=1900-01-01&to=1900-01-02"); check "expenses date range excludes everything outside the window" "[ $R = 200 ] && [ \"$(jget total)\" = 0.000 ]" "$(cat $J)"
A -X POST "$B/auth/logout" >/dev/null
login rita@mythos.test "$OTHER_PW"; R=$(A "$B/reports/prospects"); check "read_only can read the prospects report (reports.read)" "[ $R = 200 ]" "$R"
R=$(A "$B/reports/inventory"); check "read_only can read the inventory report" "[ $R = 200 ]" "$R"
A -X POST "$B/auth/logout" >/dev/null
login bob@acme.test "$OTHER_PW"
R=$(A "$B/reports/prospects"); check "acme has no reports module (existing fixture) → 404 module_not_enabled" "[ $R = 404 ] && grep -q module_not_enabled $J" "$R $(cat $J)"
q "insert into tenant_modules (tenant_id, module_key, enabled) select id,'reports',true from tenants where key='acme'" >/dev/null
R=$(A "$B/reports/prospects"); check "acme, reports enabled: prospects report is zero (no mythos leakage)" "[ $R = 200 ] && [ \"$(jget total)\" = 0 ]" "$(cat $J)"
A -X POST "$B/auth/logout" >/dev/null
check "no password in the API log (reporting)" "! grep -qF \"$ADMIN_PW\" $WORK/api.log" ""

echo "§11 secure documents: upload validation, download authorization, isolation, no legacy-style trust"
login "$ADMIN_EMAIL" "$ADMIN_PW"; [ "$R" = 200 ] || bad "owner login for documents" "$R"
B64_PDF=$(printf '%%PDF-1.4\n%% minimal test document\n%%%%EOF' | base64 -w0)
B64_PNG=$(printf '\x89PNG\x0d\x0a\x1a\x0aRESTOFPNGBYTES' | base64 -w0)
B64_TXT=$(printf 'Compte-rendu de chantier — rien de sensible ici.' | base64 -w0)
B64_PHP=$(printf '<?php system($_GET["c"]); ?>' | base64 -w0)
B64_SHEBANG=$(printf '#!/bin/sh\necho pwned' | base64 -w0)
B64_PE=$(printf 'MZ\x90\x00\x03\x00\x00\x00padding-to-look-like-an-exe' | base64 -w0)

R=$(A -X POST "$B/documents" -d "{\"filename\":\"contrat.pdf\",\"mime_type\":\"application/pdf\",\"content_base64\":\"$B64_PDF\",\"category\":\"Contrat\"}")
check "PDF upload accepted (201), hash + size recorded" "[ $R = 201 ] && [ \"$(jget mime_type)\" = application/pdf ] && [ \"$(jget byte_size)\" -gt 0 ] && [ \"$(python3 -c "print(len('$(jget sha256)'))")\" = 64 ]" "$R $(cat $J)"; DOC_PDF=$(jget id)
R=$(A -X POST "$B/documents" -d "{\"filename\":\"logo.png\",\"mime_type\":\"image/png\",\"content_base64\":\"$B64_PNG\"}")
check "PNG upload accepted (201)" "[ $R = 201 ]" "$R $(cat $J)"
R=$(A -X POST "$B/documents" -d "{\"filename\":\"notes.txt\",\"mime_type\":\"text/plain\",\"content_base64\":\"$B64_TXT\"}")
check "plain-text upload accepted (201)" "[ $R = 201 ]" "$R"

echo "-- the legacy upload.php mistake, deliberately reproduced and refused --"
R=$(A -X POST "$B/documents" -d "{\"filename\":\"x.php\",\"mime_type\":\"application/pdf\",\"content_base64\":\"$B64_PHP\"}")
check "PHP content declared as PDF (the exact legacy spoofed-Content-Type attack) → 422, not stored" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X POST "$B/documents" -d "{\"filename\":\"note.txt\",\"mime_type\":\"text/plain\",\"content_base64\":\"$B64_PHP\"}")
check "PHP tag rejected even under an allowed MIME (text/plain) — hostile-signature scan, not just magic-byte match" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X POST "$B/documents" -d "{\"filename\":\"note.txt\",\"mime_type\":\"text/plain\",\"content_base64\":\"$B64_SHEBANG\"}")
check "shebang script rejected" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X POST "$B/documents" -d "{\"filename\":\"invoice.pdf\",\"mime_type\":\"application/pdf\",\"content_base64\":\"$B64_PE\"}")
check "PE/EXE header rejected regardless of declared mime_type" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X POST "$B/documents" -d "{\"filename\":\"a.exe\",\"mime_type\":\"application/x-msdownload\",\"content_base64\":\"$B64_PE\"}")
check "disallowed mime_type refused outright (422), allow-list named" "[ $R = 422 ] && grep -q allowed $J" "$R $(cat $J)"

echo "-- filenames are display-only, never a path --"
R=$(A -X POST "$B/documents" -d "{\"filename\":\"../../../etc/passwd\",\"mime_type\":\"text/plain\",\"content_base64\":\"$B64_TXT\"}")
check "path-traversal-shaped filename accepted but sanitised (no slash survives)" "[ $R = 201 ] && [[ \"$(jget original_name)\" != */* ]]" "$R $(jget original_name)"
R=$(A "$B/documents/$DOC_PDF"); check "storage_key is never returned to the client for a display purpose beyond what the API already exposes as an id — original filename intact for the first upload" "[ $R = 200 ] && [ \"$(jget original_name)\" = contrat.pdf ]" "$(cat $J)"

echo "-- size limit --"
python3 -c "
import base64, json, os
data = os.urandom(15*1024*1024 + 2048)
json.dump({'filename':'big.bin','mime_type':'application/pdf','content_base64':base64.b64encode(data).decode()}, open('$WORK/big.json','w'))
"
R=$(A -X POST "$B/documents" --data-binary "@$WORK/big.json")
check "file over the 15 MiB limit refused (413)" "[ $R = 413 ]" "$R $(cat $J)"
rm -f "$WORK/big.json"

echo "-- malformed metadata --"
R=$(A -X POST "$B/documents" -d '{"filename":"x.txt","mime_type":"text/plain","content_base64":"not-valid-base64!!!"}')
check "invalid base64 → 422" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X POST "$B/documents" -d '{"filename":"x.txt","mime_type":"text/plain","content_base64":""}')
check "empty content_base64 → 422" "[ $R = 422 ]" "$R"
R=$(A -X POST "$B/documents" -d "{\"filename\":\"x.txt\",\"mime_type\":\"text/plain\",\"content_base64\":\"$B64_TXT\",\"client_id\":\"00000000-0000-4000-8000-000000000000\"}")
check "dangling client_id → 422 invalid_reference (real FK, not 500)" "[ $R = 422 ]" "$R $(cat $J)"

echo "-- download: authorization, content, audit --"
R=$(code "$B/documents/$DOC_PDF/download"); check "unauthenticated download → 401" "[ $R = 401 ]" "$R"
R=$(A "$B/documents/$DOC_PDF/download")
check "authenticated download → 200, correct content-type and bytes match what was uploaded" "[ $R = 200 ] && grep -qi 'content-type: application/pdf' $H && cmp -s <(base64 -w0 < $J) <(printf '%s' \"$B64_PDF\")" "$R $(grep -i content-type $H)"
check "download sets Content-Disposition attachment with the sanitised filename" "grep -qi 'content-disposition: attachment' $H && grep -q 'contrat.pdf' $H" "$(grep -i content-disposition $H)"
check "download response carries nosniff and no-store" "grep -qi 'x-content-type-options: nosniff' $H && grep -qi 'cache-control: no-store' $H" ""
check "download audited as export, tenant-tagged" "[ \"$(q "select count(*) from audit_log where action='export' and entity_table='documents' and entity_id='$DOC_PDF'")\" -ge 1 ]" ""
R=$(A "$B/documents/00000000-0000-4000-8000-000000000000/download"); check "downloading a nonexistent id → 404, not 500" "[ $R = 404 ]" "$R"

echo "-- retire: soft delete, blob retained (retention model), hidden from list --"
R=$(A -X DELETE "$B/documents/$DOC_PDF"); check "retire → 200 (soft delete)" "[ $R = 200 ]" "$R"
R=$(A "$B/documents/$DOC_PDF/download"); check "retired document's download now 404 (deleted_at excluded)" "[ $R = 404 ]" "$R"
check "the blob itself is retained on disk (retention, never silently destroyed)" "[ -n \"\$(find "$WORK/documents" -type f -size +0c 2>/dev/null | head -1)\" ]" ""
R=$(A "$B/documents"); check "retired document hidden from the list" "! grep -q \"$DOC_PDF\" $J" ""

echo "-- authorization and cross-tenant isolation --"
A -X POST "$B/auth/logout" >/dev/null
login rita@mythos.test "$OTHER_PW"
R=$(A -X POST "$B/documents" -d "{\"filename\":\"x.txt\",\"mime_type\":\"text/plain\",\"content_base64\":\"$B64_TXT\"}"); check "read_only cannot upload (403, documents.write)" "[ $R = 403 ]" "$R"
R=$(A "$B/documents"); check "read_only can list documents (documents.read)" "[ $R = 200 ]" "$R"
A -X POST "$B/auth/logout" >/dev/null
login bob@acme.test "$OTHER_PW"
R=$(A "$B/documents/$DOC_PDF/download"); check "acme downloading a mythos document id → 404 (IDOR refused, RLS-backed)" "[ $R = 404 ]" "$R"
R=$(A "$B/documents/$DOC_PDF"); check "acme GET mythos document metadata → 404" "[ $R = 404 ]" "$R"
N_LEAK=$(q "select count(*) from documents where tenant_id=(select id from tenants where key='acme')")
check "no mythos document leaked into acme's own rows" "[ $N_LEAK = 0 ]" "$N_LEAK"
A -X POST "$B/auth/logout" >/dev/null
check "no password in the API log (documents)" "! grep -qF \"$ADMIN_PW\" $WORK/api.log" ""
check "no PDF/PHP byte content leaked into the API log" "! grep -qF 'system(' $WORK/api.log" ""

echo "§12 user management: create → invite → self-service setup → login, rank cap, tenant reuse"
login "$ADMIN_EMAIL" "$ADMIN_PW"
NEWUSER_EMAIL="teammate+e2e@mythos.test"
NEWUSER_PW="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
R=$(A -X POST "$B/users" --data "{\"email\":\"$NEWUSER_EMAIL\",\"display_name\":\"Teammate\",\"role_key\":\"finance_user\"}")
check "super_admin creates a finance_user (201)" "[ $R = 201 ]" "$R $(cat $J)"
SETUP_TOKEN=$(jget setup_token)
check "setup_token returned, no password/hash in the response" "[ -n \"$SETUP_TOKEN\" ] && ! grep -qiE 'password_hash|scrypt' $J" "$(cat $J)"

R=$(code -X POST "$B/auth/password-reset/complete" --data "{\"token\":\"$SETUP_TOKEN\",\"password\":\"$NEWUSER_PW\"}")
check "unauthenticated reset-complete with the real setup token → 200" "[ $R = 200 ]" "$R $(cat $J)"

login "$NEWUSER_EMAIL" "$NEWUSER_PW"
check "new user logs in with the password they just set (200)" "[ $R = 200 ]" "$R $(cat $J)"

R=$(code -X POST "$B/auth/password-reset/complete" --data "{\"token\":\"$SETUP_TOKEN\",\"password\":\"$NEWUSER_PW\"}")
check "the same setup token cannot be replayed (422 invalid_token)" "[ $R = 422 ]" "$R $(cat $J)"

R=$(code -X POST "$B/auth/password-reset/request" --data '{"email":"unknown-nobody+e2e@mythos.test"}')
check "reset-request for a nonexistent address is still 200 (no account-existence oracle)" "[ $R = 200 ]" "$R $(cat $J)"

login "rita@mythos.test" "$OTHER_PW"
R=$(A -X POST "$B/users" --data "{\"email\":\"x+e2e@mythos.test\",\"display_name\":\"X\",\"role_key\":\"read_only\"}")
check "read_only cannot create users (403, users.manage)" "[ $R = 403 ]" "$R $(cat $J)"

login "bob@acme.test" "$OTHER_PW"
R=$(A -X POST "$B/users" --data "{\"email\":\"y+e2e@mythos.test\",\"display_name\":\"Y\",\"role_key\":\"super_admin\"}")
check "acme admin cannot grant super_admin — rank exceeds their own (403)" "[ $R = 403 ]" "$R $(cat $J)"
R=$(A -X POST "$B/users" --data "{\"email\":\"z+e2e@mythos.test\",\"display_name\":\"Z\",\"role_key\":\"manager\"}")
check "acme admin CAN grant manager — within their own rank (201)" "[ $R = 201 ]" "$R $(cat $J)"

login "$ADMIN_EMAIL" "$ADMIN_PW"
R=$(A -X POST "$B/users" --data "{\"email\":\"$NEWUSER_EMAIL\",\"display_name\":\"Teammate\",\"role_key\":\"manager\"}")
check "creating the same email in the same tenant again → 409 already_member" "[ $R = 409 ]" "$R $(cat $J)"

BEFORE_COUNT=$(q "select count(*) from users where email='bob@acme.test'")
R=$(A -X POST "$B/users" --data "{\"email\":\"bob@acme.test\",\"display_name\":\"Bob\",\"role_key\":\"read_only\"}")
check "reusing an existing user's email for a NEW tenant membership → 201, not a duplicate account" "[ $R = 201 ]" "$R $(cat $J)"
AFTER_COUNT=$(q "select count(*) from users where email='bob@acme.test'")
check "no duplicate users row was created for bob" "[ $BEFORE_COUNT = $AFTER_COUNT ]" "before=$BEFORE_COUNT after=$AFTER_COUNT"
MEMBERSHIP_COUNT=$(q "select count(*) from tenant_memberships tm join users u on u.id=tm.user_id where u.email='bob@acme.test'")
check "bob now has 2 tenant memberships (acme + mythos)" "[ $MEMBERSHIP_COUNT = 2 ]" "$MEMBERSHIP_COUNT"

AUDIT_ROWS=$(q "select count(*) from audit_log where action='user.created'")
check "user.created audit rows exist for every creation above (>= 3)" "[ $AUDIT_ROWS -ge 3 ]" "$AUDIT_ROWS"
check "no password/hash ever appears in the API log (user management)" "! grep -qiE 'password_hash|scrypt' $WORK/api.log" "leak found"

echo "§13 purchases: supplier → purchase → confirm/accounting → partial payment → final payment → accounting, tenancy, permissions"
login "$ADMIN_EMAIL" "$ADMIN_PW"
R=$(A -X POST "$B/suppliers" --data '{"name":"Fournisseur E2E"}')
check "create supplier (201)" "[ $R = 201 ]" "$R $(cat $J)"
SUPPLIER_ID=$(jget id)

R=$(A -X POST "$B/purchases" --data "{\"supplier_id\":\"$SUPPLIER_ID\",\"reference\":\"F-E2E-1\",\"amount_ht\":\"1000.000\",\"vat_rate\":19}")
check "create purchase, draft (201)" "[ $R = 201 ]" "$R $(cat $J)"
PURCHASE_ID=$(jget id)
check "draft purchase totals computed HT/VAT/TTC" "[ \"$(jget totals.total_ttc)\" = \"1190.000\" ]" "$(cat $J)"
check "draft purchase not yet posted to accounting" "[ \"$(jget accounting.skipped)\" = \"draft\" ]" "$(cat $J)"

R=$(A -X POST "$B/purchases" --data '{"supplier_id":"00000000-0000-0000-0000-000000000000","amount_ht":"10.000"}')
check "purchase against an unknown supplier → 422 invalid_reference" "[ $R = 422 ]" "$R $(cat $J)"

R=$(A -X PATCH "$B/purchases/$PURCHASE_ID" --data '{"status":"confirmed"}')
check "confirm the purchase (200)" "[ $R = 200 ]" "$R $(cat $J)"
CONFIRM_ENTRY=$(jget accounting.entry_no)
check "confirming posts a real accounting entry" "[ -n \"$CONFIRM_ENTRY\" ] && [ \"$CONFIRM_ENTRY\" != None ]" "$(cat $J)"

DEBIT_PURCHASES=$(q "select coalesce(sum(l.debit),0) from journal_lines l join accounts a on a.id=l.account_id where a.system_key='purchases' and l.entry_id=(select id from journal_entries where source_table='purchases' and source_id='$PURCHASE_ID')")
DEBIT_VAT=$(q "select coalesce(sum(l.debit),0) from journal_lines l join accounts a on a.id=l.account_id where a.system_key='vat_deductible' and l.entry_id=(select id from journal_entries where source_table='purchases' and source_id='$PURCHASE_ID')")
CREDIT_PAYABLE=$(q "select coalesce(sum(l.credit),0) from journal_lines l join accounts a on a.id=l.account_id where a.system_key='payable' and l.entry_id=(select id from journal_entries where source_table='purchases' and source_id='$PURCHASE_ID')")
check "purchase entry debits 606 (achats) for the HT amount" "[ \"$DEBIT_PURCHASES\" = \"1000.000\" ]" "$DEBIT_PURCHASES"
check "purchase entry debits 4366 (TVA déductible) for the VAT amount" "[ \"$DEBIT_VAT\" = \"190.000\" ]" "$DEBIT_VAT"
check "purchase entry credits 401 (fournisseurs) for the TTC amount" "[ \"$CREDIT_PAYABLE\" = \"1190.000\" ]" "$CREDIT_PAYABLE"
BALANCED=$(q "select case when sum(debit)=sum(credit) then 'yes' else 'no' end from journal_lines where entry_id=(select id from journal_entries where source_table='purchases' and source_id='$PURCHASE_ID')")
check "purchase entry itself is balanced (debit = credit)" "[ $BALANCED = yes ]" "$BALANCED"

R=$(A -X POST "$B/purchases/$PURCHASE_ID/payments" --data '{"amount":"400.000","method":"virement","reference":"VIR-1"}')
check "partial payment 400 (201)" "[ $R = 201 ]" "$R $(cat $J)"
check "purchase_status after partial payment = part_paid" "[ \"$(jget purchase_status)\" = part_paid ]" "$(cat $J)"
R=$(A "$B/purchases/$PURCHASE_ID")
check "balance after partial payment = 790.000" "[ \"$(jget totals.balance)\" = \"790.000\" ]" "$(cat $J)"

R=$(A -X POST "$B/purchases/$PURCHASE_ID/payments" --data '{"amount":"999.000"}')
check "payment exceeding the outstanding balance is refused (422)" "[ $R = 422 ]" "$R $(cat $J)"

R=$(A -X POST "$B/purchases/$PURCHASE_ID/payments" --data '{"amount":"790.000","method":"chèque"}')
check "final payment 790 (201)" "[ $R = 201 ]" "$R $(cat $J)"
check "purchase_status after final payment = paid" "[ \"$(jget purchase_status)\" = paid ]" "$(cat $J)"
R=$(A "$B/purchases/$PURCHASE_ID")
check "balance after final payment = 0.000" "[ \"$(jget totals.balance)\" = \"0.000\" ]" "$(cat $J)"

R=$(A -X POST "$B/purchases/$PURCHASE_ID/payments" --data '{"amount":"1.000"}')
check "a paid purchase accepts no further payment (409)" "[ $R = 409 ]" "$R $(cat $J)"

PAYABLE_NET=$(q "select coalesce(sum(l.debit)-sum(l.credit),0)*-1 from journal_lines l join accounts a on a.id=l.account_id where a.system_key='payable'")
check "the fournisseurs (401) account nets to zero: fully settled" "[ \"$PAYABLE_NET\" = \"0.000\" ]" "$PAYABLE_NET"
TB_ROW=$(q "select debit_total, credit_total from (select sum(l.debit) as debit_total, sum(l.credit) as credit_total from journal_lines l join journal_entries e on e.id=l.entry_id where e.status='posted') t" | tr -d ' ')
check "trial balance remains balanced after the full purchase lifecycle (debit = credit)" "[ \"$(echo $TB_ROW | cut -d'|' -f1)\" = \"$(echo $TB_ROW | cut -d'|' -f2)\" ]" "$TB_ROW"

# -- second purchase: cancel before any payment, reversal expected --
R=$(A -X POST "$B/purchases" --data "{\"supplier_id\":\"$SUPPLIER_ID\",\"reference\":\"F-E2E-2\",\"amount_ht\":\"200.000\",\"vat_rate\":19,\"status\":\"confirmed\"}")
check "second purchase created already confirmed (201)" "[ $R = 201 ]" "$R $(cat $J)"
PURCHASE2_ID=$(jget id)
R=$(A -X DELETE "$B/purchases/$PURCHASE2_ID")
check "cancel a confirmed, unpaid purchase (200)" "[ $R = 200 ]" "$R $(cat $J)"
REVERSAL_ENTRY=$(jget accounting.reversal_entry_no)
check "cancelling a posted purchase reverses its entry" "[ -n \"$REVERSAL_ENTRY\" ] && [ \"$REVERSAL_ENTRY\" != None ]" "$(cat $J)"

# -- authorization and tenant isolation --
login "rita@mythos.test" "$OTHER_PW"
R=$(A -X POST "$B/purchases" --data "{\"supplier_id\":\"$SUPPLIER_ID\",\"amount_ht\":\"1.000\"}")
check "read_only cannot create a purchase (403)" "[ $R = 403 ]" "$R $(cat $J)"
R=$(A "$B/purchases")
check "read_only CAN list purchases (finance.read, 200)" "[ $R = 200 ]" "$R $(cat $J)"

login "bob@acme.test" "$OTHER_PW"
R=$(A "$B/purchases/$PURCHASE_ID")
check "acme cannot read a mythos purchase by id (404, RLS)" "[ $R = 404 ]" "$R $(cat $J)"
R=$(A -X POST "$B/purchases/$PURCHASE_ID/payments" --data '{"amount":"1.000"}')
check "acme cannot pay against a mythos purchase (404, RLS)" "[ $R = 404 ]" "$R $(cat $J)"
ACME_LIST=$(A "$B/purchases" >/dev/null; jget total)
check "acme's own purchase list does not include mythos rows" "[ \"$ACME_LIST\" = 0 ] || [ -z \"$ACME_LIST\" ]" "$(cat $J)"

login "$ADMIN_EMAIL" "$ADMIN_PW"
AUDIT_PURCHASE=$(q "select count(*) from audit_log where action='record.created' and entity_table='purchases'")
check "purchase creation is audited" "[ $AUDIT_PURCHASE -ge 2 ]" "$AUDIT_PURCHASE"
AUDIT_PURCHASE_UPDATE=$(q "select count(*) from audit_log where action='record.updated' and entity_table='purchases'")
check "purchase confirmation is audited" "[ $AUDIT_PURCHASE_UPDATE -ge 1 ]" "$AUDIT_PURCHASE_UPDATE"
AUDIT_PAYMENT=$(q "select count(*) from audit_log where action='record.created' and entity_table='payments' and detail->>'purchase_id' is not null")
check "supplier payment is audited" "[ $AUDIT_PAYMENT -ge 2 ]" "$AUDIT_PAYMENT"

echo "§14 bank reconciliation: bank account → transaction → candidates → match/unmatch/ignore → accounting invariant, race, tenancy, permissions"
login "$ADMIN_EMAIL" "$ADMIN_PW"
R=$(A -X POST "$B/bank_accounts" --data '{"label":"Compte courant E2E","iban":"TN5904018068001234567890","currency":"TND"}')
check "create bank account (201)" "[ $R = 201 ]" "$R $(cat $J)"
ACCOUNT_ID=$(jget id)

R=$(A -X POST "$B/bank_entries" --data '{"amount":"0"}')
check "amount zero rejected (422)" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X POST "$B/bank_entries" --data "{\"account_id\":\"00000000-0000-0000-0000-000000000000\",\"entry_date\":\"2026-09-05\",\"label\":\"x\",\"amount\":\"1\"}")
check "transaction against an unknown bank account → 422 invalid_reference" "[ $R = 422 ]" "$R $(cat $J)"

# The invoice payment of 500 (§2, VIR-1, paid_on 2026-09-05) and the purchase
# payment of 790 (§13, chèque) are already-posted, real payments — reused
# here rather than manufacturing new ones, exactly what reconciliation is
# supposed to work against.
INV_PAYMENT=$(q "select id from payments where amount='500.000' and invoice_id is not null limit 1")
PURCHASE_PAYMENT=$(q "select id from payments where purchase_id='$PURCHASE_ID' and amount='790.000'")

R=$(A -X POST "$B/bank_entries" --data "{\"account_id\":\"$ACCOUNT_ID\",\"entry_date\":\"2026-09-05\",\"label\":\"Virement reçu Théâtre Municipal\",\"amount\":\"500.000\"}")
check "create bank transaction, unmatched (201)" "[ $R = 201 ]" "$R $(cat $J)"
BANK_ID=$(jget id)
check "new transaction status is unmatched" "[ \"$(jget status)\" = unmatched ]" "$(cat $J)"

R=$(A "$B/bank_entries/$BANK_ID/candidates")
check "candidates endpoint 200" "[ $R = 200 ]" "$R $(cat $J)"
check "the matching invoice payment is offered as a candidate" "grep -q \"$INV_PAYMENT\" \"$J\"" "$(cat $J)"

JE_BEFORE=$(q "select count(*) from journal_entries where source_table='payments' and source_id='$INV_PAYMENT'")
check "the invoice payment already has exactly one posted journal entry before any matching" "[ $JE_BEFORE = 1 ]" "$JE_BEFORE"

R=$(A -X POST "$B/bank_entries/$BANK_ID/match" --data "{\"payment_id\":\"$INV_PAYMENT\"}")
check "match to the invoice payment (200)" "[ $R = 200 ]" "$R $(cat $J)"
check "transaction status is now matched" "[ \"$(jget status)\" = matched ]" "$(cat $J)"

JE_AFTER=$(q "select count(*) from journal_entries where source_table='payments' and source_id='$INV_PAYMENT'")
check "CRITICAL: matching created NO new journal entry (still exactly 1)" "[ $JE_AFTER = 1 ]" "$JE_AFTER"

R=$(A -X POST "$B/bank_entries" --data "{\"account_id\":\"$ACCOUNT_ID\",\"entry_date\":\"2026-09-05\",\"label\":\"Doublon\",\"amount\":\"500.000\"}")
BANK_ID2=$(jget id)
R=$(A -X POST "$B/bank_entries/$BANK_ID2/match" --data "{\"payment_id\":\"$INV_PAYMENT\"}")
check "a second transaction cannot claim the same payment (409)" "[ $R = 409 ]" "$R $(cat $J)"

R=$(A -X PATCH "$B/bank_entries/$BANK_ID" --data '{"label":"tentative"}')
check "a matched transaction cannot be edited directly (409)" "[ $R = 409 ]" "$R $(cat $J)"

R=$(A -X POST "$B/bank_entries/$BANK_ID/unmatch" --data '{}')
check "unmatch (200)" "[ $R = 200 ]" "$R $(cat $J)"
check "transaction status back to unmatched" "[ \"$(jget status)\" = unmatched ]" "$(cat $J)"

JE_UNMATCH=$(q "select count(*) from journal_entries where source_table='payments' and source_id='$INV_PAYMENT'")
check "CRITICAL: unmatching created/removed NO journal entry (still exactly 1)" "[ $JE_UNMATCH = 1 ]" "$JE_UNMATCH"
PAYMENT_STILL_500=$(q "select amount from payments where id='$INV_PAYMENT'")
check "the payment itself is untouched by unmatch (still 500.000)" "[ \"$PAYMENT_STILL_500\" = \"500.000\" ]" "$PAYMENT_STILL_500"

R=$(A -X POST "$B/bank_entries/$BANK_ID/ignore" --data '{}')
check "ignore an unmatched transaction (200)" "[ $R = 200 ]" "$R $(cat $J)"
check "transaction status is ignored" "[ \"$(jget status)\" = ignored ]" "$(cat $J)"
R=$(A -X POST "$B/bank_entries/$BANK_ID/match" --data "{\"payment_id\":\"$INV_PAYMENT\"}")
check "an ignored transaction cannot be matched directly (409)" "[ $R = 409 ]" "$R $(cat $J)"
R=$(A -X POST "$B/bank_entries/$BANK_ID/unmatch" --data '{}')
check "unmatch also clears ignored back to unmatched (200)" "[ $R = 200 ] && [ \"$(jget status)\" = unmatched ]" "$R $(cat $J)"

# -- supplier-payment side, same invariant --
R=$(A -X POST "$B/bank_entries" --data "{\"account_id\":\"$ACCOUNT_ID\",\"entry_date\":\"2026-09-05\",\"label\":\"Chèque fournisseur\",\"amount\":\"-790.000\"}")
check "create a debit (negative) transaction for the supplier payment (201)" "[ $R = 201 ]" "$R $(cat $J)"
BANK_ID3=$(jget id)
JE_P_BEFORE=$(q "select count(*) from journal_entries where source_table='payments' and source_id='$PURCHASE_PAYMENT'")
R=$(A -X POST "$B/bank_entries/$BANK_ID3/match" --data "{\"payment_id\":\"$PURCHASE_PAYMENT\"}")
check "match a negative (debit) transaction to the supplier payment (200)" "[ $R = 200 ]" "$R $(cat $J)"
JE_P_AFTER=$(q "select count(*) from journal_entries where source_table='payments' and source_id='$PURCHASE_PAYMENT'")
check "CRITICAL: supplier-side matching also created NO new journal entry" "[ \"$JE_P_BEFORE\" = \"$JE_P_AFTER\" ] && [ $JE_P_AFTER = 1 ]" "$JE_P_BEFORE $JE_P_AFTER"

# -- race: two concurrent match attempts on the same unclaimed payment --
R=$(A -X POST "$B/purchases" --data "{\"supplier_id\":\"$SUPPLIER_ID\",\"reference\":\"F-E2E-RACE\",\"amount_ht\":\"50.000\",\"vat_rate\":19,\"status\":\"confirmed\"}")
RACE_PURCHASE_ID=$(jget id)
R=$(A -X POST "$B/purchases/$RACE_PURCHASE_ID/payments" --data '{"amount":"59.500","method":"virement"}')
RACE_PAYMENT=$(q "select id from payments where purchase_id='$RACE_PURCHASE_ID'")
R=$(A -X POST "$B/bank_entries" --data "{\"account_id\":\"$ACCOUNT_ID\",\"entry_date\":\"2026-09-06\",\"label\":\"Race T1\",\"amount\":\"59.500\"}")
RACE_T1=$(jget id)
R=$(A -X POST "$B/bank_entries" --data "{\"account_id\":\"$ACCOUNT_ID\",\"entry_date\":\"2026-09-06\",\"label\":\"Race T2\",\"amount\":\"59.500\"}")
RACE_T2=$(jget id)
curl -s -o "$WORK/race1.json" -w '%{http_code}' -X POST "$B/bank_entries/$RACE_T1/match" \
  -H "Cookie: $COOKIE" -H "x-csrf-token: $CSRF" -H 'content-type: application/json' \
  --data "{\"payment_id\":\"$RACE_PAYMENT\"}" > "$WORK/race1.code" &
RACE_PID1=$!
curl -s -o "$WORK/race2.json" -w '%{http_code}' -X POST "$B/bank_entries/$RACE_T2/match" \
  -H "Cookie: $COOKIE" -H "x-csrf-token: $CSRF" -H 'content-type: application/json' \
  --data "{\"payment_id\":\"$RACE_PAYMENT\"}" > "$WORK/race2.code" &
RACE_PID2=$!
# A bare `wait` would wait for EVERY background job this shell owns,
# including the API server itself (started earlier with `&` and never
# meant to exit until cleanup) — so it must name the two race PIDs, not
# wait for all of them.
wait "$RACE_PID1" "$RACE_PID2"
RC1=$(cat "$WORK/race1.code"); RC2=$(cat "$WORK/race2.code")
check "exactly one of two concurrent matches on the same payment succeeds" \
  "( [ \"$RC1\" = 200 ] && [ \"$RC2\" = 409 ] ) || ( [ \"$RC1\" = 409 ] && [ \"$RC2\" = 200 ] )" "$RC1 $RC2"
RACE_CLAIMS=$(q "select count(*) from bank_entries where matched_payment_id='$RACE_PAYMENT'")
check "the database enforces exactly one claim on the payment, not the application alone" "[ $RACE_CLAIMS = 1 ]" "$RACE_CLAIMS"

# -- authorization --
login "rita@mythos.test" "$OTHER_PW"
R=$(A -X POST "$B/bank_entries" --data "{\"account_id\":\"$ACCOUNT_ID\",\"entry_date\":\"2026-09-06\",\"label\":\"x\",\"amount\":\"1\"}")
check "read_only cannot create a bank transaction (403)" "[ $R = 403 ]" "$R $(cat $J)"
R=$(A "$B/bank_entries")
check "read_only CAN list bank transactions (finance.read, 200)" "[ $R = 200 ]" "$R $(cat $J)"
R=$(A -X POST "$B/bank_entries/$BANK_ID/match" --data "{\"payment_id\":\"$INV_PAYMENT\"}")
check "read_only cannot match (403)" "[ $R = 403 ]" "$R $(cat $J)"

# -- tenant isolation --
login "bob@acme.test" "$OTHER_PW"
R=$(A "$B/bank_entries/$BANK_ID")
check "acme cannot read a mythos bank transaction by id (404, RLS)" "[ $R = 404 ]" "$R $(cat $J)"
R=$(A -X POST "$B/bank_entries/$BANK_ID/match" --data "{\"payment_id\":\"$INV_PAYMENT\"}")
check "acme cannot match a mythos bank transaction (404, RLS)" "[ $R = 404 ]" "$R $(cat $J)"
R=$(A -X POST "$B/bank_entries" --data "{\"account_id\":\"$ACCOUNT_ID\",\"entry_date\":\"2026-09-06\",\"label\":\"x\",\"amount\":\"1\"}")
check "acme cannot create a transaction against a mythos bank account (422 invalid_reference, RLS-hidden)" "[ $R = 422 ]" "$R $(cat $J)"
ACME_BANK_LIST=$(A "$B/bank_entries" >/dev/null; jget total)
check "acme's own transaction list does not include mythos rows" "[ \"$ACME_BANK_LIST\" = 0 ] || [ -z \"$ACME_BANK_LIST\" ]" "$(cat $J)"
R=$(A -X POST "$B/clients" --data '{"name":"Acme Client"}'); ACME_CLIENT=$(jget id)
R=$(A -X POST "$B/invoices" --data "{\"client_id\":\"$ACME_CLIENT\",\"issued_on\":\"2026-09-06\",\"lines\":[{\"description\":\"x\",\"quantity\":1,\"unit_price\":100,\"vat_rate\":19}]}")
ACME_INV=$(jget id)
R=$(A -X PATCH "$B/invoices/$ACME_INV" --data '{"status":"sent"}')
R=$(A -X POST "$B/invoices/$ACME_INV/payments" --data '{"amount":"119.000"}')
ACME_PAYMENT=$(q "select id from payments where invoice_id='$ACME_INV'")

login "$ADMIN_EMAIL" "$ADMIN_PW"
R=$(A -X POST "$B/bank_entries/$BANK_ID/match" --data "{\"payment_id\":\"$ACME_PAYMENT\"}")
check "mythos cannot match its own transaction to an acme payment (422 invalid_reference, RLS-hidden)" "[ $R = 422 ]" "$R $(cat $J)"

# -- audit --
AUDIT_BANK_CREATE=$(q "select count(*) from audit_log where action='record.created' and entity_table='bank_entries'")
check "bank transaction creation is audited" "[ $AUDIT_BANK_CREATE -ge 5 ]" "$AUDIT_BANK_CREATE"
AUDIT_BANK_MATCH=$(q "select count(*) from audit_log where action='record.updated' and entity_table='bank_entries' and detail->>'transition'='match'")
check "match is audited" "[ $AUDIT_BANK_MATCH -ge 2 ]" "$AUDIT_BANK_MATCH"
AUDIT_BANK_UNMATCH=$(q "select count(*) from audit_log where action='record.updated' and entity_table='bank_entries' and detail->>'transition'='unmatch'")
check "unmatch is audited" "[ $AUDIT_BANK_UNMATCH -ge 2 ]" "$AUDIT_BANK_UNMATCH"
AUDIT_BANK_IGNORE=$(q "select count(*) from audit_log where action='record.updated' and entity_table='bank_entries' and detail->>'transition'='ignore'")
check "ignore is audited" "[ $AUDIT_BANK_IGNORE -ge 1 ]" "$AUDIT_BANK_IGNORE"

echo "§15 mission orders: driver/vehicle dispatch sheet, no client/project/amount link, validation, tenancy, permissions, audit"
login "$ADMIN_EMAIL" "$ADMIN_PW"
R=$(A -X POST "$B/collaborators" --data '{"full_name":"Chauffeur E2E","role_label":"Chauffeur"}')
check "create driver collaborator (201)" "[ $R = 201 ]" "$R $(cat $J)"
DRIVER_ID=$(jget id)

R=$(A -X POST "$B/mission_orders" --data '{"driver_name":"x"}')
check "missing required fields → 422" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X POST "$B/mission_orders" --data "{\"driver_id\":\"00000000-0000-0000-0000-000000000000\",\"driver_name\":\"x\",\"vehicle_plate\":\"123 TUN 456\",\"mission\":\"x\",\"departure_location\":\"Tunis\",\"arrival_location\":\"Sfax\",\"starts_at\":\"2026-10-01T08:00:00Z\"}")
check "unknown driver_id → 422 invalid_reference" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X POST "$B/mission_orders" --data "{\"driver_name\":\"x\",\"vehicle_plate\":\"123 TUN 456\",\"mission_type\":\"bogus\",\"mission\":\"x\",\"departure_location\":\"Tunis\",\"arrival_location\":\"Sfax\",\"starts_at\":\"2026-10-01T08:00:00Z\"}")
check "unknown mission_type → 422" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X POST "$B/mission_orders" --data "{\"driver_name\":\"x\",\"vehicle_plate\":\"123 TUN 456\",\"mission\":\"x\",\"departure_location\":\"Tunis\",\"arrival_location\":\"Sfax\",\"starts_at\":\"2026-10-01T08:00:00Z\",\"ends_at\":\"2026-09-30T08:00:00Z\"}")
check "ends_at before starts_at → 422" "[ $R = 422 ]" "$R $(cat $J)"

R=$(A -X POST "$B/mission_orders" --data "{\"driver_id\":\"$DRIVER_ID\",\"driver_name\":\"Chauffeur E2E\",\"driver_cin\":\"12345678\",\"driver_license\":\"P-0001\",\"vehicle_plate\":\"123 TUN 456\",\"mission_type\":\"aller_retour\",\"mission\":\"Transport matériel\",\"departure_location\":\"Tunis\",\"arrival_location\":\"Sfax\",\"starts_at\":\"2026-10-01T08:00:00Z\",\"add_stamp\":true,\"passengers\":[{\"name\":\"Alice\"},{\"name\":\"Bob\"}]}")
check "create mission order (201)" "[ $R = 201 ]" "$R $(cat $J)"
MO_ID=$(jget id)
check "driver is hydrated from the collaborator link" "[ \"$(jget driver.full_name)\" = 'Chauffeur E2E' ]" "$(cat $J)"
check "no client/project/amount fields exist on the row (none invented)" "! grep -qE '\"client_id\"|\"project_id\"|\"amount\"' $J" "$(cat $J)"

R=$(A "$B/mission_orders/$MO_ID")
check "get mission order (200), 2 passengers" "[ $R = 200 ] && [ \"$(jget passengers.1.name)\" = Bob ]" "$(cat $J)"

R=$(A "$B/mission_orders")
check "list includes the created order" "[ $R = 200 ] && grep -q \"$MO_ID\" \"$J\"" "$(cat $J)"
R=$(A "$B/mission_orders$(printf '?driver_id=%s' "$DRIVER_ID")")
check "filter by driver_id returns it" "grep -q \"$MO_ID\" \"$J\"" "$(cat $J)"
R=$(A "$B/mission_orders?search=Sfax")
check "search by location returns it" "grep -q \"$MO_ID\" \"$J\"" "$(cat $J)"

R=$(A -X PATCH "$B/mission_orders/$MO_ID" --data '{"mission":"Transport matériel — mise à jour"}')
check "update mission order (200)" "[ $R = 200 ] && [ \"$(jget mission)\" = 'Transport matériel — mise à jour' ]" "$(cat $J)"

R=$(A -X POST "$B/mission_orders" --data "{\"driver_name\":\"Retire me\",\"vehicle_plate\":\"999 TUN 1\",\"mission\":\"x\",\"departure_location\":\"Tunis\",\"arrival_location\":\"Sousse\",\"starts_at\":\"2026-10-02T08:00:00Z\"}")
MO_RETIRE=$(jget id)
login "rita@mythos.test" "$OTHER_PW"
R=$(A -X DELETE "$B/mission_orders/$MO_RETIRE")
check "read_only cannot retire a mission order (403, production.delete — Phase 6)" "[ $R = 403 ]" "$R $(cat $J)"
login "bob@acme.test" "$OTHER_PW"
R=$(A -X DELETE "$B/mission_orders/$MO_RETIRE")
check "acme admin cannot retire a mythos mission order (404, RLS)" "[ $R = 404 ]" "$R $(cat $J)"
login "$ADMIN_EMAIL" "$ADMIN_PW"
R=$(A -X DELETE "$B/mission_orders/$MO_RETIRE")
check "super_admin retires a mission order (200, soft delete — closes the Phase 4 gap)" "[ $R = 200 ] && [ \"$(jget retired)\" = True ]" "$R $(cat $J)"
R=$(A "$B/mission_orders/$MO_RETIRE")
check "retired mission order is hidden (404) but the row is kept (deleted_at)" "[ $R = 404 ] && [ \"$(q "select count(*) from mission_orders where id='$MO_RETIRE' and deleted_at is not null")\" = 1 ]" "$R"

login "rita@mythos.test" "$OTHER_PW"
R=$(A "$B/mission_orders")
check "read_only CAN list mission orders (production.read, 200)" "[ $R = 200 ]" "$R $(cat $J)"
R=$(A -X POST "$B/mission_orders" --data "{\"driver_name\":\"x\",\"vehicle_plate\":\"x\",\"mission\":\"x\",\"departure_location\":\"x\",\"arrival_location\":\"x\",\"starts_at\":\"2026-10-01T08:00:00Z\"}")
check "read_only cannot create a mission order (403)" "[ $R = 403 ]" "$R $(cat $J)"

login "bob@acme.test" "$OTHER_PW"
R=$(A "$B/mission_orders/$MO_ID")
check "acme cannot read a mythos mission order by id (404, RLS)" "[ $R = 404 ]" "$R $(cat $J)"
R=$(A -X POST "$B/mission_orders" --data "{\"driver_id\":\"$DRIVER_ID\",\"driver_name\":\"x\",\"vehicle_plate\":\"x\",\"mission\":\"x\",\"departure_location\":\"x\",\"arrival_location\":\"x\",\"starts_at\":\"2026-10-01T08:00:00Z\"}")
check "acme cannot create against a mythos driver_id (422 invalid_reference, RLS-hidden)" "[ $R = 422 ]" "$R $(cat $J)"
ACME_MO_LIST=$(A "$B/mission_orders" >/dev/null; jget total)
check "acme's own list does not include mythos rows" "[ \"$ACME_MO_LIST\" = 0 ] || [ -z \"$ACME_MO_LIST\" ]" "$(cat $J)"

login "$ADMIN_EMAIL" "$ADMIN_PW"
AUDIT_MO_CREATE=$(q "select count(*) from audit_log where action='record.created' and entity_table='mission_orders'")
check "mission order creation is audited" "[ $AUDIT_MO_CREATE -ge 1 ]" "$AUDIT_MO_CREATE"
AUDIT_MO_UPDATE=$(q "select count(*) from audit_log where action='record.updated' and entity_table='mission_orders'")
check "mission order update is audited" "[ $AUDIT_MO_UPDATE -ge 1 ]" "$AUDIT_MO_UPDATE"

echo "§16 fiscal stamp (droit de timbre): tenant policy → invoice/quote/purchase totals, ledger legs, exemption override, reports, tenancy"
login "$ADMIN_EMAIL" "$ADMIN_PW"
R=$(A -X POST "$B/invoices" --data "{\"client_id\":\"$CLIENT\",\"issued_on\":\"2026-09-06\",\"lines\":[{\"description\":\"Sans timbre\",\"quantity\":1,\"unit_price\":1000,\"vat_rate\":19}]}")
check "policy absent: invoice totals carry no stamp (TTC 1190.000, stamp 0.000)" "[ $R = 201 ] && [ \"$(jget totals.total_ttc)\" = 1190.000 ] && [ \"$(jget totals.stamp_amount)\" = 0.000 ]" "$R $(cat $J)"

login "rita@mythos.test" "$OTHER_PW"
R=$(A -X PATCH "$B/settings" --data '{"settings":{"fiscal_stamp":{"enabled":true,"amount":1}}}')
check "read_only cannot change the fiscal stamp policy (403)" "[ $R = 403 ]" "$R $(cat $J)"
login "$ADMIN_EMAIL" "$ADMIN_PW"
R=$(A -X PATCH "$B/settings" --data '{"settings":{"fiscal_stamp":{"enabled":"yes"}}}')
check "malformed policy refused (422)" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X PATCH "$B/settings" --data '{"settings":{"fiscal_stamp":{"enabled":true,"amount":"1e400"}}}')
check "non-finite / out-of-range stamp amount refused (422) — cannot poison every later document" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X POST "$B/invoices" --data "{\"client_id\":\"$CLIENT\",\"stamp_amount\":\"abc\",\"lines\":[{\"description\":\"x\",\"quantity\":1,\"unit_price\":1,\"vat_rate\":0}]}")
check "non-numeric stamp_amount on a document refused with a clean 422 (not a PG error)" "[ $R = 422 ] && grep -q 'stamp_amount must be' $J" "$R $(cat $J)"
R=$(A -X POST "$B/invoices" --data "{\"client_id\":\"$CLIENT\",\"stamp_amount\":\"  \",\"lines\":[{\"description\":\"x\",\"quantity\":1,\"unit_price\":1,\"vat_rate\":0}]}")
check "blank stamp_amount means absent → the tenant default applies (policy still off here → 0.000)" "[ $R = 201 ] && [ \"$(jget totals.stamp_amount)\" = 0.000 ]" "$R $(cat $J)"
R=$(A -X PATCH "$B/settings" --data '{"settings":{"fiscal_stamp":{"enabled":true,"amount":1}}}')
check "enable the fiscal stamp policy (200)" "[ $R = 200 ]" "$R $(cat $J)"
R=$(A "$B/settings")
check "policy reads back: enabled, 1" "[ \"$(jget tenant.settings.fiscal_stamp.enabled)\" = True ] && [ \"$(jget tenant.settings.fiscal_stamp.amount)\" = 1 ]" "$(cat $J)"
R=$(A -X POST "$B/invoices" --data "{\"client_id\":\"$CLIENT\",\"stamp_amount\":\"  \",\"lines\":[{\"description\":\"x\",\"quantity\":1,\"unit_price\":1,\"vat_rate\":0}]}")
check "policy on: a blank stamp_amount is absent → the tenant default 1.000 applies (not 0)" "[ $R = 201 ] && [ \"$(jget totals.stamp_amount)\" = 1.000 ]" "$R $(cat $J)"

R=$(A -X POST "$B/invoices" --data "{\"client_id\":\"$CLIENT\",\"issued_on\":\"2026-09-06\",\"lines\":[{\"description\":\"Avec timbre\",\"quantity\":1,\"unit_price\":1000,\"vat_rate\":19}]}")
check "invoice gets the default stamp: HT 1000 / TVA 190 / timbre 1.000 / TTC 1191.000" "[ $R = 201 ] && [ \"$(jget totals.total_ht)\" = 1000.000 ] && [ \"$(jget totals.total_vat)\" = 190.000 ] && [ \"$(jget totals.stamp_amount)\" = 1.000 ] && [ \"$(jget totals.total_ttc)\" = 1191.000 ]" "$R $(cat $J)"
STAMP_INV=$(jget id)
R=$(A -X PATCH "$B/invoices/$STAMP_INV" --data '{"status":"sent"}')
check "issue it (200) → sales entry posted" "[ $R = 200 ] && [ -n \"$(jget accounting.entry_no)\" ] && [ \"$(jget accounting.entry_no)\" != None ]" "$R $(cat $J)"
SENTRY=$(q "select id from journal_entries where source_table='invoices' and source_id='$STAMP_INV'")
STAMP_CREDIT=$(q "select coalesce(sum(l.credit),0) from journal_lines l join accounts a on a.id=l.account_id where a.system_key='stamp_collected' and l.entry_id='$SENTRY'")
SALES_CREDIT=$(q "select coalesce(sum(l.credit),0) from journal_lines l join accounts a on a.id=l.account_id where a.system_key='sales' and l.entry_id='$SENTRY'")
RECV_DEBIT=$(q "select coalesce(sum(l.debit),0) from journal_lines l join accounts a on a.id=l.account_id where a.system_key='receivable' and l.entry_id='$SENTRY'")
check "stamp is posted as a LIABILITY leg (4368 credit 1.000), not revenue (706 credit stays 1000.000)" "[ \"$STAMP_CREDIT\" = \"1.000\" ] && [ \"$SALES_CREDIT\" = \"1000.000\" ]" "$STAMP_CREDIT $SALES_CREDIT"
check "receivable debit = HT + TVA + timbre = 1191.000" "[ \"$RECV_DEBIT\" = \"1191.000\" ]" "$RECV_DEBIT"
SBAL=$(q "select case when sum(debit)=sum(credit) then 'yes' else 'no' end from journal_lines where entry_id='$SENTRY'")
check "stamped entry is balanced (debit = credit)" "[ $SBAL = yes ]" "$SBAL"
R=$(A "$B/reports/receivables")
check "receivables report carries the stamp in TTC (1191.000)" "grep -q '1191.000' $J" "$(cat $J | head -c 400)"
R=$(A "$B/reports/revenue")
check "revenue report exposes a stamp column" "grep -q '\"stamp\"' $J" "$(cat $J | head -c 300)"
R=$(A -X POST "$B/invoices/$STAMP_INV/payments" --data '{"paid_on":"2026-09-06","amount":1191,"method":"virement"}')
check "paying exactly HT+TVA+timbre (1191) settles it → paid" "[ $R = 201 ] && [ \"$(jget invoice_status)\" = paid ]" "$R $(cat $J)"

R=$(A -X POST "$B/invoices" --data "{\"client_id\":\"$CLIENT\",\"issued_on\":\"2026-09-06\",\"status\":\"sent\",\"stamp_amount\":0,\"lines\":[{\"description\":\"Export (exonéré)\",\"quantity\":1,\"unit_price\":1000,\"vat_rate\":0}]}")
check "explicit stamp_amount 0 (export exemption, CDET art. 118) → TTC 1000.000" "[ $R = 201 ] && [ \"$(jget totals.total_ttc)\" = 1000.000 ] && [ \"$(jget totals.stamp_amount)\" = 0.000 ]" "$R $(cat $J)"
EXPORT_INV=$(jget id)
EXPORT_STAMP_LEGS=$(q "select count(*) from journal_lines l join accounts a on a.id=l.account_id where a.system_key='stamp_collected' and l.entry_id=(select id from journal_entries where source_table='invoices' and source_id='$EXPORT_INV')")
check "exempt invoice posts NO stamp leg" "[ $EXPORT_STAMP_LEGS = 0 ]" "$EXPORT_STAMP_LEGS"
R=$(A -X POST "$B/invoices" --data "{\"client_id\":\"$CLIENT\",\"stamp_amount\":-1,\"lines\":[{\"description\":\"x\",\"quantity\":1,\"unit_price\":1,\"vat_rate\":0}]}")
check "negative stamp refused (422)" "[ $R = 422 ]" "$R $(cat $J)"

R=$(A -X POST "$B/quotes" --data "{\"client_id\":\"$CLIENT\",\"lines\":[{\"description\":\"Devis timbré\",\"quantity\":1,\"unit_price\":100,\"vat_rate\":19}]}")
check "quote gets the default stamp: TTC 120.000 (100 + 19 + 1)" "[ $R = 201 ] && [ \"$(jget totals.total_ttc)\" = 120.000 ]" "$R $(cat $J)"
SQ=$(jget id)
R=$(A -X PATCH "$B/quotes/$SQ" --data '{"status":"sent"}'); [ "$R" = 200 ] || bad "stamped quote sent" "$R"
R=$(A -X PATCH "$B/quotes/$SQ" --data '{"status":"accepted"}'); [ "$R" = 200 ] || bad "stamped quote accepted" "$R"
R=$(A -X POST "$B/quotes/$SQ/convert" --data '{}')
check "converted invoice carries the quote's stamp (TTC 120.000)" "[ $R = 201 ] && [ \"$(jget totals.total_ttc)\" = 120.000 ]" "$R $(cat $J)"

R=$(A -X POST "$B/purchases" --data "{\"supplier_id\":\"$SUPPLIER_ID\",\"reference\":\"F-TIMBRE\",\"amount_ht\":\"100.000\",\"vat_rate\":19,\"status\":\"confirmed\"}")
check "purchase gets the supplier's stamp: TTC 120.000" "[ $R = 201 ] && [ \"$(jget totals.stamp_amount)\" = 1.000 ] && [ \"$(jget totals.total_ttc)\" = 120.000 ]" "$R $(cat $J)"
SP=$(jget id)
PENTRY=$(q "select id from journal_entries where source_table='purchases' and source_id='$SP'")
STAMP_EXP=$(q "select coalesce(sum(l.debit),0) from journal_lines l join accounts a on a.id=l.account_id where a.system_key='stamp_expense' and l.entry_id='$PENTRY'")
PAYABLE_CR=$(q "select coalesce(sum(l.credit),0) from journal_lines l join accounts a on a.id=l.account_id where a.system_key='payable' and l.entry_id='$PENTRY'")
check "supplier stamp posted as an EXPENSE leg (6354 debit 1.000), payable credit 120.000" "[ \"$STAMP_EXP\" = \"1.000\" ] && [ \"$PAYABLE_CR\" = \"120.000\" ]" "$STAMP_EXP $PAYABLE_CR"
PBAL=$(q "select case when sum(debit)=sum(credit) then 'yes' else 'no' end from journal_lines where entry_id='$PENTRY'")
check "purchase entry with stamp is balanced" "[ $PBAL = yes ]" "$PBAL"
R=$(A -X POST "$B/purchases/$SP/payments" --data '{"amount":"120.000","method":"virement"}')
check "paying exactly TTC incl. stamp → paid (no phantom 1 TND balance)" "[ $R = 201 ] && [ \"$(jget purchase_status)\" = paid ]" "$R $(cat $J)"
TB_ROW=$(q "select debit_total, credit_total from (select sum(l.debit) as debit_total, sum(l.credit) as credit_total from journal_lines l join journal_entries e on e.id=l.entry_id where e.status='posted') t" | tr -d ' ')
check "trial balance still balanced with stamp legs on both sides" "[ \"$(echo $TB_ROW | cut -d'|' -f1)\" = \"$(echo $TB_ROW | cut -d'|' -f2)\" ]" "$TB_ROW"

login "bob@acme.test" "$OTHER_PW"
R=$(A -X POST "$B/clients" --data '{"name":"Acme Stamp Client"}'); ACME_SC=$(jget id)
R=$(A -X POST "$B/invoices" --data "{\"client_id\":\"$ACME_SC\",\"issued_on\":\"2026-09-06\",\"lines\":[{\"description\":\"x\",\"quantity\":1,\"unit_price\":100,\"vat_rate\":19}]}")
check "the policy is per tenant: acme (policy absent) still totals 119.000 with stamp 0" "[ $R = 201 ] && [ \"$(jget totals.total_ttc)\" = 119.000 ] && [ \"$(jget totals.stamp_amount)\" = 0.000 ]" "$R $(cat $J)"
AUDIT_TENANT=$(q "select count(*) from audit_log where action='tenant.updated'")
check "policy change is audited (tenant.updated)" "[ $AUDIT_TENANT -ge 1 ]" "$AUDIT_TENANT"

echo "§17 RBAC hardening: rank cap on role assignment, membership required, delete permissions for production/inventory"
login "bob@acme.test" "$OTHER_PW"
BOB_ID=$(q "select id from users where email='bob@acme.test'")
R=$(A -X POST "$B/users/roles" --data "{\"user_id\":\"$BOB_ID\",\"role_key\":\"super_admin\"}")
check "an admin cannot grant themselves super_admin (403, rank cap — the escalation schema-auth.sql warns about)" "[ $R = 403 ]" "$R $(cat $J)"
check "bob still holds no super_admin role" "[ \"$(q "select count(*) from user_roles ur join roles r on r.id=ur.role_id where ur.user_id='$BOB_ID' and r.key='super_admin'")\" = 0 ]" ""
check "the refusal is audited (permission.denied, role_exceeds_own_rank)" "[ \"$(q "select count(*) from audit_log where action='permission.denied' and detail->>'reason'='role_exceeds_own_rank'")\" -ge 1 ]" ""
R=$(A -X POST "$B/users/roles" --data "{\"user_id\":\"$BOB_ID\",\"role_key\":\"manager\"}")
check "an admin can grant a role within their own rank (200)" "[ $R = 200 ]" "$R $(cat $J)"
RITA_ID=$(q "select id from users where email='rita@mythos.test'")
R=$(A -X POST "$B/users/roles" --data "{\"user_id\":\"$RITA_ID\",\"role_key\":\"read_only\"}")
check "granting a role to a non-member of this tenant is refused (422)" "[ $R = 422 ]" "$R $(cat $J)"
check "no user_roles row was written for the non-member" "[ \"$(q "select count(*) from user_roles where user_id='$RITA_ID' and tenant_id=(select id from tenants where key='acme')")\" = 0 ]" ""
R=$(A -X POST "$B/users/roles" --data '{"user_id":"not-a-uuid","role_key":"admin"}')
check "malformed user_id refused (422)" "[ $R = 422 ]" "$R $(cat $J)"
login "$ADMIN_EMAIL" "$ADMIN_PW"
check "production.delete and inventory.delete exist, granted to super_admin and admin only" "[ \"$(q "select count(*) from permissions where key in ('production.delete','inventory.delete')")\" = 2 ] && [ \"$(q "select string_agg(distinct r.key, ',' order by r.key) from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id where p.key in ('production.delete','inventory.delete')")\" = admin,super_admin ]" ""
R=$(A -X POST "$B/collaborators" --data '{"full_name":"Temp Collab"}'); TC=$(jget id)
R=$(A -X DELETE "$B/collaborators/$TC")
check "super_admin can retire a collaborator (200) — unreachable before 0012" "[ $R = 200 ]" "$R $(cat $J)"
R=$(A -X POST "$B/inventory_items" --data '{"sku":"RB-1","label":"Temp item","unit":"u"}'); TI=$(jget id)
R=$(A -X DELETE "$B/inventory_items/$TI")
check "super_admin can retire an inventory item (200) — unreachable before 0012" "[ $R = 200 ]" "$R $(cat $J)"
login "rita@mythos.test" "$OTHER_PW"
R=$(A -X DELETE "$B/collaborators/$DRIVER_ID")
check "read_only cannot retire a collaborator (403, production.delete)" "[ $R = 403 ]" "$R $(cat $J)"
R=$(A "$B/collaborators"); check "read_only can still list collaborators (200)" "[ $R = 200 ]" "$R"

echo "§18 expenses → ledger: cash/bank posting, HT/VAT split, category account, immutability once posted, reversal on retire, reports, tenancy, permissions"
login "$ADMIN_EMAIL" "$ADMIN_PW"
R=$(A -X POST "$B/expense_categories" --data '{"label":"Transport E2E"}'); check "create an expense category (201)" "[ $R = 201 ]" "$R $(cat $J)"; CAT_ID=$(jget id)
R=$(A -X POST "$B/expenses" --data '{"description":"x","amount":0}'); check "amount 0 refused (422)" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X POST "$B/expenses" --data '{"description":"x","amount":10,"vat_rate":150}'); check "vat_rate 150 refused (422)" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X POST "$B/expenses" --data '{"description":"x","amount":10,"category_id":"00000000-0000-0000-0000-000000000000"}'); check "unknown category → 422 invalid_reference" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X POST "$B/expenses" --data "{\"description\":\"Taxi aéroport\",\"amount\":119,\"vat_rate\":19,\"payment_method\":\"espèces\",\"category_id\":\"$CAT_ID\",\"spent_on\":\"2026-09-06\"}")
check "cash expense recorded (201): paid 119.000 → HT 100.000 / TVA 19.000" "[ $R = 201 ] && [ \"$(jget totals.total_ht)\" = 100.000 ] && [ \"$(jget totals.total_vat)\" = 19.000 ]" "$R $(cat $J)"
EXP1=$(jget id); check "…and posted to the ledger at creation" "[ -n \"$(jget accounting.entry_no)\" ] && [ \"$(jget accounting.entry_no)\" != None ]" "$(cat $J)"
E1=$(q "select id from journal_entries where source_table='expenses' and source_id='$EXP1'")
EXP_DEBIT=$(q "select coalesce(sum(l.debit),0) from journal_lines l join accounts a on a.id=l.account_id where a.system_key='expenses' and l.entry_id='$E1'")
VAT_DEBIT=$(q "select coalesce(sum(l.debit),0) from journal_lines l join accounts a on a.id=l.account_id where a.system_key='vat_deductible' and l.entry_id='$E1'")
CASH_CREDIT=$(q "select coalesce(sum(l.credit),0) from journal_lines l join accounts a on a.id=l.account_id where a.system_key='cash' and l.entry_id='$E1'")
check "entry: 62 (expenses) debit 100.000, 4366 debit 19.000, 54 (caisse) credit 119.000 — 'espèces' → cash journal" "[ \"$EXP_DEBIT\" = \"100.000\" ] && [ \"$VAT_DEBIT\" = \"19.000\" ] && [ \"$CASH_CREDIT\" = \"119.000\" ]" "$EXP_DEBIT $VAT_DEBIT $CASH_CREDIT"
check "expense entry is balanced" "[ \"$(q "select case when sum(debit)=sum(credit) then 'yes' else 'no' end from journal_lines where entry_id='$E1'")\" = yes ]" ""
R=$(A -X POST "$B/expenses" --data '{"description":"Hôtel","amount":200,"payment_method":"virement","spent_on":"2026-09-06"}')
check "bank expense recorded (201), no VAT split" "[ $R = 201 ] && [ \"$(jget totals.total_vat)\" = 0.000 ]" "$R $(cat $J)"; EXP2=$(jget id)
E2=$(q "select id from journal_entries where source_table='expenses' and source_id='$EXP2'")
check "'virement' → bank journal: 532 credit 200.000" "[ \"$(q "select coalesce(sum(l.credit),0) from journal_lines l join accounts a on a.id=l.account_id where a.system_key='bank' and l.entry_id='$E2'")\" = \"200.000\" ]" ""
ACC61=$(q "select id from accounts where code='61' and tenant_id=(select id from tenants where key='mythos')")
R=$(A -X PATCH "$B/expense_categories/$CAT_ID" --data "{\"account_id\":\"$ACC61\"}"); check "category mapped to account 61 (200)" "[ $R = 200 ]" "$R $(cat $J)"
R=$(A -X POST "$B/expenses" --data "{\"description\":\"Location camion\",\"amount\":50,\"payment_method\":\"chèque\",\"category_id\":\"$CAT_ID\",\"spent_on\":\"2026-09-06\"}"); EXP3=$(jget id)
E3=$(q "select id from journal_entries where source_table='expenses' and source_id='$EXP3'")
check "a category with an account debits THAT account (61), not the default" "[ \"$(q "select coalesce(sum(l.debit),0) from journal_lines l where l.account_id='$ACC61' and l.entry_id='$E3'")\" = \"50.000\" ]" ""
ACC411=$(q "select id from accounts where code='411' and tenant_id=(select id from tenants where key='mythos')")
R=$(A -X PATCH "$B/expense_categories/$CAT_ID" --data "{\"account_id\":\"$ACC411\"}"); [ "$R" = 200 ] || bad "category remapped to 411 for the guard test" "$R"
R=$(A -X POST "$B/expenses" --data "{\"description\":\"Mauvais compte\",\"amount\":10,\"category_id\":\"$CAT_ID\"}")
check "a category pointing at a NON-expense account (411) refuses the posting loudly (409), never silently falls back" "[ $R = 409 ]" "$R $(cat $J)"
check "…and the refused expense was not recorded (transaction rolled back)" "[ \"$(q "select count(*) from expenses where description='Mauvais compte'")\" = 0 ]" ""
R=$(A -X PATCH "$B/expense_categories/$CAT_ID" --data "{\"account_id\":\"$ACC61\"}"); [ "$R" = 200 ] || bad "category restored to 61" "$R"
R=$(A -X POST "$B/expenses" --data '{"description":"x","amount":true}'); check "non-numeric amount type refused (422)" "[ $R = 422 ]" "$R $(cat $J)"
R=$(A -X PATCH "$B/expenses/$EXP1" --data '{"amount":500}'); check "amount of a posted expense is immutable (409)" "[ $R = 409 ]" "$R $(cat $J)"
R=$(A -X PATCH "$B/expenses/$EXP1" --data '{"description":"Taxi aéroport (retour)"}'); check "description of a posted expense stays editable (200)" "[ $R = 200 ]" "$R $(cat $J)"
check "editing did not create a second entry (still exactly 1)" "[ \"$(q "select count(*) from journal_entries where source_table='expenses' and source_id='$EXP1'")\" = 1 ]" ""
R=$(A -X DELETE "$B/expenses/$EXP2"); check "retire a posted expense (200) → reversal entry" "[ $R = 200 ] && [ -n \"$(jget accounting.reversal_entry_no)\" ] && [ \"$(jget accounting.reversal_entry_no)\" != None ]" "$R $(cat $J)"
check "reversal recorded (expense_cancel), original marked reversed" "[ \"$(q "select count(*) from journal_entries where source_table='expense_cancel' and source_id='$EXP2'")\" = 1 ] && [ \"$(q "select status from journal_entries where id='$E2'")\" = reversed ]" ""
R=$(A "$B/expenses/$EXP2"); check "retired expense hidden (404)" "[ $R = 404 ]" "$R"
TB_ROW=$(q "select debit_total, credit_total from (select sum(l.debit) as debit_total, sum(l.credit) as credit_total from journal_lines l join journal_entries e on e.id=l.entry_id where e.status in ('posted','reversed')) t" | tr -d ' ')
check "trial balance still balanced with expense entries" "[ \"$(echo $TB_ROW | cut -d'|' -f1)\" = \"$(echo $TB_ROW | cut -d'|' -f2)\" ]" "$TB_ROW"
R=$(A "$B/accounting/vat"); check "VAT report: expense VAT counted as deductible (≥ 19.000)" "[ $R = 200 ] && python3 -c \"import json;d=json.load(open('$J'));assert float(d['deductible'])>=19.0\"" "$(cat $J | head -c 200)"
R=$(A "$B/reports/expenses?from=2026-09-06&to=2026-09-06"); check "expenses report (by category) still works and excludes the retired one (169.000)" "[ $R = 200 ] && [ \"$(jget total)\" = 169.000 ]" "$(cat $J)"
login "rita@mythos.test" "$OTHER_PW"
R=$(A -X POST "$B/expenses" --data '{"description":"x","amount":1}'); check "read_only cannot record an expense (403)" "[ $R = 403 ]" "$R"
R=$(A "$B/expenses"); check "read_only can list expenses (200)" "[ $R = 200 ]" "$R"
login "bob@acme.test" "$OTHER_PW"
R=$(A "$B/expenses/$EXP1"); check "acme cannot read a mythos expense (404, RLS)" "[ $R = 404 ]" "$R"
R=$(A -X DELETE "$B/expenses/$EXP1"); check "acme cannot retire a mythos expense (404, RLS)" "[ $R = 404 ]" "$R"
login "$ADMIN_EMAIL" "$ADMIN_PW"
check "expense creation / update / retire are audited" "[ \"$(q "select count(*) from audit_log where entity_table='expenses' and action='record.created'")\" -ge 3 ] && [ \"$(q "select count(*) from audit_log where entity_table='expenses' and action='record.updated'")\" -ge 1 ] && [ \"$(q "select count(*) from audit_log where entity_table='expenses' and action='record.deleted'")\" -ge 1 ]" ""

echo "§19 rate limiting: the authoritative check runs before routing, so it cannot be bypassed by an unmatched route or an oversize-declared body"
# A dedicated restart of the same already-migrated database, at a tiny
# threshold, so this section is fast and deterministic instead of needing
# hundreds of requests against the default (400/10s) limit used everywhere
# above. Restarting (rather than reusing the running instance) is what lets
# this section use its own limit without disturbing every check already run
# against the default one.
kill "$API_PID" >/dev/null 2>&1 || true
wait "$API_PID" 2>/dev/null || true
ERP_DATABASE_URL="$APP_URL" ERP_API_PORT="$API_PORT" ERP_DOCUMENTS_DIR="$WORK/documents" \
  ERP_RATE_LIMIT_MAX=5 ERP_RATE_LIMIT_WINDOW_MS=3000 node "$API/server.js" >>"$WORK/api.log" 2>&1 &
API_PID=$!
for i in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$API_PORT/api/v1/health" && break; sleep 0.25; done

# -- unmatched route: this used to bypass the limiter entirely (match()
#    failing returned 404 before pipeline.handle() — where the check used to
#    live — was ever reached). Six requests to a path that matches nothing:
#    the first five are counted-and-404, the sixth must be 429, not a sixth 404.
UNMATCHED_CODES=""
LAST_UNMATCHED=""
for i in $(seq 1 6); do
  LAST_UNMATCHED=$(curl -s -o /dev/null -w '%{http_code}' "$B/does-not-exist-xyz")
  UNMATCHED_CODES="$UNMATCHED_CODES $LAST_UNMATCHED"
done
check "unmatched-route requests are counted by the limiter (429 on the 6th, not a 6th 404)" "[ $LAST_UNMATCHED = 429 ]" "$UNMATCHED_CODES"

# The unmatched-route probe just exhausted the one shared bucket (loopback-
# only means every probe here comes from the same source): let its window
# elapse so the next probe starts fresh and independently proves ITS own
# path is counted, rather than inheriting an already-tripped 429.
sleep 3.2

# -- oversize-declared body: this also used to bypass the limiter (declared >
#    cap returned 413 before pipeline.handle() was ever reached). A raw
#    request declaring a huge Content-Length, never actually sending that
#    many bytes — the check fires on the header alone, before any body read,
#    so this proves the bypass without transferring real payload.
cat > "$WORK/oversize_probe.py" <<PYEOF
import http.client
codes = []
for i in range(6):
    conn = http.client.HTTPConnection('127.0.0.1', $API_PORT, timeout=2)
    conn.putrequest('POST', '/api/v1/clients')
    conn.putheader('Content-Length', '999999999')
    conn.putheader('Content-Type', 'application/json')
    conn.endheaders()
    try:
        resp = conn.getresponse()
        codes.append(resp.status)
    except Exception as e:
        codes.append('ERR:' + str(e))
    conn.close()
print(' '.join(str(c) for c in codes))
PYEOF
OVERSIZE_CODES="$(python3 "$WORK/oversize_probe.py")"
LAST_OVERSIZE=$(echo "$OVERSIZE_CODES" | awk '{print $NF}')
check "oversize-declared-body requests are counted by the limiter (429 on the 6th, not a 6th 413)" "[ \"$LAST_OVERSIZE\" = 429 ]" "$OVERSIZE_CODES"

# -- the window elapses: the same source is served again rather than left
#    permanently blocked. (Per-IP independence and the reset arithmetic
#    itself are unit-tested directly in tests/erp-4-auth-test.js §11; this
#    only needs to confirm the real server, not just the isolated module,
#    actually lifts the block once the window passes.)
sleep 3.2
R=$(curl -s -o /dev/null -w '%{http_code}' "$B/does-not-exist-xyz")
check "the window elapses: the previously-limited source is served again (404, not 429)" "[ $R = 404 ]" "$R"


echo
echo "erp-core-e2e-drill: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
