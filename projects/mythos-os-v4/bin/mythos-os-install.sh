#!/usr/bin/env bash
# =====================================================
# MYTHOS OS v4 — install the watchdog and health timers (systemd --user)
# projects/mythos-os-v4/bin/mythos-os-install.sh
#
#   mythos-os-install.sh            install + enable both timers
#   mythos-os-install.sh --dry-run  print what would be installed
#   mythos-os-install.sh --remove   disable and remove them
#
# Run it FROM THE LIVE CHECKOUT, after the branch is merged: the units name
# this directory, and a unit that points at a worktree stops existing when
# the worktree does. The script refuses a checkout that is not on the
# default branch unless --allow-branch is given.
# No root, no secret, nothing outside ~/.config/systemd/user.
# =====================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNITS=(mythos-os-watchdog.service mythos-os-watchdog.timer mythos-os-health.service mythos-os-health.timer)
MODE=install
ALLOW_BRANCH=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE=dry ;;
    --remove) MODE=remove ;;
    --allow-branch) ALLOW_BRANCH=1 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

if [ "$MODE" = remove ]; then
  systemctl --user disable --now mythos-os-watchdog.timer mythos-os-health.timer 2>/dev/null || true
  for u in "${UNITS[@]}"; do rm -f "$UNIT_DIR/$u"; done
  systemctl --user daemon-reload
  echo "removed: ${UNITS[*]}"
  exit 0
fi

branch="$(git -C "$HERE" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
if [ "$branch" != main ] && [ "$ALLOW_BRANCH" != 1 ]; then
  echo "REFUSED: $HERE is on '$branch', not main. Install from the live checkout after the merge (or pass --allow-branch)." >&2
  exit 2
fi

node "$HERE/bin/mythos-os" health >/dev/null || { echo "REFUSED: 'mythos-os health' reports FAIL on this host — fix that before scheduling it." >&2; exit 3; }

for u in "${UNITS[@]}"; do
  if [ "$MODE" = dry ]; then
    echo "--- $UNIT_DIR/$u"; sed "s|@MYTHOS_OS_DIR@|$HERE|g" "$HERE/systemd/$u"
  else
    mkdir -p "$UNIT_DIR"
    sed "s|@MYTHOS_OS_DIR@|$HERE|g" "$HERE/systemd/$u" > "$UNIT_DIR/$u"
  fi
done
[ "$MODE" = dry ] && exit 0

systemctl --user daemon-reload
systemctl --user enable --now mythos-os-watchdog.timer mythos-os-health.timer
systemctl --user list-timers 'mythos-os-*' --no-pager
