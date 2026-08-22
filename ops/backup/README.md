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
| `mythos-backup.timer` | daily 03:30 (+ ≤15 min jitter) | `capture (root) → stage → manifest → verify-local → push → verify-remote` |
| `mythos-backup-verify.timer` | daily 15:00 | `verify-remote` (read-only) |
| `mythos-restore-test.timer` | monthly, 1st 05:00 | `restore-verify` into a throwaway destination — never a live path |

The pipeline units run as `User=deploy` and are root-installed/root-owned
(the `mythos-git-push` relay pattern). Deletion remains structurally
refused by the tool (`--destructive` → exit 3); retention stays
report-only per the adapter's append-only design.

### 1.1 The root-side capture step (`mythos-backup-capture.service`)

The off-host tooling backs up **file artefacts with a manifest**; it does not
produce database dumps, it carries them (`docs/OFF_HOST_BACKUP_GATE.md` §0).
The dump must be taken with `docker exec` **inside** the source container (§1:
the PostgreSQL servers differ by minor version, and the credentials stay in the
container's own environment), and docker access is root access. `deploy` is
deliberately **not** in the docker group, so the dump cannot be taken by the
scheduled pipeline itself.

`mythos-backup-capture.service` is that root side, and nothing more:

- runs `/usr/local/sbin/mythos-backup-capture` — a **root-owned 0700 copy**
  installed by `install.sh` from `ops/backup/mythos-backup-capture.sh`. Root
  never executes the deploy-writable checkout copy (the `mythos-git-push`
  relay rule);
- ordered `Before=` and pulled in by `Requires=` from `mythos-backup.service`,
  so the backup **stops** rather than staging a stale input when capture fails;
- produces exactly the two inputs the pipeline consumes and hands them over
  owned by `deploy`:
  1. `$MYTHOS_BACKUP_DB_DIR` — **exactly one** current `pg_dump -Fc` dump
     (`discoverDb()` requires exactly one file). The previous dump is retired
     to `$MYTHOS_BACKUP_DB_ARCHIVE` (root-only, `0700`), never deleted, and
     only removed from the hand-off directory once an identical archived copy
     is proven present;
  2. `$MYTHOS_BACKUP_MEDIA_DIR` — the media **backup set** in the
     IDAUTO-STORAGE-OPS format the tool consumes: `manifest.json` +
     `checksums.sha256` (`<sha256>  media/aa/bb/<sha256>`) + `media/`. This is
     **not** the live media store: the live store is not in that format and is
     never written to (it is read, and its fingerprint is taken before and
     after the copy);
- enforces the capture order the tool checks — database metadata snapshot
  (`REPEATABLE READ READ ONLY`) → `pg_dump` → media copy. Media-before-database
  is refused by `offhost-backup.js` and by this script;
- validates the dump with `pg_restore --list` before it is trusted, and records
  C1 (`SHA256SUMS-<ts>.txt`, runbook §E) in the archive;
- grants `deploy` nothing: no sudo rule, no docker group, no credential. It
  never uploads and never reads the R2 credential file.

The regenerated media input set replaces the previous one (one prior generation
is kept as `<set>.prev`). No dump, staged set or remote object is ever deleted.

### 1.2 What root will and will not accept from `deploy`

The capture step runs as root while every one of its inputs lives under an
account that is not root. Each of those inputs is therefore treated as data
from a lower-trust source, not as instruction:

- **the config is parsed, never sourced.** `. $CONFIG` would execute the file
  as root, and it sits in `deploy`'s home — that would hand `deploy` a root
  shell on the next timer fire and invert the boundary the split exists to
  hold. It is read as inert `KEY=VALUE` data: unrecognised keys, malformed
  lines and values carrying shell metacharacters are all refused, and nothing
  in the file is ever evaluated;
- **paths are allowlisted.** `MYTHOS_BACKUP_DB_DIR`, `MYTHOS_BACKUP_MEDIA_DIR`,
  `MYTHOS_BACKUP_MEDIA_SOURCE` and `MYTHOS_BACKUP_DB_ARCHIVE` must be absolute,
  free of `.`/`..`, and under `/var/backups/mythos`,
  `/home/deploy/mythos-backups` or `/home/deploy/deployments`. The config
  chooses where *inside* those roots, never whether to leave them — otherwise
  the rotation below becomes an arbitrary root-owned `rm -rf`;
- **the docker CLI is resolved, not named.** A config-supplied command name is
  a root-executed binary of the config author's choosing; the resolved path
  must be a non-symlink regular file owned by root and not group-writable;
- **staging is root-owned.** The set is built under `$ARCHIVE/.capture-staging`
  (root, `0700`, unpredictable name) and published with a single atomic
  rename. The earlier `<set>.tmp.$$` sat in a `deploy`-owned directory under a
  pid-derived name, where it could be pre-created or swapped for a symlink;
  rotation now refuses to act on any path that is a symlink;
- **the manifest is generated as JSON, not as text.** Every value is emitted
  through a JSON string/number escaper and the result is parse-checked before
  publication, so a path or hostname containing a quote cannot reshape the
  document.

`install.sh` enforces the matching half: the config and the credential file
must each be a non-symlink regular file owned `deploy:deploy` at mode `0600`,
in a directory owned by root or `deploy` that no one else can write. Mode
alone was not enough — it says how a file may be reached, never who may
replace it.

## 2. Operator installation (one time, on the VPS)

1. Ensure the deploy checkout contains this directory
   (`sudo mythos-deploy deploy os` or `git -C /home/deploy/projects/mythos-prod pull --ff-only`).
2. Create `/home/deploy/.config/mythos/backup-schedule.env` (owner
   `deploy`, mode **0600**) — content declares *what* to back up, never
   credentials:

   ```bash
   # hand-off from the root-side capture step
   MYTHOS_BACKUP_DB_DIR=/home/deploy/mythos-backups/db-dumps        # exactly one dump; consumed by stage
   MYTHOS_BACKUP_MEDIA_DIR=/home/deploy/mythos-backups/media-set    # produced media backup SET, not the live store
   # read-only sources for the capture step
   MYTHOS_BACKUP_MEDIA_SOURCE=/home/deploy/deployments/idauto-media
   MYTHOS_BACKUP_DB_CONTAINER=idauto-postgres
   MYTHOS_BACKUP_DB_ARCHIVE=/var/backups/mythos                     # root-only dump archive (0700)
   MYTHOS_BACKUP_STAGE_ROOT=/home/deploy/mythos-backups/staging
   MYTHOS_BACKUP_PREFIX=mythos/daily
   MYTHOS_BACKUP_HEALTH_FILE=/home/deploy/mythos-backups/health/backup-health.json
   ```

   `MYTHOS_BACKUP_MEDIA_DIR` must point at the **produced media backup set**,
   never at the live media store: `offhost-backup.js` reads
   `<dir>/checksums.sha256` and `<dir>/manifest.json` and resolves objects at
   `<dir>/media/…`, which the live content-addressed store does not provide.
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
