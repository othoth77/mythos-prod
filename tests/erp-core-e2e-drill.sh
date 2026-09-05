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
for f in schema.sql schema-auth.sql schema-tenant.sql 0004-prospects.sql; do
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

ERP_DATABASE_URL="$APP_URL" ERP_API_PORT="$API_PORT" node "$API/server.js" >"$WORK/api.log" 2>&1 &
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

echo
echo "erp-core-e2e-drill: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
