# VPS Memory Budget & Container Limit Plan — 2026-08-10

**Type**: Read-only planning stage. No limit was applied, no container was touched, no configuration was changed.
**No subagents were used.** All data below was collected directly over `ssh mythos` by the primary session.
**Repository baseline verified**: local HEAD = `origin/main` HEAD = `eaa4c90f10a953e8a38c733988cf4995b587e37c` before this plan was written.
**Inputs read**: `docs/AI_HANDOVER.md`, `docs/audits/VPS_SERVICE_HEALTH_AUDIT_2026-08-10.md`.

---

## 1. Current Memory Snapshot (directly re-verified)

```
              total   used   free   shared  buff/cache  available
Mem:          7.6Gi   2.8Gi  1.3Gi  304Mi    4.0Gi       4.7Gi
Swap:         2.0Gi   60Ki   2.0Gi
```

- Sum of all 23 containers' `docker stats` MemUsage: **2008.5 MiB (≈1.96 GiB)**.
- Non-container ("host-native + runtime overhead") memory: `used (2.8Gi) − containers (1.96Gi) ≈ 858 MiB`, consistent with the original audit's rough estimate.
- Swap is essentially idle (60KiB/2GiB) — healthy.

## 2. Host-Native Memory Usage — Correction to the Original Audit

The 2026-08-10 health audit's OOM-risk section flagged "a host-native (non-Docker) PHP/Laravel/Horizon/MariaDB deployment... ~400-500MB combined" as an untracked risk. **Direct re-investigation via `/proc/<pid>/cgroup` for every matching process shows this was partly a misattribution**, corrected here:

| Process | Real location | Evidence |
|---|---|---|
| `php artisan horizon`, `horizon:supervisor`, `horizon:work` (UID 9999) | **Inside the `coolify` container itself**, not host-native | `cgroup` = `docker-f86e890512ee....scope`, matching the `coolify` container ID. Coolify's own backend is a Laravel app that runs Horizon internally for its job queue — already fully counted in `coolify`'s `docker stats` figure (334MB). |
| `php artisan queue:work` (root, PID 1946483/1946512) | **Inside the two Dar Hijama queue containers** | `cgroup` matches `queue-gi0p3...` and `dar-hijama-production-queue-1` container IDs — same processes already counted in §14 of the health audit's queue-restart investigation. |
| `php-fpm: pool www` (www-data, several PIDs) | **Mostly inside Dar Hijama app containers** (`8ee4a0aae244` = Stack A app, `6d13f388aefd` = Stack B app) | Confirmed via cgroup. |

**Genuinely host-native (confirmed via `systemd`-scoped cgroups, i.e. truly outside Docker):**

| Service | systemd unit | RSS | Role |
|---|---|---|---|
| MariaDB | `mariadb.service` | 129 MB | Host-native DB server (separate from the two containerized MySQL instances) — purpose not further characterized in this plan; out of scope. |
| PHP-FPM | `php8.5-fpm.service` | ~117 MB (3 processes) | Confirmed via nginx config: serves `uthinachess.tn` directly (`root /var/www/uthinachess`, `fastcgi_pass unix:/run/php/php-fpm.sock`) — this is the **production uthinachess.tn app**, running host-native by design, not a Docker workload. |
| Docker runtime overhead | n/a | ~477 MB (`dockerd` 129MB + `containerd` 80MB + 23× `containerd-shim-runc-v2` ≈ 12MB each ≈ 276MB) | Fixed cost of running 23 containers; scales with container count, not with per-container caps. |
| Xorg / lightdm desktop session | n/a | ~330 MB (Xorg, lightdm-gtk-greeter, pulseaudio, gvfs, at-spi, dbus) | A full GUI desktop session is running on this headless VPS. Not required by any identified service. **Not touched by this plan** (out of scope — no config change authorized), but flagged as a P3 candidate for a separate, explicitly-authorized cleanup task; would free ~330MB if disabled. |
| Host nginx (reverse proxy) | `nginx.service` (implied) | ~55 MB (master + 4 workers) | The reverse proxy in front of all live domains. |
| systemd/journald/sshd/misc | — | remainder | Baseline OS overhead. |

