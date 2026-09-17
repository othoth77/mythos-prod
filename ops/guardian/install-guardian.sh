#!/usr/bin/env bash
# =====================================================
# MYTHOS Guardian V0 — installer
# ops/guardian/install-guardian.sh
#
# Run as `deploy`. NOT as root, and the script refuses to run as root.
#
# Guardian is an unprivileged observer. It writes nothing outside its own
# state directory, needs no capability and touches no system unit, so it
# does not need — and must not have — a root installation path.
#
# What it does, and nothing else:
#   1. links ~/.local/bin/mythos-guardian at the checkout's CLI
#   2. creates ~/.local/state/mythos-guardian (0700)
#   3. installs the systemd USER service + timer for deploy
#   4. runs `validate` and `selftest`, and STOPS if either fails
#   5. enables the timer only when --enable is passed
#
# It does NOT enable any remediation, because this version has none.
#
# Rollback (as deploy):
#   systemctl --user disable --now mythos-guardian.timer
#   rm -f ~/.local/bin/mythos-guardian
#   rm -f ~/.config/systemd/user/mythos-guardian.{service,timer}
#   systemctl --user daemon-reload
# The state directory is left in place: it is Guardian's own history and
# removing it is a separate, explicit decision.
# =====================================================
set -euo pipefail

ENABLE=0
DRY=0
for arg in "$@"; do
  case "$arg" in
    --enable) ENABLE=1 ;;
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" -eq 0 ]; then
  echo "refusing to run as root: Guardian is an unprivileged observer and installs into the deploy user session" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$HERE/bin/mythos-guardian"
BIN="$HOME/.local/bin"
STATE="$HOME/.local/state/mythos-guardian"
UNITS="$HOME/.config/systemd/user"

[ -x "$CLI" ] || { echo "missing or non-executable CLI: $CLI" >&2; exit 1; }
command -v node >/dev/null || { echo "node is not on PATH" >&2; exit 1; }

run() { if [ "$DRY" -eq 1 ]; then echo "  would run: $*"; else "$@"; fi; }

echo "MYTHOS Guardian installer"
echo "  checkout   $HERE"
echo "  cli        $CLI"
echo "  state      $STATE"
echo "  units      $UNITS"
[ "$DRY" -eq 1 ] && echo "  MODE       dry run: nothing will be changed"

# 1. state directory. 0700: Guardian's report names running processes and
#    unit states, which is nobody else's business on a shared host.
run mkdir -p "$STATE"
run chmod 700 "$STATE"

# 2. CLI link. A symlink, not a copy: the installed command and the merged
#    checkout can never drift apart.
run mkdir -p "$BIN"
run ln -sfn "$CLI" "$BIN/mythos-guardian"

# 3. user units.
run mkdir -p "$UNITS"
run cp "$HERE/systemd/mythos-guardian.service" "$UNITS/mythos-guardian.service"
run cp "$HERE/systemd/mythos-guardian.timer" "$UNITS/mythos-guardian.timer"
run systemctl --user daemon-reload

# 4. gates. Neither of these changes anything; both must pass before the
#    timer is allowed to run, so a broken configuration never becomes a
#    scheduled job.
echo
echo "-- validate"
if [ "$DRY" -eq 0 ]; then "$CLI" validate; else echo "  would run: $CLI validate"; fi
echo
echo "-- selftest (proves the enforced boundary on this host)"
if [ "$DRY" -eq 0 ]; then "$CLI" selftest; else echo "  would run: $CLI selftest"; fi

# 5. enablement is explicit.
echo
if [ "$ENABLE" -eq 1 ]; then
  run systemctl --user enable --now mythos-guardian.timer
  echo "TIMER ENABLED. Guardian observes every 2 minutes."
else
  echo "TIMER NOT ENABLED (no --enable)."
  echo "Guardian is installed and can be run by hand:"
  echo "    mythos-guardian run --dry-run     # observe, write nothing"
  echo "    mythos-guardian run               # observe, write Guardian state only"
  echo "    mythos-guardian status            # the last report"
  echo "Enable the schedule with:"
  echo "    systemctl --user enable --now mythos-guardian.timer"
fi
echo
echo "This version performs NO remediation. It cannot kill, restart, stop,"
echo "delete or clean anything, on any level, by design."
