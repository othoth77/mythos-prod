#!/usr/bin/env bash
# =====================================================
# MYTHOS HADDAD — V0 user-level setup (idempotent, no root)
# projects/mythos-haddad/bin/haddad-setup.sh
#
# Safe to re-run. It only touches the current user's home:
#   * data/state directories for the AI runtime foundation and logs
#   * Claude Code installed in ~/.local (so `claude` is on PATH)
#   * SSH known_hosts entries for this machine's own names, taken from the
#     local host key file (never trusted over the network)
#   * systemd user timer running the health check every 30 minutes
# Steps that need root are listed at the end, never executed.
# =====================================================
set -euo pipefail
HADDAD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${HADDAD_DATA_DIR:-$HOME/.local/share/mythos-haddad}"
STATE_DIR="${HADDAD_STATE_DIR:-$HOME/.local/state/mythos-haddad}"
say() { printf '[haddad-setup] %s\n' "$*"; }

say "directories"
mkdir -p "$DATA_DIR/models" "$DATA_DIR/runtime" "$STATE_DIR/logs"

say "prerequisites"
for c in git node npm python3 ssh tailscale; do
  command -v "$c" >/dev/null || { say "MISSING: $c — install it first (see README, Setup)"; exit 1; }
done

if command -v claude >/dev/null; then
  say "claude already installed: $(claude --version)"
else
  say "installing Claude Code into ~/.local"
  npm install -g --prefix "$HOME/.local" @anthropic-ai/claude-code
fi
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) say "NOTE: add ~/.local/bin to PATH (log out/in; Ubuntu's ~/.profile adds it once the dir exists)";; esac

say "known_hosts for this machine's own names"
HOSTKEY=/etc/ssh/ssh_host_ed25519_key.pub
if [ -r "$HOSTKEY" ]; then
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh" && touch "$HOME/.ssh/known_hosts" && chmod 600 "$HOME/.ssh/known_hosts"
  names="$(hostname)"
  if command -v tailscale >/dev/null && tailscale status --json >/dev/null 2>&1; then
    names="$names $(tailscale status --json | python3 -c 'import json,sys; s=json.load(sys.stdin)["Self"]; print(" ".join([s["DNSName"].rstrip(".")] + s["TailscaleIPs"][:1]))')"
  fi
  for n in $names; do
    ssh-keygen -F "$n" >/dev/null 2>&1 || { echo "$n $(cut -d' ' -f1,2 "$HOSTKEY")" >> "$HOME/.ssh/known_hosts"; say "  added $n"; }
  done
fi

say "health timer (systemd user)"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
sed "s|@HADDAD_DIR@|$HADDAD_DIR|g" "$HADDAD_DIR/systemd/mythos-haddad-health.service" > "$UNIT_DIR/mythos-haddad-health.service"
cp "$HADDAD_DIR/systemd/mythos-haddad-health.timer" "$UNIT_DIR/"
systemctl --user daemon-reload
systemctl --user enable --now mythos-haddad-health.timer >/dev/null
say "  timer: $(systemctl --user is-active mythos-haddad-health.timer)"

if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]; then
  loginctl enable-linger "$USER" 2>/dev/null && say "  linger enabled" || say "  linger is OFF: the timer only runs while $USER has a session. Fix (root): sudo loginctl enable-linger $USER"
fi

cat <<NOTE

[haddad-setup] done. Verify with:  node $HADDAD_DIR/bin/haddad-health.js

Root-only steps (NOT executed by this script, see README):
  sudo apt install smartmontools lm-sensors          # deeper diagnostics (optional)
  PasswordAuthentication no  in /etc/ssh/sshd_config.d/   # after every client has a key
NOTE
