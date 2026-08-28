#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# Boots the backend behind the test dev-router (same-origin harness + client),
# seeds admin/viewer/editor, and runs the Playwright E2E scenario.
# Requires: php, node, Playwright + a chromium (paths via env; see below).
#   PLAYWRIGHT_PATH  path to the playwright module (default: 'playwright')
#   CHROMIUM_PATH    chromium executable (default: /opt/pw-browsers/...)
# Run:  bash tests/e2e/run-e2e.sh
# ══════════════════════════════════════════════════════════════════════
set -u
cd "$(dirname "$0")/../.."          # projects/erp-backend
ROOT="$(pwd)"
PORT="${ERP_E2E_PORT:-8792}"
WORK="$(mktemp -d)"
export ERP_DB_DRIVER=sqlite ERP_DB_PATH="$WORK/erp.db" ERP_UPLOAD_DIR="$WORK/uploads"
export ERP_COOKIE_SECURE=0 ERP_SESSION_TTL_DAYS=7
mkdir -p "$ERP_UPLOAD_DIR"

ERP_NEW_PASSWORD='adminPass123!'  php cli/create-user.php admin  admin  "Admin"  >/dev/null
ERP_NEW_PASSWORD='viewerPass123!' php cli/create-user.php viewer viewer "Viewer" >/dev/null
ERP_NEW_PASSWORD='editorPass123!' php cli/create-user.php editor editor "Editor" >/dev/null

php -S 127.0.0.1:"$PORT" "$ROOT/tests/e2e/dev-router.php" >"$WORK/server.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$WORK"' EXIT
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.2; done

BASE="http://127.0.0.1:$PORT" node "$ROOT/tests/e2e/run-e2e.js"
