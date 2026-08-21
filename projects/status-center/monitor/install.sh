#!/usr/bin/env bash
# projects/status-center/monitor/install.sh — root-run installer for the
# STC-2 live monitor timer. Idempotent, fail-closed.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_DIR=/etc/systemd/system
DOCROOT=/var/www/status.mythosprod.xyz

[ "$(id -u)" -eq 0 ] || { echo "ERROR: must run as root" >&2; exit 1; }
command -v node >/dev/null || { echo "ERROR: node not found" >&2; exit 1; }
[ -f "$SRC_DIR/bin/monitor.js" ] || { echo "ERROR: monitor.js missing" >&2; exit 1; }
node --check "$SRC_DIR/bin/monitor.js" || { echo "ERROR: monitor.js fails node --check" >&2; exit 1; }
[ -d "$DOCROOT" ] || { echo "ERROR: $DOCROOT missing — deploy the Status Center site first (scripts/deploy-status-center.sh)" >&2; exit 1; }
mkdir -p "$DOCROOT/data/live-history"

for u in mythos-status-monitor.service mythos-status-monitor.timer; do
  [ -f "$SRC_DIR/systemd/$u" ] || { echo "ERROR: unit source $u missing" >&2; exit 1; }
  install -o root -g root -m 0644 "$SRC_DIR/systemd/$u" "$UNIT_DIR/$u"
done
if command -v systemd-analyze >/dev/null 2>&1; then
  systemd-analyze verify "$UNIT_DIR/mythos-status-monitor.service" \
    || { echo "ERROR: systemd-analyze rejected the service" >&2; exit 1; }
fi
systemctl daemon-reload
systemctl enable --now mythos-status-monitor.timer

# First supervised run so the page has data immediately.
systemctl start mythos-status-monitor.service
[ -f "$DOCROOT/data/live-status.json" ] || { echo "ERROR: first run produced no live-status.json" >&2; exit 1; }
echo "OK: live monitor installed; first snapshot written."
systemctl list-timers 'mythos-status-monitor*' --no-pager || true
