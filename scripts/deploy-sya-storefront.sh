#!/usr/bin/env bash
# =====================================================================
# SSANGYONG.AUTOS storefront — one-command deployment
# scripts/deploy-sya-storefront.sh
#
# Publishes the read-only catalog storefront (already running on
# 127.0.0.1:3011) at its approved public hostname. This is the second
# and final half of BLOCKER-SYA-API-DOWN: OTH-2026-00015 restored the
# service, and this exposes it. Run as root from the repository:
#
#     sudo bash scripts/deploy-sya-storefront.sh
#     sudo bash scripts/deploy-sya-storefront.sh --rollback   # undo vhost
#
# Modelled directly on scripts/deploy-status-center.sh, which performed
# this same operation for status.mythosprod.xyz on 2026-08-20 and is the
# proven pattern on this host: preflight → additive vhost → certbot →
# smoke tests → regression checks, fail-closed at every step.
#
# STRICTLY ADDITIVE. The only files this script ever writes are
#   /etc/nginx/sites-available/store.ssangyong.autos  (+ its symlink)
# and whatever certbot writes for that one certificate. It touches no
# other vhost, no DNS record, no application, no database.
#
# IT MUST NOT TOUCH THE APEX. ssangyong.autos serves the legacy site from
# /var/www/ssangyong.autos, which migration-plan §21 freezes, and that
# site has a LIVE /api/catalog.php of its own. OTH-2026-00017 recorded a
# corrected instruction that would have proxied ^/api/ on the apex and
# shadowed it. This script refuses to run if the apex vhost would be
# affected, and step 6 proves the apex and its catalog endpoint are still
# answering after the change.
#
# THE CONFIG BODY IS NOT WRITTEN HERE. It is read from
# projects/ssangyong-autos/deploy/nginx-ssangyong-storefront.conf and the
# hostname is substituted in. One source of truth for the config, one for
# the name; a second copy of a vhost is exactly the drift OTH-2026-00017
# had to unpick.
# =====================================================================
set -euo pipefail

HOST="store.ssangyong.autos"
EXPECTED_IP="51.68.226.211"
UPSTREAM="127.0.0.1:3011"
VHOST_AVAIL="/etc/nginx/sites-available/${HOST}"
VHOST_LINK="/etc/nginx/sites-enabled/${HOST}"
APEX_VHOST="/etc/nginx/sites-available/ssangyong.autos"
PLACEHOLDER="__STOREFRONT_HOST__"

