#!/usr/bin/env bash
# =====================================================================
# MYTHOS Status Center — one-command deployment
# scripts/deploy-status-center.sh
#
# Audited, idempotent deployment of sites/status.mythosprod.xyz on the
# VPS. Implements sites/status.mythosprod.xyz/DEPLOYMENT.md end-to-end:
# preflight → content → additive vhost → certbot → smoke tests →
# regression checks. Run as root from the repository checkout:
#
#     sudo bash scripts/deploy-status-center.sh
#     sudo bash scripts/deploy-status-center.sh --rollback   # undo vhost
#
# STRICTLY ADDITIVE: the only files this script ever writes are
#   /etc/nginx/sites-available/status.mythosprod.xyz  (+ its symlink)
#   /var/www/status.mythosprod.xyz/
# It never touches dar-hijama-app or any other vhost, site, or DNS
# record. It fails closed on every unexpected condition and never
# reports success it did not verify.
# =====================================================================
set -euo pipefail

HOST="status.mythosprod.xyz"
EXPECTED_IP="51.68.226.211"
DOCROOT="/var/www/${HOST}"
VHOST_AVAIL="/etc/nginx/sites-available/${HOST}"
VHOST_LINK="/etc/nginx/sites-enabled/${HOST}"
PROTECTED_VHOST="/etc/nginx/sites-enabled/dar-hijama-app"

step()  { printf '\n== %s\n' "$*"; }
info()  { printf '   %s\n' "$*"; }
fail()  { printf '\nFAILED: %s\nNothing further was executed. Fix the condition and re-run — the script is idempotent.\n' "$*" >&2; exit 1; }
trap 'printf "\nABORTED at line %s (last command: %s)\n" "$LINENO" "$BASH_COMMAND" >&2' ERR

[ "$(id -u)" -eq 0 ] || fail "must run as root (sudo bash scripts/deploy-status-center.sh)"

# Locate the repository from the script's own path — no cwd assumptions.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${SCRIPT_DIR}/.." && pwd)"
SITE_SRC="${REPO}/sites/${HOST}"

# ── Rollback mode ────────────────────────────────────────────────────
if [ "${1:-}" = "--rollback" ]; then
  step "ROLLBACK: disabling the ${HOST} vhost (certificate and docroot are left in place)"
  if [ -L "${VHOST_LINK}" ] || [ -e "${VHOST_LINK}" ]; then
    rm -f "${VHOST_LINK}"
    nginx -t || fail "nginx -t failed after rollback — investigate before reloading"
    systemctl reload nginx
    info "vhost disabled; ${HOST} returns to the default-vhost fallback."
  else
    info "vhost was not enabled; nothing to roll back."
  fi
  exit 0
fi

# ── 1. Preflight ─────────────────────────────────────────────────────
step "1/6 Preflight"

for bin in git nginx curl rsync certbot getent systemctl; do
  command -v "$bin" >/dev/null 2>&1 || fail "required binary missing: $bin"
done

RESOLVED="$(getent hosts "${HOST}" | awk '{print $1; exit}' || true)"
[ "${RESOLVED}" = "${EXPECTED_IP}" ] || fail "DNS: ${HOST} resolves to '${RESOLVED:-<nothing>}', expected ${EXPECTED_IP}"
info "DNS OK: ${HOST} → ${RESOLVED}"

git -C "${REPO}" rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "${REPO} is not a git worktree"
BRANCH="$(git -C "${REPO}" branch --show-current)"
[ "${BRANCH}" = "main" ] || fail "repository is on branch '${BRANCH}', expected main"
DIRTY="$(git -C "${REPO}" status --porcelain)"
[ -z "${DIRTY}" ] || fail "repository worktree is not clean:\n${DIRTY}"
HEAD_SHA="$(git -C "${REPO}" rev-parse HEAD)"
info "repo OK: main @ ${HEAD_SHA} (clean)"

for f in index.html assets/app.js assets/app.css assets/tokens.css assets/fonts.css \
         data/current.json data/reviews-index.json health.json robots.txt \
         assets/fonts/ibm-plex-sans-400-latin.woff2; do
  [ -f "${SITE_SRC}/${f}" ] || fail "expected Status Center file missing: sites/${HOST}/${f}"
done
[ -d "${SITE_SRC}/reviews" ] || fail "expected reviews/ directory missing in sites/${HOST}/"
grep -q '"application": "mythos-status-center"' "${SITE_SRC}/health.json" \
  || fail "health.json does not look like the Status Center health body"
info "site content OK: all expected Status Center files present"

[ -e "${PROTECTED_VHOST}" ] && info "protected vhost present and will not be touched: ${PROTECTED_VHOST}"

# No OTHER vhost may claim the hostname (our own file is fine — idempotency).
CLAIMS="$(grep -rls "server_name[^;]*\b${HOST}\b" /etc/nginx/sites-enabled/ /etc/nginx/sites-available/ 2>/dev/null \
          | grep -v -e "^${VHOST_AVAIL}$" -e "^${VHOST_LINK}$" || true)"
[ -z "${CLAIMS}" ] || fail "another vhost already claims ${HOST}: ${CLAIMS}"

# Record (evidence) the current fault state — informational only, since
# on a re-run the site is already fixed.
info "current HTTP state (pre-change, for the evidence log):"
curl -sSI --max-time 10 "http://${HOST}/" 2>&1 | head -4 | sed 's/^/     /' || true

# ── 2. Content ───────────────────────────────────────────────────────
step "2/6 Copy site content → ${DOCROOT}"
mkdir -p "${DOCROOT}"
rsync -a --delete \
  --exclude DEPLOYMENT.md --exclude README.md \
  "${SITE_SRC}/" "${DOCROOT}/"
