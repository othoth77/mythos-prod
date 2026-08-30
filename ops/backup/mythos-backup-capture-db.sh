#!/usr/bin/env bash
# ops/backup/mythos-backup-capture-db.sh — ROOT-SIDE capture step for a
# DATABASE-ONLY off-host backup input: one named PostgreSQL database, one
# named container, no media store.
#
# WHY THIS EXISTS, SEPARATELY FROM mythos-backup-capture.sh
# -----------------------------------------------------------
# mythos-backup-capture.sh is not a generic "dump any database" tool: its
# capture order (metadata snapshot -> dump -> media copy) and its manifest
# fields exist to reconcile a database against idauto's content-addressed
# media store, and its metadata-snapshot query is hardcoded to
# idauto_observation_media. A service with no media store (mythos_erp today;
# any future database-only service tomorrow) does not fit that shape, and
# bending that script to accept a media-less target would mean touching the
# media-consistency invariants of a script that already protects real
# production backups. This script is therefore new and separate, not a mode
# flag on the existing one: it does exactly one thing — validate, dump,
# checksum, and hand off a single named database — reusing every hardening
# pattern from mythos-backup-capture.sh line for line where they apply, and
# omitting only what does not (there is no media consistency to protect, so
# there is no metadata-snapshot step, no fingerprinting, no manifest.json —
# the downstream manifest is offhost-backup.js's job, and it already accepts
# a database-only capture set: buildManifest({dbDir}) with no mediaDir).
#
# docker access is root access; the scheduled pipeline deliberately runs as
# the unprivileged `deploy` user, and `deploy` is deliberately NOT in the
# docker group — same boundary as mythos-backup-capture.sh, held the same way.
#
#   input  $MYTHOS_BACKUP_DB_DIR/<one dump>   — pg_dump -Fc, taken in-container
#
# Installed root-owned outside the repository (/usr/local/sbin, 0700) and run
# by its own systemd service, ordered the same way mythos-backup-capture.sh
# is: Before= and Requires=d by the deploy-side pipeline that consumes its
# output, so a failed capture stops the backup rather than shipping nothing.
#
# Exit codes: 0 clean, 1 environment/capture failure (fail-closed).
set -euo pipefail

CONFIG_FILE="${MYTHOS_BACKUP_DB_CONFIG:-/home/deploy/.config/mythos/backup-schedule-db.env}"
OWNER="${MYTHOS_BACKUP_OWNER:-deploy}"
LOG_PREFIX="[mythos-backup-capture-db]"

# Same allowlist discipline as mythos-backup-capture.sh, and the same reason:
# the operator config chooses WHERE inside these roots, never whether to
# leave them.
ALLOWED_ROOTS="/var/backups/mythos /home/deploy/mythos-backups /home/deploy/deployments"

# This script's own key set. MYTHOS_BACKUP_DB_NAME is REQUIRED here, not
# optional: unlike mythos-backup-capture.sh (where an empty value falls back
# to the container's own $POSTGRES_DB, preserving its pre-existing default
# behaviour), this script's entire purpose is "dump the ONE database named
# here" — there is no sensible default for a tool whose reason to exist is
# picking a specific database out of a container that may hold several.
CONFIG_KEYS="MYTHOS_BACKUP_DB_DIR MYTHOS_BACKUP_DB_CONTAINER MYTHOS_BACKUP_DB_NAME\
 MYTHOS_BACKUP_DB_ARCHIVE MYTHOS_BACKUP_DUMP_PREFIX"

say()  { echo "$LOG_PREFIX $*"; }
fail() { echo "$LOG_PREFIX ERROR: $*" >&2; exit 1; }

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

# --- Configuration: READ AS DATA, never sourced -----------------------------
# Identical discipline to mythos-backup-capture.sh, for the identical reason:
# sourcing this file would execute it as root from a location the
# unprivileged owner controls.
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

for v in MYTHOS_BACKUP_DB_DIR MYTHOS_BACKUP_DB_CONTAINER MYTHOS_BACKUP_DB_NAME; do
  [ -n "${CFG[$v]:-}" ] || fail "missing required config variable: $v"
done

CONTAINER="${CFG[MYTHOS_BACKUP_DB_CONTAINER]}"
DB_NAME="${CFG[MYTHOS_BACKUP_DB_NAME]}"
ARCHIVE="${CFG[MYTHOS_BACKUP_DB_ARCHIVE]:-/var/backups/mythos-db}"
DB_DIR="${CFG[MYTHOS_BACKUP_DB_DIR]}"
DUMP_PREFIX="${CFG[MYTHOS_BACKUP_DUMP_PREFIX]:-$DB_NAME}"

case "$CONTAINER" in
  ''|*[!A-Za-z0-9_.-]*) fail "unacceptable container name: $CONTAINER" ;;
esac
case "$DB_NAME" in
  ''|*[!A-Za-z0-9_]*) fail "unacceptable database name: $DB_NAME" ;;
