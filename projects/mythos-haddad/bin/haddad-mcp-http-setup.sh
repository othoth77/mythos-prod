#!/usr/bin/env bash
# =====================================================
# MYTHOS HADDAD — HAD-3b: the Haddad MCP over HTTPS, setup (idempotent, no root)
# projects/mythos-haddad/bin/haddad-mcp-http-setup.sh
#
# Builds NOTHING new. Two existing pieces are connected:
#
#   projects/mythos-gateway/mcp-http-bridge.js   the Streamable-HTTP transport the VPS
#                                                already runs (mythos-mcp-http.service),
#                                                byte-identical, bearer-gated, loopback only
#   ~/.local/bin/haddad-mcp-stdio.sh             the launcher every SSH client already gets
#                                                (bin/haddad-mcp-setup.sh, HAD-3)
#
# The bridge spawns that launcher and relays JSON-RPC to it — so the HTTP endpoint
# serves exactly the tool set the stdio path serves, from the same server.js, with the
# same upstream credentials by reference. It adds ONE thing: a bearer of its own,
# because an HTTP listener has no SSH identity to lean on.
#
# Files (all user-level, all in the owner's home, none committed):
#   ~/.config/mythos-haddad/mcp-http.env               MYTHOS_MCP_HTTP_TOKEN=…  (0600, ONLY this)
#   ~/.config/systemd/user/mythos-haddad-mcp-http.service   unit (from systemd/, @REPO@ filled)
#
# Exposure model, layer by layer — nothing here widens Haddad's surface:
#   bind      127.0.0.1:8160 only (the unit fixes it; the health check refuses any other bind)
#   auth      Bearer on every /mcp request, constant-time compare, 401 otherwise
#   tls       Tailscale Serve (--serve): https://<node>.<tailnet>.ts.net/mcp -> http://127.0.0.1:8160/mcp
#             (target carries /mcp: Serve strips the mount point before proxying),
#             certificate issued by Tailscale, reachable ONLY by tailnet members — the same
#             population that could already `ssh othman@haddad`. No Funnel (public) ever.
#   surface   /mcp (bearer) is the only path served; /health stays loopback-only
#
# Flags:
#   --enable   enable + (re)start the unit and verify it over HTTP from a separate process
#   --serve    also publish /mcp through Tailscale Serve and verify over HTTPS
#   --rotate   issue a new bearer (existing clients must be reconfigured)
#
# Tailscale Serve needs, ONCE, two owner actions this script cannot perform and never
# attempts (no sudo anywhere): HTTPS certificates enabled for the tailnet (admin console
# → DNS → HTTPS Certificates) and `sudo tailscale set --operator=$USER`. Until both are
# done, --serve reports HTTPS as PENDING (exit 2) and the loopback bridge stays verified.
#
# Rollback:
#   systemctl --user disable --now mythos-haddad-mcp-http.service
#   tailscale serve --https=443 --set-path=/mcp off      (if --serve was used)
#   rm ~/.config/systemd/user/mythos-haddad-mcp-http.service ~/.config/mythos-haddad/mcp-http.env
# =====================================================
set -euo pipefail

HADDAD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="${HADDAD_MCP_REPO:-$(cd "$HADDAD_DIR/../.." && pwd)}"
CONFIG_DIR="${HADDAD_MCP_CONFIG_DIR:-$HOME/.config/mythos-haddad}"
BIN_DIR="${HADDAD_MCP_BIN_DIR:-$HOME/.local/bin}"
UNIT_DIR="${HADDAD_UNIT_DIR:-$HOME/.config/systemd/user}"
SYSTEMCTL="${HADDAD_MCP_HTTP_SYSTEMCTL:-systemctl}"   # tests substitute a recorder
TAILSCALE="${HADDAD_MCP_HTTP_TAILSCALE:-tailscale}"   # tests substitute a recorder
HOST=127.0.0.1
PORT=8160                                              # fixed by the unit, mirrored here for the checks
BRIDGE="$REPO/projects/mythos-gateway/mcp-http-bridge.js"
LAUNCHER="$BIN_DIR/haddad-mcp-stdio.sh"
ENV_FILE="$CONFIG_DIR/mcp-http.env"
UNIT_NAME=mythos-haddad-mcp-http.service
UNIT_SRC="$HADDAD_DIR/systemd/$UNIT_NAME"
UNIT="$UNIT_DIR/$UNIT_NAME"
PROBE="$HADDAD_DIR/bin/haddad-mcp-probe.js"
say() { printf '[haddad-mcp-http-setup] %s\n' "$*"; }
die() { say "FAIL: $*"; exit 1; }

