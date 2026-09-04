#!/usr/bin/env bash
# MYTHOS — HOSTOPS-2R-FIX (GitHub issue #132): refreshes the supplementary
# groups of an already-running systemd --user manager after `usermod -aG`.
#
# THE BUG THIS FIXES. `usermod -aG mythos-hostops deploy` only edits
# /etc/group; it does not update the supplementary-group list of any
# process that already exists — including `user@<uid>.service`, the
# ROOT-started system unit that forks the per-user `systemd --user`
# manager and every unit under it (mythos-ai-executor.service included).
# Restarting mythos-ai-executor.service alone is not enough: that unit is
# a *child* of the still-running, still-stale user manager, so it inherits
# the manager's old (pre-usermod) group list, not a fresh read of
# /etc/group — which is exactly why the Executor kept seeing EACCES on
# /run/mythos-hostops/hostops.sock (0660 root:mythos-hostops) even after
# `deploy` was already a member of the group and the executor unit itself
# had been restarted.
#
# `SupplementaryGroups=` on the *user* unit is not a fix either: per
# systemd.exec(5), that directive only has an effect on system services —
# a systemd --user manager runs unprivileged and lacks CAP_SETGID to call
# setgroups(), so the unit fails outright with status=216/GROUP. That
# workaround is deliberately NOT used anywhere in this tree.
#
# THE FIX. `user@<uid>.service` is itself a system unit, started by PID 1
# (root). Restarting it (root-only, exactly what this script needs to be
# run as) forces a fresh `systemd --user` fork, which re-reads /etc/group
# at that moment — so every unit under it, including mythos-ai-executor,
# gets the current group membership from then on. No reboot, no fresh
# login, no SupplementaryGroups= anywhere.
#
# Idempotent and non-disruptive by design: a user with no active manager
# (e.g. `dagu`, a nologin system account, or `deploy` on a brand-new
# install with no prior login) has nothing running to refresh — the new
# group simply applies cleanly whenever that manager next starts, so this
# script is a no-op for them, not an error.
#
# Usage: refresh-group-membership.sh <username> [<username> ...]
# MYTHOS_HOSTOPS_SYSTEMCTL / MYTHOS_HOSTOPS_ID are dev/test-only overrides
# (mirror the daemon's own *_HOME/_ALLOWLIST/_DAEMON_SOCKET convention) so
# this logic can be exercised against a stub in tests without root or a
# real systemd instance; production never sets them.
set -euo pipefail

SYSTEMCTL="${MYTHOS_HOSTOPS_SYSTEMCTL:-systemctl}"
ID_BIN="${MYTHOS_HOSTOPS_ID:-id}"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <username> [<username> ...]" >&2
  exit 1
fi

for user in "$@"; do
  uid="$("$ID_BIN" -u "$user" 2>/dev/null)" || { echo "mythos-hostops: no such user $user, skipping"; continue; }
  unit="user@${uid}.service"
  if "$SYSTEMCTL" is-active --quiet "$unit" 2>/dev/null; then
    echo "mythos-hostops: restarting $unit to refresh $user's supplementary groups (picks up mythos-hostops membership)"
    "$SYSTEMCTL" restart "$unit"
  else
    echo "mythos-hostops: $unit not active, nothing to refresh for $user (new group applies on next login)"
  fi
done
