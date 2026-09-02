#!/bin/bash
# MYTHOS MCP OAuth bridge — installer / re-installer (run as root on the VPS).
#
# Idempotent. Generates every secret ONCE (existing files are kept), installs
# the nginx snippets, and (re)starts the stack. Prints no secret.
#
#   bin/install.sh            install or update files + restart stack
#   bin/install.sh --nginx    only refresh the nginx snippets (then nginx -t + reload)
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
D=${MYTHOS_MCP_AUTH_DIR:-/home/deploy/deployments/mythos-mcp-auth}
OWNER_EMAIL=${MYTHOS_MCP_AUTH_OWNER_EMAIL:-othmanhaddad@gmail.com}
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }

install_nginx() {
  install -m 0644 "$HERE/nginx/mythos-mcp-auth-limits.conf" /etc/nginx/conf.d/mythos-mcp-auth-limits.conf
  install -m 0644 "$HERE/nginx/mythos-mcp-auth.conf" /etc/nginx/snippets/mythos-mcp-auth.conf
  install -m 0644 "$HERE/nginx/mythos-mcp-auth-proxy.conf" /etc/nginx/snippets/mythos-mcp-auth-proxy.conf
  install -m 0644 "$HERE/nginx/mythos-mcp-auth-dex.conf" /etc/nginx/snippets/mythos-mcp-auth-dex.conf
  V=/etc/nginx/sites-available/mythosprod.xyz
  if ! grep -q 'snippets/mythos-mcp-auth.conf' "$V"; then
    cp -a "$V" "$V.bak-pre-mcp-auth-$(date -u +%Y%m%dT%H%M%SZ)"
    python3 - "$V" <<'PY'
import sys; p=sys.argv[1]; s=open(p).read(); m='    location /assets/fonts/ {'
assert s.count(m)==1; open(p,'w').write(s.replace(m,'    include snippets/mythos-mcp-auth.conf;\n\n'+m,1))
PY
  fi
  nginx -t && systemctl reload nginx
}

if [ "${1:-}" = "--nginx" ]; then install_nginx; exit 0; fi

sudo -u deploy mkdir -p "$D/dex" "$D/redis" "$D/data/dex" "$D/data/redis"
chmod 750 "$D"
install -o deploy -g deploy -m 0644 "$HERE/docker-compose.yml" "$D/docker-compose.yml"
install -o deploy -g deploy -m 0644 "$HERE/dex/config.yaml" "$D/dex/config.yaml"
install -o deploy -g deploy -m 0644 "$HERE/bin/oauth-e2e-test.py" "$D/oauth-e2e-test.py"

if [ ! -s "$D/contextforge-upstream.env" ]; then
  sudo -u deploy "$HERE/../mythos-gateway/bin/cf-issue-client-token.sh" mcp-auth-proxy@mythosprod.xyz mythos-mcp-auth-proxy "$D/contextforge-upstream.env"
fi
if [ ! -s "$D/mcp-auth-proxy.env" ]; then
  sudo -u deploy bash -s "$D" "$OWNER_EMAIL" "$HERE" <<'GEN'
set -euo pipefail; umask 077; D=$1; OWNER=$2; HERE=$3
CS=$(openssl rand -base64 48 | tr -d '\n'); SG=$(openssl rand -base64 48 | tr -d '\n=' | head -c 64)
RP=$(openssl rand -hex 24); OP=$(openssl rand -base64 30 | tr -d '\n/+=' | head -c 28)
H=$(python3 -c 'import bcrypt,sys; print(bcrypt.hashpw(sys.argv[1].encode(), bcrypt.gensalt(12)).decode())' "$OP")
UP=$(grep -oP '(?<=^MYTHOS_CONTEXTFORGE_CLIENT_TOKEN=).*' "$D/contextforge-upstream.env")
sed -e "s|<generated: same value as OIDC_CLIENT_SECRET>|${CS//$/\$\$}|" -e "s|<bcrypt hash of the owner password, \"\$\" doubled>|${H//$/\$\$}|" "$HERE/dex-env.example" > "$D/dex.env"
sed -e "s|<generated>|$RP|" "$HERE/redis.conf.example" > "$D/redis/redis.conf"
sed -e "s|<generated: same value as DEX_CLIENT_SECRET>|$CS|" -e "s|<generated: 64 chars, AES-GCM key>|$SG|" -e "s|redis://:<generated>@|redis://:$RP@|" -e "s|Bearer <ContextForge client token>|Bearer $UP|" "$HERE/mcp-auth-proxy-env.example" > "$D/mcp-auth-proxy.env"
printf 'MYTHOS MCP OAuth bridge — owner login for the Dex identity provider.\n  email:    %s\n  password: %s\n' "$OWNER" "$OP" > "$D/OWNER-LOGIN.txt"
echo "secrets generated (not shown)"
GEN
fi
chown 10002:10002 "$D/redis/redis.conf" "$D/data/redis"; chmod 0400 "$D/redis/redis.conf"; chmod 700 "$D/data/redis"
chown 10003:10003 "$D/data/dex"; chmod 700 "$D/data/dex"
install_nginx
(cd "$D" && docker compose up -d --remove-orphans 2>&1 | grep -v 'variable is not set')
sleep 5; curl -fsS -o /dev/null http://127.0.0.1:8180/healthz && echo "proxy healthz ok"
curl -fsS -o /dev/null http://127.0.0.1:5556/dex/.well-known/openid-configuration && echo "dex discovery ok"
