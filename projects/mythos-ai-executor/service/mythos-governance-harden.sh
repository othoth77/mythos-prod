#!/usr/bin/env bash
# =====================================================
# Mythos — governance host hardening + relay install (ROOT ONLY, idempotent)
# projects/mythos-ai-executor/service/mythos-governance-harden.sh
#
# Establishes and verifies the AI Operating Layer v1 governance security
# boundary on the production host. Safe to re-run; every step is either a
# no-op when already correct or converges to the correct state.
#
# The architecture this enforces:
#
#   - Autonomous missions and interactive sessions execute as `deploy`.
#   - The governance signing key /etc/mythos/governance.key is
#     root:mythos-gov 0640 — the mission identity CANNOT read it.
#   - `mythos-gov` is a dedicated MEMBERLESS system group. No user is ever
#     added to it; this script refuses to run if it has acquired members.
#   - Only the relay PROCESS receives mythos-gov, through
#     SupplementaryGroups=mythos-gov in mythos-git-push.service.
#   - The approvals store is readable (never writable) by the relay process;
#     only root writes approvals, via mythos-governance-approve.
#   - The governance log directory is writable by the relay process so
#     denials are always recorded.
#
# This script NEVER prints, copies, or transmits the key material.
#
# Usage (on the production host):
#   sudo bash projects/mythos-ai-executor/service/mythos-governance-harden.sh
# =====================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GOV_GROUP=mythos-gov
KEY_FILE=/etc/mythos/governance.key
GOV_DIR=/var/lib/mythos/governance
APPROVALS_DIR=$GOV_DIR/approvals
LOG_DIR=$GOV_DIR/log
MISSION_USER=deploy

