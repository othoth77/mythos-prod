# Mythos scheduled off-host backups (`ops/backup/`)

**Created:** 2026-08-21 (post-audit execution phase, Phase 1). Closes the
audit's P0 finding "recurring off-host backups are not scheduled"
(OWNER-GATE-B1/B2/B3), under the owner's post-audit execution order of
2026-08-21. This package **schedules the pre-existing, audited tooling** —
`projects/infrastructure/ops/offhost-backup.js` with the
`adapters/s3-compatible.js` (Cloudflare R2) adapter — it implements **no
parallel backup mechanism** (the INF-BACKUP-AUTO-0 runbook forbids one).

## 0. Prerequisite this package does NOT satisfy — the dump step

**`mythos-backup.service` cannot succeed on a freshly created
`MYTHOS_BACKUP_DB_DIR`, and this is by design, not a bug in the unit.**

The wrapped tool *carries* database dumps; it never *produces* them —
`docs/OFF_HOST_BACKUP_GATE.md` §0 states it outright, and
`projects/automation/reference/backup-operations-orchestrator.js` "never
executes a shell command". Nothing in this repository dumps a database.

`stage` begins with `discoverDb()`
(`projects/infrastructure/ops/offhost-backup.js`), which requires
**exactly one** regular file in `MYTHOS_BACKUP_DB_DIR` (ignoring
`manifest.json`). Anything else — **zero files included** — raises

```
ERROR: database dump discovery failed
```

so an empty, correctly-created, correctly-owned dump directory fails, and
so does a directory holding two days of dumps or the three databases of
`OFF_HOST_BACKUP_GATE.md` §1 (`idauto`, `coolify`, `darhijama_prod`).

The same applies to media: `MYTHOS_BACKUP_MEDIA_DIR` must already contain
a `checksums.sha256` (`<sha256>  media/<path>` lines) **and** a
`manifest.json` carrying `database.row_count` (or `media_rows`) and
`database.distinct_object_keys`, which `buildManifest()` cross-checks
against the media objects and against capture order
(database-before-media). Nothing in this repository produces that pair
either — it comes from the media capture step.

**Consequence for scheduling.** Before these timers can produce a green
run, the operator must decide *what performs the dump and the media
capture, and under whose privileges*. `OFF_HOST_BACKUP_GATE.md` §4-D runs
`pg_dump`/`mysqldump` via `docker exec` inside each source container —
but these units run `User=deploy`, and `deploy` is deliberately **not** in
the `docker` group (root-equivalent; its removal is a verified governance
invariant). A dump step therefore cannot simply be added to the
deploy-owned timer without re-granting docker to `deploy`, which
governance forbids. That decision is **OWNER-GATE-B1/B2/B3** and is
unresolved: the three gates are "blocked on credentials and orders that
exist only with the owner".

Until it is resolved, the correct state of `mythos-backup.service` is
**failing with a FAIL health record**, and the Status Center correctly
reports the backup system as **DOWN** — a missing record or a failing run
is never rendered as "unknown-green".

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
   MYTHOS_BACKUP_DB_DIR=/home/deploy/mythos-backups/db-dumps        # CONSUMED, never produced — see §0; must hold exactly one dump file
   MYTHOS_BACKUP_MEDIA_DIR=/home/deploy/deployments/idauto-media    # must already carry manifest.json + checksums.sha256 — see §0
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
5. Satisfy §0 first — without a dump file and the media manifest pair,
   this step fails at `stage` with `database dump discovery failed`.
   Then run the first backup supervised:
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
