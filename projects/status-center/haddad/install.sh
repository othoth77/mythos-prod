#!/usr/bin/env bash
# =====================================================================
# MYTHOS HADDAD — ingest receiver installation (VPS, root, idempotent)
# projects/status-center/haddad/install.sh
#
# Installs the one connector this feature adds: a loopback-only receiver
# for signed node telemetry, plus the two additive nginx locations that
# expose it (POST /ingest) and the console page (/haddad/).
#
# STRICTLY ADDITIVE. The only things it ever writes are:
#   the mythos-ingest system user (no shell, no home, no groups)
#   /etc/mythos/haddad-nodes.json                       (created empty-of-nodes if absent)
#   /etc/systemd/system/mythos-haddad-ingest.service
#   /var/www/status.mythosprod.xyz/data/                (ownership only)
#   /etc/nginx/sites-available/status.mythosprod.xyz    (two locations, between markers)
# It never touches another vhost, another site, DNS, or the certificate.
# It fails closed on every unexpected condition.
#
#   sudo bash install.sh              install / re-converge
#   sudo bash install.sh --rollback   remove the unit, the user and the nginx block
# =====================================================================
set -euo pipefail

HOST="status.mythosprod.xyz"
DOCROOT="/var/www/${HOST}"
DATA_DIR="${DOCROOT}/data"
SVC_USER="mythos-ingest"
UNIT="mythos-haddad-ingest.service"
UNIT_PATH="/etc/systemd/system/${UNIT}"
NODES_DIR="/etc/mythos"
NODES_FILE="${NODES_DIR}/haddad-nodes.json"
VHOST="/etc/nginx/sites-available/${HOST}"
PORT="8190"
RELEASE_DIR="/opt/mythos/haddad-ingest"
BEGIN="# BEGIN mythos-haddad (managed by projects/status-center/haddad/install.sh)"
END="# END mythos-haddad"

