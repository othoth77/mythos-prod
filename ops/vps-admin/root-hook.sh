#!/usr/bin/env bash
# One-time root bootstrap for the permanent Mythos administration model.
# Safe to re-run after /tmp cleanup: the audited tool and sudoers source come
# from the repository; the public key is reused from the existing account when
# already installed. Intended for an owner-controlled root/KVM shell.
set -euo pipefail

ADMIN="mythosadmin"
STAGE="/tmp/mythos-bootstrap"
REPO="/home/deploy/projects/mythos-prod/ops/vps-admin"
RESULT="$STAGE/result.txt"
mkdir -p "$STAGE"
: >"$RESULT"
chmod 644 "$RESULT" 2>/dev/null || true
log(){ printf '%s\n' "$*" | tee -a "$RESULT"; }
die(){ log "FAILED: $*"; exit 1; }

log "=== mythos bootstrap @ $(date -u +%FT%TZ) as $(id -un) ==="
[ "$(id -u)" = "0" ] || die "must run as root"

# Prefer the checked-in source on the VPS checkout. The /tmp copy is only a
# fallback for a bootstrap performed before the repository checkout exists.
if [ -d "$REPO" ]; then
  SRC="$REPO"
else
  SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
log "source: $SRC"

# 1. Dedicated admin account: key-only, no privileged supplementary groups.
if id "$ADMIN" >/dev/null 2>&1; then
  log "user $ADMIN: already exists"
else
  useradd -m -s /bin/bash "$ADMIN" || die "cannot create $ADMIN"
  log "user $ADMIN: created"
fi
passwd -l "$ADMIN" >/dev/null 2>&1 || die "cannot lock $ADMIN password"
usermod -s /bin/bash "$ADMIN" 2>/dev/null || true
log "user $ADMIN: password locked (key-only)"

# 2. SSH key authentication. On a re-run, the existing authorized_keys is
# authoritative; a public-key staging file is needed only for first install.
H="$(getent passwd "$ADMIN" | cut -d: -f6)"
install -d -m 700 -o "$ADMIN" -g "$ADMIN" "$H/.ssh"
touch "$H/.ssh/authorized_keys"
chown "$ADMIN:$ADMIN" "$H/.ssh/authorized_keys"
chmod 600 "$H/.ssh/authorized_keys"
if [ -s "$STAGE/mythosadmin.pub" ]; then
  KEY="$(cat "$STAGE/mythosadmin.pub")"
  grep -qF "$KEY" "$H/.ssh/authorized_keys" 2>/dev/null || printf '%s\n' "$KEY" >>"$H/.ssh/authorized_keys"
  log "ssh: staged public key ensured"
elif [ -s "$H/.ssh/authorized_keys" ]; then
  log "ssh: existing authorized_keys preserved (no staging key required)"
else
  die "public key missing; place mythosadmin.pub in $STAGE for first install"
fi

# 3. Install the audited deployment tool from the repository source.
[ -f "$SRC/mythos-deploy" ] || die "missing $SRC/mythos-deploy"
install -o root -g root -m 0755 "$SRC/mythos-deploy" /usr/local/sbin/mythos-deploy || die "tool install failed"
install -d -o root -g root -m 0755 /var/lib/mythos-deploy
touch /var/log/mythos-deploy.log
chown root:root /var/log/mythos-deploy.log
chmod 0644 /var/log/mythos-deploy.log
log "tool: /usr/local/sbin/mythos-deploy installed ($(sha256sum /usr/local/sbin/mythos-deploy | cut -c1-16)…)"

# 4. Controlled sudo. Validate the exact source first, then install it
# atomically. Never destroy an already-valid sudoers file on failure.
[ -f "$SRC/50-mythosadmin" ] || die "missing $SRC/50-mythosadmin"
install -d -o root -g root -m 0755 /etc/sudoers.d
CHECK="$STAGE/50-mythosadmin.check"
install -o root -g root -m 0440 "$SRC/50-mythosadmin" "$CHECK" || die "cannot stage sudoers check"
if ! CHECK_ERR="$(visudo -cf "$CHECK" 2>&1)"; then
  rm -f "$CHECK"
  die "50-mythosadmin failed visudo syntax check: $CHECK_ERR"
fi
rm -f "$CHECK"

FINAL="/etc/sudoers.d/50-mythosadmin"
TMP="/etc/sudoers.d/.50-mythosadmin.tmp.$$"
BACKUP="$STAGE/50-mythosadmin.previous"
HAD_PREVIOUS=0
if [ -f "$FINAL" ]; then
  cp -a "$FINAL" "$BACKUP" || die "cannot back up existing sudoers file"
  HAD_PREVIOUS=1
fi
rm -f "$TMP"
install -o root -g root -m 0440 "$SRC/50-mythosadmin" "$TMP" || die "sudoers temp install failed"
chmod 0440 "$TMP" || die "sudoers temp chmod failed"
mv -f "$TMP" "$FINAL" || die "sudoers atomic install failed"

restore_previous() {
  rm -f "$FINAL"
  if [ "$HAD_PREVIOUS" = "1" ]; then
    install -o root -g root -m 0440 "$BACKUP" "$FINAL" || true
  fi
}

if ! GLOBAL_ERR="$(visudo -c 2>&1)"; then
  restore_previous
  die "global visudo -c failed; new sudoers file was reverted: $GLOBAL_ERR"
fi

MODE="$(stat -c '%a' "$FINAL" 2>/dev/null || echo '?')"
[ "$MODE" = "440" ] || { restore_previous; die "sudoers mode is $MODE, expected 440"; }

if ! PRIVS="$(sudo -n -l -U "$ADMIN" 2>&1)"; then
  restore_previous
  die "sudo privilege verification failed; new sudoers file was reverted: $PRIVS"
fi
printf '%s\n' "$PRIVS" | grep -Fq '/usr/local/sbin/mythos-deploy' || {
  restore_previous
  die "sudo privilege verification missing mythos-deploy; new sudoers file was reverted"
}

rm -f "$BACKUP"
log "sudo: /etc/sudoers.d/50-mythosadmin installed atomically (mode 440, global visudo OK, sudo privilege check OK)"

# 5. Ground-truth report.
log "--- sudo -l -U $ADMIN ---"
printf '%s\n' "$PRIVS" | tee -a "$RESULT"
log "--- safety assertions ---"
log "groups($ADMIN): $(id -nG "$ADMIN")"
log "sshd_config.d listing: $(ls /etc/ssh/sshd_config.d/ 2>/dev/null | tr '\n' ' ')"
[ -f /etc/mythos/governance.key ] && log "governance.key perms: $(stat -c '%A %U:%G' /etc/mythos/governance.key)" || log "governance.key: not present"
log "=== bootstrap complete ==="
