# Backup: explicit multi-database coverage

**Why this exists:** ERP Stage 5 is blocked until `mythos_erp` is provably
covered by backup and restore. Auditing the backup to answer that question
found a larger problem, so this document covers both.

**Date:** 2026-08-23. **Branch:** `feat/backup-multi-db`.

---

## 1. Audit findings (Phase 1)

### 1.1 Exactly one database is dumped, and it is selected implicitly

`ops/backup/mythos-backup-capture.sh` line 247:

```sh
"$DOCKER" exec "$CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'
```

`$POSTGRES_DB` is expanded **inside the container**, from the container's own
environment. It is `idauto`. Nothing in the repository, the config file, or the
systemd unit names the database being backed up. The dump is then *labelled*
`idauto-<TS>.dump` — a hardcoded string that happens to match today.

Selection is therefore not a decision anyone made and can review. It is a
side-effect of a container environment variable. Change `POSTGRES_DB` in the
compose file and the backup silently starts protecting something else, under
the old name.

### 1.2 Three production databases are not backed up at all

`idauto-postgres` holds five databases. One is in the backup.

| Database | Size | Content | In backup |
|---|---|---|---|
| `idauto` | 12 MB | 45 tables across `public` + `mythos_intelligence` | **yes** |
| `mythos_command_center` | 9.1 MB | `mcc_*` — 94 command tags, 35 relations, 26 categories | **no** |
| `ssangyong_autos` | 9.2 MB | `sya_*` — 346 products, 782 compatibility rows, 311 images | **no** |
| `mythos_command_center_test` | 8.7 MB | test fixtures | **no** |
| `postgres` | 7.5 MB | empty default | n/a |

No other mechanism covers them: no cron entry, no second timer, no other unit
references these names. `mythos-backup.timer` and `mythos-backup-verify.timer`
are the only backup timers on the host.

**This is a live data-loss exposure, not a hypothetical.** It predates the ERP
work and is unrelated to it. It is in this document because you cannot ask
"will `mythos_erp` be covered" without discovering that the question was never
being asked of anything else either.

### 1.3 Cluster-level roles and grants are in no backup

`pg_dump` is per-database and does not emit roles. The ERP's entire
least-privilege model — `erp_owner` owning nothing the app can change,
`erp_app` holding `INSERT, SELECT` on `audit_log` and **no** `UPDATE`/`DELETE`
— lives in cluster-level roles and grants. Restoring `mythos_erp` from a
`pg_dump` alone into a fresh cluster reproduces the tables and loses the
security model that makes the audit log trustworthy.

### 1.4 "Restore verification" verifies bytes, not restorability

`restoreVerify()` in `offhost-backup.js` downloads every object, checks size
and sha256, writes them to a throwaway directory and re-runs `verifyLocal`.
That proves **the bytes came back intact**. It never invokes `pg_restore`, so
it cannot prove the dump is loadable, and it has no concept of which databases
a set is supposed to contain.

The only restorability check anywhere is `pg_restore --list` at capture time
(line 252), which parses the archive's table of contents. Useful, and not the
same as a restore.

### 1.5 How the rest of the pipeline works (unchanged by this design)

- **Archive:** capture writes `$ARCHIVE/<db>-<TS>.dump` (root, 0700, 0600
  files), appends sha256 to `SHA256SUMS-<TS>.txt`, validates with
  `pg_restore --list`, then publishes to `$MYTHOS_BACKUP_DB_DIR` owned by
  `deploy`. Root never uploads; `deploy` is not in the docker group.
- **Staging/manifest:** `stage` builds a manifest whose `objects[0]` is the
  database dump and `objects[1]` is the media manifest, followed by media
  entries. `verifyLocal` re-hashes every object and asserts those two
  positional checksums.
- **R2 upload:** `push` PUTs each object, HEADs it back and compares size and
  sha256, uploads `manifest.json`, then writes `COMPLETE` **last**, containing
  the manifest hash — so a partial set is never advertised as restorable.
  The adapter (`adapters/s3-compatible.js`) signs SigV4 and reads its own 0600
  credential file that neither backup script ever touches.
- **Remote verify:** `verifyRemote` fetches the manifest, checks `COMPLETE`
  matches its hash, then HEADs every object.

---

## 2. Design

### 2.1 An explicit allowlist, not "dump everything"

New config key, comma-separated:

```
MYTHOS_BACKUP_DB_LIST=idauto,mythos_command_center,ssangyong_autos
```

