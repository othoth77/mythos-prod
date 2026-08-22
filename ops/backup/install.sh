#!/usr/bin/env bash
# ops/backup/install.sh — root-run installer for the Mythos backup schedule.
# Idempotent, fail-closed. Mirrors the mythos-git-push relay pattern: units
# are root-installed, root-owned, and run as User=deploy so no session ever
# holds deploy's credentials. Rerunning after a partial install is safe.
set -euo pipefail

UNIT_DIR=/etc/systemd/system
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/systemd"
SCRIPT=/home/deploy/projects/mythos-prod/ops/backup/mythos-backup-run.sh
# The capture step runs as ROOT (docker exec is root-only by design). Root must
# never execute it out of the deploy-writable checkout, so — exactly as with the
# mythos-git-push relay — a root-owned 0700 copy is installed outside the repo
# and that copy is what the unit runs.
CAPTURE_SRC=/home/deploy/projects/mythos-prod/ops/backup/mythos-backup-capture.sh
CAPTURE_DST=/usr/local/sbin/mythos-backup-capture
CONFIG=/home/deploy/.config/mythos/backup-schedule.env
CRED=/home/deploy/.config/mythos/idauto-offhost.env
UNITS="mythos-backup-capture.service mythos-backup.service mythos-backup.timer mythos-backup-verify.service mythos-backup-verify.timer mythos-restore-test.service mythos-restore-test.timer"

[ "$(id -u)" -eq 0 ] || { echo "ERROR: must run as root" >&2; exit 1; }
[ -f "$SCRIPT" ] || { echo "ERROR: $SCRIPT missing — update the deploy checkout first" >&2; exit 1; }
bash -n "$SCRIPT" || { echo "ERROR: entry script fails bash -n" >&2; exit 1; }
[ -f "$CAPTURE_SRC" ] || { echo "ERROR: $CAPTURE_SRC missing — update the deploy checkout first" >&2; exit 1; }
bash -n "$CAPTURE_SRC" || { echo "ERROR: capture script fails bash -n" >&2; exit 1; }
[ -f "$CONFIG" ] || { echo "ERROR: $CONFIG missing — create it (0600, see README.md §2)" >&2; exit 1; }
[ -f "$CRED" ] || { echo "ERROR: $CRED missing — the O-BACKUP-6 designated credential file is required" >&2; exit 1; }
for f in "$CONFIG" "$CRED"; do
  mode="$(stat -c %a "$f")"
  [ "$mode" = "600" ] || { echo "ERROR: $f must be mode 0600 (is $mode)" >&2; exit 1; }
done

# Capture inputs and the local dump archive. The archive is root-only; the
# hand-off directories are deploy-owned so the unprivileged pipeline can read
# what root produced.
install -o root -g root -m 0700 -d /var/backups/mythos
install -o deploy -g deploy -m 0700 -d /home/deploy/mythos-backups \
  /home/deploy/mythos-backups/db-dumps /home/deploy/mythos-backups/staging \
  /home/deploy/mythos-backups/health
install -o root -g root -m 0700 "$CAPTURE_SRC" "$CAPTURE_DST"

for u in $UNITS; do
  [ -f "$SRC_DIR/$u" ] || { echo "ERROR: unit source $SRC_DIR/$u missing" >&2; exit 1; }
  install -o root -g root -m 0644 "$SRC_DIR/$u" "$UNIT_DIR/$u"
done

if command -v systemd-analyze >/dev/null 2>&1; then
  for u in mythos-backup-capture.service mythos-backup.service mythos-backup-verify.service mythos-restore-test.service; do
    systemd-analyze verify "$UNIT_DIR/$u" || { echo "ERROR: systemd-analyze rejected $u" >&2; exit 1; }
  done
fi

systemctl daemon-reload
for t in mythos-backup.timer mythos-backup-verify.timer mythos-restore-test.timer; do
  systemctl enable --now "$t"
done

echo "OK: backup timers installed and enabled:"
systemctl list-timers 'mythos-backup*' 'mythos-restore*' --no-pager || true
echo "Next: run one supervised backup now:  systemctl start mythos-backup.service && journalctl -u mythos-backup.service -n 30"