step()  { printf '\n== %s\n' "$*"; }
info()  { printf '   %s\n' "$*"; }
fail()  { printf '\nFAILED: %s\nNothing further was executed. Fix the condition and re-run — the script is idempotent.\n' "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMPLATE="${REPO}/projects/ssangyong-autos/deploy/nginx-ssangyong-storefront.conf"

# ── Rollback mode ────────────────────────────────────────────────────
if [ "${1:-}" = "--rollback" ]; then
  [ "$(id -u)" -eq 0 ] || fail "must run as root"
  if [ -L "${VHOST_LINK}" ]; then
    rm -f "${VHOST_LINK}"
    nginx -t || fail "nginx -t failed after rollback — investigate before reloading"
    systemctl reload nginx
    printf '\nRolled back: %s removed, nginx reloaded.\n' "${VHOST_LINK}"
    printf 'The vhost file and any certificate are left in place; re-running the script re-enables them.\n'
    printf 'The storefront service on %s is untouched and still running.\n' "${UPSTREAM}"
  else
    printf '\nNothing to roll back: %s is not present.\n' "${VHOST_LINK}"
  fi
  exit 0
fi

# ── 1. Preflight ─────────────────────────────────────────────────────
step "1/6 Preflight"
[ "$(id -u)" -eq 0 ] || fail "must run as root (sudo bash scripts/deploy-sya-storefront.sh)"

for bin in git nginx curl certbot getent systemctl ss; do
  command -v "$bin" >/dev/null || fail "required binary not found: $bin"
done
info "required binaries present"

[ -f "${TEMPLATE}" ] || fail "vhost template not found: ${TEMPLATE}"
grep -q "${PLACEHOLDER}" "${TEMPLATE}" || fail "template carries no ${PLACEHOLDER} — refusing to guess what to substitute"
info "template found: ${TEMPLATE}"

RESOLVED="$(getent hosts "${HOST}" | awk '{print $1; exit}' || true)"
[ -n "${RESOLVED}" ] || fail "${HOST} does not resolve — add the A record first"
[ "${RESOLVED}" = "${EXPECTED_IP}" ] \
  || fail "${HOST} resolves to ${RESOLVED}, expected ${EXPECTED_IP} — refusing to deploy to a host that is not this one"
info "${HOST} resolves to ${RESOLVED}"

# The upstream must already be up. This script exposes a service; it does
# not start one. If nothing is listening, publishing the vhost would put a
# 502 on a public hostname.
ss -ltn 2>/dev/null | grep -q "127\.0\.0\.1:3011" \
  || fail "nothing is listening on ${UPSTREAM} — start ssangyong-storefront first (systemctl --user start ssangyong-storefront, as deploy) and re-run"
UPSTREAM_HEALTH="$(curl -sS --max-time 10 "http://${UPSTREAM}/api/health" || true)"
grep -q '"status":"ok"' <<<"${UPSTREAM_HEALTH}" \
  || fail "upstream ${UPSTREAM}/api/health did not return status ok — fix the service before exposing it"
info "upstream healthy on ${UPSTREAM}"

BRANCH="$(git -C "${REPO}" branch --show-current || true)"
HEAD_SHA="$(git -C "${REPO}" rev-parse HEAD)"
info "repository ${REPO} @ ${BRANCH:-detached} ${HEAD_SHA}"
if [ -n "$(git -C "${REPO}" status --porcelain)" ]; then
  info "WARNING: worktree is dirty — deploying uncommitted content"
fi

# No OTHER vhost may claim this hostname (our own file is fine — idempotency).
CLAIMS="$(grep -rls "server_name[^;]*\b${HOST}\b" /etc/nginx/sites-enabled/ /etc/nginx/sites-available/ 2>/dev/null \
          | grep -v "^${VHOST_AVAIL}$" | grep -v "^${VHOST_LINK}$" || true)"
[ -z "${CLAIMS}" ] || fail "another vhost already claims ${HOST}: ${CLAIMS}"
info "no competing vhost claims ${HOST}"

# The apex must not be in scope, now or after. Record its state to compare.
if [ -f "${APEX_VHOST}" ]; then
  APEX_SUM_BEFORE="$(sha256sum "${APEX_VHOST}" | awk '{print $1}')"
  info "legacy apex vhost recorded before change (sha256 ${APEX_SUM_BEFORE:0:16}…)"
else
  APEX_SUM_BEFORE=""
  info "no apex vhost file present — nothing to protect"
fi

# ── 2. Render the vhost from the single source ───────────────────────
step "2/6 Render vhost from ${TEMPLATE##*/}"
TMP_VHOST="$(mktemp)"
trap 'rm -f "${TMP_VHOST}"' EXIT
sed "s/${PLACEHOLDER}/${HOST}/g" "${TEMPLATE}" > "${TMP_VHOST}"
grep -q "${PLACEHOLDER}" "${TMP_VHOST}" && fail "placeholder survived substitution — refusing to install"
grep -q "server_name ${HOST};" "${TMP_VHOST}" || fail "rendered vhost has no server_name ${HOST} — refusing to install"
grep -q "proxy_pass http://${UPSTREAM}" "${TMP_VHOST}" || fail "rendered vhost does not proxy to ${UPSTREAM} — refusing to install"
info "rendered, placeholder substituted, upstream and server_name verified"

# ── 3. Vhost (additive, certbot-aware) ───────────────────────────────
step "3/6 nginx vhost"
NGINX_CHANGED=0
if [ -f "${VHOST_AVAIL}" ] && grep -q "managed by Certbot" "${VHOST_AVAIL}"; then
  info "existing certbot-managed vhost found — leaving it untouched"
elif [ -f "${VHOST_AVAIL}" ] && cmp -s "${TMP_VHOST}" "${VHOST_AVAIL}"; then
  info "vhost unchanged"
else
  if [ -f "${VHOST_AVAIL}" ]; then
    BACKUP="${VHOST_AVAIL}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
    cp -p "${VHOST_AVAIL}" "${BACKUP}"
    info "existing vhost backed up to ${BACKUP}"
  fi
  install -m 0644 "${TMP_VHOST}" "${VHOST_AVAIL}"
  NGINX_CHANGED=1
  info "vhost written: ${VHOST_AVAIL}"
fi

if [ ! -L "${VHOST_LINK}" ]; then
  [ -e "${VHOST_LINK}" ] && fail "${VHOST_LINK} exists but is not a symlink — refusing to touch it"
  ln -s "${VHOST_AVAIL}" "${VHOST_LINK}"
  NGINX_CHANGED=1
  info "vhost enabled"
fi

nginx -t || fail "nginx -t rejected the configuration — nothing reloaded; remove ${VHOST_LINK} to roll back"
if [ "${NGINX_CHANGED}" -eq 1 ]; then
  systemctl reload nginx
  info "nginx reloaded"
else
  info "nginx config unchanged — no reload needed"
fi

# ── 4. TLS ───────────────────────────────────────────────────────────
step "4/6 TLS certificate"
if [ -d "/etc/letsencrypt/live/${HOST}" ]; then
  info "certificate already exists — skipping issuance (renewal is certbot.timer's job)"
else
  certbot --nginx -d "${HOST}" --non-interactive --agree-tos \
    || fail "certbot failed — HTTP vhost is live but HTTPS is NOT; fix and re-run (idempotent)"
  nginx -t || fail "nginx -t failed after certbot"
  systemctl reload nginx
  info "certificate issued and 443 block installed by certbot"
fi

# ── 5. Smoke tests — the P0's actual acceptance criteria ─────────────
step "5/6 Smoke tests"
SMOKE_FAIL=0
check() { local label="$1"; shift; if "$@" >/dev/null 2>&1; then info "PASS  ${label}"; else info "FAIL  ${label}"; SMOKE_FAIL=1; fi; }

# EVERY probe below is a GET. The first run of this script, 2026-08-26 20:01Z,
# used `curl -I` for the header checks and reported DEPLOYMENT NOT VERIFIED
# against a deployment that was in fact correct and complete: the upstream is
# GET-only and answers HEAD with 405, which is its documented behaviour, not a
# fault. Worse, the content-type check then measured the 405's headers rather
# than the health document's and passed for the wrong reason. `-D- -o /dev/null`
# gives the headers of a real GET, so the checks read what users actually get.
HDRS="$(curl -sS -D- -o /dev/null  --max-time 15 "https://${HOST}/" || true)"
CHAIN="$(curl -sSL -D- -o /dev/null --max-time 30 "http://${HOST}/" || true)"
HEALTH="$(curl -sS  --max-time 15 "https://${HOST}/api/health" || true)"
HEALTH_CT="$(curl -sS -D- -o /dev/null --max-time 15 "https://${HOST}/api/health" || true)"

check "HTTPS GET / returns 200"                 grep -qE '^HTTP/[0-9.]+ 200' <<<"${HDRS}"
check "no darhijama.tn anywhere in the chain"   test -z "$(grep -i 'darhijama\.tn' <<<"${CHAIN}")"
check "HTTP redirects to this host's own HTTPS" grep -qi "location: https://${HOST}/" <<<"${CHAIN}"
# The whole point of the P0: JSON from the real catalog API, not an SPA fallback.
check "/api/health is application/json"         grep -qi 'content-type: *application/json' <<<"${HEALTH_CT}"
check "/api/health reports ok"                  grep -q '"status":"ok"' <<<"${HEALTH}"
check "/api/health proves a real DB read"       grep -q '"read_only":true' <<<"${HEALTH}"
check "catalog counts are present"              grep -q '"products"' <<<"${HEALTH}"
# Write verbs must be refused. WHERE they are refused depends on nginx location
# precedence, and the first run got this wrong too. An exact-match location
# (`location = /api/health`) beats a regex one (`location ~ ^/api/`), so on a
# vhost where only the regex block carries limit_except, /api/health is proxied
# straight through and the UPSTREAM refuses with 405 — still refused, one layer
# later. Any other /api/ path is refused at the edge with 403. Both are asserted
# separately so neither can hide the other.
check "POST to an /api/ path refused 403 at the edge" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST 'https://${HOST}/api/vehicles')\" = '403' ]"
check "POST /api/health is refused (403 edge or 405 upstream)" \
  bash -c "case \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST 'https://${HOST}/api/health')\" in 403|405) exit 0;; *) exit 1;; esac"
