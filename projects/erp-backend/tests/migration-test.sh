#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# Mythos ERP — localStorage → DB migration verification (§7)
# projects/erp-backend/tests/migration-test.sh
#
# Imports a representative export via the existing import-localstorage.php
# tool and verifies: valid collections imported, IDs/dates/financial values
# preserved, invalid/unknown/traversal keys rejected safely, re-import bumps
# the version (idempotent, non-destructive), audit rows recorded.
# ══════════════════════════════════════════════════════════════════════
set -u
cd "$(dirname "$0")/.."          # projects/erp-backend
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
export ERP_DB_DRIVER=sqlite ERP_DB_PATH="$WORK/erp.db"
PASS=0; FAIL=0
ok(){ if [ "$1" = "$2" ]; then PASS=$((PASS+1)); echo "  PASS $3 ($1)"; else FAIL=$((FAIL+1)); echo "  FAIL $3 (want $2 got $1)"; fi; }

cat > "$WORK/export.json" <<'JSON'
{
  "mp_invoices": [{"id":"inv_2026_006","date":"2026-08-02","ht":100.5,"tva":7,"ttc":108.535,"clientName":"Théâtre X"}],
  "mp_clients":  [{"id":"c1","name":"Client < One >","mf":"1358425MPM000"}],
  "mp_call_script": "Bonjour, ceci est le script.",
  "bad_key": [1,2,3],
  "mp_rdtpl_../../etc/passwd": ["traversal"],
  "mp_rdtpl_valid1": [{"id":"t1"}]
}
JSON

php cli/import-localstorage.php "$WORK/export.json" migration > "$WORK/out.txt" 2>&1
ok "$(grep -c 'imported 4' "$WORK/out.txt")" 1 "4 valid collections imported"
ok "$(grep -c 'bad_key' "$WORK/out.txt")" 1 "unknown key reported as skipped"
ok "$(grep -c 'passwd' "$WORK/out.txt")" 1 "traversal key reported as skipped"

Q(){ php -r '$p=new PDO("sqlite:".getenv("ERP_DB_PATH"));echo $p->query($argv[1])->fetchColumn();' "$1"; }
ok "$(Q "SELECT COUNT(*) FROM collections")" 4 "exactly 4 collections stored"
ok "$(Q "SELECT COUNT(*) FROM collections WHERE key='bad_key' OR key LIKE '%passwd%'")" 0 "invalid keys not stored"
# financial value + id preserved exactly
ok "$(Q "SELECT json_extract(data,'\$[0].ttc') FROM collections WHERE key='mp_invoices'")" "108.535" "financial value preserved"
ok "$(Q "SELECT json_extract(data,'\$[0].id') FROM collections WHERE key='mp_invoices'")" "inv_2026_006" "id preserved"
ok "$(Q "SELECT json_extract(data,'\$[0].date') FROM collections WHERE key='mp_invoices'")" "2026-08-02" "date preserved"
ok "$(Q "SELECT version FROM collections WHERE key='mp_invoices'")" 1 "first import -> version 1"

# Re-import must be non-destructive (bump version, never delete) — reversibility
php cli/import-localstorage.php "$WORK/export.json" migration >/dev/null 2>&1
ok "$(Q "SELECT version FROM collections WHERE key='mp_invoices'")" 2 "re-import -> version 2 (non-destructive)"
ok "$([ "$(Q "SELECT COUNT(*) FROM audit_log WHERE action='import'")" -ge 8 ] && echo yes || echo no)" yes "import actions audited"

echo
echo "MIGRATION-TEST: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
