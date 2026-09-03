#!/usr/bin/env bash
# MYTHOS — owner installer for the mythos-hostops v0.1 READ-ONLY boundary.
# Run as root from the repository checkout:  bash ops/hostops/install-hostops.sh
# Idempotent. Installs NOTHING beyond: the dagu system user, the helper,
# the allowlist copy, the audit directory and the one sudoers rule.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "must run as root" >&2; exit 1; }
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

# 1. dedicated system identity (no shell, no home login, no groups)
id dagu >/dev/null 2>&1 || useradd --system --shell /usr/sbin/nologin --home-dir /var/lib/mythos/hostops --no-create-home dagu

# 2. root-owned helper (0700 root:root — dagu reaches it only through sudo)
install -o root -g root -m 0700 "$REPO_DIR/ops/hostops/mythos-hostops.js" /usr/local/sbin/mythos-hostops

# 3. root-owned allowlist copy (0644 root:root; the helper refuses it if not root-owned)
install -d -o root -g root -m 0755 /etc/mythos
install -o root -g root -m 0644 "$REPO_DIR/ops/dagu-poc/hostops-allowlist.json" /etc/mythos/hostops-allowlist.json

# 4. audit home (root-only; the helper runs as root and fails closed without it)
install -d -o root -g root -m 0700 /var/lib/mythos/hostops

# 5. the one sudo rule — validated BEFORE install, never NOPASSWD:ALL
visudo -cf "$REPO_DIR/ops/hostops/60-dagu-hostops"
install -o root -g root -m 0440 "$REPO_DIR/ops/hostops/60-dagu-hostops" /etc/sudoers.d/60-dagu-hostops

# 6. HOSTOPS-1: the executor identity (deploy) gets the same single-binary rule
visudo -cf "$REPO_DIR/ops/hostops/61-deploy-hostops"
install -o root -g root -m 0440 "$REPO_DIR/ops/hostops/61-deploy-hostops" /etc/sudoers.d/61-deploy-hostops

echo "installed: /usr/local/sbin/mythos-hostops (0700 root:root)"
echo "installed: /etc/mythos/hostops-allowlist.json (0644 root:root)"
echo "installed: /etc/sudoers.d/60-dagu-hostops + 61-deploy-hostops (0440)"
echo "user:      dagu ($(id dagu))"
echo "verify:    sudo -u dagu sudo /usr/local/sbin/mythos-hostops health"