ENABLE=0; SERVE=0; ROTATE=0
for a in "$@"; do
  case "$a" in
    --enable) ENABLE=1 ;;
    --serve) SERVE=1 ;;
    --rotate) ROTATE=1 ;;
    *) die "unknown flag $a (known: --enable --serve --rotate)" ;;
  esac
done

for c in node sed ss curl; do command -v "$c" >/dev/null || die "MISSING: $c"; done
[ -f "$BRIDGE" ] || die "MISSING: $BRIDGE (wrong checkout? set HADDAD_MCP_REPO)"
node --check "$BRIDGE"
[ -x "$LAUNCHER" ] || die "MISSING: $LAUNCHER — the stdio MCP is not installed; run bin/haddad-mcp-setup.sh first (HAD-3)"
[ -f "$UNIT_SRC" ] || die "MISSING: $UNIT_SRC"

say "1/4 directories"
mkdir -p "$CONFIG_DIR" "$UNIT_DIR"
chmod 700 "$CONFIG_DIR"

say "2/4 bridge bearer (value never shown)"
if [ "$ROTATE" = 1 ] || [ ! -f "$ENV_FILE" ] || ! grep -q '^MYTHOS_MCP_HTTP_TOKEN=' "$ENV_FILE"; then
  ( umask 077; printf 'MYTHOS_MCP_HTTP_TOKEN=%s\n' "$(head -c 48 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 48)" > "$ENV_FILE" )
  TOKEN_NEW=1
  say "  issued -> $ENV_FILE"
else
  TOKEN_NEW=0
  say "  already provisioned — keeping it ($ENV_FILE)"
fi
chmod 600 "$ENV_FILE"
# The env file may carry the bearer and nothing else: the bind address and the launcher
# path are fixed in the unit, and EnvironmentFile= would override them.
if grep -vE '^(#|MYTHOS_MCP_HTTP_TOKEN=[A-Za-z0-9]{32,64}$|$)' "$ENV_FILE" >/dev/null; then
  die "$ENV_FILE carries something other than MYTHOS_MCP_HTTP_TOKEN — refusing (the unit's bind/launcher must not be overridable)"
fi

say "3/4 unit"
( umask 077; sed -e "s|@REPO@|$REPO|g" "$UNIT_SRC" > "$UNIT" )
chmod 600 "$UNIT"
grep -q "ExecStart=/usr/bin/node $BRIDGE" "$UNIT" || die "@REPO@ substitution failed in $UNIT"
grep -q '^Environment=MYTHOS_MCP_HTTP_HOST=127.0.0.1$' "$UNIT" || die "unit does not pin the loopback bind"
"$SYSTEMCTL" --user daemon-reload
say "  $UNIT -> $BRIDGE (relaying $LAUNCHER)"

say "4/4 service"
if [ "$ENABLE" = 1 ]; then
  "$SYSTEMCTL" --user enable "$UNIT_NAME" >/dev/null
  "$SYSTEMCTL" --user restart "$UNIT_NAME"
  say "  enabled + (re)started"
elif [ "$TOKEN_NEW" = 1 ] && [ "$("$SYSTEMCTL" --user is-active "$UNIT_NAME" 2>/dev/null || true)" = active ]; then
  "$SYSTEMCTL" --user restart "$UNIT_NAME"
  say "  bearer changed — restarted the running unit"