chown -R www-data:www-data "${DOCROOT}"
[ -f "${DOCROOT}/index.html" ] && [ -f "${DOCROOT}/health.json" ] || fail "docroot incomplete after rsync"
info "content synced (data/, reviews/, health.json included — they ARE the data model)"

# ── 3. Vhost (additive, certbot-aware) ───────────────────────────────
step "3/6 nginx vhost"

NGINX_CHANGED=0
if [ -f "${VHOST_AVAIL}" ] && grep -q "managed by Certbot" "${VHOST_AVAIL}"; then
  # certbot has already extended this file with the 443 block — never
  # clobber it back to the pre-TLS form (idempotency after step 4).
  info "existing certbot-managed vhost found — leaving it untouched"
else
  TMP_VHOST="$(mktemp)"
  cat > "${TMP_VHOST}" <<NGINX
# ${HOST} — MYTHOS Status Center (installed by scripts/deploy-status-center.sh)
# Pre-TLS form: certbot rewrites this file in place when the certificate
# is issued; do not hand-write the 443 block.
server {
    listen 80;
    listen [::]:80;
    server_name ${HOST};

    root ${DOCROOT};
    index index.html;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy no-referrer always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Content-Security-Policy "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'none'" always;

    location = /robots.txt {
        add_header Content-Type text/plain;
        return 200 "User-agent: *\nDisallow: /\n";
    }

    location = /health {
        default_type application/json;
        alias ${DOCROOT}/health.json;
    }

    location /assets/fonts/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location /data/ {
        add_header Cache-Control "no-cache";
    }

    location / { try_files \$uri \$uri/ =404; }
}
NGINX
  if [ -f "${VHOST_AVAIL}" ] && cmp -s "${TMP_VHOST}" "${VHOST_AVAIL}"; then
    info "vhost unchanged"
    rm -f "${TMP_VHOST}"
  else
    if [ -f "${VHOST_AVAIL}" ]; then
      BACKUP="${VHOST_AVAIL}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
      cp -p "${VHOST_AVAIL}" "${BACKUP}"
      info "existing vhost backed up to ${BACKUP}"
    fi
    install -m 0644 "${TMP_VHOST}" "${VHOST_AVAIL}"
    rm -f "${TMP_VHOST}"
    NGINX_CHANGED=1
    info "vhost written: ${VHOST_AVAIL}"
  fi
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

# ── 5. Smoke tests (the live acceptance criteria) ────────────────────
step "5/6 Smoke tests"
SMOKE_FAIL=0
check() { # check <label> <cmd...>
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then info "PASS  ${label}"; else info "FAIL  ${label}"; SMOKE_FAIL=1; fi
}

HDRS="$(curl -sSI --max-time 15 "https://${HOST}/" || true)"
CHAIN="$(curl -sSIL --max-time 30 "https://${HOST}/" || true)"
BODY="$(curl -sS  --max-time 15 "https://${HOST}/" || true)"
HEALTH="$(curl -sS --max-time 15 "https://${HOST}/health" || true)"

check "HTTPS 200 from ${HOST}"                 grep -qE '^HTTP/[0-9.]+ 200' <<<"${HDRS}"
check "no darhijama.tn anywhere in the chain"  test -z "$(grep -i 'darhijama\.tn' <<<"${CHAIN}")"
check "page contains 'Status Center'"          grep -q 'Status Center' <<<"${BODY}"
check "/health has application id"             grep -q '"application": "mythos-status-center"' <<<"${HEALTH}"
check "/health has a review id"                grep -qE '"review_id": "REVIEW-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{3}"' <<<"${HEALTH}"
check "robots.txt disallows"                   bash -c "curl -sS --max-time 15 'https://${HOST}/robots.txt' | grep -q 'Disallow: /'"
check "data/current.json served"               bash -c "curl -sS --max-time 15 'https://${HOST}/data/current.json' | head -c 200 | grep -q 'review_id'"
check "font served with 200"                   bash -c "curl -sSI --max-time 15 'https://${HOST}/assets/fonts/ibm-plex-sans-400-latin.woff2' | grep -qE '^HTTP/[0-9.]+ 200'"

# ── 6. Regression checks (untouched neighbours) ──────────────────────
step "6/6 Regression checks on existing sites"
regress() { # regress <url> <expected-code-regex> <label>
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1" || echo 000)"
  if [[ "${code}" =~ $2 ]]; then info "PASS  $3 (HTTP ${code})"; else info "FAIL  $3 (HTTP ${code}, expected $2)"; SMOKE_FAIL=1; fi
}
regress "https://darhijama.tn/"          '^200$'        "darhijama.tn still healthy"
regress "https://uthinachess.tn/"        '^200$'        "uthinachess.tn still healthy"
regress "https://panel.mythosprod.xyz/"  '^(200|30[12])$' "panel still answering (login redirect expected)"

printf '\n'
if [ "${SMOKE_FAIL}" -eq 0 ]; then
  printf '== ALL CHECKS PASSED — %s is LIVE at https://%s/ (repo %s)\n' "${HOST}" "${HOST}" "${HEAD_SHA}"
  printf '   Next: record this output in docs/audits/STATUS_CENTER_ROUTING_DIAGNOSIS_2026-08-20.md\n'
  printf '   and docs/AI_HANDOVER.md, then run: node projects/status-center/bin/review.js\n'
  printf '   Rollback remains available: sudo bash scripts/deploy-status-center.sh --rollback\n'
else
  printf '== DEPLOYMENT NOT VERIFIED — one or more checks FAILED above.\n' >&2
  printf '   Do NOT report the Status Center as live. Rollback if needed:\n' >&2
  printf '   sudo bash scripts/deploy-status-center.sh --rollback\n' >&2
  exit 1
fi
