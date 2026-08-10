# VPS Service Health Audit — 2026-08-10

**Type**: Read-only audit, post-OOM-incident verification
**Scope**: Host health, Docker, networking, service inventory, Dar Hijama duplicate-stack investigation, n8n remediation verification
**Repository baseline**: `mythos-prod` @ `6e58ad40ce41be208d6e611f498f3e035df16126` (local HEAD == origin/main, working tree clean)
**No production mutations were performed during this audit.**

---

## Executive Summary

**Classification: HEALTHY_WITH_WARNINGS**

The OOM incident appears fully resolved. No OOM kernel messages this boot, swap is essentially unused (60KiB/2GiB), 4.7GiB RAM available, all 23 containers report healthy, and every n8n remediation setting from the incident response is confirmed live and correct (3GB Docker mem cap, 2GB Node heap, concurrency limit 2, execution pruning, SQLite vacuum-on-startup, workflow autodeactivation, persistent 2GB swap). n8n itself is using only 310MB/3GB and has 0 published/active workflows — the SSANGYONG scraper and its Auto Restart workflow are confirmed inactive.

The residual risk is structural, not active: **22 of 23 containers have no memory cap** (only n8n does). Two full MySQL instances currently run uncapped at ~430-440MB each. A duplicate Dar Hijama deployment (Coolify-managed, `gi0p3...` stack) is running fully live but receiving zero traffic — nginx routes `darhijama.tn` exclusively to the other, manually-deployed stack. This duplicate stack is not provably safe to remove by container inspection alone; it needs a decision inside Coolify's own UI. A host-native (non-Docker) PHP/Laravel/Horizon/MariaDB deployment was also discovered consuming real RAM outside Docker's accounting — it was not part of the known service list and wasn't investigated in depth.

No unexpected public port exposure was found. All four live production domains (uthinachess.tn, n8n.ssangyong.autos, darhijama.tn, Coolify panel) respond 200/302 with valid TLS certs.

**Verification note**: initial data collection (§1–13) was performed via a delegated subagent, which project policy does not permit without explicit authorization. All load-bearing findings were subsequently re-verified directly and independently (§14) — all passed, with one correction (the queue-container restart pattern, previously an open inference, is now a confirmed benign root cause: hourly self-recycling via `--max-time=3600`, unrelated to the incident or to either audit pass).

---

## 1. Repository Safety

- **FACT**: Branch `main`. Local HEAD = `6e58ad40ce41be208d6e611f498f3e035df16126`. `origin/main` HEAD = same. Working tree clean, nothing to commit before this audit began.
- **FACT**: `docs/AI_HANDOVER.md` was read (tail). It references a prior session's "3 commits ahead, never push without approval" note — that state does not apply now; the tree was already clean and in sync with origin before this audit started.
- No Mythos implementation stage was started or advanced.

## 2. Host Health

- **FACT**: Uptime ~4h42m at audit start (boot ≈ 2026-08-09 19:48 UTC). Load average 1.19 / 1.05 / 0.90 on 4 vCPUs (~25-30% average utilization).
- **FACT**: `free -h` — 7.6Gi total, 2.8Gi used, 1.7Gi free, 3.6Gi buff/cache, **4.7Gi available**.
- **FACT**: Swap — 2.0Gi total, **60KiB used** (idle).
- **FACT**: Disk — `/` 34G/72G used (48%). Inodes at 9% on `/`. Both healthy.
- **FACT**: 339 processes. Kernel OOM messages this boot: **zero** (checked `dmesg` and `journalctl -k -b`). Failed systemd units: **0** (`systemctl --failed`).
- **INFERENCE**: The memory pressure that caused the prior OOM incident has fully cleared and is not recurring at this snapshot.

## 3. Docker Global Health

