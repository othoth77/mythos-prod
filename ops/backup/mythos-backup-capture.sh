#!/usr/bin/env bash
# ops/backup/mythos-backup-capture.sh — ROOT-SIDE capture step for the Mythos
# off-host backup system.
#
# WHY THIS EXISTS
# ---------------
# The off-host tooling (projects/infrastructure/ops/offhost-backup.js) backs up
# *file artefacts with a manifest*. It does not produce database dumps — it
# carries them (docs/OFF_HOST_BACKUP_GATE.md §0). The dump itself must run with
# `docker exec` inside the source container (§1: the PostgreSQL servers differ
# by minor version, so an external client cannot safely serve them, and the
# credentials stay in the container's own environment). Docker access is root
# access; the scheduled pipeline deliberately runs as the unprivileged `deploy`
# user, and `deploy` is deliberately NOT in the docker group.
#
# This script is therefore the ROOT SIDE of that boundary, and nothing more:
# it produces the two INPUTS the deploy-side pipeline consumes, hands them over
# owned by `deploy`, and exits. It never uploads, never reads a remote
# credential, never deletes a dump, a staged set or a remote object.
#
#   input 1  $MYTHOS_BACKUP_DB_DIR/<one dump>   — pg_dump -Fc, taken in-container
#   input 2  $MYTHOS_BACKUP_MEDIA_DIR/          — the IDAUTO-STORAGE-OPS media
#            backup-set format the tool consumes: manifest.json +
#            checksums.sha256 + media/aa/bb/<sha256>
#
# It is installed root-owned outside the repository (/usr/local/sbin, 0700) and
# executed by mythos-backup-capture.service, which is ordered Before= and
# required by mythos-backup.service — the mythos-git-push relay pattern. Root
# never executes this file from the deploy-writable checkout.
#
# Capture ORDER IS LOAD-BEARING and is enforced, not assumed: database metadata
# snapshot (REPEATABLE READ READ ONLY) -> database dump -> media copy. The
# reverse order is unsafe (a row committing mid-copy could reference a file
# created after the directory was walked), and offhost-backup.js refuses a set
# whose database capture is newer than its media capture.
#
# Exit codes: 0 clean, 1 environment/capture failure (fail-closed — the
# deploy-side unit Requires= this one, so a failed capture stops the backup
# rather than shipping a stale or half-built input).
set -euo pipefail

CONFIG_FILE="${MYTHOS_BACKUP_CONFIG:-/home/deploy/.config/mythos/backup-schedule.env}"
OWNER="${MYTHOS_BACKUP_OWNER:-deploy}"
LOG_PREFIX="[mythos-backup-capture]"

say()  { echo "$LOG_PREFIX $*"; }
# `date +%3N` is not honoured everywhere (it can emit full nanoseconds), and the
# manifest timestamp is parsed downstream — truncate to milliseconds explicitly.
iso_ms() { date -u "$@" +%Y-%m-%dT%H:%M:%S.%N | sed -E 's/^(.{23}).*$/\1Z/'; }
fail() { echo "$LOG_PREFIX ERROR: $*" >&2; exit 1; }

TMP_FILES=()
cleanup() { [ "${#TMP_FILES[@]}" -eq 0 ] || rm -rf -- "${TMP_FILES[@]}"; }
trap cleanup EXIT

[ "$(id -u)" -eq 0 ] || fail "must run as root (this is the root side of the docker boundary)"
[ -f "$CONFIG_FILE" ] || fail "config not found: $CONFIG_FILE (operator must create it, 0600)"

# The operator config declares WHAT to capture and WHERE it lands — never a
# credential. Database credentials live only in the source container's own
# environment and are never placed on a command line.
# shellcheck disable=SC1090
. "$CONFIG_FILE"
for v in MYTHOS_BACKUP_DB_DIR MYTHOS_BACKUP_MEDIA_DIR MYTHOS_BACKUP_MEDIA_SOURCE; do
  [ -n "${!v:-}" ] || fail "missing required config variable: $v"
done

