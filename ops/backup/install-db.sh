#!/usr/bin/env bash
# ops/backup/install-db.sh — root-run installer for the DATABASE-ONLY Mythos
# backup schedule (e.g. mythos_erp). Mirrors ops/backup/install.sh exactly —
# same idempotent, fail-closed structure, same mythos-git-push relay pattern
# (units root-installed and root-owned, run as User=deploy) — as a SEPARATE
# script rather than a flag on install.sh, so running this can never alter
# what install.sh does for the idauto pipeline, and vice versa.
#
# Reuses the EXISTING off-host credential file
# (/home/deploy/.config/mythos/idauto-offhost.env): per
# docs/OFF_HOST_BACKUP_GATE.md, that credential is scoped to the R2 BUCKET
# (Object Read & Write on mythos-offhost-backups only), not to a database or
# a path within it — the two pipelines are already separated by
# MYTHOS_BACKUP_PREFIX (mythos/daily vs mythos-erp/daily), not by credential.
# A second credential for the same bucket would be duplicated secret material
# for no isolation gained.
set -euo pipefail

UNIT_DIR=/etc/systemd/system
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/systemd"
SCRIPT=/home/deploy/projects/mythos-prod/ops/backup/mythos-backup-run-db.sh
# Root-only, same reasoning as install.sh: docker exec is root-only by
# design, so root must never execute out of the deploy-writable checkout.
CAPTURE_SRC=/home/deploy/projects/mythos-prod/ops/backup/mythos-backup-capture-db.sh
CAPTURE_DST=/usr/local/sbin/mythos-backup-capture-db
CONFIG=/home/deploy/.config/mythos/backup-schedule-db.env
CRED=/home/deploy/.config/mythos/idauto-offhost.env
OWNER_USER=deploy
UNITS="mythos-backup-capture-db.service mythos-backup-db.service mythos-backup-db.timer mythos-backup-db-verify.service mythos-backup-db-verify.timer mythos-restore-db-test.service mythos-restore-db-test.timer"

[ "$(id -u)" -eq 0 ] || { echo "ERROR: must run as root" >&2; exit 1; }
[ -f "$SCRIPT" ] || { echo "ERROR: $SCRIPT missing — update the deploy checkout first" >&2; exit 1; }
bash -n "$SCRIPT" || { echo "ERROR: entry script fails bash -n" >&2; exit 1; }
[ -f "$CAPTURE_SRC" ] || { echo "ERROR: $CAPTURE_SRC missing — update the deploy checkout first" >&2; exit 1; }
[ ! -L "$CAPTURE_SRC" ] || { echo "ERROR: $CAPTURE_SRC must not be a symlink" >&2; exit 1; }
bash -n "$CAPTURE_SRC" || { echo "ERROR: capture script fails bash -n" >&2; exit 1; }
[ -f "$CONFIG" ] || { echo "ERROR: $CONFIG missing — create it (0600, see README.md §2 and this script's own header)" >&2; exit 1; }
[ -f "$CRED" ] || { echo "ERROR: $CRED missing — this reuses the existing O-BACKUP-6 credential; install the idauto pipeline first, or create it per docs/OFF_HOST_BACKUP_GATE.md" >&2; exit 1; }
for f in "$CONFIG" "$CRED"; do
  [ ! -L "$f" ] || { echo "ERROR: $f must not be a symlink" >&2; exit 1; }
  owner="$(stat -c %U "$f")"
  group="$(stat -c %G "$f")"
  mode="$(stat -c %a "$f")"
  [ "$owner" = "$OWNER_USER" ] \
    || { echo "ERROR: $f must be owned by $OWNER_USER (is $owner)" >&2; exit 1; }
  [ "$group" = "$OWNER_USER" ] \
    || { echo "ERROR: $f must have group $OWNER_USER (is $group)" >&2; exit 1; }
  [ "$mode" = "600" ] || { echo "ERROR: $f must be mode 0600 (is $mode)" >&2; exit 1; }
done

for d in "$(dirname "$CONFIG")" "$(dirname "$CRED")"; do
  [ ! -L "$d" ] || { echo "ERROR: $d must not be a symlink" >&2; exit 1; }
  downer="$(stat -c %U "$d")"
  dmode="$(stat -c %a "$d")"
  case "$downer" in
    root|"$OWNER_USER") : ;;
    *) echo "ERROR: $d must be owned by root or $OWNER_USER (is $downer)" >&2; exit 1 ;;
  esac
  [ $(( 8#$dmode & 022 )) -eq 0 ] \
    || { echo "ERROR: $d must not be group/world-writable (is $dmode)" >&2; exit 1; }
done

# Capture inputs and the local dump archive, DISTINCT paths from the idauto
# pipeline's (/var/backups/mythos, .../mythos-backups/db-dumps) so the two
# archives, and the exactly-one-file hand-off contract, can never collide.
install -o root -g root -m 0700 -d /var/backups/mythos-db
install -o deploy -g deploy -m 0700 -d /home/deploy/mythos-backups \
  /home/deploy/mythos-backups/erp-db-dumps /home/deploy/mythos-backups/erp-staging \
  /home/deploy/mythos-backups/health
install -o root -g root -m 0700 "$CAPTURE_SRC" "$CAPTURE_DST"

for u in $UNITS; do
  [ -f "$SRC_DIR/$u" ] || { echo "ERROR: unit source $SRC_DIR/$u missing" >&2; exit 1; }
  install -o root -g root -m 0644 "$SRC_DIR/$u" "$UNIT_DIR/$u"
done

if command -v systemd-analyze >/dev/null 2>&1; then
  for u in mythos-backup-capture-db.service mythos-backup-db.service mythos-backup-db-verify.service mythos-restore-db-test.service; do
    systemd-analyze verify "$UNIT_DIR/$u" || { echo "ERROR: systemd-analyze rejected $u" >&2; exit 1; }
  done
fi

systemctl daemon-reload
for t in mythos-backup-db.timer mythos-backup-db-verify.timer mythos-restore-db-test.timer; do
  systemctl enable --now "$t"
done

echo "OK: database-only backup timers installed and enabled:"
systemctl list-timers 'mythos-backup-db*' 'mythos-restore-db*' --no-pager || true
echo "IDAuto pipeline untouched: mythos-backup.timer et al. were not read, installed, or reloaded by this script beyond the single shared daemon-reload."
echo "Next: run one supervised backup now (only after confirming mythos_erp exists — see the procedure):"
echo "  systemctl start mythos-backup-db.service && journalctl -u mythos-backup-db.service -n 30"
