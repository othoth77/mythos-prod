#!/usr/bin/env bash
# MYTHOS Autopilot — install the deploy USER timer (owner step, idempotent).
# Run as deploy:   bash ops/autopilot/install-autopilot.sh
# Installs the unit files, reloads the user manager and enables the timer in
# OBSERVE mode: no marker is created here, so the first ticks only measure
# and report. Enabling a mutation is a separate, explicit owner decision:
#   touch ~/mythos-ai-executor/autopilot/sync.enabled        # AUTO fast-forward
#   touch ~/mythos-ai-executor/autopilot/worktrees.enabled   # AUTO worktree removal
#   touch ~/mythos-ai-executor/autopilot/restart.auto.enabled # policy restarts (LEVEL_4)
# Rollback: rm the marker (instant) · systemctl --user disable --now mythos-autopilot.timer
set -euo pipefail
[ "$(id -un)" = "deploy" ] || { echo "run as deploy (this installs a USER unit)" >&2; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)
DST="$HOME/.config/systemd/user"
mkdir -p "$DST"
install -m 0644 "$HERE/mythos-autopilot.service" "$DST/mythos-autopilot.service"
install -m 0644 "$HERE/mythos-autopilot.timer" "$DST/mythos-autopilot.timer"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
# disable → daemon-reload → enable: the sequence that re-arms a relative timer
# in a live user manager (the plain cp + reload + restart path stays `elapsed`).
systemctl --user disable --now mythos-autopilot.timer 2>/dev/null || true
systemctl --user daemon-reload
systemctl --user enable --now mythos-autopilot.timer
systemctl --user list-timers --all --no-pager | grep -E 'NEXT|mythos-autopilot' || true
echo "installed: observe mode (no markers). Enable mutations per ops/autopilot/README.md"