step() { printf '\n== %s\n' "$*"; }
info() { printf '   %s\n' "$*"; }
fail() { printf '\nFAILED: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "must run as root"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
[ -f "${SCRIPT_DIR}/bin/haddad-ingest.js" ] || fail "receiver missing under ${SCRIPT_DIR}"

# ── rollback ─────────────────────────────────────────────────────────
if [ "${1:-}" = "--rollback" ]; then
  step "ROLLBACK"
  systemctl disable --now "${UNIT}" 2>/dev/null || true
  rm -f "${UNIT_PATH}"
  systemctl daemon-reload
  if [ -f "${VHOST}" ] && grep -qF "${BEGIN}" "${VHOST}"; then
    cp -a "${VHOST}" "${VHOST}.bak-$(date +%Y%m%d-%H%M%S)"
    sed -i "/$(printf '%s' "${BEGIN}" | sed 's/[][\.*^$/]/\\&/g')/,/$(printf '%s' "${END}" | sed 's/[][\.*^$/]/\\&/g')/d" "${VHOST}"
    nginx -t || fail "nginx -t failed after removing the block — restore from the .bak beside ${VHOST}"
    systemctl reload nginx
    info "nginx block removed"
  fi
  rm -rf "${RELEASE_DIR}"
  userdel "${SVC_USER}" 2>/dev/null || true
  info "unit, release directory, nginx block and service user removed."
  info "LEFT IN PLACE on purpose: ${NODES_FILE} (node registrations) and"
  info "${DATA_DIR}/haddad-node.json + haddad-history/ (the record of what was seen)."
  exit 0
fi

# ── 1. preflight ─────────────────────────────────────────────────────
step "1/6 Preflight"
for bin in node nginx systemctl useradd install; do
  command -v "$bin" >/dev/null 2>&1 || fail "required binary missing: $bin"
done
node --check "${SCRIPT_DIR}/bin/haddad-ingest.js" || fail "receiver does not parse"
node --check "${SCRIPT_DIR}/lib/node-state.js"   || fail "node-state library does not parse"
[ -d "${DOCROOT}" ] || fail "Status Center docroot missing: ${DOCROOT} (deploy the site first)"
[ -f "${VHOST}" ]   || fail "Status Center vhost missing: ${VHOST}"
if ss -tlnH "sport = :${PORT}" 2>/dev/null | grep -q .; then
  systemctl is-active --quiet "${UNIT}" || fail "port ${PORT} is already in use by something that is not ${UNIT}"
fi
info "preflight OK"

# ── 2. service user ──────────────────────────────────────────────────
step "2/6 Service user"
if id -u "${SVC_USER}" >/dev/null 2>&1; then
  info "${SVC_USER} already exists"
else
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "${SVC_USER}"
  info "created system user ${SVC_USER} (no shell, no home)"
fi

# ── 3. node registry ─────────────────────────────────────────────────
step "3/6 Node registry"
install -d -m 0755 -o root -g root "${NODES_DIR}"
if [ -f "${NODES_FILE}" ]; then
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "${NODES_FILE}" \
    || fail "${NODES_FILE} exists but is not valid JSON — fix it before re-running"
  info "${NODES_FILE} present and valid — left untouched (it holds real registrations)"
else
  # Created with NO nodes: a node becomes visible only when its public key
  # is registered deliberately, never as a side effect of installing.
  printf '{\n  "nodes": []\n}\n' > "${NODES_FILE}"
  chmod 0644 "${NODES_FILE}"
  info "created ${NODES_FILE} with an empty node list"
  info "register a node with: bash ${SCRIPT_DIR}/bin/register-node.sh <id> <base64-public-key>"
fi

# ── 4. data directory ────────────────────────────────────────────────
step "4/6 Data directory"
install -d -m 0755 "${DATA_DIR}"
install -d -m 0755 -o "${SVC_USER}" -g www-data "${DATA_DIR}/haddad-history"
# The receiver's two output paths, and only those, belong to it. The rest
# of data/ stays www-data's — the STC-2 monitor and the review record are
# not this service's business.
for f in haddad-node.json; do
  [ -e "${DATA_DIR}/${f}" ] || { : > "${DATA_DIR}/${f}"; }
  chown "${SVC_USER}:www-data" "${DATA_DIR}/${f}"
  chmod 0644 "${DATA_DIR}/${f}"
done
# ProtectSystem=strict needs the whole ReadWritePaths directory traversable
# and writable for the tmp+rename dance; group-write is the narrowest form
# of that which does not hand the user the rest of the docroot.
chgrp "${SVC_USER}" "${DATA_DIR}"
chmod 0775 "${DATA_DIR}"
info "data directory ready (receiver owns haddad-node.json and haddad-history/ only)"

# ── 5. release directory + unit ──────────────────────────────────────
# The service does NOT run from a checkout. A git worktree is temporary by
# nature (a `git worktree prune` or a tidy-up would break the receiver mid
# flight) and the shared production checkout is dirty with other sessions'
# work and is an operator-only merge. The receiver needs exactly two of its
# own files and has zero dependencies outside them, so it is COPIED to a
# release directory and the unit points there. The checkout can then be
# moved or deleted without touching production.
step "5/6 Release directory"
install -d -m 0755 -o root -g root "${RELEASE_DIR}" "${RELEASE_DIR}/bin" "${RELEASE_DIR}/lib"
install -m 0755 -o root -g root "${SCRIPT_DIR}/bin/haddad-ingest.js"  "${RELEASE_DIR}/bin/haddad-ingest.js"
install -m 0644 -o root -g root "${SCRIPT_DIR}/lib/node-state.js"     "${RELEASE_DIR}/lib/node-state.js"
SRC_REF="$(git -C "${REPO}" rev-parse HEAD 2>/dev/null || echo unknown)"
SRC_DIRTY="$(git -C "${REPO}" status --porcelain -- "${SCRIPT_DIR}" 2>/dev/null | head -c1)"
cat > "${RELEASE_DIR}/VERSION" <<EOF
# Installed by projects/status-center/haddad/install.sh — do not edit by hand.
installed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
source_repo=${REPO}
source_commit=${SRC_REF}
source_clean=$([ -z "${SRC_DIRTY}" ] && echo yes || echo NO)
EOF
chmod 0644 "${RELEASE_DIR}/VERSION"
node --check "${RELEASE_DIR}/bin/haddad-ingest.js" || fail "the installed receiver does not parse"
info "receiver installed to ${RELEASE_DIR} (commit ${SRC_REF:0:8}$([ -z "${SRC_DIRTY}" ] || echo ', SOURCE DIRTY'))"

step "5b/6 systemd unit"
sed -e "s#@RELEASE_DIR@#${RELEASE_DIR}#g" "${SCRIPT_DIR}/systemd/${UNIT}" > "${UNIT_PATH}"
chmod 0644 "${UNIT_PATH}"
systemd-analyze verify "${UNIT_PATH}" || fail "systemd-analyze verify rejected the unit"
systemctl daemon-reload
systemctl enable "${UNIT}" >/dev/null
systemctl restart "${UNIT}"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -m 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then break; fi
  [ "$i" = "10" ] && fail "the receiver did not answer /health on 127.0.0.1:${PORT} — journalctl -u ${UNIT}"
  sleep 1
done
info "receiver active and answering on 127.0.0.1:${PORT}"

# ── 6. nginx (additive, between markers) ─────────────────────────────
step "6/6 nginx"
if grep -qF "${BEGIN}" "${VHOST}"; then
  info "managed block already present — replacing it in place"
  cp -a "${VHOST}" "${VHOST}.bak-$(date +%Y%m%d-%H%M%S)"
  sed -i "/$(printf '%s' "${BEGIN}" | sed 's/[][\.*^$/]/\\&/g')/,/$(printf '%s' "${END}" | sed 's/[][\.*^$/]/\\&/g')/d" "${VHOST}"
fi

# The block is built from a QUOTED heredoc so nginx variables survive
# verbatim; only @PORT@ is substituted.
BLOCK="$(sed "s/@PORT@/${PORT}/g" <<'NGINXBLOCK'
# BEGIN mythos-haddad (managed by projects/status-center/haddad/install.sh)
    # Telemetry ingest. The ONLY write path on this host, and it writes
    # nothing but a status snapshot. POST only; everything else is refused
    # here rather than in the application.
    location = /ingest {
        limit_except POST { deny all; }
        limit_req zone=mythos_haddad_ingest burst=5 nodelay;
        client_max_body_size 64k;
        client_body_buffer_size 64k;

        proxy_pass http://127.0.0.1:@PORT@/ingest;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # This endpoint authenticates by signature, never by session.
        proxy_set_header Cookie "";
        proxy_hide_header Set-Cookie;
        proxy_connect_timeout 3s;
        proxy_read_timeout 10s;
        add_header Cache-Control "no-store" always;
    }

    # The live console is static; its data is data/haddad-node.json, which
    # the existing no-cache rule for /data/ already covers.
    location = /haddad { return 301 https://$host/haddad/; }
# END mythos-haddad
NGINXBLOCK
)"

# Insert before the catch-all `location / {`, so the exact-match locations
# above are never shadowed by it.
awk -v block="${BLOCK}" '
  !done && /location \/ \{/ { print block; done=1 }
  { print }
' "${VHOST}" > "${VHOST}.new"
grep -qF "${BEGIN}" "${VHOST}.new" || fail "insertion point not found in ${VHOST} (expected a 'location / {' line)"
mv "${VHOST}.new" "${VHOST}"

# The rate-limit zone must live in http{}, not server{}.
ZONE="/etc/nginx/conf.d/mythos-haddad-ingest.conf"
cat > "${ZONE}" <<'EOF'
# MYTHOS Haddad telemetry ingest — rate-limit zone (http context).
# 10 r/s per source is 100x the published 10 s heartbeat: generous for a
# real node, and a hard ceiling on anyone hammering the endpoint. Refused
# requests never reach the receiver.
limit_req_zone $binary_remote_addr zone=mythos_haddad_ingest:1m rate=10r/s;
EOF

nginx -t || fail "nginx -t failed — the previous vhost is beside it as ${VHOST}.bak-*"
systemctl reload nginx
info "nginx reloaded: POST /ingest -> 127.0.0.1:${PORT}"

printf '\nINSTALLED.\n'
printf '  unit      systemctl status %s\n' "${UNIT}"
printf '  registry  %s\n' "${NODES_FILE}"
printf '  snapshot  %s/haddad-node.json\n' "${DATA_DIR}"
printf '  rollback  sudo bash %s --rollback\n' "${BASH_SOURCE[0]}"
printf '\nA node is INVISIBLE until its public key is registered. On the node run\n'
printf '  projects/mythos-haddad/bin/haddad-telemetry-setup.sh\n'
printf 'and register the key it prints with\n'
printf '  sudo bash %s/bin/register-node.sh <id> <base64-public-key>\n' "${SCRIPT_DIR}"
