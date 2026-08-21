#!/usr/bin/env bash
# ops/backup/mythos-db-dump.sh — the DUMP step that runs in front of the
# off-host backup pipeline (docs/OFF_HOST_BACKUP_GATE.md §4-D).
#
# WHY THIS EXISTS. projects/infrastructure/ops/offhost-backup.js CARRIES
# database dumps; it never produces them (§0 of the gate runbook). Its
# discoverDb() requires exactly ONE dump file per staged directory, so this
# script writes each database into its own per-run directory:
#
#   $MYTHOS_BACKUP_DB_ROOT/run-<TS>/<id>/<id>-<TS>.<ext>   <- exactly one file
#   $MYTHOS_BACKUP_DB_ROOT/run-<TS>/SHA256SUMS.txt         <- C1, at run root
#   $MYTHOS_BACKUP_DB_ROOT/latest-run                      <- pointer for the wrapper
#
# SHA256SUMS.txt deliberately lives at the RUN root, never inside a database
# directory — a second file there would break discoverDb() by design.
#
# PRIVILEGES. This script runs as ROOT because `docker exec` is required and
# `deploy` is deliberately NOT in the docker group (root-equivalent; its
# removal is a verified governance invariant). Keeping the docker-touching
# step in this one small root unit is what lets mythos-backup.service stay
# User=deploy. This script grants nothing to deploy beyond READ access to the
# dumps it produces.
#
# CREDENTIALS. Never on a command line, never in this repository, never in a
# shell variable here. Each dump runs `sh -c` INSIDE its own container and
# dereferences that container's own environment ($POSTGRES_USER,
# $MYSQL_ROOT_PASSWORD), so no secret ever reaches this host's process table
# or shell history.
#
# VERIFICATION IS NOT OPTIONAL. Before dumping, each source's identity is
# re-verified against ops/backup/db-sources.json (runbook §C: container,
# engine major version, table count). A mismatch STOPS the run — it means
# something changed underneath the runbook. After dumping, each artefact is
# structurally validated (pg_restore --list parses; mysqldump completion
# marker present). Nothing here retries with force-style flags, and nothing
# here deletes anything, locally or remotely.
#
# Usage: mythos-db-dump.sh            (dumps every registry entry, in order)
# Exit codes: 0 clean, 1 usage/environment, 2 verification/anomaly.
set -u -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REGISTRY="${MYTHOS_BACKUP_DB_REGISTRY:-$REPO_ROOT/ops/backup/db-sources.json}"
CONFIG_FILE="${MYTHOS_BACKUP_CONFIG:-/home/deploy/.config/mythos/backup-schedule.env}"
DOCKER="${MYTHOS_BACKUP_DOCKER:-docker}"
OWNER_USER="${MYTHOS_BACKUP_OWNER_USER:-deploy}"
OWNER_GROUP="${MYTHOS_BACKUP_OWNER_GROUP:-deploy}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

die()  { echo "ERROR: $1" >&2; exit "${2:-1}"; }
note() { echo "[mythos-db-dump] $1"; }

[ "$(id -u)" -eq 0 ] || die "must run as root (docker exec is required; deploy is intentionally not in the docker group)"
[ -f "$REGISTRY" ] || die "source registry not found: $REGISTRY"
[ -f "$CONFIG_FILE" ] || die "config not found: $CONFIG_FILE (see ops/backup/README.md §2)"
command -v "$DOCKER" >/dev/null 2>&1 || die "docker not available on PATH"
command -v node >/dev/null 2>&1 || die "node not available on PATH"

# shellcheck disable=SC1090
. "$CONFIG_FILE"
DB_ROOT="${MYTHOS_BACKUP_DB_ROOT:-}"
[ -n "$DB_ROOT" ] || die "missing required config variable: MYTHOS_BACKUP_DB_ROOT"

RUN_DIR="$DB_ROOT/run-$TS"
# A same-second manual rerun is a legitimate operator action, so disambiguate
# rather than refuse; a run directory is still never reused or overwritten.
[ -e "$RUN_DIR" ] && RUN_DIR="$DB_ROOT/run-$TS-$$"
[ -e "$RUN_DIR" ] && die "run directory already exists: $RUN_DIR" 2
mkdir -p "$RUN_DIR" || die "cannot create $RUN_DIR"
chmod 700 "$RUN_DIR"

