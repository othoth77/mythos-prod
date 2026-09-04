#!/usr/bin/env bash
# run.sh <baseline|patched|newqr|prhead> <mock|live>  — throwaway container, same image as production
set -euo pipefail
S=$(cd "$(dirname "$0")/.." && pwd)   # expects ../baileys-lib-orig, ../baileys-lib-patched, ../baileys-lib-newqr, ../prhead/baileys-pr
V=${1:-baseline}; M=${2:-mock}
LIB=$S/baileys-lib-orig; [ "$V" = patched ] && LIB=$S/baileys-lib-patched; [ "$V" = newqr ] && LIB=$S/baileys-lib-newqr
EXTRA=()
if [ "$V" = prhead ]; then EXTRA=(-v "$S/prhead/baileys-pr":/evolution/h/baileys-pr:ro -e BAILEYS_PATH=/evolution/h/baileys-pr); fi
exec docker run --rm --name "wa-harness-$V-$M" --memory 256m --memory-swap 256m --pids-limit 64 \
  --read-only --tmpfs /tmp -e WA_VERSION="${WA_VERSION:-}" -e QR_TIMEOUT="${QR_TIMEOUT:-}" -e QR_TTY="${QR_TTY:-}" -e MAX_ATTEMPTS="${MAX_ATTEMPTS:-}" \
  -v "$S/harness":/evolution/h -v "$LIB":/evolution/node_modules/baileys/lib:ro "${EXTRA[@]}" \
  -w /evolution --entrypoint node evoapicloud/evolution-api:v2.3.7 /evolution/h/harness.mjs --variant "$V" --mode "$M"
