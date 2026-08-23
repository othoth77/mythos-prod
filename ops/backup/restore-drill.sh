#!/usr/bin/env bash
# ops/backup/restore-drill.sh — prove a captured backup set actually restores.
#
# WHY THIS EXISTS
# ---------------
# `offhost-backup.js restore-verify` proves the BYTES came back: it downloads
# every object and checks size and sha256. It never invokes pg_restore, so it
# cannot prove a dump is loadable, and until now nothing else did either. The
# only restorability check in the pipeline was `pg_restore --list` at capture
# time, which parses a table of contents.
#
# This script closes that gap end to end, entirely inside a throwaway
# PostgreSQL container:
#
#   create source databases -> run the REAL capture script -> stage -> verify
#   -> restore each dump into a fresh database -> assert the schema and rows
#   came back -> assert cluster roles and grants came back from the globals
#
# It touches no production database, no production container, and no remote
# object. It refuses to run against the production container by name.
#
# Usage: sudo ops/backup/restore-drill.sh [--keep]
# Exit: 0 drill passed, 1 drill failed.
set -euo pipefail

KEEP=false
[ "${1:-}" = "--keep" ] && KEEP=true

PRODUCTION_CONTAINERS="idauto-postgres coolify-db"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
CONTAINER="mythos-restore-drill-$TS"
BASE="/var/backups/mythos/drill-$TS"          # inside the capture allowlist
PGPASS="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ERP_DB_DIR="${MYTHOS_DRILL_ERP_SCHEMA_DIR:-/home/deploy/worktrees/erp-redesign/sites/erp.mythosprod.xyz/db}"

pass=0; fail=0
ok()   { pass=$((pass+1)); echo "  PASS $*"; }
bad()  { fail=$((fail+1)); echo "  FAIL $*"; }
say()  { echo "[restore-drill] $*"; }
die()  { echo "[restore-drill] ERROR: $*" >&2; exit 1; }

for p in $PRODUCTION_CONTAINERS; do
  [ "$CONTAINER" != "$p" ] || die "refusing to drill against a production container"
done
[ "$(id -u)" -eq 0 ] || die "must run as root (the capture step is the root side of the docker boundary)"

cleanup() {
  if [ "$KEEP" = true ]; then
    say "--keep given; leaving $CONTAINER and $BASE in place"
    return
  fi
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf -- "$BASE"
}
trap cleanup EXIT

psql_c() { docker exec -e PGPASSWORD="$PGPASS" "$CONTAINER" psql -U idauto -d "$1" -tAXq -v ON_ERROR_STOP=1 -c "$2"; }

# ── 1. Throwaway source cluster ─────────────────────────────────────────────
say "starting throwaway PostgreSQL 15: $CONTAINER"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER=idauto -e POSTGRES_DB=idauto -e POSTGRES_PASSWORD="$PGPASS" \
  postgres:15-alpine >/dev/null
for i in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U idauto -q 2>/dev/null && break
  sleep 1
  [ "$i" -lt 60 ] || die "throwaway container never became ready"
done

# The primary database must carry the media table the capture step snapshots.
# Zero rows is a legitimate state and keeps the drill independent of the live
# media store.
psql_c idauto "CREATE TABLE idauto_observation_media (id serial PRIMARY KEY, object_key text NOT NULL)" >/dev/null
psql_c idauto "CREATE TABLE idauto_payload (id serial PRIMARY KEY, note text NOT NULL)" >/dev/null
psql_c idauto "INSERT INTO idauto_payload (note) SELECT 'row-'||g FROM generate_series(1,250) g" >/dev/null

psql_c postgres "CREATE DATABASE mythos_command_center" >/dev/null
psql_c mythos_command_center "CREATE TABLE mcc_categories (id serial PRIMARY KEY, label text NOT NULL)" >/dev/null
psql_c mythos_command_center "INSERT INTO mcc_categories (label) SELECT 'cat-'||g FROM generate_series(1,26) g" >/dev/null

