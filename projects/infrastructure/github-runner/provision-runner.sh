#!/usr/bin/env bash
# =====================================================
# Mythos OS — self-hosted GitHub Actions runner provisioning
# (operator-executable, root, ON THE MYTHOS VPS ONLY)
#
# Usage (as root on the VPS):
#   RUNNER_TOKEN=<registration-token> \
#   RUNNER_VERSION=<x.y.z> \
#   [RUNNER_SHA256=<sha256-of-tarball>] \
#   bash provision-runner.sh
#
# RUNNER_TOKEN is the short-lived registration token from
# GitHub → othoth77/mythos-prod → Settings → Actions → Runners →
# "New self-hosted runner". Take RUNNER_VERSION and RUNNER_SHA256 from
# the SAME page (GitHub displays the exact version and checksum there).
# The token is consumed by config.sh and is NEVER written to disk by
# this script, never echoed, and must never be committed anywhere.
#
# What this creates (idempotent):
#   - system account `mythos-runner` (no docker, no sudo, no mythos-gov,
#     locked password, home /opt/mythos-gh-runner)
#   - the GitHub runner installed in /opt/mythos-gh-runner, registered
#     REPO-SCOPED to othoth77/mythos-prod with label `mythos-vps`
#   - hardened system unit mythos-gh-runner.service (NoNewPrivileges,
#     ProtectSystem=full, ProtectHome=read-only), enabled + started
#
# It never touches governance files, deploy's account, docker
# membership, firewall rules, or any Mythos service.
# =====================================================
set -euo pipefail

RUNNER_USER=mythos-runner
RUNNER_HOME=/opt/mythos-gh-runner
REPO_URL=https://github.com/othoth77/mythos-prod
UNIT_NAME=mythos-gh-runner.service
HERE="$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "ERROR: run as root (installs a system unit)" >&2; exit 1; }
[ -n "${RUNNER_TOKEN:-}" ] || { echo "ERROR: RUNNER_TOKEN not set (see header)" >&2; exit 1; }
[ -n "${RUNNER_VERSION:-}" ] || { echo "ERROR: RUNNER_VERSION not set (e.g. 2.325.0, from the GitHub runner page)" >&2; exit 1; }
printf '%s' "$RUNNER_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "ERROR: RUNNER_VERSION must be x.y.z" >&2; exit 1; }
if [ -n "${RUNNER_SHA256:-}" ]; then
  printf '%s' "$RUNNER_SHA256" | grep -Eq '^[0-9a-f]{64}$' || { echo "ERROR: RUNNER_SHA256 must be 64 hex chars" >&2; exit 1; }
else
  echo "WARNING: RUNNER_SHA256 not provided — tarball checksum will NOT be verified." >&2
  echo "         Take it from the GitHub 'New self-hosted runner' page and re-run." >&2
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) PKG_ARCH=x64 ;;
  aarch64) PKG_ARCH=arm64 ;;
  *) echo "ERROR: unsupported arch $ARCH" >&2; exit 1 ;;
esac
TARBALL="actions-runner-linux-${PKG_ARCH}-${RUNNER_VERSION}.tar.gz"
DL_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${TARBALL}"

echo "== 1/6 dedicated least-privilege account =="
if id "$RUNNER_USER" >/dev/null 2>&1; then
  echo "   $RUNNER_USER exists — reusing"
else
  useradd --system --create-home --home-dir "$RUNNER_HOME" --shell /bin/bash "$RUNNER_USER"
  passwd -l "$RUNNER_USER" >/dev/null
  echo "   created $RUNNER_USER (locked password)"
fi
# hard guarantees the gate order requires — fail loudly, never "fix" by widening
GROUPS_NOW="$(id -nG "$RUNNER_USER")"
for banned in docker sudo mythos-gov root; do
  if printf '%s\n' $GROUPS_NOW | grep -qx "$banned"; then
    echo "ERROR: $RUNNER_USER is in banned group '$banned' — remove it and re-run" >&2; exit 1
  fi
done
if [ -d /etc/sudoers.d ] && grep -rl "$RUNNER_USER" /etc/sudoers.d/ 2>/dev/null | grep -q .; then
  echo "ERROR: sudoers.d entry mentions $RUNNER_USER — the runner must have NO sudo" >&2; exit 1
fi
mkdir -p "$RUNNER_HOME"
chown "$RUNNER_USER:$RUNNER_USER" "$RUNNER_HOME"
chmod 750 "$RUNNER_HOME"

echo "== 2/6 runner package =="
if [ -x "$RUNNER_HOME/run.sh" ] && [ -f "$RUNNER_HOME/.runner" ]; then
  echo "   runner already installed and configured — skipping download/config"
  SKIP_CONFIG=1
else
  SKIP_CONFIG=0
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  echo "   downloading $DL_URL"
  curl -fsSL -o "$TMP/$TARBALL" "$DL_URL"
  if [ -n "${RUNNER_SHA256:-}" ]; then
    echo "${RUNNER_SHA256}  $TMP/$TARBALL" | sha256sum -c - || { echo "ERROR: checksum mismatch — aborting" >&2; exit 1; }
  fi
  sudo -u "$RUNNER_USER" tar -xzf "$TMP/$TARBALL" -C "$RUNNER_HOME"
  if [ -x "$RUNNER_HOME/bin/installdependencies.sh" ]; then
    "$RUNNER_HOME/bin/installdependencies.sh" || echo "   (dependency install reported issues — check above)"
  fi
fi

echo "== 3/6 repo-scoped registration =="
if [ "$SKIP_CONFIG" -eq 0 ]; then
  # config.sh refuses root by design; token passed via argv within this
  # root shell only, exchanged immediately, never persisted by us.
  sudo -u "$RUNNER_USER" bash -c "cd '$RUNNER_HOME' && ./config.sh \
    --url '$REPO_URL' \
    --token \"\$RUNNER_TOKEN\" \
    --name mythos-vps-runner \
    --labels mythos-vps \
    --work _work \
    --unattended" RUNNER_TOKEN="$RUNNER_TOKEN"
else
  echo "   already registered — skipping"
fi

echo "== 4/6 hardened systemd unit =="
install -m 0644 "$HERE/mythos-gh-runner.service" "/etc/systemd/system/$UNIT_NAME"
systemctl daemon-reload
systemctl enable "$UNIT_NAME" >/dev/null
systemctl restart "$UNIT_NAME"

echo "== 5/6 service state =="
sleep 3
systemctl --no-pager --lines=5 status "$UNIT_NAME" || true
systemctl is-active "$UNIT_NAME" >/dev/null || { echo "ERROR: unit not active" >&2; exit 1; }
systemctl is-enabled "$UNIT_NAME" >/dev/null || { echo "ERROR: unit not enabled (won't survive reboot)" >&2; exit 1; }

echo "== 6/6 security verification =="
bash "$HERE/verify-runner.sh"

echo ""
echo "DONE. Now check GitHub → Settings → Actions → Runners: 'mythos-vps-runner' should be Idle."
echo "Then dispatch the 'VPS Final Gate' workflow (workflow_dispatch) for the smoke + gate jobs."
