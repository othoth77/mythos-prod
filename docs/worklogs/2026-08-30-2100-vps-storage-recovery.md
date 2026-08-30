# VPS storage recovery — understand the 72 GB, remove only proven waste

**Date:** 2026-08-30 21:00 UTC
**Host:** production VPS (`vps-4722f0a9`), 72 GB root filesystem
**Executed as:** root
**Objective:** establish the real storage state, preserve unique data, reclaim only proven waste, verify production.

---

## Result

| | Used | Free | Use% |
|---|---|---|---|
| **Before** | 71 GB | 1.3 GB | **98%** (had hit 100%) |
| **After** | 44 GB | 29 GB | **61%** |
| **Recovered** | — | **+27.6 GB** | −37 pts |

Inodes: 12% → 11% used (never a constraint).
**No production interruption.** All 20 containers and all application units healthy after cleanup.

---

## 1. Where the 72 GB actually was

Measured with `du -x` (single filesystem, pseudo-filesystems excluded).

| Path | Size | Class | Action |
|---|---|---|---|
| `/var/log/syslog` | 14 GB | STALE LOG | **reclaimed** |
| `/var/lib/containerd` | 16 GB | ACTIVE (Docker image store) | preserved |
| `/opt/n8n/backups/…-before-vacuum-…sqlite` | 6.2 GB | BACKUP, 100% empty pages | **compacted to 2 MB** |
| `/home/deploy/.vscode-server` | 3.1 GB | 4 server versions | **2 stale removed** |
| `/home/ubuntu/.config` | 3.7 GB | browser/Claude profiles + caches | **caches only removed** |
| `/home/ubuntu/.cache` | 2.0 GB | pure cache | **removed (Chrome), Playwright kept** |
| `/var/lib/docker` | 2.2 GB | ACTIVE volumes | preserved |
| `/var/log/journal` | 1.7 GB | systemd journal, uncapped | **capped → 381 MB** |
| `/var/lib/snapd` | 1.9 GB | snaps + cache | **cache only (313 MB)** |
| `/root/backups` | 258 MB | unique pre-Coolify backup | **preserved** |
| `/opt/course-intelligence` | 519 MB | source data + auth'd profiles | **preserved** |
| `/swapfile` | 2.0 GB | allocated swap | **untouched (not junk)** |

---

## 2. The 14 GB syslog — root cause verified before cleanup

The file was **not** growing steadily. Byte-offset time sampling showed **90% of the 14 GB written in a single 63-minute burst**, 18:13–19:16 UTC:

| Offset | Timestamp |
|---|---|
| 0% | 00:09:28 |
| 10% | 18:13:39 |
| 50% | 18:41:37 |
| 99% | 19:16:01 |

The writer was PID 355908 — SPY (`spy.api`), a `deploy`-scope user unit. It hit `OSError: [Errno 24] Too many open files` and then logged an asyncio `ValueError: Invalid file descriptor: -1` traceback several times per millisecond.

This is the connection leak recorded in `MYTHOS_SYSTEM_INDEX.md` §44. **Confirmed fixed before reclaiming the space**, on three independent lines of evidence:

1. **Code:** `othoth77/spy` @ `5cab760` *"fix(db): reap connections whose thread has ended (production disk-full incident)"*, with regression test `89fd8c8` *"test(db): assert connections are CLOSED, not merely deregistered"*.
2. **Runtime:** the leaking process consumed 1,024 descriptors in ~4.4 h (~4/min). The replacement process, restarted 19:58 with the fix, held **12 descriptors** — sampled repeatedly across 80 s and still 12 after 1 h. At the old rate it would have shown ~190.
3. **Growth:** post-truncate, syslog grew 52 KB in 14 min ≈ **5 MB/day** (normal). `/health` returns 200.

### Reclaim procedure (non-destructive)

