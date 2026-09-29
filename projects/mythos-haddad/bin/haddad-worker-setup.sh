#!/usr/bin/env bash
# =====================================================
# MYTHOS HADDAD — HAD-3: GitHub worker setup (idempotent, no root)
# projects/mythos-haddad/bin/haddad-worker-setup.sh
#
# Runs the EXISTING MYTHOS GitHub Bridge and the EXISTING executor on this
# machine as `othman`, fully isolated from the production VPS instance.
# Nothing here is a second bridge, queue, executor or workflow engine — it
# is configuration plus two systemd user units. See docs/GITHUB_WORKER.md.
#
# The isolation, and why each piece of it is load-bearing:
#   label        mythos:haddad     the VPS bridge filters on `task`; a Haddad
#                                  issue never carries it, so the VPS never
#                                  sees this work (and vice versa).
#   label prefix haddad:           NOT the default `mythos:`. The bridge's
#                                  setStatusLabel deletes every OTHER label
#                                  sharing the status prefix — with the
#                                  default, setting `mythos:in-progress`
#                                  would delete `mythos:haddad` itself, and
#                                  the next tick would read the missing
#                                  intake label as "cancelled from the Issue
#                                  side" and kill the task. Verified against
#                                  the real code before this file existed.
#   control      mythos/control-haddad  a separate branch, so the two
#                                  bridges never write the same control
#                                  tree. It stays LOCAL: syncControl treats
#                                  "branch not on origin yet" as fine, and
#                                  the GitHub-visible record is the Issue
#                                  comments, which go over the API.
#   executor home ~/mythos-ai-executor-haddad   separate store, separate
#                                  daemon.lock, separate task tree.
#   provider     openai-compat -> 127.0.0.1:8600 (local Qwen, loopback only)
#
# Rollback: see docs/GITHUB_WORKER.md, Rollback.
# =====================================================
set -euo pipefail

HADDAD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$HADDAD_DIR/../.." && pwd)"
STATE_DIR="${HADDAD_STATE_DIR:-$HOME/.local/state/mythos-haddad}"
CONFIG_DIR="$HOME/.config/mythos-haddad"
EXEC_HOME="${HADDAD_EXECUTOR_HOME:-$HOME/mythos-ai-executor-haddad}"
CONTROL_DIR="$STATE_DIR/control"
CONTROL_BRANCH="mythos/control-haddad"
UNIT_DIR="$HOME/.config/systemd/user"
say() { printf '[haddad-worker-setup] %s\n' "$*"; }

for c in git node systemctl; do command -v "$c" >/dev/null || { say "MISSING: $c"; exit 1; }; done

say "1/6 directories"
mkdir -p "$EXEC_HOME" "$STATE_DIR" "$CONFIG_DIR"
chmod 700 "$EXEC_HOME" "$CONFIG_DIR"

say "2/6 GitHub token (Issues: read+write)"
TOKEN_FILE="$CONFIG_DIR/github-issues.env"
if [ ! -s "$TOKEN_FILE" ]; then
  cat >&2 <<NOTE

  No token at $TOKEN_FILE.

  The bridge needs a GitHub token with Issues read+write on this repository.
  It is NEVER committed and never printed. Create it yourself, one of:

    # a fine-grained PAT (recommended: least privilege)
    umask 077; printf 'MYTHOS_GITHUB_ISSUES_TOKEN=%s\n' '<your PAT>' > $TOKEN_FILE

    # or reuse the gh CLI login already on this machine (broader scope)
    umask 077; printf 'MYTHOS_GITHUB_ISSUES_TOKEN=%s\n' "\$(gh auth token)" > $TOKEN_FILE

  Then re-run this script.

NOTE
  exit 1
fi
chmod 600 "$TOKEN_FILE"
say "  token file present (contents never read or logged here)"

say "3/6 local model credential for the executor's openai-compat provider"
ADVISORY_ENV="$CONFIG_DIR/advisory.env"
if [ ! -s "$ADVISORY_ENV" ]; then
  [ -s "$CONFIG_DIR/runtime.key" ] || { say "MISSING $CONFIG_DIR/runtime.key — run bin/haddad-runtime-setup.sh first"; exit 1; }
  ( umask 077; printf 'MYTHOS_ADVISORY_API_KEY=%s\n' "$(cat "$CONFIG_DIR/runtime.key")" > "$ADVISORY_ENV" )
fi
chmod 600 "$ADVISORY_ENV"

say "4/6 control worktree on $CONTROL_BRANCH (local branch; never pushed)"
if [ ! -d "$CONTROL_DIR/.git" ] && [ ! -f "$CONTROL_DIR/.git" ]; then
  if ! git -C "$REPO" rev-parse --verify --quiet "$CONTROL_BRANCH" >/dev/null; then
    git -C "$REPO" branch "$CONTROL_BRANCH" "$(git -C "$REPO" rev-parse HEAD)"
  fi
  git -C "$REPO" worktree add "$CONTROL_DIR" "$CONTROL_BRANCH" >/dev/null
fi
mkdir -p "$CONTROL_DIR/control/tasks" "$CONTROL_DIR/control/reports"
say "  control worktree: $CONTROL_DIR"