**Corrected finding**: real host-native application-layer footprint is **MariaDB (129MB) + PHP-FPM/uthinachess (117MB) ≈ 246MB**, not ~400-500MB, and there is **no separate host-native Horizon deployment** — Horizon is Coolify's own internal component, already inside Coolify's container. The ~858MB non-container total is better explained as: Docker runtime overhead (~477MB) + MariaDB (129MB) + PHP-FPM (117MB) + host nginx (~55MB) + Xorg/desktop attribution split between "used" and reclaimable + systemd/journald/sshd/misc (remainder). (RSS-based sub-totals overcount slightly due to shared library pages counted per-process; the authoritative aggregate is the 858MB `free -h` delta.)

## 3. Per-Container Table (directly re-verified via `docker stats` + `docker inspect`)

| Container | App | Current RAM | Limit today | CPU | PIDs | Restart policy | Role | Prod-critical | Managed by |
|---|---|---|---|---|---|---|---|---|---|
| `n8n-n8n-1` | n8n | 298 MB | **3 GB** | 0.2-0.4% | 20 | unless-stopped | Automation platform | Yes | Manual compose |
| `dar-hijama-production-mysql-1` | Dar Hijama (Stack A) | 454 MB | none | 0.7-0.8% | 35 | unless-stopped | Database | Yes (serving live traffic) | Manual compose |
| `mysql-gi0p3...` | Dar Hijama (Stack B) | 446 MB | none | 0.8% | 36 | unless-stopped | Database | No (no live route) | Coolify |
| `dar-hijama-production-app-1` | Dar Hijama (Stack A) | 65 MB | none | 0.01% | 3 | unless-stopped | App (Laravel/PHP-FPM) | Yes | Manual compose |
| `app-gi0p3...` | Dar Hijama (Stack B) | 51 MB | none | 0.01% | 3 | unless-stopped | App | No | Coolify |
| `dar-hijama-production-queue-1` | Dar Hijama (Stack A) | 49 MB | none | 0.0% | 1 | unless-stopped | Queue worker (`queue:work --memory=256 --max-time=3600`) | Yes | Manual compose |
| `queue-gi0p3...` | Dar Hijama (Stack B) | 50 MB | none | 0.0% | 1 | unless-stopped | Queue worker | No | Coolify |
| `dar-hijama-production-web-1` | Dar Hijama (Stack A) | 13 MB | none | 0.0% | 5 | unless-stopped | Web front | Yes | Manual compose |
| `web-gi0p3...` | Dar Hijama (Stack B) | 4.7 MB | none | 0.0% | 5 | unless-stopped | Web front | No | Coolify |
| `dar-hijama-production-scheduler-1` | Dar Hijama (Stack A) | 3.9 MB | none | 0.0% | 2 | unless-stopped | Cron scheduler | Yes | Manual compose |
| `scheduler-gi0p3...` | Dar Hijama (Stack B) | 8.2 MB | none | 0.0% | 2 | unless-stopped | Cron scheduler | No | Coolify |
| `dar-hijama-production-redis-{queue,cache,session}-1` (×3) | Dar Hijama (Stack A) | 3.5–6 MB each | none | 0.7-1.0% | 6 each | unless-stopped | Cache/queue/session store | Yes | Manual compose |
| `redis-{queue,cache,session}-gi0p3...` (×3) | Dar Hijama (Stack B) | 3.4–3.6 MB each | none | 0.8-1.3% | 6 each | unless-stopped | Cache/queue/session store | No | Coolify |
| `coolify` | Coolify core | 334 MB | none | 0.4-0.9% | 27 | always | Control-plane app (Laravel + internal Horizon) | Yes (platform) | Self |
| `coolify-db` | Coolify core | 41 MB | none | 0.0% | 7 | always | Postgres (Coolify's own DB) | Yes (platform) | Self |
| `coolify-redis` | Coolify core | 9.2 MB | none | 1.0-1.3% | 7 | always | Redis (Coolify's own cache/queue) | Yes (platform) | Self |
| `coolify-realtime` | Coolify core | 93 MB | none | 1.1-8.8% | 22 | always | Soketi (websocket/realtime) | Yes (platform) | Self |
| `coolify-sentinel` | Coolify core | 8.8 MB | none | 0.0% | 10 | no | Monitoring agent (docker.sock-mounted) | Yes (platform) | Self |
| `i4mv37ig6xavokv0kpy5517d` | Unidentified Coolify app #1 | 45 MB | none | 0.01% | 27 | unless-stopped | Bundles its own internal nginx + php-fpm + node prestart script | Unknown — not characterized in the health audit either | Coolify |

**Restart-policy note**: every container except `coolify-sentinel` (policy `no`) uses `unless-stopped` or `always` — meaning any OOM-kill or clean exit is auto-restarted. This is good for availability but means an uncapped container hitting a memory spike can silently restart-loop while consuming host memory each cycle, masking the underlying issue. Explicit `mem_limit`s convert a silent host-wide risk into a visible, per-container, self-contained failure (the OOM-killed container restarts; its neighbors are unaffected) — this is the core goal of this plan.

## 4. Proposed Docker Memory Limits

All values are `mem_limit` (hard ceiling — the cgroup OOM-killer restarts *only this container* if breached) with an optional `mem_reservation` (soft target Docker uses to prioritize reclaim under host pressure; not a hard cap). **None of these have been applied.**

| Container | Current | Proposed `mem_limit` | Proposed `mem_reservation` | Rationale | Risk if set too low | Priority |
|---|---|---|---|---|---|---|
| n8n-n8n-1 | 298 MB | **3 GB (unchanged)** | — | Explicitly out of scope — leave as-is per task instructions | n/a | n/a |
| dar-hijama-production-mysql-1 | 454 MB | **768 MB** | 512 MB | ~1.7× current usage; `innodb_buffer_pool_size` is only 128MB (MySQL 8 default, never explicitly tuned) so most of the 454MB is connection/thread/performance_schema overhead that can grow with concurrent connections (`max_connections=151`, default) | Too low → cgroup OOM-kills MySQL under a connection spike instead of MySQL gracefully rejecting new connections — a harder failure than the DB just running out of its own internal limits | **HIGH** |
| mysql-gi0p3... | 446 MB | **768 MB** | 512 MB | Symmetric with Stack A — no retirement of this stack is authorized, so it is budgeted identically | Same as above | **HIGH** |
| dar-hijama-production-app-1 | 65 MB | **384 MB** | 128 MB | ~6× headroom for PHP-FPM under traffic bursts | Too low → app container OOM-kills under a moderate traffic spike, taking down the live darhijama.tn frontend | MEDIUM |
| app-gi0p3... | 51 MB | **384 MB** | 128 MB | Symmetric | No live traffic currently, but keep same margin per no-retirement rule | MEDIUM |
| dar-hijama-production-queue-1 | 49 MB | **320 MB** | 96 MB | Set intentionally *above* the worker's own `--memory=256` internal soft-recycle threshold, so Laravel's own graceful recycle fires before Docker's hard kill would — defense in depth, not a replacement for the existing `--max-time=3600`/`--memory=256` behavior | Setting below ~256MB would fight the worker's own internal limit and could cause Docker hard-kills instead of graceful Laravel recycles | MEDIUM |
| queue-gi0p3... | 50 MB | **320 MB** | 96 MB | Symmetric | Same | MEDIUM |
| dar-hijama-production-web-1 | 13 MB | **192 MB** | 48 MB | Light nginx+php-fpm front, generous multiple of current usage | Low risk either way given tiny footprint | LOW |
| web-gi0p3... | 4.7 MB | **192 MB** | 48 MB | Symmetric | Low | LOW |
| dar-hijama-production-scheduler-1 | 3.9 MB | **128 MB** | 32 MB | Near-idle, only spikes briefly on cron ticks | Low | LOW |
| scheduler-gi0p3... | 8.2 MB | **128 MB** | 32 MB | Symmetric | Low | LOW |
| Both stacks' Redis ×6 (`-cache`, `-queue`, `-session`) | 3.4–6 MB each | **64 MB each** | 16 MB | ~15-20× current usage; no `maxmemory`/eviction policy is currently configured on these instances (not changed here — noted for future review), so a cap prevents unbounded growth from an unexpectedly large dataset | Low risk given tiny current datasets; if a workload grows these datasets meaningfully, this is the first cap to revisit | LOW |
| coolify | 334 MB | **640 MB** | 384 MB | Control-plane app; bundles internal Horizon workers; an OOM-kill here disables the ability to manage/redeploy everything else via the UI, so give real headroom | An OOM-kill of Coolify itself is high-impact (loses platform management capability, though it does not affect already-running application containers) | **HIGH (apply last, verify carefully)** |
| coolify-db | 41 MB | **384 MB** | 128 MB | Postgres benefits from buffer/connection headroom despite tiny current usage | Moderate — Coolify's own state DB | MEDIUM-HIGH |
| coolify-redis | 9.2 MB | **96 MB** | 24 MB | Tiny footprint but Coolify-critical | Low | LOW |
| coolify-realtime | 93 MB | **256 MB** | 96 MB | Observed one CPU spike to 8.76% during the health audit; give moderate headroom | Moderate | MEDIUM |
| coolify-sentinel | 8.8 MB | **96 MB** | 24 MB | Tiny monitoring agent | Low | LOW |
| i4mv37ig6xavokv0kpy5517d | 45 MB | **320 MB** | 96 MB | Role not fully characterized by either audit (bundles internal nginx+php-fpm+node) — conservative default cap pending a separate identification task, not a fine-tuned figure | Unknown role = flagged as informational gap, not a technical red flag given its low current footprint | MEDIUM (due to unknown role, not usage) |

## 5. Total Theoretical Maximum After Caps

Sum of all proposed `mem_limit` values (the worst case **only** if every single container simultaneously hit its ceiling at once):

```
n8n                              3072 MB
MySQL ×2  (768×2)                1536 MB
App ×2    (384×2)                 768 MB
Queue ×2  (320×2)                 640 MB
Web ×2    (192×2)                 384 MB
Scheduler ×2 (128×2)               256 MB
Redis ×6  (64×6)                  384 MB
Coolify                            640 MB
Coolify-db                         384 MB
Coolify-redis                       96 MB
Coolify-realtime                   256 MB
Coolify-sentinel                    96 MB
i4mv...                            320 MB
──────────────────────────────────────────
TOTAL                            8832 MB  ≈ 8.63 GB
```

**This sum (8.63 GB) exceeds physical RAM (7.6 GB).** This is intentional, standard container-hosting practice ("limit overcommit"), not an oversight — explained below — but it is flagged transparently per the instruction to design a *realistic* budget.

**Why this is still safe:**
1. **Real observed total usage today is only ≈2.9 GB** (858MB host-native + 1.96GB containers) — nowhere near the 8.63GB ceiling.
2. It is statistically implausible for all 23 services to hit their individual ceiling at the exact same moment — the original OOM incident was caused by *one* uncapped service (n8n) growing unbounded, not by simultaneous multi-service growth.
3. **The core protection goal is per-container containment**, not a zero-overcommit guarantee: with limits in place, Docker's OOM-killer acts on the *individual cgroup* that exceeds its cap — killing/restarting only that one container — instead of the kernel OOM-killer picking an arbitrary victim process host-wide (which is what happened in the n8n incident, and could just as easily have picked `sshd` or `dockerd` instead).
4. The 2GB swap sits entirely outside this budget as a last-resort buffer, not a working-memory line item, per the design requirement.

**If a strict zero-overcommit guarantee is required instead** (sum of limits ≤ physical RAM), the correct lever is **not** shrinking these caps further — MySQL at much below 768MB risks false OOM-kills of a live production database, which would harm the "preserve production reliability" goal. The correct lever is the MySQL internal tuning noted in §6 (smaller, deliberately-sized `innodb_buffer_pool_size`, right-sized `max_connections`, possibly disabling `performance_schema`) — none of which is applied by this plan.

## 6. Expected Normal RAM Usage

```
Host-native (MariaDB + PHP-FPM/uthinachess + host nginx + Docker runtime overhead + OS/systemd/Xorg)  ≈ 858 MB  (observed)
All 23 containers, current real usage                                                                  ≈ 1959 MB (observed, 2008.5 MiB)
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
TOTAL EXPECTED NORMAL USAGE                                                                             ≈ 2.75–2.9 GB
```

This matches `free -h`'s reported "used" (2.8Gi) almost exactly — a useful cross-check that the budget model is grounded in reality, not speculation.

## 7. Emergency Headroom

```
Physical RAM                    7.6 GB
− Expected normal usage        −2.9 GB
──────────────────────────────────────
Headroom before swap            4.7 GB   (matches `free -h`'s "available" almost exactly)
+ Swap (emergency only)        +2.0 GB
──────────────────────────────────────
Total headroom before real OOM risk   6.7 GB
```

Under the proposed caps, **no single container can consume more than its own limit** — so the failure mode that caused the original incident (one service silently growing to consume the entire 6.7GB of headroom, then swap, then triggering a host-wide kernel OOM-kill) becomes structurally impossible for any of the 22 newly-capped containers. n8n was already protected this way since the incident response.

## 8. Scenario A — Both Dar Hijama Stacks Remain Running

This is the default scenario this plan is built around (§4–§7 above already reflect it). Sum of proposed limits: **8832 MB**. Both MySQL instances get full 768MB caps; both stacks get identical treatment since no retirement is authorized. Real combined Dar Hijama footprint today: Stack A ≈598MB + Stack B ≈570MB ≈ 1.17GB of the 2.9GB total observed usage.

## 9. Scenario B — Coolify Application #3 (`gi0p3...`) Later Confirmed Stale and Retired

**Not authorized now** — shown for planning comparison only, contingent on a future human decision inside the Coolify UI (per the original health audit's finding that this stack is `POSSIBLY_STALE`, not concluded safe to remove).

If Stack B (`gi0p3...`, all 8 containers: mysql, app, queue, web, scheduler, redis×3) were retired:

| | Scenario A (both) | Scenario B (Stack B retired) | Difference |
|---|---|---|---|
| Sum of proposed `mem_limit`s | 8832 MB | 6848 MB | **−1984 MB**, drops the sum **below physical RAM (7.6GB)** — eliminates limit-overcommit entirely |
| Real observed container usage | ≈1959 MB | ≈1389 MB | **−570 MB** freed |
| Expected normal total usage | ≈2.9 GB | ≈2.3 GB | **−0.6 GB** |
| Emergency headroom before swap | 4.7 GB | ≈5.3 GB | +0.6 GB |
| Disk (images+volumes, per the original audit) | baseline | **−~700 MB** | Frees the ~700MB image/volume footprint the original audit measured for this stack |

Scenario B is meaningfully better for the memory budget (removes overcommit entirely, frees real memory and disk) — but this plan does not recommend acting on it without the Coolify-UI confirmation the original audit already called for.

## 10. Recommended Implementation Sequence

Ordered safest-first, per the task's risk-minimization requirement. **Nothing in this list is applied by this plan — it is a proposed order for a future, separately-authorized implementation task.**

| Step | Group | Risk | Why this position |
|---|---|---|---|
| 1 | Both stacks' Redis ×6, `coolify-redis`, `coolify-sentinel` | **LOW** | Tiny footprints, huge margin, no state loss risk, easiest to verify and roll back |
| 2 | Both stacks' scheduler + web containers | **LOW** | Near-idle or light front-end load; caps are 15-40× current usage |
| 3 | Both stacks' app + queue containers | **MEDIUM** | Actively serving live (Stack A) or standby (Stack B) traffic; verify Stack A (`darhijama.tn`) health immediately after each cap is applied |
| 4 | `coolify-realtime`, `coolify-db` | **MEDIUM-HIGH** | Support Coolify's own dashboard/realtime features; moderate blast radius if capped too tight |
| 5 | Both MySQL containers | **HIGH — only after a separate MySQL configuration review** (buffer pool sizing, `max_connections` right-sizing, `performance_schema` decision) is completed; applying the 768MB cap alone without that review is still an improvement over today's zero cap, but should not be treated as the final word on MySQL memory safety |
| 6 | `coolify` (core) | **HIGH — apply last** | Platform control-plane; verify Coolify's UI and API respond normally immediately after, in a low-traffic window |
| — | `i4mv37ig6xavokv0kpy5517d` | MEDIUM (informational gap) | Recommend identifying this app's actual purpose *before or alongside* step 3, since its role is currently unknown to both audits |
| — | `n8n-n8n-1` | n/a | Already capped and verified compliant — no action |

Each step should be followed by: `docker stats --no-stream` re-check, a live HTTP check of any affected domain, and a log tail for new errors, before proceeding to the next step.

---

## Validation

- `git diff --check`: to be run before commit (see final response).
- Only `docs/audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md` and `docs/AI_HANDOVER.md` are intended to change.
- No credentials, secrets, or IPs were introduced (MySQL was queried using the container's own `$MYSQL_ROOT_PASSWORD` env var referenced symbolically inside `docker exec`, never echoed to output or written to any file).
- No production mutation: no `mem_limit`, restart policy, compose file, or running container was changed by this plan.
- Container IDs before/after this planning session were compared and are identical except for the two Dar Hijama queue containers' own hourly self-recycling (`--max-time=3600`, confirmed benign and pre-existing in the prior audit).