Dumping every database found would be less code and worse. It makes the backup
set depend on whatever happens to exist on the host that night — a throwaway
database someone created for an afternoon silently enters the backup, grows
it, and must then be explained to whoever restores it. An allowlist makes
coverage a reviewable decision, and makes *removing* something from backup a
visible diff rather than a `DROP DATABASE`.

Rules:

- Each name is validated against `^[A-Za-z_][A-Za-z0-9_]*$` before it reaches
  a shell command.
- Duplicates are refused.
- **A listed database that does not exist fails the run.** This is the point:
  if `mythos_erp` is renamed, dropped, or never created, the backup must stop
  and say so, not quietly produce a set that is missing it.
- **Unset means today's behaviour**, `$POSTGRES_DB` resolved in-container, so
  an existing config keeps working byte-for-byte. With the default list the
  primary dump is still named `idauto-<TS>.dump`.

### 2.2 Cluster globals, without credential material

```sh
pg_dumpall --globals-only --no-role-passwords
```

captured once per run as `globals-<TS>.sql`. Roles, grants and memberships are
restorable; **role password hashes are not written**, so the backup gains the
security model without gaining credential material to leak. Restoring into a
fresh cluster then means: load globals, create databases, restore each dump,
and set new passwords deliberately.

### 2.3 Manifest changes are additive, and `FORMAT_VERSION` does not move

`verifyLocal` rejects any manifest whose `format_version` differs. Bumping it
would make the new tool reject **every set already in R2**, including the one
currently standing between this host and data loss. So:

- `objects[0]` stays the primary database dump.
- `objects[1]` stays the media manifest.
- Media entries keep their positions.
- Additional dumps and `globals-<TS>.sql` are **appended after** them.
- New top-level `databases: [{name, dump_filename, dump_sha256, size}]` and
  `globals: {filename, sha256}`.

An old reader sees a valid 1.0.0 set with extra objects it verifies generically
and extra fields it ignores. A new reader handles an old set by synthesising
`databases` from the singular `database` block. Both directions work, which is
what lets this be deployed without a flag day.

### 2.4 `discoverDb` must stop requiring exactly one file

```js
if (a.length !== 1) throw problem('database dump discovery failed');
```

This is the hard blocker: the hand-off directory is contractually
single-file, and the capture script asserts the same thing at line 283.
Both become "one or more", with the primary chosen by explicit rule (first
allowlist entry) rather than by `sort()` — alphabetical order must not decide
which database occupies `objects[0]`.

### 2.5 Proving a set contains what it should

Two layers, because they fail differently:

1. `--require-database <name>` on `verify-local`, `verify-remote` and
   `restore-verify`. A set that does not contain a dump for that database is
   an anomaly (exit 2). This catches "the ERP silently stopped being backed
   up" on every scheduled verify, which is when you want to hear it.
2. `ops/backup/restore-drill.sh` — restores dumps into a **throwaway
   PostgreSQL 15 container**, runs `pg_restore` for real, and asserts the
   expected relations exist. Committed as a script rather than performed by
   hand once, so it is repeatable evidence.

### 2.6 What this design deliberately does not do

- **No deletion, anywhere.** Retention stays report-only.
- **No credential handling changes.** Capture still never reads a remote
  credential; the adapter still reads its own 0600 file.
- **No application data is read or written.** `pg_dump` is a reader;
  `--globals-only` emits no table data.
- **No adapter change**, so R2 compatibility is preserved by construction —
  the adapter transfers whatever objects the manifest lists and has no opinion
  about their contents.
- **It does not create `mythos_erp`.** Coverage is a capability plus a config
  line; the config line is the operator's call at provisioning time.

---

## 3. Sequencing (the part that is easy to get backwards)

`mythos_erp` cannot be added to the production allowlist before it exists —
§2.1 makes a listed-but-absent database fail the run, which would break the
nightly backup of everything else.

So the order is:

1. This change merges; capability exists and is tested. ← **this branch**
2. Restore drill passes on a throwaway instance, including a database
   standing in for `mythos_erp`.
3. ERP provisioning creates `mythos_erp`.
4. **In the same maintenance step**, `mythos_erp` is appended to
   `MYTHOS_BACKUP_DB_LIST`, and a backup runs and is verified before any real
   data is entered.
5. `--require-database mythos_erp` is added to the scheduled verify, so the
   day it stops being covered is the day the monitor says so.

Step 4 is not optional and not "soon after". A database created in step 3 and
added in step 6 has a window in which it holds real data and no backup — which
is precisely the gap this whole gate exists to close.