CONTAINER="${MYTHOS_BACKUP_DB_CONTAINER:-idauto-postgres}"
ARCHIVE="${MYTHOS_BACKUP_DB_ARCHIVE:-/var/backups/mythos}"
SRC="$MYTHOS_BACKUP_MEDIA_SOURCE"
SET_DIR="$MYTHOS_BACKUP_MEDIA_DIR"
DB_DIR="$MYTHOS_BACKUP_DB_DIR"
DOCKER="${MYTHOS_BACKUP_DOCKER:-docker}"

command -v "$DOCKER" >/dev/null 2>&1 || fail "docker CLI not available"
[ -d "$SRC" ] || fail "media source not found: $SRC"
getent passwd "$OWNER" >/dev/null || fail "owner account not found: $OWNER"

# Source preflight (runbook §C): capture nothing if the source is not the
# source the runbook describes.
[ "$("$DOCKER" inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)" = "true" ] \
  || fail "source container is not running: $CONTAINER"

umask 077
mkdir -p "$ARCHIVE"
chmod 700 "$ARCHIVE"
install -d -o "$OWNER" -g "$OWNER" -m 700 "$DB_DIR"

TS="$(date -u +%Y%m%dT%H%M%SZ)"

# --- 1. Database metadata snapshot, FIRST ------------------------------------
# One REPEATABLE READ READ ONLY transaction gives the row count, the distinct
# object-key count and the key list from a single consistent point in time.
# offhost-backup.js checks these against the media set and refuses a set whose
# numbers disagree ("media-row consistency failure").
SNAP="$(mktemp)"; TMP_FILES+=("$SNAP")
"$DOCKER" exec -i "$CONTAINER" sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAXq -v ON_ERROR_STOP=1' > "$SNAP" <<'SQL' \
  || fail "database metadata snapshot failed"
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'ROWS|' || count(*) || '|' || count(DISTINCT object_key) FROM idauto_observation_media;
SELECT 'KEY|' || object_key FROM (SELECT DISTINCT object_key FROM idauto_observation_media) k ORDER BY 1;
COMMIT;
SQL
METADATA_AT="$(iso_ms)"

ROW_LINE="$(grep -m1 '^ROWS|' "$SNAP" || true)"
[ -n "$ROW_LINE" ] || fail "database metadata snapshot returned no counts"
ROW_COUNT="$(printf '%s' "$ROW_LINE" | cut -d'|' -f2)"
DISTINCT_KEYS="$(printf '%s' "$ROW_LINE" | cut -d'|' -f3)"
case "$ROW_COUNT$DISTINCT_KEYS" in *[!0-9]*|'') fail "unusable metadata counts" ;; esac

KEYS="$(mktemp)"; TMP_FILES+=("$KEYS")
grep '^KEY|' "$SNAP" | cut -d'|' -f2- | LC_ALL=C sort > "$KEYS" || true
KEY_LINES="$(wc -l < "$KEYS")"
[ "$KEY_LINES" -eq "$DISTINCT_KEYS" ] \
  || fail "key list ($KEY_LINES) disagrees with distinct-key count ($DISTINCT_KEYS)"
say "database metadata: rows=$ROW_COUNT distinct_object_keys=$DISTINCT_KEYS"

# --- 2. Database dump, in-container (runbook §D) -----------------------------
DUMP_NAME="idauto-$TS.dump"
DUMP_PART="$ARCHIVE/.$DUMP_NAME.part"; TMP_FILES+=("$DUMP_PART")
say "dumping $CONTAINER with in-container pg_dump -Fc"
"$DOCKER" exec "$CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$DUMP_PART" \
  || fail "pg_dump failed (see the source container; never retry with weakened flags)"
[ -s "$DUMP_PART" ] || fail "pg_dump produced an empty dump"

# A dump that will not parse is not a backup. Validate before it is trusted.
"$DOCKER" exec -i "$CONTAINER" sh -c 'pg_restore --list > /dev/null' < "$DUMP_PART" \
  || fail "dump failed pg_restore --list validation"

