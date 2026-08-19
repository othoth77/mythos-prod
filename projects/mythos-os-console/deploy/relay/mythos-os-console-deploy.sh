#!/usr/bin/env bash
# Mythos OS Console — Phase-8 deployment relay (stage MOS-v2 M-02).
#
# SYSTEM unit running as `deploy`, mirroring `mythos-git-push.service`, so
# an authorized non-deploy session (e.g. `ubuntu`) can trigger the
# console's own `tools/deploy.sh` AS deploy without ever holding
# `deploy`'s credentials. `docs/AI_HANDOVER.md` (MOS-1.6, MOS-1.7)
# identifies exactly this shape as the only remaining unblock path, after
# `sudo -u deploy` and `systemctl --machine=deploy@.host --user` were
# both tested from a real host session and refused at the D-Bus/session
# boundary.
#
# Scope: runs exactly one command — the repository's own
# projects/mythos-os-console/tools/deploy.sh, unmodified, with no flags,
# no --assume-yes. deploy.sh is itself the safety boundary for what this
# relay does (see its own header): it refuses to run off the real host,
# will not proceed if tests/mos-1-console-test.js fails, refuses outright
# if xtrace is enabled (so it cannot leak the executor token), gates every
# phase behind a live health check, and — critically — stops for an
# explicit interactive "y" before ever requesting a real TLS certificate.
#
# This relay does NOT change that: started with no controlling terminal
# (as any systemd unit is), any step of deploy.sh that needs interactive
# confirmation — first-run token entry (Phase 2, only if no credential
# file exists yet) or the real-certificate request (Phase 8) — receives
# immediate EOF on `read` and fails closed ("declined by operator" /
# empty-input die), rather than proceeding unattended. That is deliberate:
# an irreversible, rate-limited action must still get a human "yes",
# typed by a human at a terminal. Re-running this relay after those two
# one-time steps have been done interactively is safe and idempotent —
# every phase of deploy.sh re-checks its own prior result first.
#
# ExecStart (in the paired .service) points at a ROOT-OWNED copy of this
# file in /usr/local/bin, not at this repo checkout, for the same reason
# as mythos-git-push.service: the checkout is writable by `ubuntu`, so the
# *trigger* must be root-owned. deploy.sh itself is deliberately still
# read live from the shared checkout — it already documents itself as the
# thing an operator runs directly from that checkout as deploy, it is not
# a secret-bearing file, and it re-verifies its own preconditions (host
# identity, git HEAD, tests) on every single run regardless of who starts
# it.
#
# Privilege note (read before installing): unlike the restart relay,
# this unit does NOT set NoNewPrivileges=true. deploy.sh's Phases 5, 6
# and 8 call `sudo nginx -t`, `sudo systemctl reload nginx`, and
# `sudo certbot` — deploy's own sudoers grant, already scoped to exactly
# those three commands (see deploy.sh's header). NoNewPrivileges would
# silently break every one of those calls, which is a worse outcome than
# the (unweakened) three-command sudo boundary that already exists
# independent of this unit. This relay adds no new privilege: it only
# lets an authorized session start, as deploy, work deploy could already
# do for itself.
#
# Fix (chief review, MOS-v2 M-02 round 2): deploy.sh's own Phase 3 calls
# `systemctl --user daemon-reload`, `systemctl --user enable --now`,
# `systemctl --user restart`, and `systemctl --user is-active` against
# the console's user service. Those are exactly the calls
# mythos-os-console-restart.sh already had to provide deploy's session
# environment for (a root-installed system unit with User=deploy has no
# login session, so XDG_RUNTIME_DIR/DBUS_SESSION_BUS_ADDRESS are not set
# by default). The first version of this script omitted that, so Phase 3
# of a relay-triggered deploy.sh run would have failed the same way
# `sudo -u deploy systemctl --user ...` did in MOS-1.6. Fixed below by
# exporting the identical two variables the restart relay uses, before
# deploy.sh ever runs.
#
# Prerequisite (read before installing): M-01 — the console's own
# deployment — must already be live, i.e. Phases 0-7 of deploy.sh have
# already succeeded at least once (interactively, by the operator, as
# deploy.sh's own header requires). Do not install or start this relay
# before that. See RUNBOOK.md.
#
# Install (root, one-time):
#   cp projects/mythos-os-console/deploy/relay/mythos-os-console-deploy.sh \
#     /usr/local/bin/mythos-os-console-deploy        # then: chmod 0755, chown root:root
#   cp projects/mythos-os-console/deploy/relay/mythos-os-console-deploy.service \
#     /etc/systemd/system/
#   systemctl daemon-reload
set -euo pipefail

# Same as mythos-os-console-restart.sh, and for the same reason: deploy.sh
# talks to deploy's systemd --user manager internally (Phase 3), and this
# process starts with no login session of its own to inherit it from.
DEPLOY_UID="${MYTHOS_DEPLOY_UID:-1001}"
export XDG_RUNTIME_DIR="/run/user/${DEPLOY_UID}"
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${DEPLOY_UID}/bus"

REPO=/home/deploy/projects/mythos-prod
exec bash "$REPO/projects/mythos-os-console/tools/deploy.sh"