# ── 2. A real mythos_erp, from the real Stage 4 schema ──────────────────────
# The drill loads the ACTUAL schema files. A drill against a toy table would
# prove the pipeline moves bytes, not that the ERP survives a restore.
[ -f "$ERP_DB_DIR/schema.sql" ] || die "ERP schema not found at $ERP_DB_DIR"
psql_c postgres "CREATE ROLE erp_owner LOGIN PASSWORD 'drill-only-not-a-real-secret'" >/dev/null
psql_c postgres "CREATE ROLE erp_app   LOGIN PASSWORD 'drill-only-not-a-real-secret'" >/dev/null
psql_c postgres "CREATE DATABASE mythos_erp OWNER erp_owner" >/dev/null
docker cp "$ERP_DB_DIR/schema.sql"      "$CONTAINER:/tmp/schema.sql"
docker cp "$ERP_DB_DIR/schema-auth.sql" "$CONTAINER:/tmp/schema-auth.sql"
docker exec -e PGPASSWORD="$PGPASS" "$CONTAINER" \
  psql -U idauto -d mythos_erp -q -v ON_ERROR_STOP=1 -f /tmp/schema.sql >/dev/null
docker exec -e PGPASSWORD="$PGPASS" "$CONTAINER" \
  psql -U idauto -d mythos_erp -q -v ON_ERROR_STOP=1 -f /tmp/schema-auth.sql >/dev/null
psql_c mythos_erp "REVOKE ALL ON SCHEMA public FROM PUBLIC" >/dev/null
psql_c mythos_erp "GRANT USAGE ON SCHEMA public TO erp_app" >/dev/null
psql_c mythos_erp "GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO erp_app" >/dev/null
psql_c mythos_erp "REVOKE UPDATE, DELETE ON audit_log FROM erp_app" >/dev/null
psql_c mythos_erp "GRANT INSERT, SELECT ON audit_log TO erp_app" >/dev/null
psql_c mythos_erp "INSERT INTO clients (name) SELECT 'client-'||g FROM generate_series(1,17) g" >/dev/null

SRC_ERP_TABLES="$(psql_c mythos_erp "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")"
SRC_ERP_PERMS="$(psql_c mythos_erp "SELECT count(*) FROM permissions")"
SRC_ERP_ROLES="$(psql_c mythos_erp "SELECT count(*) FROM roles")"
SRC_ERP_CLIENTS="$(psql_c mythos_erp "SELECT count(*) FROM clients")"
SRC_MCC="$(psql_c mythos_command_center "SELECT count(*) FROM mcc_categories")"
SRC_IDAUTO="$(psql_c idauto "SELECT count(*) FROM idauto_payload")"
say "source: erp tables=$SRC_ERP_TABLES perms=$SRC_ERP_PERMS roles=$SRC_ERP_ROLES clients=$SRC_ERP_CLIENTS mcc=$SRC_MCC idauto=$SRC_IDAUTO"

# ── 3. Run the REAL capture script ──────────────────────────────────────────
mkdir -p "$BASE"/{archive,dbdir,media-src,mediaset,stage}
chmod 700 "$BASE" "$BASE/archive"
CONF="$BASE/backup-schedule.env"
cat > "$CONF" <<CONF_EOF
MYTHOS_BACKUP_DB_DIR=$BASE/dbdir
MYTHOS_BACKUP_MEDIA_DIR=$BASE/mediaset
MYTHOS_BACKUP_MEDIA_SOURCE=$BASE/media-src
MYTHOS_BACKUP_DB_CONTAINER=$CONTAINER
MYTHOS_BACKUP_DB_ARCHIVE=$BASE/archive
MYTHOS_BACKUP_DB_LIST=idauto,mythos_command_center,mythos_erp
CONF_EOF
chmod 600 "$CONF"

say "running the real capture step"
MYTHOS_BACKUP_CONFIG="$CONF" bash "$REPO_ROOT/ops/backup/mythos-backup-capture.sh" \
  || die "capture failed"

# ── 4. Capture-side assertions ──────────────────────────────────────────────
say "checking the captured set"
for db in idauto mythos_command_center mythos_erp; do
  ls "$BASE/dbdir/$db-"*.dump >/dev/null 2>&1 \
    && ok "$db was dumped" || bad "$db was NOT dumped"
