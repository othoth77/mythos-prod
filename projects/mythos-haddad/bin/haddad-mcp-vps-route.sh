#!/usr/bin/env bash
# =====================================================
# MYTHOS HADDAD — HAD-3c: publish the Haddad MCP at https://mythosprod.xyz/mcphaddad
# projects/mythos-haddad/bin/haddad-mcp-vps-route.sh   (run as root ON THE VPS)
#
#   haddad-mcp-vps-route.sh            preflight, install, nginx -t, reload, verify
#   haddad-mcp-vps-route.sh --check    preflight only, changes nothing
#   haddad-mcp-vps-route.sh --remove   take the route out again
#
# Adds ONE nginx location (nginx/mythos-mcp-haddad.conf) to the apex vhost,
# directly after the existing mythos-mcp-auth include. /mcp is not touched.
# Never runs `tailscale up`, never touches Funnel/Serve, never reads a bearer:
# joining the VPS to the tailnet is the owner's action (HADDAD_MCP.md §13).
# Refuses to install unless the VPS already reaches Haddad over TLS with a
# certificate that verifies for haddad.tail23f990.ts.net.
# =====================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$HERE/nginx/mythos-mcp-haddad.conf"
VHOST="${MYTHOS_APEX_VHOST:-/etc/nginx/sites-available/mythosprod.xyz}"
SNIP="${MYTHOS_NGINX_SNIPPETS:-/etc/nginx/snippets}/mythos-mcp-haddad.conf"
ANCHOR='include snippets/mythos-mcp-auth.conf;'
LINE='    include snippets/mythos-mcp-haddad.conf;'
NODE_IP=100.78.7.10 NODE_NAME=haddad.tail23f990.ts.net
mode="${1:-install}"

preflight() {
  command -v tailscale >/dev/null || { echo "PENDING owner action — tailscale is not installed on this VPS (HADDAD_MCP.md §13)"; return 2; }
  tailscale status >/dev/null 2>&1 || { echo "PENDING owner action — this VPS is not joined to the tailnet (HADDAD_MCP.md §13)"; return 2; }
  if tailscale funnel status 2>/dev/null | grep -qi 'funnel on'; then echo "REFUSED — Funnel is on for this node"; return 1; fi
  local code
  code=$(curl -sS -m 10 -o /dev/null -w '%{http_code}' --resolve "$NODE_NAME:443:$NODE_IP" -X POST "https://$NODE_NAME/mcp" -H 'content-type: application/json' -d '{}' || true)
  [ "$code" = 401 ] || { echo "FAIL — https://$NODE_NAME/mcp via $NODE_IP answered '$code' (want 401 from the bridge, strict TLS)"; return 1; }
  echo "ok — VPS reaches the Haddad bridge over the tailnet (401 without bearer, certificate verified)"
}

case "$mode" in
  --check) preflight; exit $? ;;
  --remove)
    cp -a "$VHOST" "$VHOST.bak-mcphaddad-$(date +%Y%m%d-%H%M%S)"
    sed -i '\#^    include snippets/mythos-mcp-haddad.conf;$#d' "$VHOST"; rm -f "$SNIP"
    nginx -t && systemctl reload nginx; echo "removed"; exit 0 ;;
  install) ;;
  *) echo "usage: $0 [--check|--remove]"; exit 2 ;;
esac

[ "$(id -u)" = 0 ] || { echo "run as root"; exit 2; }
preflight || exit $?
grep -qF "$ANCHOR" "$VHOST" || { echo "anchor '$ANCHOR' not found in $VHOST"; exit 1; }
bak="$VHOST.bak-mcphaddad-$(date +%Y%m%d-%H%M%S)"; cp -a "$VHOST" "$bak"
install -m 0644 "$SRC" "$SNIP"
grep -qF "$LINE" "$VHOST" || sed -i "\#$ANCHOR#a\\$LINE" "$VHOST"
if ! nginx -t 2>&1; then cp -a "$bak" "$VHOST"; rm -f "$SNIP"; echo "nginx -t failed — vhost restored from $bak"; exit 1; fi
systemctl reload nginx
sleep 1
m=$(curl -sS -m 10 -o /dev/null -w '%{http_code}' -X POST https://mythosprod.xyz/mcp -H 'content-type: application/json' -d '{}')
h=$(curl -sS -m 10 -o /dev/null -w '%{http_code}' -X POST https://mythosprod.xyz/mcphaddad -H 'content-type: application/json' -d '{}')
echo "/mcp -> $m (want 401, unchanged) · /mcphaddad -> $h (want 401 from the Haddad bridge)"
[ "$m" = 401 ] && [ "$h" = 401 ] && echo "INSTALLED — backup $bak" || { echo "verify failed; roll back with: $0 --remove"; exit 1; }
