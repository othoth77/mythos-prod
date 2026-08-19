#!/usr/bin/env bash
# =====================================================
# OTH Knowledge — store backup (operator-executable)
# Usage: backup.sh <store-root> <backup-dir>
#
# Consistent copy of the whole store root + integrity hash, per
# docs/PRIVATE_STORE_ARCHITECTURE.md §6. Run with NO writer running.
# Encrypt before any transfer off-host (see encrypt step below).
# Never deletes anything; retention is a separate explicit operator act.
# =====================================================
set -euo pipefail
umask 077

STORE_ROOT="${1:?usage: backup.sh <store-root> <backup-dir>}"
BACKUP_DIR="${2:?usage: backup.sh <store-root> <backup-dir>}"

[ -d "$STORE_ROOT" ] || { echo "store root not found: $STORE_ROOT" >&2; exit 1; }
[ -f "$STORE_ROOT/records.jsonl" ] || { echo "not a store root (no records.jsonl): $STORE_ROOT" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"

# Refuse a backup destination inside the store or inside a git worktree.
case "$(cd "$BACKUP_DIR" && pwd)/" in
  "$(cd "$STORE_ROOT" && pwd)/"*) echo "backup dir must be outside the store" >&2; exit 1;;
esac
if git -C "$BACKUP_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  echo "backup dir is inside a git worktree — refused (backups never enter Git)" >&2; exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="$BACKUP_DIR/othk-backup-$STAMP.tar.gz"

# Pre-backup integrity check.
node "$(dirname "$0")/../cli/othk-cli.js" --store "$STORE_ROOT" validate >/dev/null

tar czf "$ARCHIVE" -C "$(dirname "$STORE_ROOT")" "$(basename "$STORE_ROOT")"
( cd "$BACKUP_DIR" && sha256sum "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256" )

echo "backup written: $ARCHIVE"
echo "hash:           $ARCHIVE.sha256"
echo "records:        $(wc -l < "$STORE_ROOT/records.jsonl")"
echo
echo "Before transferring off-host, encrypt (passphrase from the operator"
echo "password manager — never stored in the repository):"
echo "  openssl enc -aes-256-cbc -pbkdf2 -in '$ARCHIVE' -out '$ARCHIVE.enc'"