mv "$DUMP_PART" "$ARCHIVE/$DUMP_NAME"
chmod 600 "$ARCHIVE/$DUMP_NAME"
DUMP_SHA="$(sha256sum "$ARCHIVE/$DUMP_NAME" | cut -d' ' -f1)"
# C1 per runbook §E — the source checksum, recorded at rest before upload.
printf '%s  %s\n' "$DUMP_SHA" "$DUMP_NAME" >> "$ARCHIVE/SHA256SUMS-$TS.txt"
chmod 600 "$ARCHIVE/SHA256SUMS-$TS.txt"
say "dump: $DUMP_NAME ($(stat -c %s "$ARCHIVE/$DUMP_NAME") bytes) sha256=$DUMP_SHA"

# --- 3. Publish exactly ONE current dump to the deploy-side dump dir ---------
# discoverDb() in offhost-backup.js requires exactly one file in this directory.
# The previous dump is retired to the archive, never deleted: it is removed from
# the hand-off directory only once an identical copy is proven present there.
shopt -s nullglob
for old in "$DB_DIR"/*; do
  [ -f "$old" ] || continue
  b="$(basename "$old")"
  if [ -f "$ARCHIVE/$b" ] && cmp -s "$old" "$ARCHIVE/$b"; then
    rm -f "$old"
  else
    mv -n "$old" "$ARCHIVE/$b" || fail "cannot retire previous dump: $b"
    if [ -e "$old" ]; then fail "cannot retire previous dump: $b"; fi
  fi
done
shopt -u nullglob
cp -p "$ARCHIVE/$DUMP_NAME" "$DB_DIR/$DUMP_NAME"
chown "$OWNER":"$OWNER" "$DB_DIR/$DUMP_NAME"
chmod 600 "$DB_DIR/$DUMP_NAME"
COUNT_IN_DB_DIR="$(find "$DB_DIR" -maxdepth 1 -type f | wc -l)"
[ "$COUNT_IN_DB_DIR" -eq 1 ] \
  || fail "dump hand-off directory must hold exactly one file (holds $COUNT_IN_DB_DIR)"

# --- 4. Media backup set, AFTER the dump ------------------------------------
# Format consumed by offhost-backup.js (and pinned by tests/backup-scheduler-test.js):
#   manifest.json · checksums.sha256 (`<sha256>  media/aa/bb/<sha256>`) · media/
fingerprint() { # <dir> -> "count bytes digest"
  local d="$1" count bytes digest
  count="$(find "$d" -type f | wc -l)"
  bytes="$(find "$d" -type f -printf '%s\n' | awk '{s+=$1} END {print s+0}')"
  digest="$(find "$d" -type f -printf '%P %s\n' | LC_ALL=C sort | sha256sum | cut -d' ' -f1)"
  printf '%s %s %s' "$count" "$bytes" "$digest"
}

read -r FP_B_COUNT FP_B_BYTES FP_B_DIGEST <<<"$(fingerprint "$SRC")"

SET_TMP="$SET_DIR.tmp.$$"; TMP_FILES+=("$SET_TMP")
rm -rf "$SET_TMP"
mkdir -p "$SET_TMP/media"
: > "$SET_TMP/checksums.sha256"

OBJ_COUNT=0
OBJ_BYTES=0
while IFS= read -r key; do
  case "$key" in
    *[!0-9a-f]*|'') fail "unexpected object_key shape in the database" ;;
  esac
  [ "${#key}" -eq 64 ] || fail "unexpected object_key length in the database"
  src="$SRC/${key:0:2}/${key:2:2}/$key"
  [ -f "$src" ] || fail "referenced media object missing from the store: $key"
  actual="$(sha256sum "$src" | cut -d' ' -f1)"
  [ "$actual" = "$key" ] || fail "media object fails its own content hash: $key"
  rel="media/${key:0:2}/${key:2:2}/$key"
  install -D -m 600 "$src" "$SET_TMP/$rel"
  printf '%s  %s\n' "$key" "$rel" >> "$SET_TMP/checksums.sha256"
  OBJ_COUNT=$((OBJ_COUNT + 1))
  OBJ_BYTES=$((OBJ_BYTES + $(stat -c %s "$src")))
done < "$KEYS"

[ "$OBJ_COUNT" -eq "$DISTINCT_KEYS" ] \
  || fail "media set holds $OBJ_COUNT objects for $DISTINCT_KEYS distinct keys"
LC_ALL=C sort -o "$SET_TMP/checksums.sha256" "$SET_TMP/checksums.sha256"

read -r FP_A_COUNT FP_A_BYTES FP_A_DIGEST <<<"$(fingerprint "$SRC")"
if [ "$FP_B_DIGEST" = "$FP_A_DIGEST" ]; then
  CHANGED=false; STATE=CONSISTENT
else
  CHANGED=true; STATE=DEGRADED
fi
# Objects on disk that no committed row references yet. writes.js stores the
# object before the row commits, so a transient unreferenced object is normal,
# not corruption — it is recorded, and it is not part of this set because the
# set must contain exactly the referenced objects.
UNREFERENCED=$((FP_A_COUNT - OBJ_COUNT))
[ "$UNREFERENCED" -ge 0 ] || UNREFERENCED=0

MEDIA_AT="$(iso_ms)"
DUMP_AT="$(iso_ms -r "$DB_DIR/$DUMP_NAME")"
# offhost-backup.js refuses a set captured media-before-database.
[ "$(date -u -d "$DUMP_AT" +%s%N)" -le "$(date -u -d "$MEDIA_AT" +%s%N)" ] \
  || fail "capture order violated: database $DUMP_AT is newer than media $MEDIA_AT"

CHECKSUMS_SHA="$(sha256sum "$SET_TMP/checksums.sha256" | cut -d' ' -f1)"
cat > "$SET_TMP/manifest.json" <<JSON
{
  "format_version": "1.0.0",
  "created_at_utc": "$MEDIA_AT",
  "tool": "ops/backup/mythos-backup-capture.sh",
  "source": {
    "storage_path": "$SRC",
    "host_identifier": "$(hostname)",
    "project": "mythos-prod / id-auto"
  },
  "backup_mode": "online-live",
  "consistency": {
    "strategy": "metadata-snapshot-first-then-media",
    "metadata_isolation": "REPEATABLE READ READ ONLY",
    "metadata_snapshot_utc": "$METADATA_AT",
    "source_fingerprint_before": { "count": $FP_B_COUNT, "bytes": $FP_B_BYTES, "digest": "$FP_B_DIGEST" },
    "source_fingerprint_after": { "count": $FP_A_COUNT, "bytes": $FP_A_BYTES, "digest": "$FP_A_DIGEST" },
    "source_changed_during_backup": $CHANGED,
    "state": "$STATE"
  },
  "media": {
    "file_count": $OBJ_COUNT,
    "total_bytes": $OBJ_BYTES,
    "layout": "content-addressed sha256 aa/bb/<hash>"
  },
  "database": {
    "metadata_export_version": "1.0.0",
    "source_table": "idauto_observation_media",
    "row_count": $ROW_COUNT,
    "distinct_object_keys": $DISTINCT_KEYS,
    "dump_filename": "$DUMP_NAME",
    "dump_sha256": "$DUMP_SHA",
    "dump_captured_at_utc": "$DUMP_AT"
  },
  "integrity": {
    "checksums_file": "checksums.sha256",
    "checksums_file_sha256": "$CHECKSUMS_SHA"
  },
  "anomalies": {
    "referenced_objects_missing_from_backup": [],
    "unreferenced_objects_in_store": $UNREFERENCED
  },
  "restore_note": "Media objects are content-addressed; each path under media/ is its own sha256. This set is the INPUT staged and pushed by ops/backup/mythos-backup-run.sh; it is not itself the off-host backup."
}
JSON

# --- 5. Publish the media set atomically ------------------------------------
# One prior generation is retained as <set>.prev. The regenerated input set is
# not a backup: no dump, no staged set and no remote object is ever deleted.
chown -R "$OWNER":"$OWNER" "$SET_TMP"
chmod 700 "$SET_TMP"
find "$SET_TMP" -type d -exec chmod 700 {} +
find "$SET_TMP" -type f -exec chmod 600 {} +
rm -rf "$SET_DIR.prev"
if [ -d "$SET_DIR" ]; then mv "$SET_DIR" "$SET_DIR.prev"; fi
mv "$SET_TMP" "$SET_DIR"

say "media set: $OBJ_COUNT objects / $OBJ_BYTES bytes / state=$STATE / unreferenced_in_store=$UNREFERENCED"
say "capture complete — database $DUMP_AT, media $MEDIA_AT"
exit 0
