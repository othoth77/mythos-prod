#!/bin/bash
# MYTHOS MCP registry check — launcher.
#
# The checker authenticates with at most three values: the bridge bearer
# and the gateway admin email + password. They live in the 0600 env files
# beside the deployment and this launcher exports ONLY those names into
# the checker's environment before exec'ing it. Nothing is echoed and
# nothing else from those files is exported. Same pattern, same reason as
# deployments/oth-mcp/oth-mcp-stdio.sh: a non-interactive shell exports
# nothing on its own.
set -euo pipefail
DEPLOY=${MYTHOS_GATEWAY_DEPLOY_DIR:-/home/deploy/deployments/mythos-gateway}
CHECK=${MYTHOS_MCP_REGISTRY_CHECK:-/home/deploy/projects/mythos-prod/projects/mythos-gateway/bin/mcp-registry-check}
OUT=${MYTHOS_MCP_STATUS_FILE:-$DEPLOY/mcp-registry-status.json}
[ -r "$CHECK" ] || { echo "mcp-registry-check: $CHECK not found" >&2; exit 78; }
pick() { grep -oP "(?<=^$2=).*" "$1" 2>/dev/null | head -1 || true; }
if [ -r "$DEPLOY/mcp-http.env" ]; then
  v=$(pick "$DEPLOY/mcp-http.env" MYTHOS_MCP_HTTP_TOKEN); [ -n "$v" ] && export MYTHOS_MCP_HTTP_TOKEN="$v"
fi
if [ -r "$DEPLOY/contextforge.env" ]; then
  for k in PLATFORM_ADMIN_EMAIL PLATFORM_ADMIN_PASSWORD; do
    v=$(pick "$DEPLOY/contextforge.env" "$k"); [ -n "$v" ] && export "$k=$v"
  done
fi
unset v
exec /usr/bin/node "$CHECK" --out "$OUT" "$@"