- **FACT**: Docker 29.6.1, Compose v5.3.1 (host); Coolify's bundled compose reports v2.38.2 for its own containers.
- **FACT**: `docker system df` — 15 images (11.16GB, 1.18GB reclaimable), **23 containers, all `Up`/healthy**, 16 volumes (647.5MB total), 0 build cache.
- **FACT**: Two containers show elevated `RestartCount` (`dar-hijama-production-queue-1` and `queue-gi0p3mbss6geqhunih23fy6f-121359620192`), both restarting in lockstep, both always `ExitCode 0` / `OOMKilled: false`, no error strings in logs.
- **FACT (confirmed by direct re-verification, see §14 below)**: Root cause identified — both containers run `php artisan queue:work redis --queue=notifications,default --sleep=2 --tries=3 --timeout=90 --memory=256 --max-time=3600`. The `--max-time=3600` flag makes the worker process exit cleanly every hour by design (a standard Laravel pattern to avoid long-lived-process memory creep); the containers' `unless-stopped` restart policy then restarts them automatically. This is **benign, expected, self-recycling behavior — not a crash loop and not related to the OOM incident.** (Original inference below, superseded by this confirmed root cause.)
- ~~INFERENCE: This restart pattern... looks like a deliberate action during the incident-remediation work itself rather than an active crash loop.~~ **Superseded** — the actual mechanism is the `--max-time=3600` worker-recycling flag, unrelated to any remediation activity or incident.
- **FACT**: No containers found with unusually high PID counts (range 1–35 across all containers; MySQL containers highest at 35).

## 4. Service / Project Ownership Inventory

| Group | Compose/Coolify project | Managed by | Location | Image(s) |
|---|---|---|---|---|
| n8n | `n8n` | Manual compose | `/opt/n8n` | `n8nio/n8n:latest` |
| Dar Hijama "production" | `dar-hijama-production` | **Manual compose** (no `coolify.managed` label) | `/home/deploy/deployments/darhijama-v1.0.1` | `mythos-darhijama-production-{app,web}:v1.0.1` |
| Dar Hijama "gi0p3..." | `gi0p3mbss6geqhunih23fy6f` | **Coolify-managed**, `applicationId=3`, `projectName=darhijama`, `environmentName=production` | `/artifacts/da5j1i55i59zfw62g9qh2r38` | `mythos-staging-{app,web}:local` |
| Coolify core | `source` | Self-managed | `/data/coolify/source` | `coolify:4.1.2`, `postgres:15-alpine`, `redis:7-alpine`, `coolify-realtime:1.0.16` |
| `i4mv37ig6xavokv0kpy5517d` | Own Coolify project | Coolify-managed, `applicationId=1` | `/artifacts/s7zxfwl71h67t6ytlb5r7nm8` | Custom image, single container, no ports/mounts observed |

