#!/bin/bash
# Issue a MYTHOS Gateway (ContextForge) CLIENT token for a non-admin identity — MCP-ECOSYSTEM-4.
# Same pattern as the executor's credential (MCP-ECOSYSTEM-3): a dedicated non-admin user whose
# random password is used for nothing and discarded, a 365-day token, the tools-only role
# (tools.read + tools.execute), and the value written straight into a 0600 file — never printed.
#
# Usage (as deploy):  cf-issue-client-token.sh <identity-email> <token-name> <out-file>
#   e.g. cf-issue-client-token.sh chatgpt@mythosprod.xyz mythos-chatgpt /home/deploy/deployments/mythos-gateway/contextforge-chatgpt.env
# Env: CF_CLIENT_ROLE (default mythos-executor-client), CF_TOKEN_DAYS (default 365)
set -euo pipefail; umask 077
IDENTITY=${1:?identity email}; TNAME=${2:?token name}; OUT=${3:?output file}
ROLE=${CF_CLIENT_ROLE:-mythos-executor-client}; DAYS=${CF_TOKEN_DAYS:-365}
ENV_FILE=/home/deploy/deployments/mythos-gateway/contextforge.env; BASE=http://127.0.0.1:4444
[ -e "$OUT" ] && { echo "refused: $OUT already exists (rotate by revoking first)" >&2; exit 1; }
EMAIL=$(grep -oP '(?<=^PLATFORM_ADMIN_EMAIL=).*' "$ENV_FILE"); PASS=$(grep -oP '(?<=^PLATFORM_ADMIN_PASSWORD=).*' "$ENV_FILE")
JWT=$(curl -s -m 15 -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
      --data "$(python3 -c 'import json,sys;print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$EMAIL" "$PASS")" \
      | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("access_token") or d.get("token") or "")')
unset PASS; [ -n "$JWT" ] || { echo "admin login failed" >&2; exit 1; }
api() { curl -s -m 20 -X "$1" "$BASE$2" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' "${@:3}"; }
# identity (idempotent: 4xx if it already exists is tolerated; the token is what matters)
PW=$(openssl rand -base64 36)
api POST /v1/auth/email/admin/users --data "$(python3 -c 'import json,sys;print(json.dumps({"email":sys.argv[1],"password":sys.argv[2],"full_name":sys.argv[3],"is_admin":False,"is_active":True,"password_change_required":False}))' "$IDENTITY" "$PW" "MYTHOS Gateway client: $TNAME")" >/dev/null || true
unset PW
# role by name -> id, then assign (global)
RID=$(api GET /v1/rbac/roles | python3 -c 'import sys,json;d=json.load(sys.stdin);r=d if isinstance(d,list) else d.get("roles",d);print(next((x["id"] for x in r if x.get("name")==sys.argv[1]),""))' "$ROLE")
[ -n "$RID" ] || { echo "role $ROLE not found" >&2; exit 1; }
api POST "/v1/rbac/users/$IDENTITY/roles" --data "{\"role_id\":\"$RID\",\"scope\":\"global\"}" >/dev/null || true
# token -> file, never stdout
api POST /v1/tokens --data "$(python3 -c 'import json,sys;print(json.dumps({"name":sys.argv[1],"description":"MYTHOS Gateway client token for "+sys.argv[2]+" (Vault reference; value lives only in "+sys.argv[3]+")","expires_in_days":int(sys.argv[4]),"user_email":sys.argv[2],"tags":["mythos","gateway-client","vault-reference"]}))' "$TNAME" "$IDENTITY" "$OUT" "$DAYS")" \
 | python3 - "$OUT" "$IDENTITY" "$TNAME" <<'PY'
import sys,json,os
d=json.load(sys.stdin); tok=d.get('access_token')
if not tok: print('token not issued:', d.get('detail') or {k:v for k,v in d.items() if k!='access_token'}, file=sys.stderr); sys.exit(1)
out,ident,name=sys.argv[1:4]; meta=d.get('token') or {}
fd=os.open(out, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
with os.fdopen(fd,'w') as f:
    f.write('# MYTHOS Gateway client token for %s (identity %s, token id %s, expires %s). Paste into the client once; never copy elsewhere.\n' % (name, ident, meta.get('id'), meta.get('expires_at')))
    f.write('MYTHOS_CONTEXTFORGE_CLIENT_TOKEN=%s\n' % tok)
print('issued: identity=%s token_id=%s expires=%s -> %s (0600)' % (ident, meta.get('id'), meta.get('expires_at'), out))
PY
echo "effective permissions of $IDENTITY:"; api GET "/v1/rbac/permissions/user/$IDENTITY" | python3 -c 'import sys,json;p=json.load(sys.stdin);print(sorted(p) if isinstance(p,list) else p)'
