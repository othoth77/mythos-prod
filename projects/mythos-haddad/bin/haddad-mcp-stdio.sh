#!/usr/bin/env bash
# =====================================================
# MYTHOS HADDAD — HAD-3: OTH MCP launcher for this machine (SSH-stdio)
# projects/mythos-haddad/bin/haddad-mcp-stdio.sh
#
# The SAME server the VPS runs — projects/oth-mcp/server.js, unchanged —
# started on Haddad with Haddad's configuration. This file is the Haddad
# twin of the VPS launcher /home/deploy/deployments/oth-mcp/oth-mcp-stdio.sh
# and exists for the same reason: `ssh host command` runs a NON-interactive
# shell, ~/.bashrc returns before exporting anything, so the upstream
# configuration has to be sourced here from a 0600 file.
#
# Client side (any tailnet peer that can already SSH to haddad):
#   { "mcpServers": { "haddad": { "command": "ssh",
#       "args": ["othman@100.78.7.10", "/home/othman/.local/bin/haddad-mcp-stdio.sh"] } } }
#
# No port, no listener, no daemon: one process per client, on that client's
# stdio, gone when the client disconnects. The MCP surface adds no access —
# whoever can run this could already run anything as `othman` over SSH.
#
# Credentials by reference: this file and mcp.env carry NO secret. The
# executor bearer is read at launch from the executor's OWN 0600 file
# (~/.config/mythos-ai-executor/executor.env, the file the executor itself
# reads) and handed to the server through the environment only. It is never
# echoed, logged or written anywhere else.
#
# Installed by bin/haddad-mcp-setup.sh (@REPO@ replaced at install time).
# =====================================================
set -euo pipefail

REPO="@REPO@"
CONFIG_DIR="${HADDAD_MCP_CONFIG_DIR:-$HOME/.config/mythos-haddad}"
ENV_FILE="$CONFIG_DIR/mcp.env"
SERVER="$REPO/projects/oth-mcp/server.js"

# Uninstalled copy (still in the repository): resolve the checkout it sits in.
if [ "$REPO" = "@REPO""@" ] || [ ! -f "$SERVER" ]; then
  REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
  SERVER="$REPO/projects/oth-mcp/server.js"
fi
[ -f "$SERVER" ] || { echo "haddad-mcp: server not found: $SERVER" >&2; exit 3; }

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

# Executor credential by reference (see header). An absent file is not an
# error here: the server then reports UPSTREAM_UNCONFIGURED for the executor
# tools, naming the owner, instead of guessing.
if [ -z "${OTH_MCP_EXECUTOR_TOKEN:-}" ] && [ -n "${OTH_MCP_EXECUTOR_TOKEN_FILE:-}" ] && [ -r "$OTH_MCP_EXECUTOR_TOKEN_FILE" ]; then
  OTH_MCP_EXECUTOR_TOKEN="$(sed -n 's/^MYTHOS_EXECUTOR_TOKEN=//p' "$OTH_MCP_EXECUTOR_TOKEN_FILE" | head -n 1)"
  [ -n "$OTH_MCP_EXECUTOR_TOKEN" ] && export OTH_MCP_EXECUTOR_TOKEN
fi
unset OTH_MCP_EXECUTOR_TOKEN_FILE

exec node "$SERVER"
