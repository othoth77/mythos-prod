#!/usr/bin/env bash
# =====================================================
# Mythos OS — self-hosted runner security verification (read-only)
# Run as root on the VPS: bash verify-runner.sh
#
# Verifies every section-3/4 requirement of the VPS Final Gate order:
# dedicated identity, no root, no docker, no sudo, governance material
# unreachable, unit hardened + enabled, restart survival.
# Prints PASS/FAIL per check and exits non-zero on any FAIL.
# Reads no secret values.
# =====================================================
set -u

RUNNER_USER=mythos-runner
UNIT_NAME=mythos-gh-runner.service
FAIL=0

check() { # check <label> <command...> — PASS when command succeeds
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "PASS  $label"; else echo "FAIL  $label"; FAIL=1; fi
}
check_not() { # check_not <label> <command...> — PASS when command FAILS
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "FAIL  $label"; FAIL=1; else echo "PASS  $label"; fi
}

echo "--- identity ---"
check     "account $RUNNER_USER exists"                    id "$RUNNER_USER"
check_not "$RUNNER_USER is not uid 0"                      test "$(id -u "$RUNNER_USER" 2>/dev/null)" = "0"
for banned in docker sudo mythos-gov root; do
  check_not "$RUNNER_USER not in group '$banned'"          sh -c "id -nG '$RUNNER_USER' | tr ' ' '\n' | grep -qx '$banned'"
done
check_not "no sudoers.d entry mentions $RUNNER_USER"       sh -c "grep -rl '$RUNNER_USER' /etc/sudoers.d/ 2>/dev/null | grep -q ."
echo "--- sudo -l -U $RUNNER_USER (must show no commands) ---"
sudo -l -U "$RUNNER_USER" 2>/dev/null | sed 's/^/      /' || echo "      (sudo -l unavailable)"
check_not "sudo -l lists no allowed commands"              sh -c "sudo -l -U '$RUNNER_USER' 2>/dev/null | grep -Eq '(ALL|NOPASSWD|/)'"

echo "--- governance boundary (as $RUNNER_USER; values never read into output) ---"
check_not "cannot read /etc/mythos/governance.key"         runuser -u "$RUNNER_USER" -- test -r /etc/mythos/governance.key
check_not "cannot list /var/lib/mythos/governance/approvals" runuser -u "$RUNNER_USER" -- ls /var/lib/mythos/governance/approvals
check_not "cannot write /etc/mythos"                       runuser -u "$RUNNER_USER" -- test -w /etc/mythos
check_not "cannot reach docker socket"                     runuser -u "$RUNNER_USER" -- test -r /var/run/docker.sock

echo "--- service ---"
check     "unit active"                                    systemctl is-active "$UNIT_NAME"
check     "unit enabled (reboot survival)"                 systemctl is-enabled "$UNIT_NAME"
check     "unit runs as $RUNNER_USER"                      sh -c "systemctl show -p User '$UNIT_NAME' | grep -qx 'User=$RUNNER_USER'"
check     "NoNewPrivileges enforced"                       sh -c "systemctl show -p NoNewPrivileges '$UNIT_NAME' | grep -qx 'NoNewPrivileges=yes'"

echo "--- restart survival ---"
systemctl restart "$UNIT_NAME" 2>/dev/null
sleep 5
check     "unit active after restart"                      systemctl is-active "$UNIT_NAME"

echo ""
if [ "$FAIL" -eq 0 ]; then echo "ALL CHECKS PASS"; else echo "FAILURES PRESENT — do not proceed to the gate"; fi
exit "$FAIL"
