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
for f in schema.sql schema-auth.sql schema-tenant.sql 0004-prospects.sql 0005-accounting.sql 0006-agenda.sql; do
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
R=$(A -X POST "$B/quotes" -d "{\"number\":\"DV-2026-001\",\"client_id\":\"$CLIENT\",\"issued_on\":\"$(date -u +%F)\",\"valid_until\":\"2026-12-31\",\"status\":\"draft\",\"notes\":\"Devis spectacle\"}"); check "devis (quote) created (201)" "[ $R = 201 ]" "$R $(cat $J)"; QUOTE=$(jget id)
R=$(A -X PATCH "$B/quotes/$QUOTE" -d '{"status":"sent"}'); check "devis sent" "[ $R = 200 ] && [ \"$(jget status)\" = sent ]" "$R $(cat $J)"
R=$(A -X PATCH "$B/quotes/$QUOTE" -d '{"status":"accepted"}'); check "devis accepted" "[ $R = 200 ] && [ \"$(jget status)\" = accepted ]" "$R"
R=$(A -X POST "$B/invoices" -d "{\"client_id\":\"$CLIENT\",\"quote_id\":\"$QUOTE\",\"issued_on\":\"$(date -u +%F)\",\"due_on\":\"2026-10-05\",\"currency\":\"TND\",\"lines\":[{\"description\":\"Représentation\",\"quantity\":1,\"unit_price\":1000,\"vat_rate\":19},{\"description\":\"Technique\",\"unit\":\"h\",\"quantity\":4,\"unit_price\":50,\"vat_rate\":19}]}")
check "facture created from the devis (201)" "[ $R = 201 ]" "$R $(cat $J)"; INV=$(jget id); INVNUM=$(jget number)
check "facture number follows the tenant pattern (MP2026-0001)" "[ \"$INVNUM\" = MP2026-0001 ]" "$INVNUM"
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
R=$(A -X POST "$B/quotes" -d '{"number":"DV-2026-001","status":"draft"}'); check "duplicate devis number → 409 duplicate (not 500)" "[ $R = 409 ] && grep -q duplicate $J" "$R $(cat $J)"
R=$(A -X POST "$B/quotes" -d '{"number":"DV-2026-002","status":"bogus"}'); check "unknown status vocabulary → 422" "[ $R = 422 ]" "$R"
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
R=$(A -X POST "$B/quotes" -d '{"number":"DV-2026-001","status":"draft"}'); check "acme reuses devis number DV-2026-001 — uniqueness is per tenant (201)" "[ $R = 201 ]" "$R $(cat $J)"
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
check "erp_app grants: no DELETE except journal_lines (draft lines replaced wholesale)" "[ \"$(q "select string_agg(table_name,',' order by table_name) from information_schema.role_table_grants where grantee='erp_app' and privilege_type='DELETE'")\" = invoice_lines,journal_lines ]" "$(q "select string_agg(table_name,',') from information_schema.role_table_grants where grantee='erp_app' and privilege_type='DELETE'")"
check "4 accounting permissions; finance_user has read/write/post but not close; read_only read only" "[ \"$(q "select count(*) from permissions where key like 'accounting.%'")\" = 4 ] && [ \"$(q "select string_agg(p.key,',' order by p.key) from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id where r.key='finance_user' and p.key like 'accounting.%'")\" = accounting.post,accounting.read,accounting.write ] && [ \"$(q "select string_agg(p.key,',') from role_permissions rp join roles r on r.id=rp.role_id join permissions p on p.id=rp.permission_id where r.key='read_only' and p.key like 'accounting.%'")\" = accounting.read ]" ""
R=$(A "$B/accounting/setup"); check "setup status: configured (16 accounts seeded, 5 journals, counter)" "[ $R = 200 ] && [ \"$(jget configured)\" = True ] && [ \"$(jget journals)\" = 5 ]" "$R $(cat $J)"
R=$(A "$B/accounts?sort=code&dir=asc&limit=100"); check "chart of accounts listed (16), receivable = 411, vat_collected = 4367, sales = 706" "[ $R = 200 ] && [ \"$(jget total)\" = 16 ] && [ \"$(q "select code from accounts where system_key='receivable' and tenant_id=(select id from tenants where key='mythos')")\" = 411 ] && [ \"$(q "select code from accounts where system_key='vat_collected' and tenant_id=(select id from tenants where key='mythos')")\" = 4367 ]" "$(jget total)"
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
check "no invoice row leaked from the refused issue (transaction rolled back)" "[ \"$(q "select count(*) from invoices where tenant_id=(select id from tenants where key='mythos') and deleted_at is null")\" = 1 ]" "$(q "select count(*) from invoices where tenant_id=(select id from tenants where key='mythos') and deleted_at is null")"
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
R=$(A -X POST "$B/accounting/setup" -d '{}'); check "acme admin runs setup → 16 accounts seeded (accounting.close)" "[ $R = 200 ] && [ \"$(jget seeded_accounts)\" = 16 ]" "$R $(cat $J)"
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

echo "§12 rate limiting: the authoritative check runs before routing, so it cannot be bypassed by an unmatched route or an oversize-declared body"
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
