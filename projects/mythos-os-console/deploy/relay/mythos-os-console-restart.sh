#!/usr/bin/env bash
# Mythos OS Console — restart relay (stage MOS-v2 M-02).
#
# SYSTEM unit running as `deploy`, the user that owns the console's
# systemd --user service (installed by M-01; see
# ../mythos-os-console.user.service). It exists because a session
# identity without `deploy`'s credentials — e.g. `ubuntu`, which runs
# this repository's automation — has no path to `deploy`'s own systemd
# --user manager. `docs/AI_HANDOVER.md` (MOS-1.6, MOS-1.7) records two
# tested and refused attempts at that path: `sudo -u deploy` (no D-Bus
# session environment) and `systemctl --machine=deploy@.host --user`
# (the session bus socket itself refuses a non-owning UID). This relay
# does not defeat that boundary — it runs the restart AS deploy, via a
# root-installed system unit, so `deploy`'s own already-authorized
# identity performs the action. No credential is borrowed, read, or
# escalated.
#
# Scope: exactly one action — restart the already-installed
# mythos-os-console user service and confirm it came back up. Nothing
# else. It does not install or modify the unit, nginx, TLS, or the
# console's env file, and it reads no secret: `systemctl restart` never
# touches the contents of that file.
#
# ExecStart (in the paired .service) points at a ROOT-OWNED copy of this
# file in /usr/local/bin, deliberately not at this repo checkout: the
# checkout is writable by `ubuntu`, and code that runs as `deploy` must
# not be editable by a less-privileged user — the same reasoning
# `mythos-git-push.service` already applies to git delivery.
#
# Prerequisite (read before installing): M-01 — the console's own
# deployment — must already be live. This script only restarts an
# existing `mythos-os-console` user unit; it does not create one. Running
# it before M-01 has installed that unit fails with "Unit
# mythos-os-console.service not found," which is the safe, expected
# failure mode, not a bug to work around.
#
# Install (root, one-time):
#   cp projects/mythos-os-console/deploy/relay/mythos-os-console-restart.sh \
#     /usr/local/bin/mythos-os-console-restart        # then: chmod 0755, chown root:root
#   cp projects/mythos-os-console/deploy/relay/mythos-os-console-restart.service \
#     /etc/systemd/system/
#   systemctl daemon-reload
#
# See projects/mythos-os-console/deploy/relay/RUNBOOK.md for execute,
# verify, and rollback steps. This file is never executed by systemd from
# this path — only the root-owned /usr/local/bin copy is.
set -euo pipefail

# `deploy`'s own systemd --user manager and D-Bus session bus, kept alive
# across logout by `loginctl enable-linger deploy` (confirmed active,
# uid 1001, in docs/AI_HANDOVER.md MOS-1.6). A root-installed system unit
# with User=deploy runs its process under deploy's UID but starts with no
# login session, so these two variables must be set explicitly here —
# the same discipline `mythos-git-push.sh` uses for GIT_SSH_COMMAND rather
# than relying on ambient environment.
DEPLOY_UID="${MYTHOS_DEPLOY_UID:-1001}"
export XDG_RUNTIME_DIR="/run/user/${DEPLOY_UID}"
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${DEPLOY_UID}/bus"

UNIT=mythos-os-console

systemctl --user restart "$UNIT"
systemctl --user is-active --quiet "$UNIT" \
  || { journalctl --user -u "$UNIT" -n 30 --no-pager >&2 || true; echo "REFUSED: $UNIT is not active after restart" >&2; exit 1; }

echo "restarted: $UNIT is $(systemctl --user is-active "$UNIT")"