# Registry read via node (already a hard dependency of the pipeline) so the
# parse is real JSON parsing, not a regex over a config file.
readarray -t ROWS < <(node -e '
  var r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  (r.databases || []).forEach(function (d) {
    process.stdout.write([d.id, d.container, d.engine, d.expected_engine_major,
      d.expected_tables, d.dump_extension].join("\t") + "\n");
  });
' "$REGISTRY") || die "cannot parse $REGISTRY"
[ "${#ROWS[@]}" -gt 0 ] || die "source registry declares no databases"

FAILED=0
for row in "${ROWS[@]}"; do
  IFS=$'\t' read -r ID CONTAINER ENGINE MAJOR TABLES EXT <<< "$row"
  note "source: $ID ($CONTAINER, $ENGINE $MAJOR, expect $TABLES tables)"

  # ── §C source identification — refuse to dump a changed source ──────────
  if ! "$DOCKER" inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -qx true; then
    echo "ERROR: $ID: container $CONTAINER is not running" >&2; FAILED=1; continue
  fi

  if [ "$ENGINE" = "postgres" ]; then
    got_major="$("$DOCKER" exec "$CONTAINER" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SHOW server_version"' 2>/dev/null | cut -d. -f1 | tr -d ' ')"
    got_tables="$("$DOCKER" exec "$CONTAINER" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='"'"'public'"'"'"' 2>/dev/null | tr -d ' ')"
  else
    got_major="$("$DOCKER" exec "$CONTAINER" sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" -N -B -e "SELECT VERSION()"' 2>/dev/null | cut -d. -f1 | tr -d ' ')"
    got_tables="$("$DOCKER" exec "$CONTAINER" sh -c 'mysql -u root -p"$MYSQL_ROOT_PASSWORD" -N -B -e "SELECT count(*) FROM information_schema.tables WHERE table_schema=DATABASE()" '"$ID"'' 2>/dev/null | tr -d ' ')"
  fi

  [ -n "$got_major" ] || { echo "ERROR: $ID: could not read engine version" >&2; FAILED=1; continue; }
  [ "$got_major" = "$MAJOR" ] || { echo "ERROR: $ID: engine major $got_major != registry $MAJOR — source changed under the runbook, refusing to dump" >&2; FAILED=1; continue; }
  [ -n "$got_tables" ] || { echo "ERROR: $ID: could not read table count" >&2; FAILED=1; continue; }
  [ "$got_tables" = "$TABLES" ] || { echo "ERROR: $ID: table count $got_tables != registry $TABLES — source changed under the runbook, refusing to dump" >&2; FAILED=1; continue; }

  # ── §D dump — in-container, read-only, credential never leaves the container
  DB_DIR="$RUN_DIR/$ID"
  mkdir -p "$DB_DIR" && chmod 700 "$DB_DIR"
  OUT="$DB_DIR/$ID-$TS.$EXT"
  if [ "$ENGINE" = "postgres" ]; then
    "$DOCKER" exec "$CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$OUT"
  else
    "$DOCKER" exec "$CONTAINER" sh -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --events '"$ID" > "$OUT"
  fi
  st=$?
  if [ "$st" -ne 0 ]; then
    echo "ERROR: $ID: dump command exited $st" >&2; FAILED=1; continue
  fi
  [ -s "$OUT" ] || { echo "ERROR: $ID: dump is empty" >&2; FAILED=1; continue; }
  chmod 600 "$OUT"

  # ── structural validation of the artefact (never a bare size check alone)
  if [ "$ENGINE" = "postgres" ]; then
    if ! "$DOCKER" exec -i "$CONTAINER" sh -c 'pg_restore --list > /dev/null' < "$OUT" 2>/dev/null; then
      echo "ERROR: $ID: pg_restore --list could not parse the dump" >&2; FAILED=1; continue
    fi
  else
    if ! tail -c 200 "$OUT" | grep -q "Dump completed"; then
      echo "ERROR: $ID: mysqldump completion marker absent — dump is truncated" >&2; FAILED=1; continue
    fi
  fi

  # ── C1 at the RUN root (never inside $DB_DIR — discoverDb wants one file)
  ( cd "$RUN_DIR" && sha256sum "$ID/$(basename "$OUT")" >> SHA256SUMS.txt ) || {
    echo "ERROR: $ID: could not record C1 checksum" >&2; FAILED=1; continue; }
  note "$ID: dumped and validated"
done

if [ "$FAILED" -ne 0 ]; then
  echo "ERROR: one or more sources failed; the run directory is kept for diagnosis: $RUN_DIR" >&2
  exit 2
fi

chmod 600 "$RUN_DIR/SHA256SUMS.txt"
chown -R "$OWNER_USER:$OWNER_GROUP" "$RUN_DIR" || die "cannot hand the run directory to $OWNER_USER"

# Pointer consumed by mythos-backup-run.sh. Written atomically, last, so it
# only ever names a complete, fully validated run.
printf '%s\n' "$RUN_DIR" > "$DB_ROOT/latest-run.tmp.$$"
chmod 644 "$DB_ROOT/latest-run.tmp.$$"
chown "$OWNER_USER:$OWNER_GROUP" "$DB_ROOT/latest-run.tmp.$$"
mv -f "$DB_ROOT/latest-run.tmp.$$" "$DB_ROOT/latest-run"

note "all sources dumped and validated: $RUN_DIR"
exit 0