else
  say "  not started (pass --enable). State: $("$SYSTEMCTL" --user is-active "$UNIT_NAME" 2>/dev/null || echo inactive)"
fi

# ------------------------------------------------------------------ verify (HTTP)
# Every check below runs OUTSIDE the bridge process, as a client would:
# curl for the negative cases, the shared MYTHOS MCP client (via the probe) for
# the real handshake. The bearer is read by the probe from the 0600 file; this
# script never holds it.
if [ "$("$SYSTEMCTL" --user is-active "$UNIT_NAME" 2>/dev/null || true)" = active ]; then
  say "verify (loopback HTTP, from a separate process)"
  n=0
  until curl -sf --max-time 2 "http://$HOST:$PORT/health" >/dev/null 2>&1; do
    n=$((n + 1)); [ "$n" -lt 20 ] || die "bridge did not answer /health within 10 s: journalctl --user -u $UNIT_NAME"
    sleep 0.5
  done
  say "  /health 200"
  BOUND="$(ss -ltnH | awk '{print $4}' | grep -E ":$PORT\$" || true)"
  [ "$BOUND" = "$HOST:$PORT" ] || die "listener is '$BOUND', expected exactly $HOST:$PORT"
  say "  bound $BOUND and nothing else"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "http://$HOST:$PORT/mcp")"
  [ "$code" = 401 ] || die "unauthenticated tools/list answered $code, expected 401"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST -H 'Authorization: Bearer not-the-token' -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "http://$HOST:$PORT/mcp")"
  [ "$code" = 401 ] || die "wrong bearer answered $code, expected 401"
  say "  /mcp without or with a wrong bearer -> 401"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$HOST:$PORT/anything-else")"
  [ "$code" = 404 ] || die "an unknown path answered $code, expected 404"
  say "  any other path -> 404 (surface is /mcp and /health only)"
  TOOLS="$(HADDAD_MCP_HTTP_ENV="$ENV_FILE" node "$PROBE" --http "http://$HOST:$PORT/mcp" \
    | node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const r=JSON.parse(b);process.stdout.write(r.ok?String(r.tools.length)+" "+(r.call.ok?"call-ok":"call-"+String(r.call.error||"").slice(0,60)):"FAIL "+String(r.error))})')"
  case "$TOOLS" in
    "9 "*) say "  handshake over HTTP: 9 tools (8 shared + haddad_health), execution_status: ${TOOLS#9 }" ;;
    *) die "HTTP handshake: $TOOLS (expected 9 tools)" ;;
  esac
  STDIO="$(node "$PROBE" "$LAUNCHER" | node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const r=JSON.parse(b);process.stdout.write(r.ok?r.tools.join(","):"FAIL")})')"
  HTTPL="$(HADDAD_MCP_HTTP_ENV="$ENV_FILE" node "$PROBE" --http "http://$HOST:$PORT/mcp" | node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const r=JSON.parse(b);process.stdout.write(r.ok?r.tools.join(","):"FAIL")})')"
  [ "$STDIO" = "$HTTPL" ] || die "HTTP and stdio list different tools — that would be a second server"
  say "  same tool list over stdio and HTTP: one server, two transports"
fi

