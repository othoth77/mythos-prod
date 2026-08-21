#!/usr/bin/env bash
# ops/backup/mythos-backup-run.sh — scheduled entry point for the Mythos
# off-host backup system (post-audit execution phase, Phase 1, 2026-08-21).
#
# This script is a THIN SCHEDULED WRAPPER around the pre-existing, audited
# tooling at projects/infrastructure/ops/offhost-backup.js. It implements no
# backup logic of its own (the INF-BACKUP-AUTO-0 runbook forbids a parallel
# mechanism). Exit codes follow the tool: 0 clean, 1 usage/env, 2 anomaly,
# 3 refused.
#
# Modes:
#   backup        stage -> manifest -> verify-local -> push -> verify-remote
#   verify        verify-remote (read-only)
#   restore-test  restore-verify into an isolated throwaway destination
#
# After every run (success or failure) a redacted health record is written
# atomically to $MYTHOS_BACKUP_HEALTH_FILE for the Status Center monitor.
# Secrets are never read by this script; the adapter reads its own 0600
# config (~/.config/mythos/idauto-offhost.env). Nothing here prints secret
# values, and deletion is structurally refused by the underlying tool.
set -u -o pipefail

MODE="${1:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOL="$REPO_ROOT/projects/infrastructure/ops/offhost-backup.js"
ADAPTER="${MYTHOS_BACKUP_ADAPTER:-$REPO_ROOT/projects/infrastructure/ops/adapters/s3-compatible.js}"
CONFIG_FILE="${MYTHOS_BACKUP_CONFIG:-$HOME/.config/mythos/backup-schedule.env}"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
START_EPOCH=$(date +%s)
LOG_TAIL=""
EXIT_CODE=0

fail_usage() { echo "ERROR: $1" >&2; write_health 1 "$1"; exit 1; }

write_health() {
  # write_health <exit_code> <error_or_empty>
  local code="$1" err="${2:-}"
  local health="${MYTHOS_BACKUP_HEALTH_FILE:-$HOME/mythos-backups/health/backup-health.json}"
  local finished epoch_now duration status last_success prev_fails fails
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  epoch_now=$(date +%s)
  duration=$((epoch_now - START_EPOCH))
  if [ "$code" -eq 0 ]; then status="ok"; else status="fail"; fi
  # Redact anything credential-shaped from the recorded error, defensively.
  err="$(printf '%s' "$err" | sed -E 's/(access[_ -]?key|secret|token|signature|credential|password)([=:][^ ]*)/\1=[REDACTED]/Ig' | tail -c 400)"
  last_success=""
  prev_fails=0
  if [ -f "$health" ]; then
    last_success="$(sed -n 's/.*"last_success_at": *"\([^"]*\)".*/\1/p' "$health" | head -1)"
    prev_fails="$(sed -n 's/.*"consecutive_failures": *\([0-9]*\).*/\1/p' "$health" | head -1)"
    prev_fails="${prev_fails:-0}"
  fi
  if [ "$status" = "ok" ]; then last_success="$finished"; fails=0; else fails=$((prev_fails + 1)); fi
  mkdir -p "$(dirname "$health")"
  local tmp="$health.tmp.$$"
  {
    printf '{\n'
    printf '  "schema_version": "1.0.0",\n'
    printf '  "source": "ops/backup/mythos-backup-run.sh",\n'
    printf '  "mode": "%s",\n' "${MODE:-unknown}"
    printf '  "status": "%s",\n' "$status"
    printf '  "exit_code": %s,\n' "$code"
    printf '  "started_at": "%s",\n' "$STARTED_AT"
    printf '  "finished_at": "%s",\n' "$finished"
    printf '  "duration_s": %s,\n' "$duration"
    printf '  "backup_prefix": "%s",\n' "${MYTHOS_BACKUP_PREFIX:-}"
    printf '  "last_success_at": "%s",\n' "$last_success"
    printf '  "consecutive_failures": %s,\n' "$fails"
    printf '  "error": "%s"\n' "$(printf '%s' "$err" | tr '"\n' "' ")"
    printf '}\n'
  } > "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$health"
}

run_step() {
  # run_step <label> <args...> — runs the tool, captures tail, propagates code
  local label="$1"; shift
  local out st
  echo "[mythos-backup] step: $label"
  out="$(node "$TOOL" "$@" 2>&1)"
  st=$?
  if [ "$st" -ne 0 ]; then
    EXIT_CODE=$st
    LOG_TAIL="$label: $(printf '%s' "$out" | tail -n 3)"
    echo "[mythos-backup] FAILED at $label (exit $st)" >&2
    printf '%s\n' "$out" | tail -n 10 >&2
    return 1
  fi
  return 0
}

case "$MODE" in backup|verify|restore-test) ;; *)
  echo "Usage: mythos-backup-run.sh <backup|verify|restore-test>" >&2
  exit 1 ;;
esac

[ -f "$TOOL" ] || fail_usage "tool not found: $TOOL"
[ -f "$ADAPTER" ] || fail_usage "adapter not found: $ADAPTER"
[ -f "$CONFIG_FILE" ] || fail_usage "config not found: $CONFIG_FILE (operator must create it, 0600)"

# Config declares WHAT to back up and WHERE staging lives — never credentials.
# Required: MYTHOS_BACKUP_DB_DIR, MYTHOS_BACKUP_MEDIA_DIR, MYTHOS_BACKUP_STAGE_ROOT,
#           MYTHOS_BACKUP_PREFIX
# Optional: MYTHOS_BACKUP_HEALTH_FILE, MYTHOS_BACKUP_HOST
# shellcheck disable=SC1090
. "$CONFIG_FILE"
for v in MYTHOS_BACKUP_STAGE_ROOT MYTHOS_BACKUP_PREFIX; do
  [ -n "${!v:-}" ] || fail_usage "missing required config variable: $v"