check "HSTS present"                            grep -qi 'strict-transport-security' <<<"${HDRS}"
check "X-Frame-Options DENY present"            grep -qi 'x-frame-options: *DENY' <<<"${HDRS}"

# ── 6. Regression — the apex and its neighbours must be untouched ────
step "6/6 Regression checks (the legacy apex above all)"
regress() { local code; code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1" || echo 000)"
  if [[ "${code}" =~ $2 ]]; then info "PASS  $3 (HTTP ${code})"; else info "FAIL  $3 (HTTP ${code}, expected $2)"; SMOKE_FAIL=1; fi; }

if [ -n "${APEX_SUM_BEFORE}" ]; then
  APEX_SUM_AFTER="$(sha256sum "${APEX_VHOST}" | awk '{print $1}')"
  if [ "${APEX_SUM_BEFORE}" = "${APEX_SUM_AFTER}" ]; then
    info "PASS  legacy apex vhost file is byte-identical to before"
  else
    info "FAIL  legacy apex vhost file CHANGED — this script must never modify it"; SMOKE_FAIL=1
  fi
fi
regress "https://ssangyong.autos/"             '^200$'          "legacy apex still healthy"
regress "https://ssangyong.autos/api/catalog.php" '^200$'       "legacy apex catalog API still healthy"
regress "https://www.ssangyong.autos/"         '^(200|30[12])$' "www.ssangyong.autos still answering"
regress "https://n8n.ssangyong.autos/"         '^(200|30[12])$' "n8n still answering"
regress "https://darhijama.tn/"                '^200$'          "darhijama.tn still healthy"
regress "https://status.mythosprod.xyz/"       '^200$'          "Status Center still healthy"

