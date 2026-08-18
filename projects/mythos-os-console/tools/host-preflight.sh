#!/usr/bin/env bash
# =====================================================
# MYTHOS OS COMMAND CENTER — host preflight
# projects/mythos-os-console/tools/host-preflight.sh
#
# READ-ONLY. Run this ON the VPS before deploying. It installs nothing,
# starts nothing, writes nothing, and touches no service. It reports what
# is and is not ready, and exits non-zero if anything blocks deployment.
#
# It exists because MOS-1 reported "os.mythosprod.xyz has no DNS record"
# without ever resolving the name — the claim was carried over from the
# sibling service's documentation instead of being checked. The record in
# fact exists. This script is the check that should have run: every
# precondition verified against the host, never assumed from a document.
#
#   bash projects/mythos-os-console/tools/host-preflight.sh
# =====================================================
set -uo pipefail

DOMAIN="${MOS_DOMAIN:-os.mythosprod.xyz}"
EXPECT_IP="${MOS_EXPECT_IP:-51.68.226.211}"
PORT="${MOS_PORT:-8140}"
EXECUTOR="${MOS_EXECUTOR_URL:-http://127.0.0.1:8130}"
ENVFILE="${MOS_ENVFILE:-/home/deploy/deployments/mythos-os-console/.env}"
REPO="${MOS_REPO:-/home/deploy/projects/mythos-prod}"

pass=0; fail=0; warn=0
ok()   { printf '  \033[32mOK\033[0m    %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mBLOCK\033[0m %s\n' "$1"; fail=$((fail+1)); }
note() { printf '  \033[33mNOTE\033[0m  %s\n' "$1"; warn=$((warn+1)); }

echo "MYTHOS OS Command Center — host preflight for ${DOMAIN}"
echo

echo "1. DNS"
resolved="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1)"
if [ -z "$resolved" ]; then
  bad "$DOMAIN does not resolve. Create the A record at OVH -> ${EXPECT_IP}. This is an owner action."
elif [ "$resolved" = "$EXPECT_IP" ]; then
  ok "$DOMAIN resolves to $resolved"
else
  bad "$DOMAIN resolves to $resolved, expected $EXPECT_IP"
fi

echo "2. Repository"
if [ -d "$REPO/.git" ]; then
  ok "worktree present at $REPO ($(git -C "$REPO" rev-parse --short HEAD 2>/dev/null))"
  if [ -f "$REPO/projects/mythos-os-console/reference/server.js" ]; then
    ok "console source present"
  else
    bad "console source missing — the branch carrying MOS-1 is not checked out here"
  fi
else
  bad "no git worktree at $REPO"
fi

echo "3. Runtime"
if command -v node >/dev/null 2>&1; then
  ok "node $(node -v)"
else
  bad "node is not installed"
fi

echo "4. Port ${PORT}"
if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":${PORT} "; then
  note "port ${PORT} is already listening — confirm it is this console and not another service"
else
  ok "port ${PORT} is free"
fi

echo "5. Control plane"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${EXECUTOR}/health" 2>/dev/null)"
if [ "$code" = "200" ]; then
  ok "executor answers 200 on ${EXECUTOR}/health"
elif [ "$code" = "503" ]; then
  note "executor answers 503 (degraded). The console will start and report DEGRADED honestly."
else
  note "executor not answering on ${EXECUTOR} (curl said '${code:-no response}'). The console will still start and will report the plane unreachable — it does not need the executor to boot."
fi

echo "6. Credentials"
if [ -f "$ENVFILE" ]; then
  perms="$(stat -c '%a' "$ENVFILE" 2>/dev/null)"
  if [ "$perms" = "600" ]; then ok "$ENVFILE exists, mode $perms"; else note "$ENVFILE exists but mode is $perms, expected 600"; fi
  # Presence only. The value is never read, printed, or logged by this script.
  if grep -q '^MOS_EXECUTOR_TOKEN=' "$ENVFILE" 2>/dev/null; then
    ok "MOS_EXECUTOR_TOKEN is set (value not read)"
  else
    note "MOS_EXECUTOR_TOKEN is absent — the console will start and report 'not authorised' on every data read"
  fi
else
  note "$ENVFILE does not exist yet — create it with MOS_EXECUTOR_TOKEN before starting the unit"
fi

echo "7. nginx"
if [ -f "/etc/nginx/sites-available/${DOMAIN}" ]; then
  ok "vhost installed at /etc/nginx/sites-available/${DOMAIN}"
  [ -L "/etc/nginx/sites-enabled/${DOMAIN}" ] && ok "vhost enabled" || bad "vhost present but not symlinked into sites-enabled"
else
  bad "vhost not installed — copy deploy/nginx-os.mythosprod.xyz.conf (needs root)"
fi
for other in ordre.mythosprod.xyz panel.mythosprod.xyz tv.mythosprod.xyz; do
  [ -f "/etc/nginx/sites-enabled/$other" ] && ok "neighbour vhost $other present (must stay unaffected by any reload)"
done

echo "8. TLS"
if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  ok "certificate exists for ${DOMAIN}"
else
  note "no certificate yet — run certbot AFTER the vhost is installed and DNS resolves"
fi

echo "9. systemd user unit"
if [ -f "/home/deploy/.config/systemd/user/mythos-os-console.service" ]; then
  ok "unit installed"
else
  note "unit not installed — copy deploy/mythos-os-console.user.service (no root needed; deploy owns it)"
fi

echo "10. Tests"
if [ -f "$REPO/tests/mos-1-console-test.js" ]; then
  if (cd "$REPO" && node tests/mos-1-console-test.js >/dev/null 2>&1); then
    ok "tests/mos-1-console-test.js passes on this host"
  else
    bad "tests/mos-1-console-test.js FAILS on this host — do not deploy"
  fi
else
  bad "test suite not present"
fi

echo
echo "${pass} ready, ${fail} blocking, ${warn} to action"
if [ "$fail" -gt 0 ]; then
  echo "NOT READY TO DEPLOY — resolve the BLOCK lines above."
  exit 1
fi
echo "Preconditions met. Deployment steps are in docs/MYTHOS_OS_CONSOLE_ARCHITECTURE.md §10.2."
