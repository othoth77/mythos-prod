#!/usr/bin/env bash
# run.sh <baseline|patched> <mock|live>  — throwaway container, same image as production
set -euo pipefail
S=$(cd "$(dirname "$0")/.." && pwd)
V=${1:-baseline}; M=${2:-mock}
LIB=$S/baileys-lib-orig; [ "$V" = patched ] && LIB=$S/baileys-lib-patched
exec docker run --rm --name "wa-harness-$V-$M" --memory 256m --memory-swap 256m --pids-limit 64 \
  --read-only --tmpfs /tmp -e WA_VERSION="${WA_VERSION:-}" \
  -v "$S/harness":/evolution/h -v "$LIB":/evolution/node_modules/baileys/lib:ro \
  -w /evolution --entrypoint node evoapicloud/evolution-api:v2.3.7 /evolution/h/harness.mjs --variant "$V" --mode "$M"
