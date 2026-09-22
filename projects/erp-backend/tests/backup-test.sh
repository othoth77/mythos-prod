#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# Mythos ERP — backup / restore verification (§17)
# projects/erp-backend/tests/backup-test.sh
#
# A backup that cannot be restored is NOT verified. This seeds data + an
# uploaded file, snapshots (backup.php), DESTROYS the live DB and uploads,
# restores (restore.php), and asserts everything came back intact and that a
# tampered snapshot is refused.
# ══════════════════════════════════════════════════════════════════════
set -u
cd "$(dirname "$0")/.."          # projects/erp-backend
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
export ERP_DB_DRIVER=sqlite ERP_DB_PATH="$WORK/erp.db" ERP_UPLOAD_DIR="$WORK/uploads"
mkdir -p "$ERP_UPLOAD_DIR"
PASS=0; FAIL=0
ok(){ if [ "$1" = "$2" ]; then PASS=$((PASS+1)); echo "  PASS $3 ($1)"; else FAIL=$((FAIL+1)); echo "  FAIL $3 (want $2 got $1)"; fi; }
Q(){ php -r '$p=new PDO("sqlite:".getenv("ERP_DB_PATH"));echo $p->query($argv[1])->fetchColumn();' "$1"; }

# Seed: a user + a collection + an uploaded document file.
ERP_NEW_PASSWORD='adminPass123!' php cli/create-user.php admin admin "Admin" >/dev/null
php -r '$p=new PDO("sqlite:".getenv("ERP_DB_PATH"));$s=$p->prepare("INSERT INTO collections(key,data,version,updated_at) VALUES (?,?,?,?)");$s->execute(["mp_invoices",json_encode([["id"=>"inv_1","ttc"=>111]]),1,"2026-08-28T00:00:00Z"]);'
echo "document-bytes" > "$ERP_UPLOAD_DIR/doc1.txt"

BEFORE_COLL="$(Q "SELECT data FROM collections WHERE key='mp_invoices'")"
BEFORE_USERS="$(Q "SELECT COUNT(*) FROM users")"

echo "1. Backup produces a verifiable set"
SET="$(php cli/backup.php "$WORK/backups")"
ok "$([ -f "$SET/manifest.json" ] && echo yes || echo no)" yes "manifest written"
ok "$([ -f "$SET/erp.db" ] && echo yes || echo no)" yes "db snapshot present"
ok "$(grep -c 'uploads/doc1.txt' "$SET/manifest.json")" 1 "upload checksummed in manifest"

echo "2. Disaster: destroy the live DB and uploads"
rm -f "$ERP_DB_PATH" "$ERP_DB_PATH-wal" "$ERP_DB_PATH-shm"; rm -rf "$ERP_UPLOAD_DIR"; mkdir -p "$ERP_UPLOAD_DIR"
ok "$([ -f "$ERP_DB_PATH" ] && echo yes || echo no)" no "live DB gone"

echo "3. Restore from the snapshot"
php cli/restore.php "$SET" >/dev/null
ok "$(Q "SELECT COUNT(*) FROM users")" "$BEFORE_USERS" "users restored"
ok "$(Q "SELECT data FROM collections WHERE key='mp_invoices'")" "$BEFORE_COLL" "collection data restored byte-for-byte"
ok "$(cat "$ERP_UPLOAD_DIR/doc1.txt" 2>/dev/null)" "document-bytes" "uploaded document restored"

echo "4. A tampered snapshot is refused (fail-closed)"
echo "corrupted" >> "$SET/erp.db"
php cli/restore.php "$SET" >/dev/null 2>&1
ok "$?" 1 "restore of a checksum-mismatched set exits non-zero"

echo
echo "BACKUP-TEST: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
