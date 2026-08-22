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

# Every path this script creates, rotates or removes must resolve under one of
# these roots. The operator config chooses WHERE inside them, never whether to
# leave them: without this, a rewritten config would turn the rotation below
# into an arbitrary root-owned `rm -rf`/`mv` of any path on the host.
ALLOWED_ROOTS="/var/backups/mythos /home/deploy/mythos-backups /home/deploy/deployments"

# Keys this file recognises. The last three belong to the deploy-side pipeline
# and are accepted-but-unused here, so the two sides can keep sharing one file.
CONFIG_KEYS="MYTHOS_BACKUP_DB_DIR MYTHOS_BACKUP_MEDIA_DIR MYTHOS_BACKUP_MEDIA_SOURCE\
 MYTHOS_BACKUP_DB_CONTAINER MYTHOS_BACKUP_DB_ARCHIVE MYTHOS_BACKUP_STAGE_ROOT\
 MYTHOS_BACKUP_PREFIX MYTHOS_BACKUP_HEALTH_FILE"

say()  { echo "$LOG_PREFIX $*"; }
# `date +%3N` is not honoured everywhere (it can emit full nanoseconds), and the
# manifest timestamp is parsed downstream — truncate to milliseconds explicitly.
iso_ms() { date -u "$@" +%Y-%m-%dT%H:%M:%S.%N | sed -E 's/^(.{23}).*$/\1Z/'; }
fail() { echo "$LOG_PREFIX ERROR: $*" >&2; exit 1; }

# Values reach the manifest as JSON *literals*, never as raw interpolation: an
# operator-supplied path or a hostname carrying a quote or a backslash would
# otherwise emit a document the downstream parser rejects — or silently reshape
# it. Numbers are proven numeric before they are emitted unquoted.
json_str() {
  local s="${1-}"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\n'/\\n}"
  printf '"%s"' "$s"
}
json_int() {
  case "${1-}" in
    ''|*[!0-9]*) fail "refusing to emit a non-numeric JSON number: '${1-}'" ;;
  esac
  printf '%s' "$1"
}

TMP_FILES=()
cleanup() { [ "${#TMP_FILES[@]}" -eq 0 ] || rm -rf -- "${TMP_FILES[@]}"; }
trap cleanup EXIT