log()  { printf '[harden] %s\n' "$*"; }
fail() { printf '[harden] FAIL: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "must run as root"

# --- 1. Memberless system group ----------------------------------------------
if ! getent group "$GOV_GROUP" >/dev/null; then
  log "creating system group $GOV_GROUP"
  groupadd --system "$GOV_GROUP"
else
  log "group $GOV_GROUP already exists"
fi
MEMBERS=$(getent group "$GOV_GROUP" | cut -d: -f4)
if [ -n "$MEMBERS" ]; then
  # Never silently strip membership — that is an explicit operator decision.
  fail "$GOV_GROUP must be MEMBERLESS but has members: $MEMBERS (remove with: gpasswd -d <user> $GOV_GROUP)"
fi
if id -nG "$MISSION_USER" 2>/dev/null | tr ' ' '\n' | grep -qx "$GOV_GROUP"; then
  fail "$MISSION_USER must never carry $GOV_GROUP"
fi

# --- 2. Root-owned installed copies (never run governance code from the repo) -
install -d -o root -g root -m 0755 /usr/local/lib/mythos
install -o root -g root -m 0755 "$SCRIPT_DIR/mythos-git-push.sh" /usr/local/bin/mythos-git-push
install -o root -g root -m 0644 "$SCRIPT_DIR/governance-verify.js" /usr/local/lib/mythos/governance-verify.js
install -o root -g root -m 0755 "$SCRIPT_DIR/mythos-governance-approve.js" /usr/local/bin/mythos-governance-approve
install -o root -g root -m 0644 "$SCRIPT_DIR/mythos-git-push.service" /etc/systemd/system/mythos-git-push.service
install -o root -g root -m 0644 "$SCRIPT_DIR/mythos-git-push.timer" /etc/systemd/system/mythos-git-push.timer
log "root-owned relay, verifier, approve tool and units installed"

# --- 3. Signing key: root:mythos-gov 0640, created only if absent -------------
install -d -o root -g root -m 0755 /etc/mythos
if [ ! -f "$KEY_FILE" ]; then
  # A new key invalidates nothing (no approvals can exist without one).
  # Regenerating an EXISTING key is deliberately NOT done here: it would
  # silently invalidate every persisted approval signature.
  log "generating governance key (value not shown)"
  ( umask 227; head -c 48 /dev/urandom | base64 > "$KEY_FILE" )
fi
chown root:"$GOV_GROUP" "$KEY_FILE"
chmod 0640 "$KEY_FILE"
log "key ownership root:$GOV_GROUP mode 0640 applied"

# --- 4. Governance store: group-readable, root-writable; log group-writable ---
install -d -o root -g "$GOV_GROUP" -m 0750 "$GOV_DIR"
install -d -o root -g "$GOV_GROUP" -m 0750 "$APPROVALS_DIR"
install -d -o root -g "$GOV_GROUP" -m 2770 "$LOG_DIR"
chown root:"$GOV_GROUP" "$GOV_DIR" "$APPROVALS_DIR" "$LOG_DIR"
chmod 0750 "$GOV_DIR" "$APPROVALS_DIR"
chmod 2770 "$LOG_DIR"
find "$APPROVALS_DIR" -maxdepth 1 -type f -name '*.json' \
  -exec chown root:"$GOV_GROUP" {} + -exec chmod 0640 {} + 2>/dev/null || true
if [ -f "$GOV_DIR/audit.log" ]; then
  chown root:root "$GOV_DIR/audit.log"
  chmod 0640 "$GOV_DIR/audit.log"
fi
log "governance store ownership applied (approvals ro-by-group, log rw-by-group)"

# --- 5. systemd ----------------------------------------------------------------
systemctl daemon-reload
systemctl enable --now mythos-git-push.timer >/dev/null 2>&1 || systemctl enable --now mythos-git-push.timer
log "daemon reloaded; delivery timer enabled"

# --- 6. Verification (the boundary, proven, without printing the key) ---------
FAILURES=0
check() { # check <label> <expected 0|1> <cmd...>
  local label="$1" want="$2"; shift 2
  local got=0; "$@" >/dev/null 2>&1 || got=1
  if [ "$got" = "$want" ]; then log "PASS $label"; else
    log "FAIL $label"; FAILURES=$((FAILURES + 1)); fi
}
check "$GOV_GROUP exists"                    0 getent group "$GOV_GROUP"
[ -z "$(getent group "$GOV_GROUP" | cut -d: -f4)" ] \
  && log "PASS $GOV_GROUP is memberless" \
  || { log "FAIL $GOV_GROUP is memberless"; FAILURES=$((FAILURES + 1)); }
OWN=$(stat -c '%U:%G %a' "$KEY_FILE")
[ "$OWN" = "root:$GOV_GROUP 640" ] \
  && log "PASS key is root:$GOV_GROUP 0640" \
  || { log "FAIL key ownership is '$OWN', expected root:$GOV_GROUP 640"; FAILURES=$((FAILURES + 1)); }
if id "$MISSION_USER" >/dev/null 2>&1; then
  check "$MISSION_USER CANNOT read the key"            1 runuser -u "$MISSION_USER" -- test -r "$KEY_FILE"
  check "$MISSION_USER CANNOT list the approval store" 1 runuser -u "$MISSION_USER" -- ls "$APPROVALS_DIR"
  check "relay identity (deploy+$GOV_GROUP) CAN read the key" \
                                                       0 runuser -u "$MISSION_USER" -G "$GOV_GROUP" -- test -r "$KEY_FILE"
  check "relay identity CAN read the approval store"   0 runuser -u "$MISSION_USER" -G "$GOV_GROUP" -- ls "$APPROVALS_DIR"
  check "relay identity CANNOT write the approval store" \
                                                       1 runuser -u "$MISSION_USER" -G "$GOV_GROUP" -- touch "$APPROVALS_DIR/.probe"
  check "relay identity CAN write the governance log"  0 runuser -u "$MISSION_USER" -G "$GOV_GROUP" -- \
                                                         sh -c "touch '$LOG_DIR/.probe' && rm -f '$LOG_DIR/.probe'"
else
  log "WARN user $MISSION_USER absent on this host — live boundary checks skipped"
fi
rm -f "$APPROVALS_DIR/.probe" 2>/dev/null || true

if [ "$FAILURES" -gt 0 ]; then
  fail "$FAILURES verification check(s) failed — boundary NOT established"
fi
log "governance boundary established and verified"