esac
case "$DUMP_PREFIX" in
  ''|*[!A-Za-z0-9_-]*) fail "unacceptable dump filename prefix: $DUMP_PREFIX" ;;
esac
require_safe_path "MYTHOS_BACKUP_DB_ARCHIVE" "$ARCHIVE"
require_safe_path "MYTHOS_BACKUP_DB_DIR" "$DB_DIR"

# The docker CLI is resolved here, not named by the config — identical check
# to mythos-backup-capture.sh.
DOCKER="$(command -v docker 2>/dev/null || true)"
[ -n "$DOCKER" ] || fail "docker CLI not available"
case "$DOCKER" in /*) : ;; *) fail "docker CLI did not resolve to an absolute path: $DOCKER" ;; esac
[ ! -L "$DOCKER" ] || fail "docker CLI must not be a symlink: $DOCKER"
[ "$(stat -c %U "$DOCKER")" = root ] || fail "docker CLI must be owned by root: $DOCKER"
[ $(( 8#$(stat -c %a "$DOCKER") & 022 )) -eq 0 ] \
  || fail "docker CLI must not be group/world-writable: $DOCKER"

# Source preflight: capture nothing if the container is not running.
[ "$("$DOCKER" inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)" = "true" ] \
  || fail "source container is not running: $CONTAINER"

# Preflight the DATABASE itself, not only the container: a container that is
# up but does not (yet, or any longer) hold this database must fail closed
# with a clear message, not attempt a pg_dump against a name that does not
# exist and produce a confusing driver error several steps later. Passing the
# name as the libpq connection target and letting a failed connection BE the
# preflight is simpler and less version-fragile than querying pg_database.
EXISTS="$("$DOCKER" exec -e "MYTHOS_TARGET_DB=$DB_NAME" "$CONTAINER" sh -c \
  'psql -U "$POSTGRES_USER" -d "$MYTHOS_TARGET_DB" -tAXq -v ON_ERROR_STOP=1 -c "SELECT 1"' \
  2>/dev/null || echo "")"
[ "$EXISTS" = "1" ] || fail "database not found or not connectable in $CONTAINER: $DB_NAME"

umask 077
mkdir -p "$ARCHIVE"
chmod 700 "$ARCHIVE"
[ ! -L "$ARCHIVE" ] || fail "archive must not be a symlink: $ARCHIVE"
ARCHIVE_OWNER="$(stat -c %U "$ARCHIVE")"
ARCHIVE_MODE="$(stat -c %a "$ARCHIVE")"
[ "$ARCHIVE_OWNER" = root ] \
  || fail "archive must be owned by root (is $ARCHIVE_OWNER): $ARCHIVE"
[ $(( 8#$ARCHIVE_MODE & 022 )) -eq 0 ] \
  || fail "archive must not be group/world-writable (mode $ARCHIVE_MODE): $ARCHIVE"
install -d -o "$OWNER" -g "$OWNER" -m 700 "$DB_DIR"

TS="$(date -u +%Y%m%dT%H%M%SZ)"

# --- Database dump, in-container --------------------------------------------
DUMP_NAME="$DUMP_PREFIX-$TS.dump"
DUMP_PART="$ARCHIVE/.$DUMP_NAME.part"; TMP_FILES+=("$DUMP_PART")
say "dumping $CONTAINER db=$DB_NAME with in-container pg_dump -Fc"
"$DOCKER" exec -e "MYTHOS_TARGET_DB=$DB_NAME" "$CONTAINER" \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$MYTHOS_TARGET_DB" -Fc' > "$DUMP_PART" \
  || fail "pg_dump failed (see the source container; never retry with weakened flags)"
[ -s "$DUMP_PART" ] || fail "pg_dump produced an empty dump"

# A dump that will not parse is not a backup. Validate before it is trusted —
# identical requirement to mythos-backup-capture.sh.
"$DOCKER" exec -i "$CONTAINER" sh -c 'pg_restore --list > /dev/null' < "$DUMP_PART" \
  || fail "dump failed pg_restore --list validation"

mv "$DUMP_PART" "$ARCHIVE/$DUMP_NAME"
chmod 600 "$ARCHIVE/$DUMP_NAME"
DUMP_SHA="$(sha256sum "$ARCHIVE/$DUMP_NAME" | cut -d' ' -f1)"
printf '%s  %s\n' "$DUMP_SHA" "$DUMP_NAME" >> "$ARCHIVE/SHA256SUMS-$TS.txt"
chmod 600 "$ARCHIVE/SHA256SUMS-$TS.txt"
say "dump: $DUMP_NAME ($(stat -c %s "$ARCHIVE/$DUMP_NAME") bytes) sha256=$DUMP_SHA"

# --- Publish exactly ONE current dump to the deploy-side dump dir ----------
# offhost-backup.js's discoverDb() requires exactly one file in this
# directory — identical contract to mythos-backup-capture.sh's hand-off, and
# identical retire-not-delete discipline for the previous generation.
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

say "capture complete — database $DB_NAME dumped at $TS, no media component"
exit 0
