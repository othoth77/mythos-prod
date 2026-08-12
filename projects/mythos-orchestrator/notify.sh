#!/usr/bin/env bash
# =====================================================
# Mythos Orchestrator — notification abstraction
# projects/mythos-orchestrator/notify.sh
#
# Usage: notify.sh <event> <stage> [detail]
#   event: task_started | task_completed | task_failed |
#          approval_required | orchestrator_error
#
# Design rules (all load-bearing):
#   * Notification is best-effort telemetry, never control flow. This
#     script ALWAYS exits 0, even when the network, the config or the
#     notification service is entirely unavailable — an ntfy outage must
#     never change a task's status or block Claude/Codex.
#   * The destination URL is a capability secret: possessing the topic is
#     enough to publish to it. It therefore lives in user-local config,
#     never in Git, and is never printed — not in output, not in logs,
#     not in errors.
#   * Short timeouts, one retry. The orchestrator must not wait on it.
#
# Configuration resolution order:
#   1. $MYTHOS_NTFY_URL
#   2. $MYTHOS_NOTIFY_CONFIG            (default ~/.config/mythos-orchestrator/notify.env)
# The config file must be mode 600 and define MYTHOS_NTFY_URL=...
# When nothing is configured the script logs "unconfigured" and exits 0.
# =====================================================
set -u

readonly EVENT="${1:-orchestrator_error}"
readonly STAGE="${2:-unknown}"
readonly DETAIL="${3:-}"

readonly STATE_DIR="${MYTHOS_ORCHESTRATOR_HOME:-/home/deploy/mythos-orchestrator}/logs"
readonly LOG_FILE="${STATE_DIR}/notify.log"

mkdir -p "$STATE_DIR" 2>/dev/null || true

log_line() {
  # Records only the event and outcome — never the URL or the payload body.
  printf '%s event=%s stage=%s outcome=%s\n' \
    "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$EVENT" "$STAGE" "$1" >>"$LOG_FILE" 2>/dev/null || true
}

CONFIG_FILE="${MYTHOS_NOTIFY_CONFIG:-${HOME}/.config/mythos-orchestrator/notify.env}"
if [[ -z "${MYTHOS_NTFY_URL:-}" && -r "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE" 2>/dev/null || true
fi

if [[ -z "${MYTHOS_NTFY_URL:-}" ]]; then
  log_line 'unconfigured'
  exit 0
fi

case "$EVENT" in
  task_started)       title='Mythos task started';    tags='rocket';            priority='2' ;;
  task_completed)     title='Mythos task complete';   tags='white_check_mark';  priority='3' ;;
  task_failed)        title='Mythos task failed';     tags='x,warning';         priority='5' ;;
  approval_required)  title='Mythos needs approval';  tags='warning,bell';      priority='5' ;;
  orchestrator_error) title='Mythos orchestrator error'; tags='rotating_light'; priority='5' ;;
  *)                  title='Mythos orchestrator';    tags='computer';          priority='3' ;;
esac

# Collapse whitespace and cap length so a runaway log line can never be
# posted wholesale.
detail_clean=$(printf '%s' "$DETAIL" | tr '\r\n\t' '   ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//' | cut -c1-240)

case "$EVENT" in
  task_completed)    message="Mythos Codex task complete: ${STAGE}" ;;
  approval_required) message="Mythos needs approval: ${STAGE}" ;;
  task_failed)       message="Mythos Codex task failed: ${STAGE}" ;;
  task_started)      message="Mythos Codex task started: ${STAGE}" ;;
  *)                 message="Mythos orchestrator error: ${STAGE}" ;;
esac
[[ -n "$detail_clean" ]] && message="${message}"$'\n'"${detail_clean}"

# --fail keeps a 4xx/5xx from being reported as success; every failure mode
# is swallowed into a warning-only log entry.
if curl --fail --silent --show-error \
      --connect-timeout 3 --max-time 7 --retry 1 --retry-delay 0 \
      -H "Title: ${title}" -H "Priority: ${priority}" -H "Tags: ${tags}" \
      --data-binary "$message" "$MYTHOS_NTFY_URL" >/dev/null 2>&1; then
  log_line 'sent'
else
  log_line 'send-failed-nonfatal'
fi

exit 0
