# SPY backup — implementation package (PROPOSED, not installed)

Status 2026-09-02: **designed and dry-run by hand; systemd units NOT installed** (root action). A first
manual copy exists at `/home/deploy/mythos-backups/spy-db/spy-20260902T073512Z.db` (40,062,976 bytes,
sha256 `2dabecb7…`, `integrity_check = ok`, 45,274 observations / 72 events) plus
`spy-snapshots-20260902T073512Z.tar.gz`. Nothing in SPY was modified.

## 1. What is backed up
| Item | Source | Method |
|---|---|---|
| `spy.db` (SQLite, WAL) | `/home/deploy/deployments/spy/var/spy.db` | SQLite online backup API from a `mode=ro` connection — consistent, WAL-safe, no writer lock |
| page snapshots | `/home/deploy/deployments/spy/var/snapshots/` | `tar.gz` |
| verification | copy | `PRAGMA integrity_check` on the copy (a failing copy is deleted, run fails) + SHA-256 sidecar + JSON manifest with row counts |

## 2. Destination, permissions, retention
- `/home/deploy/mythos-backups/spy-db/` — `deploy:deploy 0700`, files `0600`.
- 14 daily copies; Sunday copies hard-linked into `weekly/` and kept 8 weeks. Retention only ever deletes inside this directory.
- Health record: `/home/deploy/mythos-backups/health/backup-health-spy.json` (same shape as the existing backup health files, so the status-center backup probe pattern can be reused).
- Targets: RPO ≤ 24 h (daily timer 03:10 UTC), RTO < 30 min (single file restore, §5).

## 3. Install (root, owner action)
```
install -m 0755 -o deploy -g deploy /home/deploy/projects/mythos-prod/ops/spy-backup/mythos-spy-backup.sh /home/deploy/projects/mythos-prod/ops/spy-backup/mythos-spy-backup.sh
install -m 0644 /home/deploy/projects/mythos-prod/ops/spy-backup/mythos-spy-backup.service /etc/systemd/system/
install -m 0644 /home/deploy/projects/mythos-prod/ops/spy-backup/mythos-spy-backup.timer   /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now mythos-spy-backup.timer
systemctl start mythos-spy-backup.service && cat /home/deploy/mythos-backups/health/backup-health-spy.json
```
Dry run without installing (as deploy): `bash ops/spy-backup/mythos-spy-backup.sh`.

## 4. Off-host
The existing off-host pipeline (`ops/backup/mythos-backup-run.sh` → `projects/infrastructure/ops/offhost-backup.js`,
S3-compatible bucket configured in `~deploy/.config/mythos/idauto-offhost.env`) stages exactly one DB dump + the
media set per run and is not a generic file pusher. Two options, owner decision:
- **A (recommended, reuse):** extend `feat/backup-multi-db`'s explicit allowlist design with a "extra files" stage
  entry so `spy-db/` latest copy is added to the nightly staged set — one pipeline, one verify-remote, one restore drill.
- **B (minimal):** a second `mythos-backup-run-spy.sh` invoking `offhost-backup.js push --prefix spy/daily` on the
  latest copy. Adds a second prefix but no new credentials.
Until either exists, the copy is on-host only (same disk as the source) — this is durability against corruption
and accidental deletion, not against loss of the VPS.

## 5. Restore procedure (RTO < 30 min)
```
# as deploy
XDG_RUNTIME_DIR=/run/user/1001 systemctl --user stop spy-monitor.service spy.service
cd /home/deploy/mythos-backups/spy-db && sha256sum -c spy-<TS>.db.sha256
cp /home/deploy/deployments/spy/var/spy.db /home/deploy/deployments/spy/var/spy.db.pre-restore-$(date -u +%s)   # keep the broken one
rm -f /home/deploy/deployments/spy/var/spy.db-wal /home/deploy/deployments/spy/var/spy.db-shm
install -m 0600 spy-<TS>.db /home/deploy/deployments/spy/var/spy.db
tar -C /home/deploy/deployments/spy/var -xzf spy-snapshots-<TS>.tar.gz     # optional
XDG_RUNTIME_DIR=/run/user/1001 systemctl --user start spy.service spy-monitor.service
curl -s https://spy.mythosprod.xyz/api/health
```
Restore drill: run the above against a scratch copy (`SPY_DB_PATH=/tmp/x.db python -m spy` is not needed — opening
the copy read-only and counting rows is the drill) at least once before relying on it.
