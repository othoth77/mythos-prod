#!/usr/bin/env bash
# =====================================================
# MYTHOS Session Guard — installer (GitHub Issue #144)
# ops/session-guard/install-session-guard.sh
#
# OWNER ACTION, run as root from a merged checkout. No agent installs this:
# writes under /etc/systemd and /usr/local are outside every agent's
# permission boundary, correctly.
#
# What it does, and nothing else:
#   1. copies session-guard.js + the runner to /usr/local/lib/mythos-session-guard
#      (root:root — root must never execute code from the deploy-writable checkout)
#   2. creates /var/lib/mythos-session-guard (0700 root:root)
#   3. installs mythos-session-guard.service + .timer and enables the timer
#
# It does NOT enable enforcement and does NOT signal anything. After this
# script the guard runs every 5 minutes in OBSERVE mode: it tracks
# sessions, writes its ledger and logs what it would reclaim. Enforcement
# is a separate, explicit decision:
#
#   enable   : touch /var/lib/mythos-session-guard/session-guard.enabled
#   rollback : rm    /var/lib/mythos-session-guard/session-guard.enabled
#
# Re-run this script after any merged change to session-guard.js or the
# runner: the installed copy is what the unit executes.
# =====================================================
set -euo pipefail

LIB=/usr/local/lib/mythos-session-guard
STATE=/var/lib/mythos-session-guard
UNITS=/etc/systemd/system
DOC=/usr/local/share/doc/mythos

if [ "$(id -u)" -ne 0 ]; then
  echo "must run as root" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
GUARD_LIB="$REPO/projects/mythos-ai-executor/lib/session-guard.js"

for f in "$GUARD_LIB" "$HERE/mythos-session-guard-run.js" \
         "$HERE/mythos-session-guard.service" "$HERE/mythos-session-guard.timer"; do
  [ -f "$f" ] || { echo "missing required file: $f" >&2; exit 1; }
done

command -v node >/dev/null || { echo "node is not on root's PATH" >&2; exit 1; }
[ -x /usr/bin/node ] || { echo "/usr/bin/node (the unit's ExecStart) is missing" >&2; exit 1; }

echo "==> code"
install -d -m 0755 -o root -g root "$LIB"
install -m 0644 -o root -g root "$GUARD_LIB"                    "$LIB/session-guard.js"
install -m 0755 -o root -g root "$HERE/mythos-session-guard-run.js" "$LIB/mythos-session-guard-run.js"
# Execution Lifecycle: the runner consults the deploy-owned registry and
# exports a host snapshot (pid ↔ session uuid ↔ turn state) through
# runtime-vps.js, installed beside it. Optional: an absent file means the
# guard behaves exactly as before.
RUNTIME_VPS="$REPO/projects/mythos-ai-executor/lib/lifecycle/runtime-vps.js"
if [ -f "$RUNTIME_VPS" ]; then
  install -m 0644 -o root -g root "$RUNTIME_VPS" "$LIB/runtime-vps.js"
fi

echo "==> lifecycle snapshot directory (root writes, deploy reads)"
DEPLOY_GID="$(getent group deploy | cut -d: -f3 || true)"
# 2750, not 0750: the setgid bit is load-bearing. The runner writes this
# snapshot as root restricted to CAP_KILL, which means it has no CAP_CHOWN
# and CANNOT hand the file to the deploy group after the fact — its
# best-effort chown fails with EPERM, silently. With setgid the kernel gives
# every file created here the directory's group, so the 0640 snapshot is
# group-readable by deploy without any privilege at all.
# Measured 2026-09-17: without it the snapshot lands root:root 0640 and
# every deploy-side reader gets EACCES on a file that exists.
install -d -m 2750 -o root -g "${DEPLOY_GID:-0}" /var/lib/mythos/lifecycle
# Existing installs were created 0750; re-apply so an upgrade fixes them too.
chmod 2750 /var/lib/mythos/lifecycle

echo "==> resource pressure publication directory (executor writes, guard reads)"
# The executor (deploy) publishes ONLY { level, updated_at } here, and the
# guard reads it holding CAP_KILL alone — it never needs the executor's
# private home. Deploy-owned 0755 inside root:deploy 0750 /var/lib/mythos:
# only root and the deploy group can reach it.
DEPLOY_UID="$(id -u deploy 2>/dev/null || true)"
if [ -n "$DEPLOY_UID" ] && [ -n "${DEPLOY_GID:-}" ]; then
  install -d -m 0755 -o "$DEPLOY_UID" -g "$DEPLOY_GID" /var/lib/mythos/pressure
else
  echo "   deploy user/group not found: /var/lib/mythos/pressure not created (guard will report pressure_source missing)" >&2
fi

echo "==> state directory (enforcement stays OFF: no enable marker is created)"
install -d -m 0700 -o root -g root "$STATE"

echo "==> documentation"
install -d -m 0755 "$DOC"
[ -f "$REPO/docs/MYTHOS_SESSION_GUARD.md" ] && install -m 0644 "$REPO/docs/MYTHOS_SESSION_GUARD.md" "$DOC/MYTHOS_SESSION_GUARD.md"

echo "==> units"
install -m 0644 -o root -g root "$HERE/mythos-session-guard.service" "$UNITS/mythos-session-guard.service"
install -m 0644 -o root -g root "$HERE/mythos-session-guard.timer"   "$UNITS/mythos-session-guard.timer"
systemctl daemon-reload
systemctl enable --now mythos-session-guard.timer

echo
echo "==> first run (observe mode)"
systemctl start mythos-session-guard.service
journalctl -u mythos-session-guard.service -n 5 --no-pager || true

cat <<EOF

Installed. The guard is running in OBSERVE mode every 5 minutes and will
not signal anything.

  watch it        journalctl -u mythos-session-guard.service -f
  ledger          cat $STATE/session-guard.jsonl
  what it would do
                  MYTHOS_SESSION_GUARD_HOME=$STATE node $LIB/mythos-session-guard-run.js

When the observed plan looks right for several hours:

  enable          touch $STATE/session-guard.enabled
  rollback        rm    $STATE/session-guard.enabled
  hard off        systemctl disable --now mythos-session-guard.timer

Optional, separate owner decision — soft memory ceiling on the root login
slice that holds the Desktop Remote sessions:
  ops/session-guard/user-0.slice.d/memory.conf
EOF
