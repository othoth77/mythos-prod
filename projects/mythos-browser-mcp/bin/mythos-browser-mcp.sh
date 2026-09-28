#!/usr/bin/env bash
# =====================================================
# MYTHOS Browser MCP — stdio launcher (what the estate registry points at)
# projects/mythos-browser-mcp/bin/mythos-browser-mcp.sh
#
# Installed as ~/.local/bin/mythos-browser-mcp.sh on the browser host (Haddad).
# Reads the Obscura CDP token from a 0600 env file into THIS process only,
# pins the CDP endpoint to loopback, and execs the server. The token is never
# echoed, never passed as an argument, never written anywhere else.
# =====================================================
set -euo pipefail
ENV_FILE="${OBSCURA_ENV_FILE:-$HOME/.config/obscura/cdp.env}"
REPO="${MYTHOS_BROWSER_MCP_REPO:-$HOME/projects/mythos-prod}"
if [ -f "$ENV_FILE" ]; then
  mode="$(stat -c %a "$ENV_FILE")"
  if [ "$mode" != "600" ] && [ "$mode" != "400" ]; then echo "refusing: $ENV_FILE mode is $mode, expected 600" >&2; exit 78; fi
  set -a; . "$ENV_FILE"; set +a
fi
export OBSCURA_CDP_URL="${OBSCURA_CDP_URL:-http://127.0.0.1:9222}"
export MYTHOS_BROWSER_ARTIFACTS="${MYTHOS_BROWSER_ARTIFACTS:-$HOME/.local/state/mythos-browser/artifacts}"
unset OBSCURA_ALLOW_PRIVATE_NETWORK   # never inherited, never set here
exec /usr/bin/env node "$REPO/projects/mythos-browser-mcp/server.js"
