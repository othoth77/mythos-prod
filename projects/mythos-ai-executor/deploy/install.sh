#!/usr/bin/env bash
# =====================================================
# Mythos AI Executor — idempotent installer
# projects/mythos-ai-executor/deploy/install.sh
#
# Run as the service user (ubuntu). Steps, each skipped when already done:
#   1. Provision the bearer token env file (0600, outside Git; NEVER printed)
#   2. Create the persistent runtime home
#   3. Install + enable the systemd user service (with linger)
#   4. Open the scoped firewall path from the n8n Docker subnet to :8130
#   5. Import the n8n credential + MYTHOS workflows, restart n8n
#   6. Verify: executor health, n8n health, authenticated webhook round-trip
#
# Rollback notes are printed at each mutating step. No secret value is ever
# echoed. Requires: node, sudo (for ufw + docker + linger only).
# =====================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
EXEC_DIR="$REPO_DIR/projects/mythos-ai-executor"
CFG_DIR="$HOME/.config/mythos-ai-executor"
ENV_FILE="$CFG_DIR/executor.env"
UNIT_DST="$HOME/.config/systemd/user/mythos-ai-executor.service"
N8N_CONTAINER="${N8N_CONTAINER:-n8n-n8n-1}"
N8N_SUBNET="${N8N_SUBNET:-172.18.0.0/16}"
EXECUTOR_PORT="${EXECUTOR_PORT:-8130}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

log() { printf '[install] %s\n' "$*"; }

# --- 1. Token ---------------------------------------------------------------
mkdir -p "$CFG_DIR" && chmod 700 "$CFG_DIR"
if [ ! -f "$ENV_FILE" ] || ! grep -q '^MYTHOS_EXECUTOR_TOKEN=' "$ENV_FILE"; then
  log "generating executor bearer token (value not shown)"
  umask 077
  printf 'MYTHOS_EXECUTOR_TOKEN=%s\n' "$(head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 48)" > "$ENV_FILE"
else
  log "token already provisioned — keeping it"
fi
chmod 600 "$ENV_FILE"

# --- 2. Runtime home ----------------------------------------------------------
mkdir -p "$HOME/mythos-ai-executor/tasks" "$HOME/mythos-ai-executor/logs"
chmod 700 "$HOME/mythos-ai-executor"
log "runtime home ready: $HOME/mythos-ai-executor"

# --- 3. systemd user service ---------------------------------------------------
mkdir -p "$(dirname "$UNIT_DST")"
# %h/../deploy/... in the template resolves awkwardly across homes; write the
# absolute repo path for THIS host instead.
sed "s|%h/../deploy/projects/mythos-prod|$REPO_DIR|" "$EXEC_DIR/service/mythos-ai-executor.service" > "$UNIT_DST"
if ! loginctl show-user "$(whoami)" | grep -q 'Linger=yes'; then
  log "enabling linger for $(whoami) (rollback: sudo loginctl disable-linger $(whoami))"
  sudo loginctl enable-linger "$(whoami)"
fi
systemctl --user daemon-reload
systemctl --user enable mythos-ai-executor.service >/dev/null 2>&1 || true
systemctl --user restart mythos-ai-executor.service
log "service restarted (rollback: systemctl --user disable --now mythos-ai-executor)"

# --- 4. Firewall path from n8n subnet ------------------------------------------
if ! sudo ufw status | grep -q "$EXECUTOR_PORT.*$N8N_SUBNET\|$N8N_SUBNET.*$EXECUTOR_PORT"; then
  log "allowing $N8N_SUBNET -> :$EXECUTOR_PORT (rollback: sudo ufw delete allow from $N8N_SUBNET to any port $EXECUTOR_PORT proto tcp)"
  sudo ufw allow from "$N8N_SUBNET" to any port "$EXECUTOR_PORT" proto tcp >/dev/null
else
  log "firewall rule already present"
fi

# --- 5. n8n credential + workflows -----------------------------------------------
TOKEN="$(grep '^MYTHOS_EXECUTOR_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT
cat > "$STAGE_DIR/credential.json" <<EOF
[{
  "id": "MythosExecTok001",
  "name": "MYTHOS Executor Token",
  "type": "httpHeaderAuth",
  "data": { "name": "Authorization", "value": "Bearer $TOKEN" }
}]
EOF
chmod 600 "$STAGE_DIR/credential.json"
cp "$EXEC_DIR"/n8n/*.json "$STAGE_DIR/"

sudo docker cp "$STAGE_DIR/credential.json" "$N8N_CONTAINER:/tmp/mythos-credential.json"
sudo docker exec "$N8N_CONTAINER" n8n import:credentials --input=/tmp/mythos-credential.json
sudo docker exec "$N8N_CONTAINER" rm -f /tmp/mythos-credential.json
for wf in mythos-failure-handler mythos-task-intake mythos-execute-task mythos-quota-watch mythos-report; do
  sudo docker cp "$STAGE_DIR/$wf.json" "$N8N_CONTAINER:/tmp/$wf.json"
  sudo docker exec "$N8N_CONTAINER" n8n import:workflow --input="/tmp/$wf.json"
  sudo docker exec "$N8N_CONTAINER" rm -f "/tmp/$wf.json"
done
rm -f "$STAGE_DIR/credential.json"
log "restarting n8n to register webhooks (rollback: workflows are additive; deactivate them in the n8n UI)"
sudo docker restart "$N8N_CONTAINER" >/dev/null

# --- 6. Verification ---------------------------------------------------------------
sleep 3
log "executor health:"
curl -sf "http://127.0.0.1:$EXECUTOR_PORT/health" | head -c 400; echo
for i in $(seq 1 30); do
  curl -sf -o /dev/null "http://127.0.0.1:5678/healthz" && break
  sleep 2
done
log "n8n health: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5678/healthz)"
WEBHOOK_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:5678/webhook/mythos/task" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"bad":"payload"}')
log "webhook auth+validation probe (expect 400): $WEBHOOK_CODE"
UNAUTH_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:5678/webhook/mythos/task" \
  -H 'Content-Type: application/json' -d '{}')
log "webhook unauthenticated probe (expect 403): $UNAUTH_CODE"
log "done"