Recent operational context was preserved first — the last 20,000 non-flood lines, gzipped to 137 KB at `/var/log/syslog.preserved-20260830.gz` — then `truncate -s 0` (rsyslog keeps its inode and append-mode fd), then `SIGHUP`. rsyslog verified writing immediately afterwards. **The rotated history (`syslog.1`, `.2.gz`–`.4.gz`) was not touched.**

### Why it grew unbounded — config gap closed

`/etc/logrotate.d/rsyslog` rotated **weekly with no size ceiling**, so a burst had six days of headroom. Added:

```
maxsize 500M
```

`logrotate.timer` runs daily, so a file passing the ceiling now rotates out of band. `journald` was likewise uncapped; set `SystemMaxUse=500M`, `SystemKeepFree=2G`.

> **Incidental fix:** the config backup was first written to `/etc/logrotate.d/rsyslog.bak-…`, which logrotate *includes* — it produced `duplicate log entry` errors that abort the whole run. Backup moved outside `/etc/logrotate.d/`; `logrotate -d /etc/logrotate.conf` now validates clean. Note that validating a fragment alone falsely reports `insecure permissions`, because the global `su root adm` lives in `logrotate.conf`.

---

## 3. The 6.2 GB n8n backup — kept, not deleted

`/opt/n8n/backups/n8n-before-vacuum-20260810.sqlite` was **not** removed for being large. Evidence gathered first:

- `pragma quick_check` = **ok** (valid backup, not corrupt).
- `page_count=1,514,111`, `freelist=1,513,597` → **100.0% of the file was empty pages**. It held ~2 MB of data in a 6.2 GB envelope — exactly the pre-VACUUM bloat the 2026-08-10 maintenance existed to remove.
- **Redundancy vs the live database:**

  | table | backup | live | unique to backup |
  |---|---|---|---|
  | `workflow_entity` | 3 | 10 | **0** |
  | `credentials_entity` | 1 | 2 | **0** |
  | `user` | 1 | 1 | **0** |
  | `execution_entity` | 2 | 1033 | **0** |

  Every id in the backup is also present live.
- Referenced by **no restore procedure**. Its only mentions anywhere were audit notes marking it `UNKNOWN` (`docs/audits/VPS_SERVICE_HEALTH_AUDIT_2026-08-10.md:117`, `AI_HANDOVER.md`) because earlier audits ran unprivileged against a root-only directory. **That long-standing UNKNOWN is now resolved.**

Rather than delete, the snapshot was preserved losslessly with `VACUUM INTO` → **2.06 MB**. All 112 tables and 1,709 rows were dumped from both files and hashed: SHA-256 identical (`6ea6f77c…41869`). Only then was the 6.2 GB original removed. Evidence recorded on-host in `/opt/n8n/backups/README-RETENTION.md`.

n8n container healthy throughout; live DB `quick_check` = ok.

---

## 4. Preserved — considered and deliberately kept

The objective was not to maximise deletion.

- **Docker (2.6 GB nominally reclaimable) — untouched.** The two unused images are a Coolify **rollback** image and the deployment **helper**. The 1.46 GB of "dangling" volumes are **real PostgreSQL data directories** (one with populated `base/`) plus a named Coolify **staging MySQL** volume — unverified databases, not waste. A blanket prune was also unsafe: the image tagged `<none>` (`3d0f7584ed7d`) is **actively in use** by the running `idauto-postgres` container.
- **`/root/backups` (258 MB)** — the unique pre-Coolify migration snapshot (2026-07-21). No duplicate exists.
- **Course Intelligence (519 MB)** — `output/` and `videos/` are source artifacts; the two browser profiles carry live authenticated sessions. Only ~85 MB of regenerable component cache existed; not worth the risk of breaking a logged-in automation profile.
- **Playwright browsers (656 MB)** — actively referenced by Course Intelligence scripts.
- **`/swapfile` (2 GB)** — allocated swap, explicitly not junk.
- **Claude installs** — one version each (`2.1.251`) per user; nothing obsolete to remove.

---

## 5. Swap — historical, not active pressure

