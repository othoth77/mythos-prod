#!/usr/bin/env bash
# MYTHOS — owner installer for the mythos-hostops boundary.
# Run as root from the repository checkout:  bash ops/hostops/install-hostops.sh
# Idempotent. Installs: the dagu system user, the helper, the allowlist
# copy, the audit directory, the dagu sudo rule (manual/owner verification
# only, unrelated to the Executor path), and — HOSTOPS-2R (GitHub issue
# #130) — the mythos-hostops group, the root socket daemon and its
# systemd socket + service units, and — HOSTOPS-2R-FIX (GitHub issue #132)
# — a refresh of `deploy`/`dagu`'s already-running systemd --user manager
# so the new group membership actually takes effect without a reboot or
# fresh login. The Executor's own sudo path is GONE: mythos-ai-executor.service
# runs with NoNewPrivileges=true, which makes `sudo` unable to gain root
# from inside it no matter what sudoers grants, so HOSTOPS-1's
# `61-deploy-hostops` rule never actually worked in production. The socket
# boundary replaces it; see docs/MYTHOS_HOSTOPS_INTERFACE.md.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "must run as root" >&2; exit 1; }
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

# 1. dedicated system identity (no shell, no home login, no groups)
id dagu >/dev/null 2>&1 || useradd --system --shell /usr/sbin/nologin --home-dir /var/lib/mythos/hostops --no-create-home dagu

# 2. root-owned helper (0700 root:root — reached only through sudo (dagu,
#    manual/owner use) or the root socket daemon (deploy, the Executor))
install -o root -g root -m 0700 "$REPO_DIR/ops/hostops/mythos-hostops.js" /usr/local/sbin/mythos-hostops

# 3. root-owned allowlist copy (0644 root:root; the helper refuses it if not root-owned)
install -d -o root -g root -m 0755 /etc/mythos
install -o root -g root -m 0644 "$REPO_DIR/ops/dagu-poc/hostops-allowlist.json" /etc/mythos/hostops-allowlist.json

# 4. audit home (root-only; the helper runs as root and fails closed without it)
install -d -o root -g root -m 0700 /var/lib/mythos/hostops

# 5. dagu's sudo rule — manual/owner verification path only (validated
#    BEFORE install, never NOPASSWD:ALL). Unrelated to the Executor: dagu is
#    not wired into the READ path (HOSTOPS-1 decision) and this rule is not
#    reached by any hardened service's process tree.
visudo -cf "$REPO_DIR/ops/hostops/60-dagu-hostops"
install -o root -g root -m 0440 "$REPO_DIR/ops/hostops/60-dagu-hostops" /etc/sudoers.d/60-dagu-hostops

# 6. HOSTOPS-2R: the socket access group. Membership, not sudoers, is what
#    lets `deploy` (the Executor identity) and `dagu` reach the boundary now.
groupadd -f mythos-hostops
usermod -aG mythos-hostops deploy
usermod -aG mythos-hostops dagu

# 6b. HOSTOPS-2R-FIX (GitHub issue #132): `usermod -aG` above does not
#     update the supplementary groups of an already-running systemd --user
#     manager (or anything under it, e.g. mythos-ai-executor.service) —
#     only a restart of the manager's own system unit (user@<uid>.service,
#     root-only) does. Without this, a clean owner install on a host where
#     `deploy` already has an active session would leave the Executor
#     seeing EACCES on the socket until an unrelated reboot or logout.
#     Idempotent: a no-op for a user with no active manager yet.
bash "$REPO_DIR/ops/hostops/refresh-group-membership.sh" deploy dagu

# 7. HOSTOPS-2R: the root socket daemon (0700 root:root — invoked only by
#    systemd; never reachable via sudo, never a child of the Executor).
install -o root -g root -m 0700 "$REPO_DIR/ops/hostops/mythos-hostops-daemon.py" /usr/local/sbin/mythos-hostops-daemon

# 8. HOSTOPS-2R: the socket + service units. The socket unit owns
#    /run/mythos-hostops (RuntimeDirectory=) and the socket file's
#    permissions; only the socket is enabled — it starts the service on
#    first connection.
install -o root -g root -m 0644 "$REPO_DIR/ops/hostops/mythos-hostops.socket" /etc/systemd/system/mythos-hostops.socket
install -o root -g root -m 0644 "$REPO_DIR/ops/hostops/mythos-hostops.service" /etc/systemd/system/mythos-hostops.service
systemctl daemon-reload
systemctl enable --now mythos-hostops.socket

echo "installed: /usr/local/sbin/mythos-hostops (0700 root:root)"
echo "installed: /usr/local/sbin/mythos-hostops-daemon (0700 root:root)"
echo "installed: /etc/mythos/hostops-allowlist.json (0644 root:root)"
echo "installed: /etc/sudoers.d/60-dagu-hostops (0440, dagu manual/owner path only)"
echo "installed: mythos-hostops.socket + mythos-hostops.service (HOSTOPS-2R boundary)"
echo "group:     mythos-hostops ($(getent group mythos-hostops))"
echo "user:      dagu ($(id dagu))"
echo "refreshed: deploy/dagu systemd --user manager (if already running) — HOSTOPS-2R-FIX, GitHub issue #132"
echo "verify:    sudo -u dagu sudo /usr/local/sbin/mythos-hostops health   # dagu, manual sudo path"
echo "verify:    curl -s -H \"Authorization: Bearer \$TOKEN\" -X POST http://127.0.0.1:8130/hostops/run -d '{\"operation\":\"health\"}'   # deploy, via the Executor's socket path"
echo "verify:    journalctl -u mythos-hostops -n 50   # daemon startup + SO_PEERCRED-verified connections"
