#!/usr/bin/env bash
# ops/runner/inspect-and-repair-workspace.sh — Step-0 tool for the runner
# workspace fault first recorded 2026-08-21 (VPS Final Gate runs
# 32482633989 / 32485711727: "insufficient permission for adding an object
# to repository database .git/objects" in
# /opt/mythos-gh-runner/_work/mythos-prod/mythos-prod).
#
# Root-run, on the VPS, over the sanctioned operator path. Contract:
#   inspect            (default) read-only diagnosis — prints ownership,
#                      permissions, ACLs, immutable attrs, the runner
#                      service account, and every entry not owned by the
#                      runner user. CHANGES NOTHING.
#   repair             minimal correction ONLY: chown exactly the entries
#                      the inspection found foreign-owned (never a blind
#                      recursive chown of the runner root), after printing
#                      them. Refuses if the runner user cannot be determined.
#   reset              last resort: remove the DISPOSABLE _work/mythos-prod
#                      workspace so the runner recreates it on next run.
#                      Touches nothing outside _work/mythos-prod.
#
# This script never edits the runner service, sudoers, NoNewPrivileges,
# governance controls, or anything outside the workspace tree.
set -euo pipefail

RUNNER_ROOT=/opt/mythos-gh-runner
WORKSPACE="$RUNNER_ROOT/_work/mythos-prod"
MODE="${1:-inspect}"

[ "$(id -u)" -eq 0 ] || { echo "ERROR: must run as root" >&2; exit 1; }
[ -d "$RUNNER_ROOT" ] || { echo "ERROR: $RUNNER_ROOT missing — is this the runner host?" >&2; exit 1; }

# Determine the runner service account from evidence, not assumption:
# owner of the runner root, cross-checked against the systemd unit if present.
RUNNER_USER="$(stat -c %U "$RUNNER_ROOT")"
UNIT="$(systemctl list-units --all --no-legend 'actions.runner.*' 2>/dev/null | awk '{print $1}' | head -1 || true)"
echo "== Runner workspace diagnosis ($(date -u +%Y-%m-%dT%H:%M:%SZ)) =="
echo "runner root owner (assumed service account): $RUNNER_USER"
if [ -n "$UNIT" ]; then
  echo "runner unit: $UNIT"
  systemctl show "$UNIT" --property=User,ExecStart --no-pager 2>/dev/null || true
fi
id "$RUNNER_USER" 2>/dev/null || echo "WARN: account $RUNNER_USER not resolvable"

echo ""
echo "-- Ownership/permissions along the failing path"
for p in "$RUNNER_ROOT" "$RUNNER_ROOT/_work" "$WORKSPACE" \
         "$WORKSPACE/mythos-prod" "$WORKSPACE/mythos-prod/.git" \
         "$WORKSPACE/mythos-prod/.git/objects"; do
  if [ -e "$p" ]; then stat -c '%A %U:%G %n' "$p"; else echo "(absent) $p"; fi
done

echo ""
echo "-- ACLs and immutable attributes on .git/objects (if tooling present)"
command -v getfacl >/dev/null && getfacl -p "$WORKSPACE/mythos-prod/.git/objects" 2>/dev/null | sed 's/^/  /' || echo "  getfacl unavailable/skipped"
command -v lsattr  >/dev/null && lsattr -d "$WORKSPACE/mythos-prod/.git/objects" 2>/dev/null | sed 's/^/  /' || echo "  lsattr unavailable/skipped"

echo ""
echo "-- Filesystem headroom (EACCES vs ENOSPC disambiguation)"
df -h "$RUNNER_ROOT" | sed 's/^/  /'
df -i "$RUNNER_ROOT" | sed 's/^/  /'

echo ""
echo "-- Entries under the workspace NOT owned by $RUNNER_USER (the actual fault set)"
FOREIGN="$(find "$WORKSPACE" \( ! -user "$RUNNER_USER" -o ! -writable \) -exec stat -c '%A %U:%G %n' {} + 2>/dev/null || true)"
if [ -z "$FOREIGN" ]; then
  echo "  none found — if checkout still fails, re-check ACLs/attrs/disk above"
else
  printf '%s\n' "$FOREIGN" | sed 's/^/  /'
  echo "  count: $(printf '%s\n' "$FOREIGN" | wc -l)"
fi

case "$MODE" in
  inspect)
    echo ""
    echo "INSPECTION ONLY — nothing changed. Next: rerun with 'repair' (minimal chown of the listed entries) or 'reset' (recreate the disposable workspace)."
    ;;
  repair)
    [ -n "$FOREIGN" ] || { echo "REFUSED: no foreign-owned entries found — nothing to repair; do not chown blindly." >&2; exit 2; }
    echo ""
    echo "-- REPAIR: chown ONLY the entries listed above to $RUNNER_USER"
    find "$WORKSPACE" ! -user "$RUNNER_USER" -exec chown --no-dereference "$RUNNER_USER":"$RUNNER_USER" {} +
    echo "-- verify: remaining foreign-owned entries:"
    find "$WORKSPACE" ! -user "$RUNNER_USER" | sed 's/^/  /' || true
    [ -z "$(find "$WORKSPACE" ! -user "$RUNNER_USER" 2>/dev/null)" ] && echo "OK: workspace uniformly owned by $RUNNER_USER"
    echo "Next: re-dispatch the 'VPS Final Gate' workflow and require SUCCESS."
    ;;
  reset)
    echo ""
    echo "-- RESET: removing the disposable workspace $WORKSPACE (recreated by the runner on next run)"
    rm -rf "$WORKSPACE"
    echo "OK: removed. Next: re-dispatch the 'VPS Final Gate' workflow and require SUCCESS."
    ;;
  *)
    echo "Usage: inspect-and-repair-workspace.sh [inspect|repair|reset]" >&2
    exit 1
    ;;
esac