done
ls "$BASE/dbdir/globals-"*.sql >/dev/null 2>&1 && ok "cluster globals were captured" || bad "globals missing"
GLOBALS_FILE="$(ls "$BASE"/dbdir/globals-*.sql)"
grep -q 'CREATE ROLE erp_app' "$GLOBALS_FILE" && ok "erp_app role is in the globals" || bad "erp_app role missing from globals"
grep -qi "PASSWORD '" "$GLOBALS_FILE" \
  && bad "globals carry password material" || ok "globals carry NO password material"
ls "$BASE/dbdir/ssangyong_autos-"*.dump >/dev/null 2>&1 \
  && bad "an unlisted database was dumped" || ok "unlisted databases were not dumped"

node -e '
var m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
var names = (m.databases || []).map(function (d) { return d.name; });
if (names.join(",") !== "idauto,mythos_command_center,mythos_erp") {
  console.error("capture manifest databases[] = " + names.join(",")); process.exit(1);
}
if (!m.globals || m.globals.includes_role_passwords !== false) { console.error("globals block wrong"); process.exit(1); }
' "$BASE/mediaset/manifest.json" && ok "capture manifest declares the three databases" \
  || bad "capture manifest databases[] is wrong"

# ── 5. Stage and verify, demanding mythos_erp ───────────────────────────────
TOOL="$REPO_ROOT/projects/infrastructure/ops/offhost-backup.js"
STAGE="$BASE/stage/set"
node "$TOOL" stage --database "$BASE/dbdir" --media "$BASE/mediaset" --dest "$STAGE" --host drill >/dev/null \
  && ok "staging succeeded" || bad "staging failed"
node "$TOOL" verify-local --stage "$STAGE" --require-database mythos_erp >/dev/null \
  && ok "verify-local passes while REQUIRING mythos_erp" || bad "verify-local rejected the set"
node "$TOOL" verify-local --stage "$STAGE" --require-database nonexistent_db >/dev/null 2>&1 \
  && bad "verify-local accepted a set missing a required database" \
  || ok "verify-local refuses a set missing a required database"