done

# Two source layouts are supported.
#
#   MULTI-RUN (preferred): MYTHOS_BACKUP_DB_ROOT points at the root written by
#   ops/backup/mythos-db-dump.sh. Its latest-run pointer names one run
#   directory holding one sub-directory per database, each with exactly the
#   one dump file discoverDb() requires. Each database is staged and pushed
#   under its own prefix, so several databases and successive daily runs
#   coexist without ever putting two files in front of discoverDb().
#
#   LEGACY (single database): MYTHOS_BACKUP_DB_DIR + MYTHOS_BACKUP_MEDIA_DIR,
#   exactly as before. Still supported and still tested.
if [ -z "${MYTHOS_BACKUP_DB_ROOT:-}" ]; then
  for v in MYTHOS_BACKUP_DB_DIR MYTHOS_BACKUP_MEDIA_DIR; do
    [ -n "${!v:-}" ] || fail_usage "missing required config variable: $v (or set MYTHOS_BACKUP_DB_ROOT for multi-run mode)"
  done
fi

# Media directory for one database id. The wrapped tool requires a media
# manifest + checksums pair for EVERY staged set, so a database whose media
# directory is not configured FAILS CLOSED and says which variable is
# missing — it is never staged with an invented or empty media set.
media_dir_for() {
  local id="$1" var
  var="MYTHOS_BACKUP_MEDIA_DIR_$(printf '%s' "$id" | tr '[:lower:]' '[:upper:]' | tr -c 'A-Z0-9_' '_')"
  printf '%s' "${!var:-}"
}

STAGE_DIR="$MYTHOS_BACKUP_STAGE_ROOT/stage-$(date -u +%Y%m%dT%H%M%SZ)"

ok=0
case "$MODE" in
  backup)
    # one_set <label> <db-dir> <media-dir> <stage-dir> <prefix>
    one_set() {
      local label="$1" dbdir="$2" mediadir="$3" dest="$4" prefix="$5"
      run_step "stage($label)" stage \
          --database "$dbdir" \
          --media "$mediadir" \
          --dest "$dest" \
          --host "${MYTHOS_BACKUP_HOST:-$(hostname)}" \
        && run_step "manifest($label)" manifest --stage "$dest" \
        && run_step "verify-local($label)" verify-local --stage "$dest" \
        && run_step "push($label)" push --stage "$dest" --adapter "$ADAPTER" --prefix "$prefix" \
        && run_step "verify-remote($label)" verify-remote --adapter "$ADAPTER" --prefix "$prefix"
    }

    if [ -n "${MYTHOS_BACKUP_DB_ROOT:-}" ]; then
      POINTER="$MYTHOS_BACKUP_DB_ROOT/latest-run"
      if [ ! -f "$POINTER" ]; then
        fail_usage "no completed dump run: $POINTER absent — mythos-db-dump.service must run first (ops/backup/README.md §0)"
      fi
      RUN_DIR="$(head -n1 "$POINTER")"
      [ -d "$RUN_DIR" ] || fail_usage "dump run directory named by $POINTER does not exist: $RUN_DIR"

      sets=0
      all_ok=1
      for dbdir in "$RUN_DIR"/*/; do
        [ -d "$dbdir" ] || continue
        id="$(basename "$dbdir")"
        mediadir="$(media_dir_for "$id")"
        if [ -z "$mediadir" ]; then
          EXIT_CODE=1
          LOG_TAIL="media directory not configured for database '$id' (set MYTHOS_BACKUP_MEDIA_DIR_$(printf '%s' "$id" | tr '[:lower:]' '[:upper:]' | tr -c 'A-Z0-9_' '_'))"
          echo "ERROR: $LOG_TAIL" >&2
          all_ok=0
          continue
        fi
        sets=$((sets + 1))
        one_set "$id" "$dbdir" "$mediadir" "$STAGE_DIR/$id" "$MYTHOS_BACKUP_PREFIX/$id" || all_ok=0
      done
      [ "$sets" -gt 0 ] || { EXIT_CODE=2; LOG_TAIL="dump run $RUN_DIR contains no database directories"; echo "ERROR: $LOG_TAIL" >&2; all_ok=0; }
      [ "$all_ok" -eq 1 ] && ok=1
    else
      one_set single "$MYTHOS_BACKUP_DB_DIR" "$MYTHOS_BACKUP_MEDIA_DIR" "$STAGE_DIR" "$MYTHOS_BACKUP_PREFIX" && ok=1
    fi
    ;;
  verify)
    run_step verify-remote verify-remote --adapter "$ADAPTER" --prefix "$MYTHOS_BACKUP_PREFIX" && ok=1
    ;;
  restore-test)
    RESTORE_DEST="$MYTHOS_BACKUP_STAGE_ROOT/restore-test-$(date -u +%Y%m%dT%H%M%SZ)"
    run_step restore-verify restore-verify --adapter "$ADAPTER" \
        --prefix "$MYTHOS_BACKUP_PREFIX" --dest "$RESTORE_DEST" && ok=1
    # The restore-test destination is throwaway evidence, never a live path.
    ;;
esac

if [ "$ok" -eq 1 ]; then
  write_health 0 ""
  echo "[mythos-backup] $MODE completed clean"
  exit 0
else
  [ "$EXIT_CODE" -eq 0 ] && EXIT_CODE=2
  write_health "$EXIT_CODE" "$LOG_TAIL"
  exit "$EXIT_CODE"
fi
