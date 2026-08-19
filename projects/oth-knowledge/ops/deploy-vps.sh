#!/usr/bin/env bash
# =====================================================
# OTH Knowledge — VPS deployment package (operator-executable)
# Usage: deploy-vps.sh [deploy@host] [remote-base]
#
# Runs FROM THE OWNER MACHINE over the verified Windows→VPS SSH/SCP
# channel (docs/OTH_KNOWLEDGE_OPERATIONS.md §6). The AI execution
# environment cannot reach the VPS (TCP/22 unavailable) — this script
# turns deployment into a procedure instead of manual experimentation.
#
# Deploys CODE ONLY. It never creates, touches, or transfers a knowledge
# store; store provisioning and imports are separate authorized steps
# (docs/PRIVATE_STORE_ARCHITECTURE.md §10). No credentials appear here:
# authentication is the operator's existing ED25519 key.
# =====================================================
set -euo pipefail

TARGET="${1:-deploy@51.68.226.211}"
REMOTE_BASE="${2:-/home/deploy/oth-knowledge}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"   # projects/oth-knowledge

# Validate operator-supplied args: no shell metacharacters reach the
# remote command, and neither value may begin with '-' (ssh/scp would
# parse it as an option, e.g. -oProxyCommand=… → local execution).
case "$TARGET" in -*) echo "TARGET must not begin with '-'" >&2; exit 1;; esac
case "$REMOTE_BASE" in -*) echo "REMOTE_BASE must not begin with '-'" >&2; exit 1;; esac
if ! printf '%s' "$TARGET" | grep -Eq '^[A-Za-z0-9._@-]+$'; then echo "invalid TARGET: $TARGET" >&2; exit 1; fi
if ! printf '%s' "$REMOTE_BASE" | grep -Eq '^/[A-Za-z0-9._/-]+$'; then echo "invalid REMOTE_BASE: $REMOTE_BASE" >&2; exit 1; fi

echo "deploying $HERE -> $TARGET:$REMOTE_BASE (code only, no store data)"

# Refuse to deploy an uncommitted worktree (AGENTS.md §15).
if git -C "$HERE" rev-parse --git-dir >/dev/null 2>&1; then
  if [ -n "$(git -C "$HERE" status --porcelain -- .)" ]; then
    echo "worktree has uncommitted changes under projects/oth-knowledge — refused" >&2; exit 1
  fi
  COMMIT="$(git -C "$HERE" rev-parse HEAD)"
  echo "deploying commit: $COMMIT (record this in docs/AI_HANDOVER.md)"
fi

# scp -r is the verified transfer tool from Windows (rsync absent there).
ssh -- "$TARGET" "mkdir -p '$REMOTE_BASE'"
scp -r -- "$HERE/lib" "$HERE/cli" "$HERE/config" "$HERE/seeds" "$HERE/ops" "$HERE/README.md" "$TARGET:$REMOTE_BASE/"

# Smoke check on the remote: Node present, CLI loads, usage exit code 2.
ssh -- "$TARGET" "node '$REMOTE_BASE/cli/othk-cli.js' >/dev/null 2>&1; [ \$? -eq 2 ] && echo 'remote CLI ok'"

echo "done. Next (separate, authorized steps): provision the private store"
echo "and run imports per docs/OTH_KNOWLEDGE_OPERATIONS.md §5 / PRIVATE_STORE_ARCHITECTURE.md §10."
