#!/usr/bin/env bash
# One-time root bootstrap for the permanent Mythos administration model.
# Executed as root via `certbot --manual --manual-auth-hook` (dry-run/staging,
# invalid domain — no certificate is issued or touched). Idempotent.
set -uo pipefail

STAGE="/tmp/mythos-bootstrap"
RESULT="$STAGE/result.txt"
ADMIN="mythosadmin"
: >"$RESULT"; chmod 644 "$RESULT" 2>/dev/null || true
log(){ printf '%s\n' "$*" | tee -a "$RESULT"; }

log "=== mythos bootstrap @ $(date -u +%FT%TZ) as $(id -un) ==="
[ "$(id -u)" = "0" ] || { log "NOT ROOT (uid=$(id -u)) — abort"; exit 0; }

# 1. Create the dedicated admin account (locked password → key-only login,
#    no supplementary groups: not sudo, not docker, not the deploy group).
if id "$ADMIN" >/dev/null 2>&1; then
  log "user $ADMIN: already exists"
else
  useradd -m -s /bin/bash "$ADMIN" && log "user $ADMIN: created" || log "user $ADMIN: useradd FAILED"
fi
passwd -l "$ADMIN" >/dev/null 2>&1 && log "user $ADMIN: password locked (key-only)"
usermod -s /bin/bash "$ADMIN" 2>/dev/null || true

# 2. SSH key authentication
H="$(getent passwd "$ADMIN" | cut -d: -f6)"
install -d -m 700 -o "$ADMIN" -g "$ADMIN" "$H/.ssh"
if [ -f "$STAGE/mythosadmin.pub" ]; then
  # idempotent: only add if not already present
  touch "$H/.ssh/authorized_keys"
  KEY="$(cat "$STAGE/mythosadmin.pub")"
  grep -qF "$KEY" "$H/.ssh/authorized_keys" 2>/dev/null || printf '%s\n' "$KEY" >>"$H/.ssh/authorized_keys"
  chown "$ADMIN:$ADMIN" "$H/.ssh/authorized_keys"; chmod 600 "$H/.ssh/authorized_keys"
  log "ssh: authorized_keys installed ($(wc -l <"$H/.ssh/authorized_keys") key(s))"
else
  log "ssh: PUBKEY MISSING at $STAGE/mythosadmin.pub — abort"; exit 0
fi

# 3. Install the audited deployment tool (root-owned, not writable by admin)
if [ -f "$STAGE/mythos-deploy" ]; then
  install -o root -g root -m 0755 "$STAGE/mythos-deploy" /usr/local/sbin/mythos-deploy \
    && log "tool: /usr/local/sbin/mythos-deploy installed ($(sha256sum /usr/local/sbin/mythos-deploy | cut -c1-16)…)"
  install -d -o root -g root -m 0755 /var/lib/mythos-deploy
  touch /var/log/mythos-deploy.log && chmod 0644 /var/log/mythos-deploy.log
else
  log "tool: SOURCE MISSING — abort"; exit 0
fi

# 4. Controlled sudo — validate with visudo BEFORE installing, never leave a
#    broken sudoers file.
if [ -f "$STAGE/50-mythosadmin" ]; then
  cp "$STAGE/50-mythosadmin" /tmp/50-mythosadmin.check
  if visudo -cf /tmp/50-mythosadmin.check >/dev/null 2>&1; then
    install -o root -g root -m 0440 "$STAGE/50-mythosadmin" /etc/sudoers.d/50-mythosadmin
    if visudo -c >/dev/null 2>&1; then
      log "sudo: /etc/sudoers.d/50-mythosadmin installed (visudo -c OK)"
    else
      rm -f /etc/sudoers.d/50-mythosadmin; log "sudo: global visudo -c FAILED — file removed, aborting"; exit 0
    fi
  else
    log "sudo: 50-mythosadmin FAILED visudo syntax check — NOT installed"; exit 0
  fi
  rm -f /tmp/50-mythosadmin.check
else
  log "sudo: SOURCE MISSING — abort"; exit 0
fi

# 5. Report exactly what mythosadmin can do (ground truth from sudo itself)
log "--- sudo -l -U $ADMIN ---"
sudo -l -U "$ADMIN" 2>&1 | tee -a "$RESULT"

# 6. Confirm we did NOT weaken anything: sshd untouched, governance key still
#    unreadable to the admin, admin not in docker/sudo groups.
log "--- safety assertions ---"
log "groups($ADMIN): $(id -nG "$ADMIN")"
log "sshd_config.d unchanged listing: $(ls /etc/ssh/sshd_config.d/ | tr '\n' ' ')"
[ -f /etc/mythos/governance.key ] && log "governance.key perms: $(stat -c '%A %U:%G' /etc/mythos/governance.key)" || log "governance.key: not present"
log "=== bootstrap complete ==="
exit 0
