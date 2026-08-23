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

### 1.3 Which databases are backed up (`MYTHOS_BACKUP_DB_LIST`)

A comma-separated allowlist. **This is the only place that decides what is
protected**, and it is deliberately a list you have to edit rather than
"everything on the server":

- A throwaway database created for an afternoon does not silently enter the
  backup, grow it, and have to be explained to whoever restores it.
- Removing something from backup becomes a visible diff instead of a
  `DROP DATABASE` nobody notices.

Rules the capture step enforces:

| Rule | Behaviour |
|---|---|
| Name shape | `^[A-Za-z_][A-Za-z0-9_]*$`, validated before it reaches any command |
| Permitted targets | Must appear in the root-side `ALLOWED_DATABASES` constant in the capture script. The config selects a subset; it cannot extend the set, because that file may be owned by `deploy` and `deploy` is not in the docker group |
| Duplicates | Refused |
| **Listed but absent** | **Run fails.** A missing database is how a rename, a drop, or a never-provisioned database announces itself |
| Unset | Falls back to the container's `$POSTGRES_DB` — exactly the pre-2026-08-23 behaviour |

Each database is dumped separately with in-container `pg_dump -Fc`, validated
with `pg_restore --list`, and published to the hand-off directory. The name is
passed as a positional argument, never interpolated into the shell string the
container runs.

**Cluster globals** are captured once per run as `globals-<TS>.sql` via
`pg_dumpall --globals-only --no-role-passwords`. `pg_dump` is per-database and
emits no roles, so without this a restore rebuilds the tables and loses the
grants — including the property that `erp_app` may append to `audit_log` and
may not rewrite it. `--no-role-passwords` keeps role password hashes out of a
backup that leaves the host, and the capture step *verifies* the redaction
rather than trusting the flag.

#### Proving a database is covered

```sh
# fails (exit 2) if the set does not contain mythos_erp
node projects/infrastructure/ops/offhost-backup.js verify-remote \
  --prefix mythos --adapter <adapter> --require-database mythos_erp
```

`--require-database` is repeatable and works on `verify-local`,
`verify-remote` and `restore-verify`. Put it on the scheduled verify for any
database whose disappearance should page someone.

#### Restore drill

`ops/backup/restore-drill.sh` (root) proves a set actually restores, which
`restore-verify` does not: it stands up a throwaway PostgreSQL 15 container,
runs the real capture step against it, stages and verifies the set, drops the
source databases and roles, then restores from the dumps and asserts the
schema, the row counts and the grants came back. It refuses to run against a
production container and touches no remote object.

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
   MYTHOS_BACKUP_DB_LIST=idauto,mythos_command_center,ssangyong_autos  # see §1.3
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

`tests/backup-multi-db-test.js` (85 assertions) covers explicit
multi-database coverage: that the allowlist is validated and a listed-but-
absent database fails the run; that a set contains exactly the declared
databases and nothing else; that an undeclared file in the hand-off
directory is refused rather than swept in; that corrupting any dump, the
globals, or the manifest's own claims about them fails verification; that
`--require-database` fails a set missing the named database both locally and
against a remote; that push, remote verification and restore-verify still
work; and that legacy single-database sets — including every set already in
R2 — still stage, push and verify unchanged.

The suite was mutation-tested: 22 single-line defects were injected into the
capture script and the tool one at a time (globals dumped *with* password
hashes, `--require-database` ignored, declared checksums not compared, a
listed-but-absent database tolerated, the database name interpolated into
the container shell, `FORMAT_VERSION` bumped). All 22 were caught — seven
only after the suite was strengthened, because the original assertions
matched text anywhere in the file rather than on the line that runs.
