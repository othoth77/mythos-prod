#!/usr/bin/env bash
# =====================================================
# MYTHOS HADDAD — register Haddad's MCP as a ContextForge gateway (issue #424)
#
# One federation entry, nothing else. It creates no endpoint, no server, no
# bridge and no second OAuth layer: ContextForge already federates peers, and
# this registers Haddad as one of them so its 9 tools join the 8 already on
# https://mythosprod.xyz/mcp.
#
# Run FROM HADDAD. The gateway URL is tailnet-only, so the registration is
# only meaningful from a host that can prove the endpoint answers.
#
# Credentials by reference, never on the command line and never printed:
#   CF_TOKEN  registration token    default ~/.config/mythos-haddad/cf-register.token
#   BEARER    Haddad bridge bearer  default MYTHOS_MCP_HTTP_TOKEN in mcp-http.env
# Both may be pre-exported; the files are only read when the variable is empty.
#
# Exit codes: 0 registered or already present · 2 precondition failed ·
#             3 credential rejected (401/403) · 4 gateway refused the payload
# =====================================================
set -uo pipefail

BASE="${CF_BASE:-https://mythosprod.xyz/gateway}"
GW_URL="${HADDAD_MCP_URL:-https://haddad.tail23f990.ts.net/mcp}"
GW_NAME=haddad
CONFIG_DIR="${HADDAD_MCP_CONFIG_DIR:-$HOME/.config/mythos-haddad}"
CF_TOKEN_FILE="${CF_TOKEN_FILE:-$CONFIG_DIR/cf-register.token}"
BEARER_FILE="${BEARER_FILE:-$CONFIG_DIR/mcp-http.env}"
EXPECT_TOOLS="${EXPECT_TOOLS:-17}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
CHECK_ONLY=0; [ "${1:-}" = "--check" ] && CHECK_ONLY=1

die() { echo "haddad-cf-register: $1" >&2; exit "${2:-2}"; }

# --- credentials -------------------------------------------------------
CF_TOKEN="${CF_TOKEN:-}"
[ -z "$CF_TOKEN" ] && [ -r "$CF_TOKEN_FILE" ] && CF_TOKEN="$(tr -d '\r\n' < "$CF_TOKEN_FILE")"
[ -n "$CF_TOKEN" ] || die "no registration token (export CF_TOKEN or write $CF_TOKEN_FILE)"

BEARER_SRC=env
BEARER="${BEARER:-}"
FILE_BEARER=""
[ -r "$BEARER_FILE" ] &&
  FILE_BEARER="$(sed -n 's/^MYTHOS_MCP_HTTP_TOKEN=//p' "$BEARER_FILE" | head -n1 | tr -d '\r')"
[ -z "$BEARER" ] && { BEARER="$FILE_BEARER"; BEARER_SRC=file; }

# Token confusion is the failure mode that actually bit us: the interactive
# shell exports BEARER holding a ContextForge *gateway API* JWT, not the
# bridge bearer. Registering that as authToken would create a gateway that
# can never authenticate to Haddad, so refuse it by shape (aud=mcpgateway-api)
# before it reaches the payload.
# These tokens are not all 3-segment JWTs (the gateway issues some as
# payload.signature), so scan every dot-separated segment for the audience
# claim rather than assuming segment 2 is the payload.
b64aud() {
  local tok="$1" seg b pad
  printf '%s\n' "$tok" | tr '.' '\n' | while IFS= read -r seg; do
    [ "${#seg}" -lt 16 ] && continue
    b="$seg"; pad=$(( (4 - ${#seg} % 4) % 4 ))
    if [ "$pad" -gt 0 ]; then
      b="$seg$(head -c "$pad" < /dev/zero | tr '\0' '=')"
    fi
    printf '%s' "$b" | tr '_-' '/+' | base64 -d 2>/dev/null |
      jq -r 'select(type=="object") | .aud // empty' 2>/dev/null
  done
}

# NB: capture, then match. Under `set -o pipefail` a `| grep -q` pipeline
# reports the producer's SIGPIPE (141) when grep exits early on a match, so
# the success case would silently read as failure.
BEARER_AUD=""
[ "$BEARER_SRC" = env ] && [ -n "$BEARER" ] && BEARER_AUD="$(b64aud "$BEARER")"
if [ "$BEARER_SRC" = env ] && [ -n "$BEARER" ]; then
  case "$BEARER_AUD" in *mcpgateway-api*) : ;; *) false ;; esac
  if [ $? -eq 0 ]; then
    echo "haddad-cf-register: \$BEARER holds a ContextForge gateway API token (aud=mcpgateway-api)," >&2
    echo "  not the Haddad bridge bearer. That value belongs in CF_TOKEN." >&2
    if [ -n "$FILE_BEARER" ]; then
      echo "  using the bridge bearer from $BEARER_FILE instead." >&2
      BEARER="$FILE_BEARER"; BEARER_SRC=file
    else
      die "no bridge bearer available (MYTHOS_MCP_HTTP_TOKEN in $BEARER_FILE)"
    fi
  fi
fi

# An empty authToken registers a gateway that can never authenticate. The
# ad-hoc attempts in the shell history did exactly that; refuse it here.
[ -n "$BEARER" ] || die "bridge bearer is empty (MYTHOS_MCP_HTTP_TOKEN in $BEARER_FILE)"

cf() { # cf METHOD PATH [BODY] -> prints status, body in $TMP/body
  local m="$1" p="$2" b="${3:-}"
  local -a a
  a=(-s -o "$TMP/body" -w '%{http_code}' --max-time 45
     -X "$m" -H "Authorization: Bearer $CF_TOKEN")
  [ -n "$b" ] && a+=(-H 'Content-Type: application/json' -d "$b")
  curl "${a[@]}" "$BASE$p"
}

# --- precondition: the endpoint we are about to advertise must answer ---
probe="$(curl -s -o "$TMP/init" -w '%{http_code}' --max-time 30 -X POST "$GW_URL" \
  -H "Authorization: Bearer $BEARER" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"cf-register","version":"1"}}}')"
if [ "$probe" != "200" ]; then
  if [ "$probe" = "401" ]; then
    echo "haddad-cf-register: $GW_URL rejected the bridge bearer (401)." >&2
    echo "  bearer source: $BEARER_SRC" >&2
    if [ "$BEARER_SRC" = env ] && [ -n "$FILE_BEARER" ] && [ "$BEARER" != "$FILE_BEARER" ]; then
      echo "  \$BEARER differs from MYTHOS_MCP_HTTP_TOKEN in $BEARER_FILE." >&2
      echo "  Re-run with the file value:  env -u BEARER $0 ${1:-}" >&2
    fi
  fi
  die "$GW_URL did not initialize (HTTP $probe) — nothing to register" 2
fi
echo "precondition: $GW_URL initializes (HTTP 200)"

# --- is it already registered? -----------------------------------------
code="$(cf GET /gateways)"
case "$code" in
  200) : ;;
  401|403) echo "GET /gateways -> HTTP $code"
           jq -r '.detail // .' "$TMP/body" 2>/dev/null | head -1
           die "registration token rejected — ask the owner for a fresh one" 3 ;;
  *)   die "GET /gateways -> HTTP $code" 2 ;;
