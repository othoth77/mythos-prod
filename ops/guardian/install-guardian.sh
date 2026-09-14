#!/usr/bin/env bash
# =====================================================
# MYTHOS Guardian — installer / rollback (root)
# ops/guardian/install-guardian.sh
#
#   install-guardian.sh install [--with-session-guard-pressure] [--with-status-monitor-bounds]
#   install-guardian.sh rollback
#   install-guardian.sh status
#
# install copies the reviewed repository files into
# /usr/local/lib/mythos-guardian (root:root) — root never runs the
# deploy-writable checkout — installs the unit + timer, runs ONE supervised
# tick, and only then enables the timer. It never creates an enable marker:
# a fresh install observes and reports, it does not act.
#
# rollback disables the timer, removes exactly the units and drop-ins this
# script installs, and keeps /var/lib/mythos-guardian (incident evidence).
# =====================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DEST=/usr/local/lib/mythos-guardian
UNITDIR=/etc/systemd/system
STATE=/var/lib/mythos-guardian
SG_DROPIN="$UNITDIR/mythos-session-guard.service.d/20-guardian-pressure.conf"
SM_DROPIN="$UNITDIR/mythos-status-monitor.service.d/20-bounds.conf"

die() { echo "install-guardian: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "must run as root"
command -v node >/dev/null || die "node not found"

preflight() {
  local f
  for f in "$HERE"/lib/*.js "$HERE/bin/mythos-guardian" "$REPO/projects/mythos-ai-executor/lib/resource-guard.js"; do
    node --check "$f" || die "syntax check failed: $f"
  done
  node "$HERE/bin/mythos-guardian" validate || die "configuration invalid — refusing to install"
  node "$REPO/tests/mythos-guardian-test.js" >/tmp/mythos-guardian-install-test.log 2>&1 \
    || die "test suite failed — see /tmp/mythos-guardian-install-test.log"
  echo "preflight: syntax, config and test suite OK"
}

cmd_install() {
  local with_sg=0 with_sm=0 a
  for a in "$@"; do
    case "$a" in
      --with-session-guard-pressure) with_sg=1 ;;
      --with-status-monitor-bounds) with_sm=1 ;;
      *) die "unknown option $a" ;;
    esac
  done
  preflight

  local stage="$DEST.new.$$"
  rm -rf "$stage"
  install -d -m 0755 -o root -g root "$stage" "$stage/lib" "$stage/bin" "$stage/docs"
  install -m 0644 -o root -g root "$HERE"/lib/*.js "$stage/lib/"
  install -m 0644 -o root -g root "$REPO/projects/mythos-ai-executor/lib/resource-guard.js" "$stage/lib/resource-guard.js"
  install -m 0755 -o root -g root "$HERE/bin/mythos-guardian" "$stage/bin/mythos-guardian"
  if compgen -G "$REPO/docs/guardian/*.md" >/dev/null; then install -m 0644 -o root -g root "$REPO"/docs/guardian/*.md "$stage/docs/"; fi
  git -C "$REPO" rev-parse HEAD > "$stage/SOURCE_COMMIT" 2>/dev/null || echo unknown > "$stage/SOURCE_COMMIT"
  node "$stage/bin/mythos-guardian" validate >/dev/null || { rm -rf "$stage"; die "staged copy failed validation"; }
  if [ -d "$DEST" ]; then rm -rf "$DEST.prev"; mv "$DEST" "$DEST.prev"; fi
  mv "$stage" "$DEST"

  install -d -m 0700 -o root -g root "$STATE" "$STATE/enable"
  install -m 0644 -o root -g root "$HERE/systemd/mythos-guardian.service" "$UNITDIR/mythos-guardian.service"
  install -m 0644 -o root -g root "$HERE/systemd/mythos-guardian.timer" "$UNITDIR/mythos-guardian.timer"
  if [ "$with_sg" = 1 ]; then
    install -d -m 0755 "$(dirname "$SG_DROPIN")"
    install -m 0644 -o root -g root "$HERE/systemd/mythos-session-guard.service.d/20-guardian-pressure.conf" "$SG_DROPIN"
  fi
  if [ "$with_sm" = 1 ]; then
    install -d -m 0755 "$(dirname "$SM_DROPIN")"
    install -m 0644 -o root -g root "$HERE/systemd/mythos-status-monitor.service.d/20-bounds.conf" "$SM_DROPIN"
  fi
  systemctl daemon-reload
  systemd-analyze verify "$UNITDIR/mythos-guardian.service" "$UNITDIR/mythos-guardian.timer" 2>&1 | grep -v 'Unknown key name' || true

  echo "supervised first tick..."
  systemctl start mythos-guardian.service || die "first tick failed: journalctl -u mythos-guardian -n 50"
  [ "$(systemctl show mythos-guardian.service -p Result --value)" = success ] || die "first tick result not success"
  [ -s "$STATE/public/status.json" ] || die "first tick wrote no public status"
  systemctl enable --now mythos-guardian.timer
  echo "installed $(cat "$DEST/SOURCE_COMMIT"); markers present: $(ls -A "$STATE/enable" | tr '\n' ' ')"
  cmd_status
}

cmd_rollback() {
  systemctl disable --now mythos-guardian.timer 2>/dev/null || true
  rm -f "$UNITDIR/mythos-guardian.service" "$UNITDIR/mythos-guardian.timer" "$SG_DROPIN" "$SM_DROPIN"
  rmdir "$(dirname "$SG_DROPIN")" "$(dirname "$SM_DROPIN")" 2>/dev/null || true
  systemctl daemon-reload
  if [ -d "$DEST" ]; then mv "$DEST" "$DEST.removed.$(date -u +%Y%m%dT%H%M%SZ)"; fi
  echo "rolled back: timer disabled, units and drop-ins removed; evidence kept in $STATE"
}

cmd_status() {
  systemctl list-timers mythos-guardian.timer --no-pager || true
  systemctl show mythos-guardian.service -p Result -p ExecMainExitTimestamp --no-pager || true
  node "$DEST/bin/mythos-guardian" status 2>/dev/null | head -40 || echo "no status yet"
}

case "${1:-}" in
  install) shift; cmd_install "$@" ;;
  rollback) cmd_rollback ;;
  status) cmd_status ;;
  *) echo "usage: $0 install [--with-session-guard-pressure] [--with-status-monitor-bounds] | rollback | status" >&2; exit 2 ;;
esac
