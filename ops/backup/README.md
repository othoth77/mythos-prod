# Mythos scheduled off-host backups (`ops/backup/`)

**Created:** 2026-08-21 (post-audit execution phase, Phase 1). Closes the
audit's P0 finding "recurring off-host backups are not scheduled"
(OWNER-GATE-B1/B2/B3), under the owner's post-audit execution order of
2026-08-21. This package **schedules the pre-existing, audited tooling** —
`projects/infrastructure/ops/offhost-backup.js` with the
`adapters/s3-compatible.js` (Cloudflare R2) adapter — it implements **no
parallel backup mechanism** (the INF-BACKUP-AUTO-0 runbook forbids one).

## 1. What runs, when

| Timer | Schedule (UTC) | What it does |
|---|---|---|
| `mythos-backup.timer` | daily 03:30 (+ ≤15 min jitter) | `stage → manifest → verify-local → push → verify-remote` |
| `mythos-backup-verify.timer` | daily 15:00 | `verify-remote` (read-only) |
| `mythos-restore-test.timer` | monthly, 1st 05:00 | `restore-verify` into a throwaway destination — never a live path |

All units run as `User=deploy` and are root-installed/root-owned
(the `mythos-git-push` relay pattern). Deletion remains structurally
refused by the tool (`--destructive` → exit 3); retention stays
report-only per the adapter's append-only design.

## 2. Operator installation (one time, on the VPS)

1. Ensure the deploy checkout contains this directory
   (`sudo mythos-deploy deploy os` or `git -C /home/deploy/projects/mythos-prod pull --ff-only`).
2. Create `/home/deploy/.config/mythos/backup-schedule.env` (owner
   `deploy`, mode **0600**) — content declares *what* to back up, never
   credentials:

   ```bash
   MYTHOS_BACKUP_DB_DIR=/home/deploy/mythos-backups/db-dumps        # dump dir consumed by stage
   MYTHOS_BACKUP_MEDIA_DIR=/home/deploy/deployments/idauto-media
   MYTHOS_BACKUP_STAGE_ROOT=/home/deploy/mythos-backups/staging
   MYTHOS_BACKUP_PREFIX=mythos/daily
   MYTHOS_BACKUP_HEALTH_FILE=/home/deploy/mythos-backups/health/backup-health.json
   ```
3. Confirm the O-BACKUP-6 designated credential file exists:
   `/home/deploy/.config/mythos/idauto-offhost.env` (0600) — the
   s3-compatible adapter reads it itself.
4. `sudo bash /home/deploy/projects/mythos-prod/ops/backup/install.sh`
   (fail-closed preflight: script syntax, config presence, 0600 modes,
   `systemd-analyze verify`, then enable timers).
5. Run the first backup supervised:
   `sudo systemctl start mythos-backup.service && journalctl -u mythos-backup.service -n 40`.

Rollback: `sudo systemctl disable --now mythos-backup.timer mythos-backup-verify.timer mythos-restore-test.timer`.

## 3. Health record → Status Center

Every run writes `backup-health.json` (0600, atomic tmp+rename):
`status` (ok|fail), `mode`, `exit_code`, `started_at`/`finished_at`,
`duration_s`, `last_success_at` (carried forward across failures),
`consecutive_failures`, redacted `error` tail. The Status Center monitor
(`projects/status-center/monitor/`) reads this file through its `file`
probe and surfaces the backup system as LIVE / DEGRADED / DOWN:

- `ok` and `last_success_at` < 26 h old → **LIVE**
- `last_success_at` 26–50 h old, or last run failed but a success exists
  within 50 h → **DEGRADED**
- older than 50 h, or no record → **DOWN** (a missing record is a failure,
  never "unknown-green")

## 4. Restore test policy

A backup is valid only after restoration is tested (AGENTS.md §16). The
monthly `restore-test` run restore-verifies the newest set into
`$MYTHOS_BACKUP_STAGE_ROOT/restore-test-<timestamp>` — hash-verified
against the manifest by the tool, isolated from every live path. The
operator may prune old `restore-test-*` directories manually; the
scheduled jobs never delete anything, locally or remotely.

## 5. Evidence & tests

`tests/backup-scheduler-test.js` validates: script syntax and fail-closed
behavior (missing config → exit 1 + FAIL health record), health-record
schema and failure-counter behavior, a full dry pipeline of the wrapped
tool against fixtures with a mock adapter, unit-file contract
(`User=deploy`, oneshot, correct script path/mode per unit, timers have
`OnCalendar` + `Persistent`), and that no unit or script carries a
credential or a destructive flag.