- **FACT**: `docker.sock` is mounted into exactly one container: `coolify-sentinel` (Coolify's own monitoring agent — by design). No other container mounts `docker.sock`. Zero privileged containers found. Zero containers mount host root.
- **FACT**: Only `n8n-n8n-1` has an explicit memory cap (3GiB via `mem_limit: 3g`). **All other 22 containers report `Memory: 0` (uncapped)** in `docker inspect`.

## 5. Dar Hijama Duplicate-Stack Investigation

Two complete, parallel Dar Hijama stacks exist (app, web, queue, scheduler, mysql, redis×3 each = 8 containers per stack, 16 total):

**Stack A — `dar-hijama-production-*`**
- Not Coolify-managed; deployed manually via versioned compose at `/home/deploy/deployments/darhijama-v1.0.1`, image tag `v1.0.1`.
- Created: `mysql-1`/`redis-*-1` on 2026-07-29 01:09; `web-1` on 2026-07-29 15:33; `app/queue/scheduler-1` on 2026-07-29 15:57.
- Web listens on `127.0.0.1:18081`.

**Stack B — `gi0p3mbss6geqhunih23fy6f-*`**
- Coolify-managed, `applicationId=3`, labels `projectName=darhijama`, `resourceName=dar-hijama`, `environmentName=production`.
- All 8 containers created simultaneously: 2026-07-29 12:17:50.
- Web listens on `127.0.0.1:8085`.

**Routing evidence (decisive)**:
- `/etc/nginx/sites-enabled/dar-hijama-app` is **enabled** (since 2026-07-29 17:10) and proxies `darhijama.tn` / `www.darhijama.tn` → `127.0.0.1:18081` (**Stack A**).
- A prior config, `darhijama.tn.disabled-20260729-171012`, was disabled at the exact same timestamp — confirms a routing cutover happened at that moment.
- No nginx site, Traefik, Caddy, or any other proxy container references port `8085` (**Stack B**) anywhere on the host.
- `ss -lntup` confirms both `18081` and `8085` are `127.0.0.1`-only (neither is publicly exposed regardless of routing).
- Live check: `curl -I https://darhijama.tn` → `200 OK`, TLS valid to 2026-10-26 — confirms real traffic is served by Stack A right now.

**Classification**:
- **Stack A (`dar-hijama-production-*`, port 18081): ACTIVE_CONFIRMED** — verified serving live production traffic.
- **Stack B (`gi0p3...`, port 8085, Coolify application #3): POSSIBLY_STALE** — no active routing path found in nginx or any proxy, but it is still registered as `coolify.managed=true` under Coolify's "darhijama" project / "production" environment. **This audit does not conclude it is safe to remove.** Coolify's internal dashboard/state may still treat Application #3 as canonical, and interacting with it outside Coolify's own UI (e.g., manual container removal) risks conflicting with Coolify's state tracking. A human decision inside the Coolify UI is required to confirm Application #3's configured domain/status before any action is taken.

## 6. Network / Listening Services

- **FACT** (`ss -lntup`) — Public listeners (`0.0.0.0`/`[::]`): `22` (SSH), `80`/`443` (nginx), `8000` (Coolify web UI, itself reverse-proxied via nginx for `panel.mythosprod.xyz`), `6001`/`6002` (coolify-realtime/soketi), `631` (CUPS — host print service; unusual on a headless VPS but not a security-sensitive port by default).
- **FACT** — Localhost-only (`127.0.0.1`): `3306` (host-native MariaDB, not containerized), `18081` (Dar Hijama Stack A web), `8085` (Dar Hijama Stack B web), `5678` (n8n).
- **FACT**: No database, Redis, admin UI, or Docker API port was found bound publicly. All correctly loopback-bound or intentionally public (web/SSH/Coolify UI).

## 7. Coolify Health

- **FACT**: `coolify` (4.1.2, healthy, 327.4MB / 4.23% mem, 27 PIDs), `coolify-db` (postgres:15, healthy, 132.1MB volume, 40MB mem), `coolify-redis` (healthy, 9MB mem), `coolify-realtime` (soketi, healthy, 90.0MB mem), `coolify-sentinel` (monitoring agent, healthy, 8.5MB mem, docker.sock-mounted by design). All 0 restarts.
- **FACT**: `panel.mythosprod.xyz` → `302` to `/login` (expected unauthenticated behavior), TLS valid to 2026-10-19.

## 8. n8n Post-Incident Verification

All values verified directly against the live container environment and `/opt/n8n/docker-compose.yml`:

| Guard | Required | Observed | Status |
|---|---|---|---|
| Docker mem_limit | 3g | `3221225472` bytes (3GiB) | ✓ |
| NODE_OPTIONS | --max-old-space-size=2048 | present | ✓ |
| N8N_CONCURRENCY_PRODUCTION_LIMIT | 2 | 2 | ✓ |
| EXECUTIONS_DATA_PRUNE | true | true | ✓ |
| EXECUTIONS_DATA_MAX_AGE | 168 | 168 | ✓ |
| EXECUTIONS_DATA_PRUNE_MAX_COUNT | 1000 | 1000 | ✓ |
| DB_SQLITE_VACUUM_ON_STARTUP | true | true | ✓ |
| N8N_WORKFLOW_AUTODEACTIVATION_ENABLED | true | true | ✓ |
| Swap persistence | 2GB, survives reboot | `/swapfile` in `/etc/fstab`, active via `swapon --show` | ✓ |

- **FACT**: Current n8n memory usage: **310.4MiB / 3GiB (10.1%)**.
- **FACT**: SQLite DB size: **2.0MB**. WAL file: **2.0MB** (roughly equal to main DB — not yet checkpointed, but small and benign at this size; a far cry from the pre-incident 5.8GB).
- **FACT**: n8n logs since restart: 18 lines total; sole notable line is an informational notice that the Python task runner is unavailable (expected, not an error). No new errors found.
- **FACT**: Published/active workflow count verified via `n8n export:workflow --all` piped through `docker exec` (no file written to disk) → **3 workflows total, all `active=false`**. This explicitly confirms `SSANGYONG_AUTOPART_SCRAPER` and its "Auto Restart" workflow are both **inactive/unpublished**, satisfying the audit's confirmation requirement.
- **UNKNOWN**: Backup file `/opt/n8n/backups/n8n-before-vacuum-20260810.sqlite` could not be verified (directory is `drwx------ root`, unreadable by the `deploy` account; no sudo was attempted, per read-only/no-privilege-escalation constraints). Its presence/size is unconfirmed by this audit, but it was **not touched, deleted, or at any risk from any action taken**.

## 9. Live Service Checks

| Domain | HTTP | Response time | TLS expiry | Backend |
|---|---|---|---|---|
| uthinachess.tn | 200 | 0.08s | 2026-09-27 | Host nginx (own site — out of audit scope) |
| n8n.ssangyong.autos | 200 | 0.12s | 2026-10-07 | nginx → `127.0.0.1:5678` (n8n) |
| darhijama.tn | 200 | 0.10s | 2026-10-26 | nginx → `127.0.0.1:18081` (Dar Hijama Stack A) |
| panel.mythosprod.xyz (Coolify) | 302 → /login | 0.14s | 2026-10-19 | nginx → `127.0.0.1:8000` (coolify) |

All four checked via HEAD/GET only. No anomalies; all certs valid with 45+ days remaining.

## 10. Storage / Volumes

- **FACT** (`docker system df -v`): Largest volumes — `dar-hijama-production_staging-mysql` 221.4MB, `gi0p3mbss6geqhunih23fy6f_staging-mysql` 221.4MB (near-identical sizes, consistent with a fork/copy at deploy time), `gi0p3..._staging-redis-queue` 29.8MB, `dar-hijama-production_staging-redis-queue` 31.7MB, `coolify-db` 132.1MB, `n8n_n8n_data` 4.2MB.
- **FACT**: Largest images — n8n 2.47GB, `i4mv37ig6xavokv0kpy5517d` 2.17GB (two tags sharing 1.558GB), `mysql:8.4` 1.12GB, both Dar Hijama app images 1.33GB each (698.7MB shared layer).
- **UNKNOWN**: A per-directory `du -sh /var/lib/docker/*` breakdown could not be obtained — the directory is `root`-only (0700) and the `deploy` account has no sudo. `docker system df -v` was used as an adequate substitute for volume-level visibility.
- **FACT**: Disk headroom — 38G available on `/`, 48% used.

## 11. Security Observations (Read-Only)

- **FACT**: `docker.sock` exposed to exactly one container (`coolify-sentinel`), by design as Coolify's monitoring agent.
- **FACT**: Zero privileged containers. Zero containers mounting host root.
- **UNKNOWN**: SSH login history (successful/failed) could not be obtained — `journalctl -u ssh` and `/var/log/auth.log` require `adm`/`systemd-journal` group membership or sudo, neither available to the `deploy` account, and none was attempted per the read-only/no-escalation constraint.
- No secret values, tokens, passwords, or private keys were printed at any point in this audit.

## 12. OOM Residual Risk Assessment

**Memory budget at snapshot time:**

| Item | Value |
|---|---|
| Host RAM total | 7.6GiB |
| Host RAM used | 2.8GiB |
| Host RAM available | 4.7GiB |
| Sum of all 23 containers' RSS (`docker stats`) | ≈1.92GiB |
| Swap used / total | 60KiB / 2.0GiB |
| Containers with a memory cap | 1 of 23 (n8n only) |

**Largest container consumers**: `dar-hijama-production-mysql-1` 437MB, `mysql-gi0p3...` 432.3MB, `coolify` 327.4MB, `n8n` 310.4MB, `coolify-realtime` 90.0MB.

**Non-container host RAM (~0.9GiB of the 2.8GiB "used")**: host-native MariaDB (129MB), an Xorg/lightdm desktop session (~220MB — unusual on a headless VPS, worth a look but not urgent), dockerd/containerd (~205MB), and a **host-native (non-Docker) PHP/Laravel Horizon deployment** (`php artisan horizon`, `queue:work`, `schedule:work`, php-fpm processes under `www-data`, ~400-500MB combined). This last item runs entirely outside Docker/Coolify's accounting and was not part of the known service list in this audit's brief — flagged for awareness, not investigated further.

**CLASSIFICATION: HEALTHY_WITH_WARNINGS**

- **Healthy**: No OOM messages this boot; swap essentially unused; 4.7GiB available; all 23 containers healthy; n8n fully compliant with every remediation setting and using only 10% of its cap.
- **Warnings**:
  1. 22 of 23 containers (including two full MySQL instances at ~430-440MB each) have **no memory cap** — any one could balloon under load and reproduce an OOM-style incident, this time from a different service.
  2. The duplicate Coolify-managed Dar Hijama stack (Stack B) is fully running, consuming ~700MB of image/volume footprint, while serving zero traffic.
  3. A host-native PHP/Horizon/MariaDB deployment consumes real memory outside Docker's accounting, meaning `docker stats`-based monitoring alone would not have caught it contributing to a future OOM event.

**Could this happen again?** At current usage, no single component is close to exhausting the host. But because uncapped containers can grow without bound, a load spike on either MySQL instance, or on the untracked host-native app, is the most plausible path to a repeat OOM — not n8n, which is now well-contained.

---

## Recommended Actions

**P0 — Critical**: None identified. No active incident, no imminent failure condition found.

**P1 — High**
1. Add explicit memory caps (`mem_limit` / Compose `deploy.resources.limits.memory`) to all currently-uncapped containers, starting with both MySQL instances (candidate: 512–768MB given current 430–440MB usage) and the Coolify core containers, to prevent a repeat OOM from a different service than n8n.
2. Get a human decision, made inside the Coolify UI (not by inference from container state), on whether Coolify Application #3 (the `gi0p3...` Dar Hijama stack) should be stopped/archived now that live traffic confirmably routes to the manually-deployed stack instead.

**P2 — Medium**
1. Investigate the host-native PHP/Laravel/Horizon/MariaDB deployment — confirm what it is, whether it's expected, and whether it should have its own resource limits (e.g., systemd `MemoryMax=`) since it sits outside Docker's memory accounting entirely.
2. Clarify the two simultaneous `RestartCount=4` events on 2026-08-09T23:49:15 (both Dar Hijama queue containers) — confirm this was expected remediation activity and not an unexplained restart trigger.

**P3 — Cleanup**
1. Grant the audit/deploy account read-only access to auth logs (`adm` or `systemd-journal` group) so future security reviews don't require sudo.
2. Review whether the CUPS service (port 631) is needed on this host; if not, it's a minor unnecessary listener.

---

## 14. Direct Re-Verification (2026-08-10, performed personally, no subagent)

The initial data collection for this audit (sections 1–13 above) was performed via a delegated general-purpose subagent. Mythos OS project policy prohibits subagent use without explicit authorization, which was not given for this audit. All load-bearing findings were therefore independently re-verified directly over `ssh mythos`, by the primary session, with no subagent involved.

**Re-verified directly, all PASS:**
- **Host**: RAM 7.6Gi total / 4.7Gi available / 2.9Gi used, swap 60Ki/2.0Gi used, disk 34G/72G (48%), load avg 0.28/0.75/0.88 — consistent with the original findings (minor natural fluctuation only).
- **Containers**: 23 running, all healthy. Container ID set identical to the fingerprint taken immediately after the original audit — **no container was recreated** by either audit pass.
- **`docker stats`**: re-pulled fresh; all values consistent with original report within normal fluctuation (e.g. both MySQL containers now 444–454MiB vs 432–437MB originally). 22 of 23 containers confirmed still uncapped (`7.564GiB` = host total shown as the limit, i.e. no real cap); only `n8n-n8n-1` capped at exactly `3221225472` bytes (3GiB).
- **n8n**: memory cap 3GiB confirmed via `docker inspect`; `NODE_OPTIONS=--max-old-space-size=2048`, `N8N_CONCURRENCY_PRODUCTION_LIMIT=2`, `EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=168`, `EXECUTIONS_DATA_PRUNE_MAX_COUNT=1000`, `DB_SQLITE_VACUUM_ON_STARTUP=true`, `N8N_WORKFLOW_AUTODEACTIVATION_ENABLED=true` all confirmed via `docker exec printenv`, byte-for-byte matching the required values. Swap persistence confirmed via `/etc/fstab` (`/swapfile none swap sw 0 0`).
- **n8n workflows**: re-ran the in-memory `n8n export:workflow --all --output=/dev/stdout` (no file written to disk). Confirmed exactly 3 workflows exist: `SSANGYONG_AUTOPART_SCRAPER` (`active:false`), `SSANGYONG_AUTOPART_SCRAPER - Auto Restart` (`active:false`), and `SSANGYONG_PROCESS_MODEL` (`active:false`, not individually named in the original report but consistent with "3 workflows, all inactive"). **Confirmed: 0 active/published workflows, scraper and Auto Restart both inactive.**
- **Dar Hijama routing**: re-confirmed directly. `/etc/nginx/sites-enabled/dar-hijama-app` (enabled 2026-07-29 17:10) → `proxy_pass http://127.0.0.1:18081` for `server_name darhijama.tn www.darhijama.tn` — Stack A. `grep -rl 8085 /etc/nginx/sites-enabled/ /etc/nginx/sites-available/` returned **zero matches** — no nginx site of any kind routes to Stack B (`gi0p3...`, port 8085). Live check: `https://darhijama.tn` → `200`, 0.169s. **ACTIVE_CONFIRMED / POSSIBLY_STALE classification stands, independently reconfirmed.**
- **Public ports** (`ss -lntup`): identical listener set to the original audit — `22, 80, 443, 6001, 6002, 631, 8000` public; `3306, 18081, 5678, 8085` loopback-only. No change, no new exposure.
- **Git diff scope**: `git status --porcelain` shows exactly two changes — `M docs/AI_HANDOVER.md` and `?? docs/audits/` (containing only this report). No other file touched.
- **`git diff --check`**: exit 0, no whitespace/conflict-marker errors.
- **Secret scan**: re-run against both changed files (`+`-added lines only for the diff, full content for the new file) for password/secret-value/api-key/private-key/PEM-header/bearer-token patterns — **zero matches** beyond this report's own "no secrets were printed" statements.

**Correction applied**: the queue-container restart-count observation (§2/§3 above) has been corrected from a cautious INFERENCE to a confirmed FACT with root cause — see the strikethrough/correction inline in section "Docker Global Health" above. `RestartCount` had risen from 4 (at original audit) to 12 (at re-verification, ~9 hours later); the restarts occur at almost exactly hourly intervals, which precisely matches the `--max-time=3600` flag on the queue worker's `php artisan queue:work` command, confirming this is routine self-recycling, not a crash loop, not OOM-related, and not caused by either audit pass.

**Confirmed not caused by any audit activity**: the queue containers' most recent restart (`StartedAt 2026-08-10T07:49:34Z`) occurred roughly an hour before this re-verification session began, and the hourly cadence traces back continuously through both audit passes — ruling out either audit as the cause.

**Still UNKNOWN (unchanged from original audit, not re-attempted — requires sudo which was not used in either pass)**: n8n backup file presence/size at `/opt/n8n/backups/`, SSH login/auth-failure history, per-directory `/var/lib/docker` breakdown.

**No correction was needed** to: host health classification, service ownership inventory, Dar Hijama classification, network exposure findings, Coolify health, n8n compliance status, live service checks, storage/volume figures, security observations, or the overall OOM residual risk classification. All independently reconfirmed as originally reported.

## Explicitly Confirmed

- No mutating command was executed against Docker, systemd, nginx, files, or n8n at any point in this audit, across either the original pass or the direct re-verification pass.
- All 23 container IDs were identical before, during, and after both audit passes (only uptime/restart counters advanced from the queue workers' own hourly self-recycling, root-caused in §14), confirming no restart/recreate occurred as a side effect of any audit activity.
- The n8n backup file was not deleted, moved, or read (in either pass).
- No n8n workflow was modified. SSANGYONG_AUTOPART_SCRAPER and its Auto Restart workflow remain unpublished (independently reconfirmed in §14).
- No secrets, tokens, passwords, or private keys were printed, in either pass.
- All load-bearing findings from the original (subagent-assisted) audit were independently reconfirmed by direct SSH commands with no subagent, per §14. One correction was applied (queue-restart root cause); no other finding required correction.