require_safe_path() { # <label> <path> — absolute, normalised, under ALLOWED_ROOTS
  local label="$1" p="$2" pre ok=false
  case "$p" in
    /*) : ;;
    *)  fail "$label must be an absolute path (got '$p')" ;;
  esac
  case "$p" in
    *//*|*/..|*/../*|*/.|*/./*) fail "$label must be a normalised path without '.' or '..' (got '$p')" ;;
  esac
  for pre in $ALLOWED_ROOTS; do
    case "$p" in
      "$pre"|"$pre"/*) ok=true; break ;;
    esac
  done
  [ "$ok" = true ] || fail "$label ('$p') is outside the permitted roots: $ALLOWED_ROOTS"
}

[ "$(id -u)" -eq 0 ] || fail "must run as root (this is the root side of the docker boundary)"
getent passwd "$OWNER" >/dev/null || fail "owner account not found: $OWNER"

# --- Configuration: READ AS DATA, never sourced ------------------------------
# Sourcing this file would execute it as root, and it lives under the home of
# the unprivileged owner — that would hand `deploy` a root shell on the next
# timer fire and invert the very boundary this script exists to hold. It is
# therefore parsed as inert KEY=VALUE data: only recognised keys are accepted,
# every value is shape-checked, and nothing in it is ever evaluated.
[ ! -L "$CONFIG_FILE" ] || fail "config must not be a symlink: $CONFIG_FILE"
[ -f "$CONFIG_FILE" ] || fail "config not found: $CONFIG_FILE (operator must create it, 0600)"
CFG_OWNER="$(stat -c %U "$CONFIG_FILE")"
CFG_MODE="$(stat -c %a "$CONFIG_FILE")"
case "$CFG_OWNER" in
  root|"$OWNER") : ;;
  *) fail "config must be owned by root or $OWNER (is $CFG_OWNER): $CONFIG_FILE" ;;
esac
[ $(( 8#$CFG_MODE & 022 )) -eq 0 ] \
  || fail "config must not be group/world-writable (mode $CFG_MODE): $CONFIG_FILE"

declare -A CFG=()
CFG_LINE=0
while IFS= read -r line || [ -n "$line" ]; do
  CFG_LINE=$((CFG_LINE + 1))
  case "$line" in
    ''|'#'*) continue ;;
  esac
  line="${line#export }"
  key="${line%%=*}"
  [ "$key" != "$line" ] || fail "config line $CFG_LINE is not KEY=VALUE"
  val="${line#*=}"
  case "$key" in
    ''|*[!A-Z_]*) fail "config line $CFG_LINE has an unacceptable key" ;;
  esac
  case " $CONFIG_KEYS " in
    *" $key "*) : ;;
    *) fail "config line $CFG_LINE declares an unrecognised key: $key" ;;
  esac
  case "$val" in
    \"*\") val="${val#\"}"; val="${val%\"}" ;;
    \'*\') val="${val#\'}"; val="${val%\'}" ;;
  esac
  case "$val" in
    *[!A-Za-z0-9/._:@+=,-]*) fail "config value for $key contains unacceptable characters" ;;
  esac
  CFG["$key"]="$val"
done < "$CONFIG_FILE"

for v in MYTHOS_BACKUP_DB_DIR MYTHOS_BACKUP_MEDIA_DIR MYTHOS_BACKUP_MEDIA_SOURCE; do
  [ -n "${CFG[$v]:-}" ] || fail "missing required config variable: $v"
done

CONTAINER="${CFG[MYTHOS_BACKUP_DB_CONTAINER]:-idauto-postgres}"
ARCHIVE="${CFG[MYTHOS_BACKUP_DB_ARCHIVE]:-/var/backups/mythos}"
SRC="${CFG[MYTHOS_BACKUP_MEDIA_SOURCE]}"
SET_DIR="${CFG[MYTHOS_BACKUP_MEDIA_DIR]}"
DB_DIR="${CFG[MYTHOS_BACKUP_DB_DIR]}"

case "$CONTAINER" in
  ''|*[!A-Za-z0-9_.-]*) fail "unacceptable container name: $CONTAINER" ;;
esac
require_safe_path "MYTHOS_BACKUP_DB_ARCHIVE" "$ARCHIVE"
require_safe_path "MYTHOS_BACKUP_MEDIA_SOURCE" "$SRC"
require_safe_path "MYTHOS_BACKUP_MEDIA_DIR" "$SET_DIR"
require_safe_path "MYTHOS_BACKUP_DB_DIR" "$DB_DIR"

# The docker CLI is resolved here, not named by the config: a config-supplied
# command name is a root-executed binary of the config author's choosing.
DOCKER="$(command -v docker 2>/dev/null || true)"
[ -n "$DOCKER" ] || fail "docker CLI not available"
case "$DOCKER" in /*) : ;; *) fail "docker CLI did not resolve to an absolute path: $DOCKER" ;; esac
[ ! -L "$DOCKER" ] || fail "docker CLI must not be a symlink: $DOCKER"
[ "$(stat -c %U "$DOCKER")" = root ] || fail "docker CLI must be owned by root: $DOCKER"
[ $(( 8#$(stat -c %a "$DOCKER") & 022 )) -eq 0 ] \
  || fail "docker CLI must not be group/world-writable: $DOCKER"

# The generated manifest is parse-checked before publication. The deploy-side
# pipeline already requires node, so this introduces no new system dependency.
command -v node >/dev/null 2>&1 \
  || fail "node not available (required to validate the generated manifest)"

[ -d "$SRC" ] || fail "media source not found: $SRC"

# Source preflight (runbook §C): capture nothing if the source is not the
# source the runbook describes.
[ "$("$DOCKER" inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)" = "true" ] \
  || fail "source container is not running: $CONTAINER"

umask 077
mkdir -p "$ARCHIVE"
chmod 700 "$ARCHIVE"
# The archive holds the dump history AND the staging area, so it must be a
# root-only directory — the allowlist alone does not make it one, since two of
# the permitted roots are owned by $OWNER. Without this, a config naming an
# archive under $OWNER's tree lets $OWNER pre-seed the staging path, and
# `install -d` follows a symlink: it would chmod and chown whatever the link
# points at, and `stat` would then report the target's (now correct) mode back
# to us. Check the link itself, before anything follows it.
[ ! -L "$ARCHIVE" ] || fail "archive must not be a symlink: $ARCHIVE"
ARCHIVE_OWNER="$(stat -c %U "$ARCHIVE")"
ARCHIVE_MODE="$(stat -c %a "$ARCHIVE")"
[ "$ARCHIVE_OWNER" = root ] \
  || fail "archive must be owned by root (is $ARCHIVE_OWNER): $ARCHIVE"
[ $(( 8#$ARCHIVE_MODE & 022 )) -eq 0 ] \
  || fail "archive must not be group/world-writable (mode $ARCHIVE_MODE): $ARCHIVE"
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

# The set is BUILT where only root can write and PUBLISHED with one rename.
# The old `$SET_DIR.tmp.$$` sat in a directory the unprivileged owner controls,
# under a name derived from the pid: that path could be pre-created, or swapped
# for a symlink in the window between the `rm -rf` and the `mkdir`. Root now
# stages inside the root-only archive (0700) under an unpredictable name.
STAGE_PARENT="$ARCHIVE/.capture-staging"
# Refuse the link before `install -d` can follow it (see the archive checks).
[ ! -L "$STAGE_PARENT" ] || fail "staging parent must not be a symlink: $STAGE_PARENT"
install -o root -g root -m 700 -d "$STAGE_PARENT"
[ ! -L "$STAGE_PARENT" ] || fail "staging parent must not be a symlink: $STAGE_PARENT"
[ "$(stat -c %U "$STAGE_PARENT")" = root ] || fail "staging parent is not root-owned: $STAGE_PARENT"
[ "$(stat -c %a "$STAGE_PARENT")" = 700 ] || fail "staging parent is not 0700: $STAGE_PARENT"
# Publishing must be an atomic rename, and rename cannot cross filesystems.
[ "$(stat -c %d "$STAGE_PARENT")" = "$(stat -c %d "$(dirname "$SET_DIR")")" ] \
  || fail "staging ($STAGE_PARENT) and hand-off ($SET_DIR) are on different filesystems"
SET_TMP="$(mktemp -d "$STAGE_PARENT/set.XXXXXXXXXX")"; TMP_FILES+=("$SET_TMP")
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
  "created_at_utc": $(json_str "$MEDIA_AT"),
  "tool": "ops/backup/mythos-backup-capture.sh",
  "source": {
    "storage_path": $(json_str "$SRC"),
    "host_identifier": $(json_str "$(hostname)"),
    "project": "mythos-prod / id-auto"
  },
  "backup_mode": "online-live",
  "consistency": {
    "strategy": "metadata-snapshot-first-then-media",
    "metadata_isolation": "REPEATABLE READ READ ONLY",
    "metadata_snapshot_utc": $(json_str "$METADATA_AT"),
    "source_fingerprint_before": { "count": $(json_int "$FP_B_COUNT"), "bytes": $(json_int "$FP_B_BYTES"), "digest": $(json_str "$FP_B_DIGEST") },
    "source_fingerprint_after": { "count": $(json_int "$FP_A_COUNT"), "bytes": $(json_int "$FP_A_BYTES"), "digest": $(json_str "$FP_A_DIGEST") },
    "source_changed_during_backup": $CHANGED,
    "state": $(json_str "$STATE")
  },
  "media": {
    "file_count": $(json_int "$OBJ_COUNT"),
    "total_bytes": $(json_int "$OBJ_BYTES"),
    "layout": "content-addressed sha256 aa/bb/<hash>"
  },
  "database": {
    "metadata_export_version": "1.0.0",
    "source_table": "idauto_observation_media",
    "row_count": $(json_int "$ROW_COUNT"),
    "distinct_object_keys": $(json_int "$DISTINCT_KEYS"),
    "dump_filename": $(json_str "$DUMP_NAME"),
    "dump_sha256": $(json_str "$DUMP_SHA"),
    "dump_captured_at_utc": $(json_str "$DUMP_AT")
  },
  "integrity": {
    "checksums_file": "checksums.sha256",
    "checksums_file_sha256": $(json_str "$CHECKSUMS_SHA")
  },
  "anomalies": {
    "referenced_objects_missing_from_backup": [],
    "unreferenced_objects_in_store": $(json_int "$UNREFERENCED")
  },
  "restore_note": "Media objects are content-addressed; each path under media/ is its own sha256. This set is the INPUT staged and pushed by ops/backup/mythos-backup-run.sh; it is not itself the off-host backup."
}
JSON
# A manifest that will not parse is not a manifest. Prove it before publishing.
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$SET_TMP/manifest.json" \
  || fail "generated manifest.json is not valid JSON"

# --- 5. Publish the media set atomically ------------------------------------
# One prior generation is retained as <set>.prev. The regenerated input set is
# not a backup: no dump, no staged set and no remote object is ever deleted.
chown -R "$OWNER":"$OWNER" "$SET_TMP"
chmod 700 "$SET_TMP"
find "$SET_TMP" -type d -exec chmod 700 {} +
find "$SET_TMP" -type f -exec chmod 600 {} +
# Rotate through real directories only. A symlink planted at either path would
# otherwise redirect the rename out of the hand-off area entirely; `--` keeps a
# leading-dash name from being read as an option; `-T` replaces the target
# instead of moving the source *into* it when the target already exists.
[ ! -L "$SET_DIR" ] || fail "hand-off path is a symlink, refusing to publish: $SET_DIR"
[ ! -L "$SET_DIR.prev" ] || fail "retained generation is a symlink, refusing to publish: $SET_DIR.prev"
[ ! -e "$SET_DIR.prev" ] || [ -d "$SET_DIR.prev" ] \
  || fail "retained generation is not a directory, refusing to publish: $SET_DIR.prev"
rm -rf -- "$SET_DIR.prev"
if [ -d "$SET_DIR" ]; then mv -T -- "$SET_DIR" "$SET_DIR.prev"; fi
mv -T -- "$SET_TMP" "$SET_DIR"

say "media set: $OBJ_COUNT objects / $OBJ_BYTES bytes / state=$STATE / unreferenced_in_store=$UNREFERENCED"
say "capture complete — database $DUMP_AT, media $MEDIA_AT"
exit 0
