#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# Mythos ERP backend — ROLLBACK to the previous safe state (§17)
# projects/erp-backend/deploy/rollback.sh [backup-set-dir]
#
# Run ON THE HOST if the new backend misbehaves. It returns the route to the
# previous safe (static-preservation) state and, if a backup set is given,
# restores the database + uploads. It NEVER deletes business data.
#
# Steps (each is safe to run independently):
#   1. Disable the new backend vhost, re-enable the static one, reload nginx.
#   2. (optional) Restore DB + uploads from a verified backup set.
#   3. The frontend cutover flag is per-browser localStorage and defaults OFF,
#      so no server action re-hides it; instruct users to clear the flag if it
#      was enabled during acceptance (documented in the runbook).
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail
SET="${1:-}"
NGX_AVAIL=/etc/nginx/sites-available
NGX_ENABLED=/etc/nginx/sites-enabled

echo "== 1. Route back to the previous safe state =="
if [ -L "$NGX_ENABLED/erp-backend.mythosprod.xyz" ] || [ -f "$NGX_ENABLED/erp-backend.mythosprod.xyz" ]; then
    sudo rm -f "$NGX_ENABLED/erp-backend.mythosprod.xyz"
    echo "  removed new backend vhost from sites-enabled"
fi
# Re-enable the static-preservation vhost if it exists but is not enabled.
if [ -f "$NGX_AVAIL/erp.mythosprod.xyz" ] && [ ! -e "$NGX_ENABLED/erp.mythosprod.xyz" ]; then
    sudo ln -sfn "$NGX_AVAIL/erp.mythosprod.xyz" "$NGX_ENABLED/erp.mythosprod.xyz"
    echo "  re-enabled the static-preservation vhost"
fi
sudo nginx -t && sudo systemctl reload nginx
echo "  nginx reloaded — route is back to the previous safe state"

echo "== 2. Optional data restore =="
if [ -n "$SET" ]; then
    [ -d "$SET" ] || { echo "  backup set not found: $SET" >&2; exit 1; }
    # restore.php verifies every checksum before touching the live DB (fail-closed).
    php "$(dirname "$0")/../cli/restore.php" "$SET"
    echo "  database + uploads restored from $SET (checksums verified)"
else
    echo "  (no backup set given — DB left as-is; business data is never deleted by rollback)"
fi

echo "== 3. Frontend flag =="
echo "  The secure-backend flag is per-browser localStorage (default OFF). If it"
echo "  was enabled during acceptance, have the operator run in the browser console:"
echo "    localStorage.removeItem('mythos_secure_backend')"

echo
echo "ROLLBACK COMPLETE — route restored to the previous safe state."