# ------------------------------------------------------------------ HTTPS (Tailscale Serve)
HTTPS_STATE="not requested (pass --serve)"
HTTPS_URL=""
if [ "$SERVE" = 1 ]; then
  command -v "$TAILSCALE" >/dev/null || die "tailscale not installed"
  NODE_DNS="$("$TAILSCALE" status --json 2>/dev/null | node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{try{const s=JSON.parse(b);process.stdout.write(String((s.Self&&s.Self.DNSName||"").replace(/\.$/,""))+" "+((s.CertDomains||[]).length))}catch(e){process.stdout.write(" 0")}})')"
  CERTS="${NODE_DNS##* }"; NODE_DNS="${NODE_DNS% *}"
  if [ -z "$NODE_DNS" ]; then
    HTTPS_STATE="PENDING — tailscale is not running or this node has no MagicDNS name"
  elif [ "$CERTS" = 0 ]; then
    HTTPS_STATE="PENDING owner action — HTTPS certificates are not enabled for the tailnet (admin console → DNS → HTTPS Certificates); nothing attempted"
  else
    say "tailscale serve: https://$NODE_DNS/mcp -> http://$HOST:$PORT/mcp (tailnet only, never public)"
    # Serve STRIPS the --set-path mount point before proxying: with a bare
    # "http://$HOST:$PORT" target, https://…/mcp reaches the bridge as "/" and the
    # bridge answers 404. The target therefore carries the bridge's own route.
    if OUT="$("$TAILSCALE" serve --bg --https=443 --set-path=/mcp "http://$HOST:$PORT/mcp" 2>&1)"; then
      HTTPS_URL="https://$NODE_DNS/mcp"
      say "verify (HTTPS, tailnet address, from a separate process)"
      n=0; code=000
      # First use may wait on certificate issuance; bounded.
      until [ "$code" = 401 ]; do
        code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "$HTTPS_URL" || true)"
        [ "$code" = 401 ] && break
        n=$((n + 1)); [ "$n" -lt 12 ] || die "HTTPS $HTTPS_URL answered '$code' to an unauthenticated request, expected 401 (certificate not issued yet? tailscale serve status)"
        sleep 5
      done
      say "  $HTTPS_URL without bearer -> 401 over TLS"
      code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$NODE_DNS/health" || true)"
      [ "$code" != 200 ] || die "/health is reachable over HTTPS — only /mcp may be served"
      say "  https://$NODE_DNS/health -> $code (not served; surface is /mcp only)"
      TOOLS="$(HADDAD_MCP_HTTP_ENV="$ENV_FILE" node "$PROBE" --http "$HTTPS_URL" | node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const r=JSON.parse(b);process.stdout.write(r.ok?String(r.tools.length):"FAIL "+String(r.error))})')"
      [ "$TOOLS" = 9 ] || die "HTTPS handshake: $TOOLS (expected 9 tools)"
      say "  handshake over HTTPS: 9 tools"
      HTTPS_STATE="ONLINE (Tailscale Serve, certificate by Tailscale, tailnet members only)"
    else
      case "$OUT" in
        *operator*|*"Use 'sudo"*|*"permission denied"*|*"Access denied"*)
          HTTPS_STATE="PENDING owner action — 'tailscale serve' needs root or the operator grant; run ONCE as the owner:  sudo tailscale set --operator=$(id -un)   then re-run this script with --serve" ;;
        *) HTTPS_STATE="PENDING — tailscale serve failed: $(printf '%s' "$OUT" | head -n 2 | tr '\n' ' ')" ;;
      esac
    fi
  fi
fi

cat <<NOTE

[haddad-mcp-http-setup] done.
Unit:      $UNIT_NAME ($("$SYSTEMCTL" --user is-active "$UNIT_NAME" 2>/dev/null || echo inactive))
Loopback:  http://$HOST:$PORT/mcp   (Streamable HTTP, Bearer required; /health = liveness only)
HTTPS:     $HTTPS_STATE
${HTTPS_URL:+URL:       $HTTPS_URL
}Bearer:    $ENV_FILE  (0600 — read it there; it is never printed)
Client:    claude mcp add --transport http haddad-http ${HTTPS_URL:-http://$HOST:$PORT/mcp} --header "Authorization: Bearer \$(sed -n 's/^MYTHOS_MCP_HTTP_TOKEN=//p' $ENV_FILE)"
Health:    node $HADDAD_DIR/bin/haddad-health.js --quick   (check id: mcp — now covers the bridge)
Test:      node tests/mythos-haddad-mcp-test.js   ·   node tests/gateway-boundary-test.js
NOTE
if [ "$SERVE" = 1 ] && [ -z "$HTTPS_URL" ]; then exit 2; fi