say "5/6 environment file"
ENV_FILE="$CONFIG_DIR/worker.env"
MODEL_ID=$(cat "$STATE_DIR/model-id.txt" 2>/dev/null || echo qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf)
DIAGNOSER_DENY=Bash,Edit,Write,NotebookEdit,Read,Glob,Grep,WebFetch,WebSearch,Agent
# This file IS the production configuration: a re-run must reproduce the
# running worker, never downgrade it. Keep the previous file beside it so an
# operator can diff what changed.
[ -f "$ENV_FILE" ] && cp -p "$ENV_FILE" "$ENV_FILE.prev"
cat > "$ENV_FILE" <<ENV
# Generated by haddad-worker-setup.sh. Isolation config for the Haddad
# bridge + executor. Contains NO secrets — tokens live in their own 0600
# files, bound separately by the units.
MYTHOS_BRIDGE_USER=$(id -un)
MYTHOS_BRIDGE_PROJECT=mythos-haddad
MYTHOS_BRIDGE_REPO=$REPO
MYTHOS_BRIDGE_CONTROL_DIR=$CONTROL_DIR
MYTHOS_BRIDGE_BRANCH=$CONTROL_BRANCH
# HAD-4: routed to the local tool runner (execution provider, separate allow-list).
# The advisory variable (MYTHOS_BRIDGE_WORKER_PROVIDER, the V0 openai-compat
# worker) must stay unset — the bridge refuses both at once (BRIDGE_PROVIDER_CONFLICT).
MYTHOS_BRIDGE_EXEC_PROVIDER=haddad-agent
MYTHOS_BRIDGE_ALLOW_UNVERIFIED_RUNTIME=0
MYTHOS_EXECUTOR_HOME=$EXEC_HOME
MYTHOS_ISSUES_ENABLED=1
MYTHOS_ISSUES_LABEL=mythos:haddad
MYTHOS_ISSUES_LABEL_PREFIX=haddad:
MYTHOS_ISSUES_REPO=othoth77/mythos-prod
MYTHOS_ISSUES_MAX_PER_TICK=5
MYTHOS_ADVISORY_BASE_URL=http://127.0.0.1:8600/v1
MYTHOS_ADVISORY_KEY_FILE=$ADVISORY_ENV
MYTHOS_ADVISORY_MODEL=$MODEL_ID
MYTHOS_MAX_PARALLEL=1
MYTHOS_EXECUTOR_INTERVAL_MS=20000
MYTHOS_CORE_ENABLED=false
# Stage: multi-project isolation. Bridge-side review gate (VPS default stays off).
MYTHOS_BRIDGE_REVIEW_GATE=1
HADDAD_AGENT_MODEL=$MODEL_ID
# Diagnosis-only escalation on the last repair round (no tools, writes nothing): Sonnet via the Claude CLI.
HADDAD_AGENT_DIAGNOSER=claude -p --model claude-sonnet-5 --max-turns 1 --disallowedTools $DIAGNOSER_DENY
# V3.1 deep-tier escalation (Opus): asked at most once per task — on the last standard round of a deep-scored task, or in ONE extra round after a failed Sonnet diagnosis (providers/haddad-agent.js escalationTier / MAX_DEEP_ROUNDS). Diagnosis only, no tools.
HADDAD_AGENT_DIAGNOSER_DEEP=claude -p --model claude-opus-5 --max-turns 1 --disallowedTools $DIAGNOSER_DENY
# Loopback only. The executor's default bind list also names 172.18.0.1 (the VPS
# Docker bridge, where n8n reaches it); Haddad has no Docker and no n8n, so that
# bind fails with EADDRNOTAVAIL on every start (harmless by design, noisy in the
# journal, and one address more than this node should ever offer).
MYTHOS_EXECUTOR_BIND=127.0.0.1
ENV
chmod 600 "$ENV_FILE"
say "  $ENV_FILE"

say "6/6 systemd user units"
mkdir -p "$UNIT_DIR"
for u in mythos-haddad-worker.service mythos-haddad-bridge.service mythos-haddad-bridge.timer; do
  sed -e "s|@REPO@|$REPO|g" -e "s|@HADDAD_DIR@|$HADDAD_DIR|g" "$HADDAD_DIR/systemd/$u" > "$UNIT_DIR/$u"
done
systemctl --user daemon-reload
systemctl --user enable --now mythos-haddad-worker.service >/dev/null
systemctl --user enable --now mythos-haddad-bridge.timer >/dev/null
say "  worker: $(systemctl --user is-active mythos-haddad-worker.service) | bridge timer: $(systemctl --user is-active mythos-haddad-bridge.timer)"

cat <<NOTE

[haddad-worker-setup] done.
Send a task:  open a GitHub Issue labelled  mythos:haddad  (see docs/GITHUB_WORKER.md)
Watch:        journalctl --user -u mythos-haddad-bridge -n 40
              journalctl --user -u mythos-haddad-worker -n 40
Status:       systemctl --user list-timers mythos-haddad-bridge.timer
Rollback:     systemctl --user disable --now mythos-haddad-bridge.timer mythos-haddad-worker.service
NOTE
