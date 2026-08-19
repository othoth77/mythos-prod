#!/usr/bin/env bash
# =====================================================
# OTH Knowledge — restore + verification (operator-executable)
# Usage: restore-verify.sh <backup-archive.tar.gz> <fresh-restore-dir>
#
# Implements docs/PRIVATE_STORE_ARCHITECTURE.md §7: hash check, restore
# to a FRESH directory (never over a live store), integrity validation.
# A backup is valid only after this has succeeded (AGENTS.md §16).
# =====================================================
set -euo pipefail
umask 077

ARCHIVE="${1:?usage: restore-verify.sh <backup-archive.tar.gz> <fresh-restore-dir>}"
DEST="${2:?usage: restore-verify.sh <backup-archive.tar.gz> <fresh-restore-dir>}"

[ -f "$ARCHIVE" ] || { echo "archive not found: $ARCHIVE" >&2; exit 1; }
if [ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ]; then
  echo "restore dir must be fresh/empty (never restore over a live store): $DEST" >&2; exit 1
fi

# 1. Integrity hash of the archive itself.
if [ -f "$ARCHIVE.sha256" ]; then
  ( cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$ARCHIVE").sha256" )
else
  echo "WARNING: no .sha256 next to archive — hash verification skipped" >&2
fi

# 2. Restore to fresh directory.
mkdir -p "$DEST"
tar xzf "$ARCHIVE" -C "$DEST"

# 3. Locate the restored store root (the single extracted directory).
ROOT="$(find "$DEST" -maxdepth 2 -name records.jsonl -printf '%h\n' | head -1)"
[ -n "$ROOT" ] || { echo "restored archive contains no store (records.jsonl missing)" >&2; exit 1; }

# 4. Full integrity validation (hash-verifies every artifact object).
node "$(dirname "$0")/../cli/othk-cli.js" --store "$ROOT" validate

echo "restore verified: $ROOT"
echo "records:          $(wc -l < "$ROOT/records.jsonl")"
echo "Spot-check next:  node $(dirname "$0")/../cli/othk-cli.js --store '$ROOT' search '<known term>'"