`swapon` shows 2.0 GB of 2.0 GB consumed, but this is **not** current memory distress:

- `vmstat` steady state: **si/so = 0** — no thrashing.
- `vm.swappiness = 10` (low).
- 2.0 GiB available memory; 2.8 GiB in buff/cache.
- Largest resident swap: `mysqld` 410 MB, `omniroute` 239 MB — cold pages parked during the earlier disk-full/memory episode and never faulted back.

**No action taken.** Swap was not resized or recreated. Draining it would require a `swapoff/swapon` cycle needing 2 GB of free RAM, which the host does not comfortably have — the risk exceeds the benefit, and 100% swap *usage* with zero swap *traffic* is a benign steady state.

---

## 6. Post-cleanup verification

- `df -h /` → 61%, 29 GB free. `df -ih /` → 11%.
- **All 20 Docker containers running**, all health-checked ones `healthy`.
- n8n, Coolify (+db/redis/realtime/sentinel), dar-hijama (app/web/mysql/redis×3/queue/scheduler), idauto-postgres, omniroute, jellyfin, MCP containers — all up.
- `dar-hijama-production-queue-1` cycles by design (exit 0, `RestartCount=199` long predating this work, heartbeat jobs running); healthy.
- SPY: HTTP 200, 12 fds, unchanged process.
- rsyslog + systemd-journald active; syslog growth normal; journal 381 MB under its new cap.
- Journal retention still spans 2026-08-13 → 2026-08-30 after vacuuming — no meaningful history lost.
- No volumes, project files, databases or repositories missing.

### Pre-existing failures — NOT caused by this work

| Unit | Cause | Note |
|---|---|---|
| `mythos-backup-capture-db` | config declares `MYTHOS_BACKUP_STAGE_ROOT`, which the installed script does not recognise | broke **13:04**, ~7.5 h before this session; retried after freeing disk and **still fails** → not a disk problem |
| `mythos-backup-db-verify` | downstream of the above | failed 15:39 |
| `mythos-git-push` | `local main is not a fast-forward of origin/main (diverged)` + a governance DENY on a protected path | policy/branch state, unrelated to storage |

---

## 7. Open risks surfaced (not fixed here — outside this mandate)

1. **`mythos_erp` database backups are not running.** The capture step fails on a config/script key mismatch. Retried post-cleanup and still failing, so the earlier assumption that disk-full caused it is wrong. The file/media backup path still runs daily (idauto dumps present through 2026-08-30).
2. **n8n has no off-host backup.** `mythos-backup-db` covers `mythos_erp` only. The live n8n database (12 MB, 10 workflows, 2 credentials) exists solely in the Docker volume `n8n_n8n_data`. Recommend adding it to the off-host set — it is small.
3. **Unattributed Docker volumes** (~1.46 GB): several initialised PostgreSQL clusters created 2026-08-23 and a Coolify staging MySQL volume from 2026-07-29, none currently attached. Left in place pending an owner decision on whether the staging app is retired.

---

## 8. Changes made

**Files:**
- `/var/log/syslog` — truncated (recent context preserved to `/var/log/syslog.preserved-20260830.gz`)
- `/etc/logrotate.d/rsyslog` — added `maxsize 500M` (backup at `/root/config-backups-20260830/`)
- `/etc/systemd/journald.conf` — added `SystemMaxUse=500M`, `SystemKeepFree=2G`
- `/opt/n8n/backups/` — 6.2 GB original replaced by 2.06 MB verified-identical compact copy; `README-RETENTION.md` added
- Removed: 2 stale VS Code server versions, Chrome/Claude/Chromium caches and redownloadable component stores, codex `.tmp`, snap + apt caches

**Services:** `rsyslog` reloaded (SIGHUP), `systemd-journald` restarted. No application service was stopped, restarted or reconfigured.

**Security:** no credentials, tokens, `.env` contents or database contents were read, printed or transmitted. Database inspection was limited to row counts and primary keys.
