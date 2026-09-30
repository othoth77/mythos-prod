#!/usr/bin/env bash
# =====================================================
# MYTHOS HADDAD — HAD-2: AI runtime setup (idempotent, no root)
# projects/mythos-haddad/bin/haddad-runtime-setup.sh
#
# Ties together haddad-runtime-install.sh (llama.cpp Vulkan backend) and
# haddad-model-install.sh (the pinned Qwen model), generates a local API
# key if one is not already configured, installs the systemd user unit,
# and starts it. Safe to re-run — an existing key and a verified model are
# both left untouched.
#
# Rollback: `systemctl --user disable --now mythos-haddad-runtime` and
# delete ~/.local/share/mythos-haddad/runtime/llama.cpp — see
# docs/AI_RUNTIME.md, Rollback.
# =====================================================
set -euo pipefail
HADDAD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_PREFIX="${HADDAD_RUNTIME_PREFIX:-$HOME/.local/share/mythos-haddad/runtime/llama.cpp}"
MODEL_PATH="${HADDAD_MODEL_PATH:-$HOME/.local/share/mythos-haddad/models/qwen2.5-7b-instruct-q4_k_m/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf}"
CONFIG_DIR="$HOME/.config/mythos-haddad"
say() { printf '[haddad-runtime-setup] %s\n' "$*"; }

say "1/4 llama.cpp Vulkan backend"
bash "$HADDAD_DIR/bin/haddad-runtime-install.sh"

say "2/4 pinned model"
bash "$HADDAD_DIR/bin/haddad-model-install.sh"

say "3/4 local API key + config"
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"
if [ ! -s "$CONFIG_DIR/runtime.key" ]; then
  umask 077
  head -c 32 /dev/urandom | base64 | tr -d '=+/\n' > "$CONFIG_DIR/runtime.key"
  chmod 600 "$CONFIG_DIR/runtime.key"
  say "  generated a new local API key (never printed; see runtime.key)"
else
  say "  existing API key kept"
fi
touch "$CONFIG_DIR/runtime.env"
chmod 600 "$CONFIG_DIR/runtime.env"

say "4/4 systemd user unit"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
sed \
  -e "s|@HADDAD_DIR@|$HADDAD_DIR|g" \
  -e "s|@RUNTIME_PREFIX@|$RUNTIME_PREFIX|g" \
  -e "s|@MODEL_PATH@|$MODEL_PATH|g" \
  "$HADDAD_DIR/systemd/mythos-haddad-runtime.service" > "$UNIT_DIR/mythos-haddad-runtime.service"
systemctl --user daemon-reload
systemctl --user enable --now mythos-haddad-runtime.service
say "  unit: $(systemctl --user is-active mythos-haddad-runtime.service)"

cat <<NOTE

[haddad-runtime-setup] done.
Endpoint:  http://127.0.0.1:8600/v1  (loopback only, requires the API key)
Key file:  $CONFIG_DIR/runtime.key   (0600, never logged)
Verify:    node $HADDAD_DIR/bin/haddad-health.js
Logs:      journalctl --user -u mythos-haddad-runtime -n 50
Rollback:  systemctl --user disable --now mythos-haddad-runtime
           rm -rf $RUNTIME_PREFIX
NOTE