APEX_JSON="$(curl -sSI --max-time 15 "https://ssangyong.autos/api/catalog.php" || true)"
if grep -qi 'content-type: *application/json' <<<"${APEX_JSON}"; then
  info "PASS  legacy apex /api/catalog.php still returns application/json (not shadowed)"
else
  info "FAIL  legacy apex /api/catalog.php no longer returns JSON — the apex data path is broken"; SMOKE_FAIL=1
fi

printf '\n'
if [ "${SMOKE_FAIL}" -eq 0 ]; then
  printf '== ALL CHECKS PASSED — the catalog API is LIVE at https://%s/api/health (repo %s)\n' "${HOST}" "${HEAD_SHA}"
  printf '   BLOCKER-SYA-API-DOWN can now be closed. Next, as deploy:\n'
  printf '     1. probes.json — retarget sya-api to https://%s/api/health and set enabled:true\n' "${HOST}"
  printf '        (its expect_content_type guard already stops an SPA fallback false-green)\n'
  printf '     2. node projects/status-center/bin/review.js\n'
  printf '   Rollback remains available: sudo bash scripts/deploy-sya-storefront.sh --rollback\n'
else
  printf '== DEPLOYMENT NOT VERIFIED — one or more checks FAILED above.\n' >&2
  printf '   Do NOT report the catalog API as live. Roll back with:\n' >&2
  printf '   sudo bash scripts/deploy-sya-storefront.sh --rollback\n' >&2
  exit 1
fi
