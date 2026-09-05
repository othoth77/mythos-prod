#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# Mythos ERP — recovery/staging import verification (Phases 1-5)
# projects/erp-backend/tests/recovery-test.sh
#
# Proves the recovery mechanism on a SYNTHETIC fixture (never real data):
# backup first, import ALL candidates into the SEPARATE staging collection,
# preserve every field, no dedup, no delete, official invoices (017/018)
# untouched, provenance + RECOVERY_REVIEW intact, 007/008 both preserved,
# and a KEEP/DELETE/MERGE decision round-trips non-destructively.
# ══════════════════════════════════════════════════════════════════════
set -u
cd "$(dirname "$0")/.."          # projects/erp-backend
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
export ERP_DB_DRIVER=sqlite ERP_DB_PATH="$WORK/erp.db" ERP_UPLOAD_DIR="$WORK/uploads"
mkdir -p "$ERP_UPLOAD_DIR"
FIX="tests/fixtures/recovery-sample.json"
PASS=0; FAIL=0
ok(){ if [ "$1" = "$2" ]; then PASS=$((PASS+1)); echo "  PASS $3 ($1)"; else FAIL=$((FAIL+1)); echo "  FAIL $3 (want $2 got $1)"; fi; }
Q(){ php -r '$p=new PDO("sqlite:".getenv("ERP_DB_PATH"));$s=$p->query($argv[1]);echo $s?($s->fetchColumn()):"";' "$1"; }
J(){ php -r '$p=new PDO("sqlite:".getenv("ERP_DB_PATH"));$r=$p->query("SELECT data FROM collections WHERE key=\"".$argv[1]."\"")->fetchColumn();$d=json_decode($r?:"[]",true);echo $argv[2]==="count"?count($d):json_encode($d);' "$1" "$2"; }

ERP_NEW_PASSWORD='adminPass123!' php cli/create-user.php admin admin A >/dev/null

echo "0. Seed OFFICIAL invoices 017/018 (must never be overwritten)"
php -r '$p=new PDO("sqlite:".getenv("ERP_DB_PATH"));$off=[["id"=>"cur017","num"=>"2026/017","ttc"=>1700.0,"client"=>"REAL 017"],["id"=>"cur018","num"=>"2026/018","ttc"=>1800.0,"client"=>"REAL 018"]];$s=$p->prepare("INSERT INTO collections(key,data,version,updated_at) VALUES (?,?,?,?)");$s->execute(["mp_invoices",json_encode($off),5,"2026-08-28T00:00:00Z"]);'
OFF_BEFORE="$(J mp_invoices json)"
ok "$(J mp_invoices count)" 2 "official mp_invoices seeded (017/018)"

echo "1. BACKUP before migration (Phase 1)"
SET="$(php cli/backup.php "$WORK/backups")"
ok "$([ -f "$SET/manifest.json" ] && echo yes || echo no)" yes "pre-import backup created + checksummed"

echo "2. Import ALL candidates into the SEPARATE recovery collection (Phase 2)"
php cli/import-recovery.php "$FIX" admin > "$WORK/imp.txt" 2>&1
ok "$(grep -c 'recovery import ok: 26' "$WORK/imp.txt")" 1 "26 candidates imported"
ok "$(grep -c '8 flagged duplicateCandidate' "$WORK/imp.txt")" 1 "8 duplicateCandidate flagged (no silent dedup)"
ok "$(J mp_invoices_recovery count)" 26 "recovery collection holds all 26"

echo "3. Official invoices 017/018 UNTOUCHED (Phase 3/4)"
ok "$(J mp_invoices json)" "$OFF_BEFORE" "official mp_invoices byte-for-byte unchanged"
ok "$(J mp_invoices count)" 2 "still exactly 2 official invoices"

echo "4. Preservation: every field + provenance + status (Phase 4)"
ok "$(php -r '$p=new PDO("sqlite:".getenv("ERP_DB_PATH"));$d=json_decode($p->query("SELECT data FROM collections WHERE key=\"mp_invoices_recovery\"")->fetchColumn(),true);$n=0;foreach($d as $r){if(($r["recoveryStatus"]??"")==="RECOVERY_REVIEW")$n++;}echo $n;')" 26 "all 26 tagged RECOVERY_REVIEW"
ok "$(php -r '$p=new PDO("sqlite:".getenv("ERP_DB_PATH"));$d=json_decode($p->query("SELECT data FROM collections WHERE key=\"mp_invoices_recovery\"")->fetchColumn(),true);$n=0;foreach($d as $r){if(isset($r["ht"],$r["ttc"],$r["lines"],$r["source"],$r["assessment"])&&!empty($r["originalId"]))$n++;}echo $n;')" 26 "all financial/line/source/provenance fields preserved"

echo "5. Verification tool (Phase 5): 001-018 represented, 007/008 dual"
php cli/verify-recovery.php > "$WORK/ver.txt" 2>&1; VRC=$?
ok "$VRC" 0 "verify-recovery passes (all 001-018 represented; provenance+status intact)"
ok "$(grep -c '007  official:0  recovery:2' "$WORK/ver.txt")" 1 "007 both candidates preserved"
ok "$(grep -c '008  official:0  recovery:2' "$WORK/ver.txt")" 1 "008 both candidates preserved"

echo "6. Review decision round-trips non-destructively (Phase 7)"
# Mark the first 007 candidate KEEP via a normal collection write (as the review UI does).
php -r '$p=new PDO("sqlite:".getenv("ERP_DB_PATH"));$row=$p->query("SELECT data,version FROM collections WHERE key=\"mp_invoices_recovery\"")->fetch();$d=json_decode($row["data"],true);foreach($d as &$r){if(($r["num"]??"")==="2026/007"&&($r["source"]??"")==="candidateA"){$r["reviewDecision"]="KEEP";break;}}$p->prepare("UPDATE collections SET data=?,version=? WHERE key=\"mp_invoices_recovery\"")->execute([json_encode($d),$row["version"]+1]);'
ok "$(php -r '$p=new PDO("sqlite:".getenv("ERP_DB_PATH"));$d=json_decode($p->query("SELECT data FROM collections WHERE key=\"mp_invoices_recovery\"")->fetchColumn(),true);$k=0;foreach($d as $r){if(($r["reviewDecision"]??null)==="KEEP")$k++;}echo $k;')" 1 "a KEEP decision is recorded"
ok "$(J mp_invoices_recovery count)" 26 "nothing deleted — still 26 after the decision"

echo
echo "RECOVERY-TEST: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