esac
existing="$(jq -r --arg n "$GW_NAME" '
  (if type=="array" then . else (.data // .items // []) end)
  | map(select(.name==$n)) | .[0] // empty | .id' "$TMP/body" 2>/dev/null)"

if [ -n "$existing" ]; then
  echo "HTTP 409-equivalent: gateway '$GW_NAME' already exists — not creating a duplicate"
elif [ "$CHECK_ONLY" = 1 ]; then
  echo "--check: gateway '$GW_NAME' absent; token accepted; would POST now"; exit 0
else
  body="$(jq -nc --arg u "$GW_URL" --arg t "$BEARER" '{
    name:"haddad", url:$u,
    description:"Haddad workstation MCP, reached over the tailnet",
    transport:"STREAMABLEHTTP", authType:"bearer", authToken:$t,
    tags:["haddad","tailnet"]}')"
  code="$(cf POST /gateways "$body")"
  echo "POST /gateways -> HTTP $code"
  case "$code" in
    200|201) existing="$(jq -r '.id // empty' "$TMP/body")" ;;
    409)     existing="$(cf GET /gateways >/dev/null; jq -r --arg n "$GW_NAME" '
               (if type=="array" then . else (.data // []) end)
               | map(select(.name==$n)) | .[0].id // empty' "$TMP/body")"
             echo "409 — gateway already existed; inspecting instead of duplicating" ;;
    401|403) jq -r '.detail // .' "$TMP/body" 2>/dev/null | head -1; exit 3 ;;
    *)       # 422 here is usually SSRF_ALLOWED_NETWORKS not covering the tailnet.
             jq -r '.detail // .' "$TMP/body" 2>/dev/null | head -c 400; echo; exit 4 ;;
  esac
fi

# --- verify: the entry, then the federated surface ---------------------
cf GET /gateways >/dev/null
jq -r --arg n "$GW_NAME" '(if type=="array" then . else (.data // []) end)
  | map(select(.name==$n)) | .[0]
  | "gateway name: \(.name)\ngateway id:   \(.id)\nreachable:    \(.reachable // .enabled // "unknown")"' \
  "$TMP/body" 2>/dev/null || echo "gateway id:   ${existing:-unknown}"

code="$(cf GET /tools)"
if [ "$code" = "200" ]; then
  n="$(jq -r '(if type=="array" then . else (.data // []) end) | length' "$TMP/body")"
  echo "federated tools: $n (expected $EXPECT_TOOLS)"
  [ "$n" = "$EXPECT_TOOLS" ] || echo "WARNING: tool count is not $EXPECT_TOOLS — the gateway is registered but not serving"
else
  echo "GET /tools -> HTTP $code (tool count unverified)"
fi

echo
echo "Next (owner, on the VPS): revoke this registration token, then"
echo "  shred -u $CF_TOKEN_FILE"
