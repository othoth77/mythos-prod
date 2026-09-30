#!/bin/bash
# erp-api boot-order guard — added 2026-09-18 after the OOM reboot incident.
#
# WHY. This is a *user* unit under the `deploy` user manager, and PostgreSQL is
# the `idauto-postgres` Docker container owned by the system manager. A user
# unit cannot order itself After= a system unit, so there is no systemd
# dependency that can express "start after Postgres". On 2026-09-18 the host
# rebooted at 15:28:38; erp-api started 14 s later, at 15:28:52, before the
# container was listening, hit server.js's fail-fast guard
#   [erp-api] REFUSED: database not reachable at start: ECONNREFUSED 127.0.0.1:5432
# and exited 2. The unit carried RestartPreventExitStatus=2 3, so it was never
# retried and ERP served 502 for 68 minutes until restarted by hand.
#
# WHAT. Block until the database accepts TCP connections, then let ExecStart
# run. Host and port are read from ERP_DATABASE_URL (the same EnvironmentFile
# the service uses) so this never drifts from the real connection target.
#
# Exit 0 = ready. Exit 1 = still not ready after the timeout, which is a
# *transient* failure: Restart=on-failure retries the whole unit, and 1 is
# deliberately not in RestartPreventExitStatus.
set -uo pipefail

TIMEOUT_SECS="${ERP_DB_WAIT_TIMEOUT:-120}"
INTERVAL=2

if [[ -z "${ERP_DATABASE_URL:-}" ]]; then
    echo "[erp-api] wait-for-db: ERP_DATABASE_URL is unset; cannot probe" >&2
    exit 1
fi

# postgres://user:pass@host:port/db  ->  host:port   (strip scheme+credentials,
# then everything from the first / or ? onward)
hostport="$(printf '%s' "$ERP_DATABASE_URL" | sed -E 's#^[^:]+://##; s#^[^@]*@##; s#[/?].*$##')"
host="${hostport%%:*}"
port="${hostport##*:}"
[[ "$port" == "$host" || -z "$port" ]] && port=5432

if [[ -z "$host" ]]; then
    echo "[erp-api] wait-for-db: could not parse a host out of ERP_DATABASE_URL" >&2
    exit 1
fi

deadline=$(( SECONDS + TIMEOUT_SECS ))
attempt=0
while (( SECONDS < deadline )); do
    if (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null; then
        exec 3>&- 2>/dev/null || true
        if (( attempt > 0 )); then
            echo "[erp-api] wait-for-db: ${host}:${port} ready after ${SECONDS}s (${attempt} retries)"
        fi
        exit 0
    fi
    attempt=$(( attempt + 1 ))
    sleep "$INTERVAL"
done

echo "[erp-api] wait-for-db: ${host}:${port} not accepting connections after ${TIMEOUT_SECS}s" >&2
exit 1