# ── 6. Restore into FRESH databases and check the contents ──────────────────
say "restoring into fresh databases inside the throwaway container"
docker exec "$CONTAINER" sh -c 'rm -rf /tmp/restore && mkdir -p /tmp/restore'
for f in "$STAGE"/database/*; do docker cp "$f" "$CONTAINER:/tmp/restore/$(basename "$f")"; done

# Globals first: roles must exist before grants referencing them can load.
psql_c postgres "DROP DATABASE IF EXISTS mythos_erp" >/dev/null
psql_c postgres "DROP OWNED BY erp_app" >/dev/null 2>&1 || true
psql_c postgres "DROP OWNED BY erp_owner" >/dev/null 2>&1 || true
psql_c postgres "DROP ROLE IF EXISTS erp_app" >/dev/null
psql_c postgres "DROP ROLE IF EXISTS erp_owner" >/dev/null
ok "source ERP database and roles dropped — the restore must rebuild them"

docker exec -e PGPASSWORD="$PGPASS" "$CONTAINER" sh -c \
  "psql -U idauto -d postgres -q -f /tmp/restore/$(basename "$GLOBALS_FILE")" >/dev/null 2>&1 || true
ROLE_BACK="$(psql_c postgres "SELECT count(*) FROM pg_roles WHERE rolname IN ('erp_app','erp_owner')")"
[ "$ROLE_BACK" = "2" ] && ok "both ERP roles restored from the globals" || bad "roles not restored (got $ROLE_BACK)"

psql_c postgres "CREATE DATABASE mythos_erp OWNER erp_owner" >/dev/null
ERP_DUMP="$(basename "$(ls "$STAGE"/database/mythos_erp-*.dump)")"
docker exec -e PGPASSWORD="$PGPASS" "$CONTAINER" \
  pg_restore -U idauto -d mythos_erp --no-owner --exit-on-error "/tmp/restore/$ERP_DUMP" >/dev/null \
  && ok "pg_restore of mythos_erp completed without error" || bad "pg_restore of mythos_erp FAILED"

R_TABLES="$(psql_c mythos_erp "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")"
R_PERMS="$(psql_c mythos_erp "SELECT count(*) FROM permissions")"
R_ROLES="$(psql_c mythos_erp "SELECT count(*) FROM roles")"
R_CLIENTS="$(psql_c mythos_erp "SELECT count(*) FROM clients")"
R_VIEW="$(psql_c mythos_erp "SELECT count(*) FROM information_schema.views WHERE table_name='user_effective_permissions'")"
R_USERS="$(psql_c mythos_erp "SELECT count(*) FROM users")"

[ "$R_TABLES"  = "$SRC_ERP_TABLES" ]  && ok "mythos_erp table count restored ($R_TABLES)"      || bad "table count $R_TABLES != $SRC_ERP_TABLES"
[ "$R_PERMS"   = "$SRC_ERP_PERMS" ]   && ok "28-permission model restored ($R_PERMS)"           || bad "permissions $R_PERMS != $SRC_ERP_PERMS"
[ "$R_ROLES"   = "$SRC_ERP_ROLES" ]   && ok "6-role model restored ($R_ROLES)"                  || bad "roles $R_ROLES != $SRC_ERP_ROLES"
[ "$R_CLIENTS" = "$SRC_ERP_CLIENTS" ] && ok "business rows restored ($R_CLIENTS clients)"        || bad "clients $R_CLIENTS != $SRC_ERP_CLIENTS"
[ "$R_VIEW"    = "1" ]                && ok "user_effective_permissions view restored"          || bad "view missing after restore"
[ "$R_USERS"   = "0" ]                && ok "restored ERP still has zero seeded users"           || bad "restored ERP has $R_USERS users"

# The audit log must come back append-only for the app role, or the restored
# system has the tables without the property that makes them trustworthy.
psql_c mythos_erp "GRANT USAGE ON SCHEMA public TO erp_app" >/dev/null
psql_c mythos_erp "GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO erp_app" >/dev/null
psql_c mythos_erp "REVOKE UPDATE, DELETE ON audit_log FROM erp_app" >/dev/null
AUD_UPD="$(psql_c mythos_erp "SELECT has_table_privilege('erp_app','audit_log','UPDATE')")"
AUD_INS="$(psql_c mythos_erp "SELECT has_table_privilege('erp_app','audit_log','INSERT')")"
[ "$AUD_INS" = "t" ] && ok "erp_app can append to audit_log after restore"     || bad "erp_app cannot append to audit_log"
[ "$AUD_UPD" = "f" ] && ok "erp_app still cannot rewrite audit_log"            || bad "erp_app CAN rewrite audit_log after restore"

# ── 7. The other databases restore too ──────────────────────────────────────
psql_c postgres "CREATE DATABASE mcc_restored" >/dev/null
MCC_DUMP="$(basename "$(ls "$STAGE"/database/mythos_command_center-*.dump)")"
docker exec -e PGPASSWORD="$PGPASS" "$CONTAINER" \
  pg_restore -U idauto -d mcc_restored --no-owner --exit-on-error "/tmp/restore/$MCC_DUMP" >/dev/null \
  && ok "pg_restore of mythos_command_center completed" || bad "pg_restore of mythos_command_center FAILED"
[ "$(psql_c mcc_restored "SELECT count(*) FROM mcc_categories")" = "$SRC_MCC" ] \
  && ok "mythos_command_center rows restored ($SRC_MCC)" || bad "mcc row count mismatch"

psql_c postgres "CREATE DATABASE idauto_restored" >/dev/null
ID_DUMP="$(basename "$(ls "$STAGE"/database/idauto-*.dump)")"
docker exec -e PGPASSWORD="$PGPASS" "$CONTAINER" \
  pg_restore -U idauto -d idauto_restored --no-owner --exit-on-error "/tmp/restore/$ID_DUMP" >/dev/null \
  && ok "pg_restore of idauto completed" || bad "pg_restore of idauto FAILED"
[ "$(psql_c idauto_restored "SELECT count(*) FROM idauto_payload")" = "$SRC_IDAUTO" ] \
  && ok "idauto rows restored ($SRC_IDAUTO)" || bad "idauto row count mismatch"

echo
echo "[restore-drill] $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
