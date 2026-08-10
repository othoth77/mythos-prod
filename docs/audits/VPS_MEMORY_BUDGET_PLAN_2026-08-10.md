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
| `i4mv37ig6xavokv0kpy5517d` | **Notre Jour (preview/staging)** — identified in the 2026-08-10 safety review, see §11.7 | 45 MB | none | 0.01% | 27 | unless-stopped | Bundles its own internal nginx + php-fpm + node prestart script; Nixpacks-built Laravel app, `APP_ENV=local`, SQLite | **No** — non-production preview, reachable only via Coolify's sslip.io URL; the real `notrejour.tn` domain is served by a separate host-native deployment | Coolify |

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
| Both stacks' Redis ×6 (`-cache`, `-queue`, `-session`) | 3.4–6 MB each (Redis-internal `used_memory` only 1.1–1.3MB; the rest is process/allocator baseline) | **64 MB each (Docker `mem_limit`, unchanged proposal)** | 16 MB | See §11.6 below — directly re-verified: `maxmemory=0` and `maxmemory-policy=noeviction` confirmed identical on all 6 instances via `redis-cli CONFIG GET`. Docker `mem_limit` alone is a **hard, ungraceful** backstop (SIGKILL on breach); this is the *only* revision to this row's reasoning — the 64MB Docker figure itself is unchanged, still ~50× current real usage | Low risk given tiny current datasets; the real gap is the missing Redis-level `maxmemory`, not the Docker limit size — see §11.6 for role-specific recommendation (not applied) | LOW |
| coolify | 334 MB | **640 MB** | 384 MB | Control-plane app; bundles internal Horizon workers; an OOM-kill here disables the ability to manage/redeploy everything else via the UI, so give real headroom | An OOM-kill of Coolify itself is high-impact (loses platform management capability, though it does not affect already-running application containers) | **HIGH (apply last, verify carefully)** |
| coolify-db | 41 MB | **384 MB** | 128 MB | Postgres benefits from buffer/connection headroom despite tiny current usage | Moderate — Coolify's own state DB | MEDIUM-HIGH |
| coolify-redis | 9.2 MB | **96 MB** | 24 MB | Tiny footprint but Coolify-critical | Low | LOW |
| coolify-realtime | 93 MB | **256 MB** | 96 MB | Observed one CPU spike to 8.76% during the health audit; give moderate headroom | Moderate | MEDIUM |
| coolify-sentinel | 8.8 MB | **96 MB** | 24 MB | Tiny monitoring agent | Low | LOW |
| i4mv37ig6xavokv0kpy5517d | 45 MB | **320 MB** | 96 MB | **Identified in §11.7**: this is a Coolify-managed **preview/staging deployment of the "Notre Jour" Laravel app** (`coolify.projectName=notrejour`, `APP_ENV=local`, SQLite DB, `QUEUE_CONNECTION=sync`), reachable only via Coolify's auto-generated `i4mv37ig6xavokv0kpy5517d.51.68.226.211.sslip.io` URL. **Not production** — the real `notrejour.tn` domain is served by a separate, host-native PHP-FPM deployment at `/var/www/notrejour/public`, confirmed via nginx config, entirely independent of this container. 320MB cap remains generously justified for a low-traffic preview app | Low — non-production preview environment; an OOM-kill here has no live-traffic impact | **LOW** (downgraded from MEDIUM now that its role and non-production status are confirmed) |

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

> **Superseded by the 2026-08-10 safety review (§11):** point 2 above ("statistically implausible") was directionally correct but not quantified, and does not by itself establish host-wide safety. §11 below runs the actual numbers: against a formal 2GB host reserve, the *preferred* aggregate ceiling is ≈5.65GB and the absolute *swap-backed* hard ceiling is ≈7.65GB. Scenario A's 8832MB sum **exceeds both** — by ~3.0GB against the preferred ceiling and by ~1.0GB against the hard ceiling. This does not mean Scenario A is unsafe to *start* implementing (see §11's per-step authorization call), but the full 22-container rollout should not be treated as fully safe against a genuine multi-container simultaneous spike until the aggregate is trimmed in a future revision.

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

Under the proposed caps, **no single container can consume more than its own limit** — so the specific failure mode that caused the original incident (one uncapped service silently growing to consume the entire 6.7GB of headroom, then swap, then triggering a host-wide kernel OOM-kill) is greatly reduced for any of the 22 newly-capped containers. n8n was already protected this way since the incident response.

> **Correction (2026-08-10 safety review):** the original version of this section stated this makes host-wide OOM "structurally impossible." That was incorrect and has been corrected. Per-container limits reduce *single-container* OOM risk — they do not, by themselves, guarantee host-wide safety, because **the sum of all limits (8832 MB in Scenario A) is not bounded against physical RAM**. If several capped containers spiked to their ceiling *simultaneously* (e.g. both MySQL instances under a traffic surge, plus Coolify, plus a Dar Hijama app tier, all at once), their combined demand could still exceed available RAM and swap together, producing a host-wide OOM-kill — just a less likely one than the original single-service failure mode. See the new §11 "Global Safety Reserve & Revised Safe Targets" below for the corrected model and revised thresholds.

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
| — | `i4mv37ig6xavokv0kpy5517d` | **LOW** (identified in §11.7 as a non-production Notre Jour preview deployment) | Can be grouped with Step 2 (low-risk, non-production, generous cap-to-usage ratio) rather than held back pending identification |
| — | `n8n-n8n-1` | n/a | Already capped and verified compliant — no action |

Each step should be followed by: `docker stats --no-stream` re-check, a live HTTP check of any affected domain, and a log tail for new errors, before proceeding to the next step.

---

## 11. Final Safety Review (2026-08-10) — Corrected Global Safety Model

**No subagents used. Read-only. No production mutation.** This section revises §5 and §7 above rather than replacing the rest of the plan.

### 11.1 Correction: "structurally impossible" was wrong

The original §7 stated per-container limits make host-wide OOM "structurally impossible." **This has been corrected** (see the inline note in §7 above). Per-container limits reduce *single-container* OOM risk — they were never a guarantee against a *multi-container simultaneous* spike, because the sum of proposed limits was never checked against physical capacity. That check is done below.

### 11.2 Recalculation

```
Total RAM                          7.6 GiB   = 7782 MB
Swap (emergency only, excluded
  from the working budget)         2.0 GiB   = 2048 MB
Observed non-container usage                 ≈ 858 MB
Scenario A — sum of proposed
  container mem_limits                       = 8832 MB
Scenario B — sum of proposed
  container mem_limits (Stack B
  retired; NOT authorized)                   = 6848 MB
```

### 11.3 Global Safety Reserve (revised, host-side — never available to containers)

| Component | Reserve | Basis |
|---|---|---|
| Kernel / systemd / host nginx / SSH | 200 MB | Directly measured: journald 57MB + sshd + host nginx ~55MB + systemd core, with margin for extra sessions/cron |
| Docker/containerd daemon overhead | 500 MB | Directly measured: `dockerd` 129MB + `containerd` 80MB + 23× `containerd-shim-runc-v2` (~12MB each ≈ 276MB) = ~477MB measured; scales with container count |
| Host-native MariaDB + PHP-FPM (uthinachess.tn + notrejour.tn) | 300 MB | Directly measured: `mariadb.service` 129MB + `php8.5-fpm.service` 117MB = ~246MB measured, rounded up with margin |
| Filesystem cache soft floor | 300 MB | Not a hard reservation (buff/cache is kernel-reclaimable on demand) but a working target — squeezing this to near-zero causes I/O thrashing under load |
| Unexpected burst buffer | 700 MB | Slop factor for anything not itemized above (log spikes, ad-hoc admin processes, additional SSH sessions, cron jobs) |
| **TOTAL RESERVE** | **2000 MB (2.0 GB)** | |

*(Separately noted, not part of the formal reserve: the Xorg/lightdm desktop session measured at ~330MB is real but non-essential — a P3 reclaim candidate, not a "needed" reservation line, per the health audit.)*

### 11.4 Does 8832 MB provide adequate worst-case safety? — No, not against a full simultaneous-spike standard

```
Capacity available for container mem_limits, no-swap-reliance standard:
  7782 MB (RAM) − 2000 MB (reserve) = 5782 MB  ≈ 5.65 GB   ← PREFERRED CEILING

Capacity available for container mem_limits, swap-backed absolute standard:
  7782 MB (RAM) + 2048 MB (swap) − 2000 MB (reserve) = 7830 MB  ≈ 7.65 GB   ← HARD DANGER THRESHOLD
```

| | Scenario A (8832 MB) | Scenario B (6848 MB) |
|---|---|---|
| vs. Preferred ceiling (5782 MB) | **Exceeds by ~3050 MB (~3.0 GB)** | Exceeds by ~1066 MB (~1.0 GB) |
| vs. Hard danger threshold (7830 MB) | **Exceeds by ~1002 MB (~1.0 GB)** | Under, by ~982 MB margin |

**Conclusion**: if every capped container simultaneously hit its ceiling — an unlikely but not impossible event, since it doesn't require *all 23*, just a handful of the largest ones (e.g. both MySQL instances + Coolify + one Dar Hijama app tier under a coincident traffic surge) — Scenario A's current aggregate could still exceed RAM+swap combined and trigger a host-wide OOM-kill. This is a **real, quantified residual risk**, smaller than the pre-cap situation (where *any single* uncapped container could do this alone, as n8n did) but not zero. Scenario B is closer to safe but still exceeds the no-swap-reliance preferred ceiling.

**This does not block starting implementation** — see §11.8 on Step 1 specifically — but the full 22-container rollout should not be described as fully safe until a future revision trims the aggregate (the correct levers are the MySQL internal tuning already noted in §4/§6, and/or moderating the Coolify-core and app-tier margins), not by removing Dar Hijama Stack B, which remains explicitly out of scope for retirement.

### 11.5 Revised Safe Targets

| Target | Value | Meaning |
|---|---|---|
| **Preferred aggregate capped maximum** | **≈5.65 GB (5782 MB)** | Sum of all container `mem_limit`s should trend toward this to be safe even in a full simultaneous-spike scenario without relying on swap |
| **Minimum host reserve** | **2.0 GB (2000 MB)** | Never allocate this to any container; see breakdown in §11.3 |
| **Acceptable emergency swap use** | Near-zero in normal operation. Brief transient use up to ~500MB (25% of the 2GB swap) during a genuine burst is tolerable. Sustained use beyond ~1GB (50%) for more than a few minutes = warning condition requiring investigation, not normal operation |
| **Normal-operation target** | Total real usage (host-native + containers) ≤ **~3.5–4 GB** | Comfortable margin above the current observed ≈2.9GB, room to grow without approaching the danger zone |
| **Hard danger threshold** | Total real usage reaching **~6.5–7 GB (85–90% of physical RAM)** with rising swap | This is the zone the original n8n incident occurred in; should trigger immediate alerting if instrumented later |

### 11.6 Redis: Docker `mem_limit` vs. Redis `maxmemory` (re-verified directly, nothing applied)

Directly queried all 6 Dar Hijama Redis instances (`-cache`, `-queue`, `-session` × 2 stacks) via `redis-cli CONFIG GET`, authenticating with each container's own password env var (`REDIS_{CACHE,QUEUE,SESSION}_PASSWORD`) referenced symbolically inside the container shell — no password value was ever printed to any output or file.

**Findings (identical across all 6 instances):**
- `maxmemory = 0` (disabled — Redis itself has no internal ceiling)
- `maxmemory-policy = noeviction`
- Real dataset size: tiny (`DBSIZE` 0–12 keys, `used_memory` 1.1–1.3MB Redis-internal accounting; the 3.4–6MB seen in `docker stats` is mostly process/allocator baseline, not dataset size — `mem_fragmentation_ratio` 7–8× is expected/benign at this scale, not a red flag)

**The distinction that matters**: the proposed 64MB **Docker `mem_limit`** is a hard cgroup ceiling — if breached, the kernel SIGKILLs the `redis-server` process abruptly (data loss for anything not yet persisted, container then restarts per its `unless-stopped` policy). Redis's own **`maxmemory`** setting, if configured, is a soft, graceful, application-level ceiling: Redis manages it internally via eviction or write-rejection *before* the process would ever approach the Docker limit. **Currently, only the hard/ungraceful Docker-level backstop exists; the graceful Redis-level one is disabled.**

**Recommendation (not applied — planning only), role-specific:**
- **Cache** instance: safe to later configure `maxmemory ≈48MB` (leaving headroom under a 64MB Docker cap) with `allkeys-lru` or `allkeys-lfu` eviction — evicting least-used cache entries is a safe, self-healing degradation (cache miss, recompute), not a correctness bug.
- **Session** instance: eviction is riskier — evicting a live session key could log a user out or drop cart/session state. Keep `noeviction` (current) unless session keys are confirmed to always carry a TTL, in which case `volatile-lru` could be a reasonable middle ground — this needs an app-level review, not a unilateral change here.
- **Queue** instance: `noeviction` (current) is **correct and should not change** — silently evicting a pending job is data loss (a dropped job), not just a performance hit. The right protection here is capacity planning (the Docker limit + monitoring), not eviction.

The 64MB Docker `mem_limit` figure itself is not revised by this finding (it remains ~50× current real usage, generously safe on its own) — what changes is the recommendation to **not rely on the Docker limit as the only control layer**, since it's the only ungraceful one currently active.

### 11.7 `i4mv37ig6xavokv0kpy5517d` — Identity Confirmed

Directly inspected via `docker inspect` labels, environment variable names (values not printed where secret-shaped, e.g. `APP_KEY` was never read), image metadata, and `docker logs`:

- **Coolify labels**: `coolify.projectName=notrejour`, `coolify.applicationId=1`, `coolify.resourceName=notrejourmain-i4mv37ig6xavokv0kpy5517d`, `coolify.environmentName=production` (Coolify's own environment label — see caveat below).
- **Image/build**: Nixpacks-built (`NIXPACKS_*` env vars, `IS_LARAVEL=` present) — a Laravel application, built and deployed through Coolify's standard pipeline.
- **Runtime config**: `APP_ENV=local`, `DB_CONNECTION=sqlite`, `CACHE_STORE=file`, `SESSION_DRIVER=file`, `QUEUE_CONNECTION=sync` — this is a lightweight, single-file-backed configuration typical of a preview/demo deployment, not a scaled production setup.
- **Routing**: only reachable via Coolify's auto-generated URL `i4mv37ig6xavokv0kpy5517d.51.68.226.211.sslip.io` (`APP_URL`/`COOLIFY_FQDN`). **No nginx site or reverse-proxy rule anywhere on the host routes any real domain to this container.**
- **Decisive cross-check**: `/etc/nginx/sites-enabled/notrejour.tn` (the actual production domain implied by the project name) **is enabled**, but its `root` is `/var/www/notrejour/public` — a **host-native, PHP-FPM-served directory**, entirely separate from this container. Production `notrejour.tn` traffic does not touch this container at all.

**Conclusion**: `i4mv37ig6xavokv0kpy5517d` is a **Coolify-managed preview/staging deployment of the "Notre Jour" project** (a project already known from prior session context — see the repo's own history/memory of a PSR-4 casing-bug investigation on this codebase), despite its Coolify label saying `environmentName=production` (that label reflects Coolify's own environment-naming convention, not real production traffic — a useful reminder that Coolify's internal labels are not authoritative for "is this live," matching the same caution already applied to the Dar Hijama duplicate-stack question). **It carries no live traffic and is not production-critical.**

**Is the proposed 320MB cap justified?** Yes, and now more clearly so: current usage is 45MB, and even generously provisioning a non-production preview app at 320MB (≈7× headroom) costs little in the aggregate budget while fully containing it. Given its confirmed non-production status, its risk classification is revised from MEDIUM ("unknown role") to **LOW** in §4 and §10 above.

### 11.8 Scenario A Reaffirmed — No Retirement Assumed

Both Dar Hijama stacks remain treated as running for all figures in this plan and in this safety review. Coolify Application #3 (Stack B, `gi0p3...`) is **not** assumed retirable; no stop, restart, or deletion of any container was performed or is authorized by this review. Scenario B (§9 above) remains a documented comparison only, contingent on a future, separate, human Coolify-UI decision.

### 11.9 Is Step 1 Safe to Authorize?

**Yes.** The aggregate-ceiling concern in §11.4 is about the *cumulative* worst case of the full 22-container rollout (dominated by MySQL ×2 and Coolify core) — it is not a reason to withhold the smallest, lowest-risk group. Step 1 (both stacks' Redis ×6 + `coolify-redis` + `coolify-sentinel`, per §10) sums to only **576MB** of proposed limits against **~43MB** of current combined real usage. Even a full simultaneous spike of every Step 1 container to its cap would add ~533MB to the current ~2.9GB total usage — landing at ~3.43GB, still comfortably under the revised normal-operation target (~3.5–4GB) and far under the preferred aggregate ceiling. Step 1 does not need to wait for a full aggregate revision.

**Later steps are a different judgment call**: Step 5 (both MySQL, 1536MB combined) and Step 6 (Coolify core, 640MB) are exactly the items that push the cumulative aggregate past the preferred ceiling — those should be re-evaluated against a trimmed aggregate figure in a future revision before being authorized, rather than approved as a package with Step 1.

## 12. Step 1 Implementation (2026-08-10) — PARTIAL: Dar Hijama Stack A done, Coolify-managed items blocked

**No subagents used.** All mutations below were performed directly over `ssh mythos` by the primary session, following the phased sequence and stop conditions from the approved plan.

### 12.1 Outcome summary

| Target | Result |
|---|---|
| Dar Hijama Stack A: `redis-cache`, `redis-session`, `redis-queue` | **DONE** — 64MB/16MB applied persistently via the stack's own compose file |
| Dar Hijama Stack B (`gi0p3...`): `redis-cache`, `redis-session`, `redis-queue` | **BLOCKED** — see §12.4 |
| `coolify-redis` | **BLOCKED** — see §12.4 |
| `coolify-sentinel` | **BLOCKED** — see §12.4 |

### 12.2 Persistent configuration source used (Stack A)

- **Compose files**: `/home/deploy/deployments/darhijama-v1.0.1/docker-compose.production.yml` (top-level, `include:`s the file below) + `/home/deploy/deployments/darhijama-v1.0.1/docker-compose.staging.yml` (actual service definitions — this is the file edited) + `/home/deploy/deployments/darhijama-v1.0.1/ops-production/docker-compose.host.yml` (host port override, not touched).
- **Invocation** (confirmed from the stack's own `ops-production/ROLLBACK.md`): `docker compose --env-file .env.production -f docker-compose.production.yml -f ops-production/docker-compose.host.yml <cmd>`, run from `/home/deploy/deployments/darhijama-v1.0.1`.
- **Backup taken before any edit**: `/home/deploy/backups/darhijama-memcaps-step1-20260810/` containing `docker-compose.staging.yml.orig`, `docker-compose.production.yml.orig`, `docker-compose.host.yml.orig` — verified via `sha256sum` match against the live files before editing began.
- **Change applied**: added `mem_limit: 64m` and `mem_reservation: 16m` to exactly the `redis-cache`, `redis-session`, and `redis-queue` service blocks in `docker-compose.staging.yml`. No other service block was touched (`app`, `web`, `queue`, `scheduler`, `mysql`, `backup` are unmodified — confirmed by diffing against the backup).

### 12.3 Phases executed (Stack A)

| Phase | Action | Command | Result |
|---|---|---|---|
| 1 | `redis-cache` | `docker compose ... up -d --no-deps redis-cache` | Recreated. `Memory=67108864` (64MB exact), `MemoryReservation=16777216` (16MB exact), `Health=healthy`, `RestartCount=0`, `OOMKilled=false`. RDB reloaded (3 keys). PING → PONG. `darhijama.tn` → HTTP 200 (0.136s). |
| 2 | `redis-session` | `docker compose ... up -d --no-deps redis-session` | Same result: 64MB/16MB exact, healthy, PONG, `darhijama.tn` → 200 (0.121s). |
| 3 | `redis-queue` | `docker compose ... up -d --no-deps redis-queue` | Same result: 64MB/16MB exact, healthy, PONG. Confirmed the live queue worker (`dar-hijama-production-queue-1`, a dependent of `redis-queue` but explicitly out of scope and *not* recreated — `--no-deps` used precisely to prevent this) continued processing its heartbeat job normally through and after the `redis-queue` recreation, with no new errors in its logs. `darhijama.tn` → 200 (0.109s). |

No phase showed `OOMKilled`, a Redis error, an abnormal restart, an HTTP failure, or unexpected memory pressure — all three phases proceeded per the approved sequence with no rollback needed.

### 12.4 Blocker — Stack B Redis, `coolify-redis`, `coolify-sentinel` (Phases 4–6)

Per the plan's explicit stop condition ("If a safe persistent Coolify-native memory-limit method cannot be identified, STOP at that point and report blocker" / "Do not use temporary `docker update` as the final implementation" / "Do NOT continue past the first real blocker"), the following was investigated **read-only, nothing was written**:

1. **Stack B's live compose source** (`/artifacts/da5j1i55i59zfw62g9qh2r38/docker-compose.staging.yml`, per its container labels) **does not exist on the host filesystem** accessible to the `deploy` account — confirmed via `ls`. This path is internal to Coolify's own deployment tooling (almost certainly generated fresh inside/via the `coolify` container on every deploy). Editing it, even if reachable via `docker exec coolify`, would match exactly the plan's own warning: "DO NOT blindly edit generated files under `/artifacts` if Coolify will overwrite them" — any edit would very likely be silently discarded on the next Coolify deploy/redeploy/webhook trigger.
2. **Coolify's own infrastructure compose source** (`/data/coolify/source/docker-compose.yml` + `docker-compose.prod.yml`, which does define `coolify-redis` and would be the correct persistent location for it) **exists on the host but is not readable by the `deploy` account** (`Permission denied` on `ls`/`cat`). `sudo -n true` confirmed **no passwordless sudo is available** to `deploy`, and no sudo was used or requested, per the no-privilege-escalation constraint already established in this project ([[project-mythos-workflow]] memory). This is a genuine access blocker, not a design gap.
3. **`coolify-sentinel` has no `docker-compose` labels at all** (confirmed via `docker inspect`) — it is not managed by any compose project found. No persistent recreation source was located for it within accessible paths.
4. **Investigated Coolify's own database as a possible persistent, Coolify-native mechanism** (read-only: `\d applications` and `\dt` against `coolify-db` via `psql`, authenticated with the container's own `$POSTGRES_USER`/`$POSTGRES_PASSWORD` env vars, values never printed; **no `SELECT`, `UPDATE`, or `INSERT` was executed against actual data, only schema inspection**). Confirmed the `applications` table does have `limits_memory` / `limits_memory_reservation` / `limits_cpus` columns — Coolify's real, documented mechanism for setting resource limits. **However**, this column applies at **whole-application granularity**: Stack B (`coolify.applicationId=3`, `coolify.type=application`) is a single multi-service Docker-Compose-based "Application" resource in Coolify's model, meaning one `limits_memory` value would apply uniformly to *all* of its services (`app`, `web`, `queue`, `scheduler`, `mysql`, and the three redis instances) if set this way — not just the three Redis containers this stage is scoped to. Using it as-is would either put a 64MB cap on the stack's MySQL/app/web containers too (immediately breaking them — MySQL alone already uses ~450MB) or require a value large enough for MySQL that would defeat the purpose of a tight Redis-specific cap. **This is exactly the "would require guessing" scenario the plan's stop condition anticipated** — Coolify may support a more granular per-service override through its UI (Application → Advanced settings, or a raw Docker Compose override field), but confirming that requires Coolify UI/API access this session does not have, and guessing at an UPDATE against production application configuration state without confirming the correct mechanism was judged too risky to attempt.

**Conclusion**: Phases 4–6 are blocked by a combination of (a) confirmed-ephemeral generated state for Stack B, (b) a confirmed-inaccessible-without-sudo persistent file for `coolify-redis`, (c) no located persistent source at all for `coolify-sentinel`, and (d) a Coolify-native DB mechanism that exists but operates at the wrong granularity for this stage's per-service scope. **No mutation was attempted or performed against Stack B, `coolify-redis`, `coolify-sentinel`, or Coolify's database.**

### 12.5 Pre/Post Host State

```
                  BEFORE                          AFTER
Mem used          2.9Gi                           2.9Gi
Mem available     4.6Gi                            4.7Gi
Swap used         60Ki                             52Ki
```

No measurable host-level change — expected, given the three capped containers were already using only ~3.6MB each (well under their new 64MB caps) before this change; the caps are a ceiling, not a reservation that consumes memory up front. Kernel OOM check (`journalctl -k --since '1 hour ago' | grep -i oom`) returned **zero matches** — no new host OOM events during or after implementation.

### 12.6 Rollback status

**Not needed — no phase failed.** Documented here for completeness per the plan's requirement to record the rollback procedure before every mutation:

```bash
# To revert Stack A redis-cache/-session/-queue to uncapped (if ever needed):
cd /home/deploy/deployments/darhijama-v1.0.1
cp /home/deploy/backups/darhijama-memcaps-step1-20260810/docker-compose.staging.yml.orig docker-compose.staging.yml
docker compose --env-file .env.production -f docker-compose.production.yml -f ops-production/docker-compose.host.yml up -d --no-deps redis-cache redis-session redis-queue
```
This was prepared before Phase 1 began and was not executed.

### 12.7 Next recommended stage

1. Obtain Coolify UI or API access (not available this session) to determine whether Coolify supports a per-service resource-limit override for Docker-Compose-based "Application" resources; if yes, use it to apply the same 64MB/16MB caps to Stack B's three Redis containers.
2. Separately, obtain either sudo/root access or an explicitly-authorized alternate path to edit `/data/coolify/source/docker-compose.prod.yml` (or Coolify's own supported upgrade-safe customization mechanism, if one exists) for `coolify-redis`.
3. Identify how `coolify-sentinel` is created/recreated (likely Coolify's own installer/upgrade script) before attempting any persistent limit on it.
4. Once Phases 4–6 have a confirmed persistent mechanism, re-run this same phased, verify-after-each-step process for them.
5. Steps 2–6 of the original plan's implementation sequence (app/queue/web/scheduler containers, both MySQL, Coolify core) remain unauthorized and untouched, per scope.

## 13. Coolify Resource-Limit Mechanism Discovery (2026-08-10) — Read-Only

**No subagents used. Read-only only. No production mutation, no Coolify DB write.** Dar Hijama Stack A was not touched (its 3 Redis caps remained 64MB/16MB throughout, reconfirmed at the end — see §13.6).

Investigated directly by reading Coolify 4.1.2's own PHP source code from inside the `coolify` container (`docker exec coolify sh -c 'cat/grep ...'`, read-only filesystem access as the container's own `www-data` user — no host file was written, no `docker exec` command mutated anything), plus two narrowly-scoped, non-sensitive, read-only SQL `SELECT`s against `coolify-db` (identifier columns only — `id`, `uuid`, `name`, `build_pack`, `environment_id`, `project_id` — no environment variables, no secrets/tokens/passwords tables were queried).

### 13.1 Target 1-3: Stack B `redis-cache` / `redis-session` / `redis-queue` — **UNSUPPORTED** (for the `limits_memory` mechanism), but a working alternative exists — **MANUAL_UI_ACTION_REQUIRED**

**Confirmed, not guessed, via source code (file:line references below):**

- Coolify's `Application` model has `limits_memory`, `limits_memory_reservation`, `limits_cpus`, etc. (confirmed columns on the `applications` Postgres table, and confirmed `PATCH /api/v1/applications/{uuid}` accepts them — `app/Http/Controllers/Api/ApplicationsController.php:2367` `$allowedFields` array).
- **However**, these fields are only ever injected into a generated compose file inside `ApplicationDeploymentJob::generate_compose_file()` (`app/Jobs/ApplicationDeploymentJob.php:3091`, injection at lines 3151-3154: `'mem_limit' => $this->application->limits_memory, ...`). This function builds a **single-service** compose block keyed by `$this->container_name` — it is the path used for Coolify-generated deployments (Dockerfile/Nixpacks/static buildpacks), where Coolify builds one image and runs one container.
- For `build_pack = 'dockercompose'` (confirmed via read-only SQL: `applications.id=3` has `build_pack='dockercompose'`), deployment instead goes through `ApplicationDeploymentJob::deploy_docker_compose_buildpack()` (line 607). This function was read in full (lines 607-900): it base64-decodes `$this->application->docker_compose_raw` (the literal, user-authored compose YAML) and writes it to disk verbatim, then runs a plain `docker compose ... up -d`. **It contains zero references to `limits_memory`, `mem_limit`, or any resource field.**
- **Conclusion**: for `dockercompose`-buildpack applications, `limits_memory` (and its API field / DB column / UI form) is read and stored, but **is never applied at deploy time** — setting it via the API would be a **silent no-op**, not a working mechanism. This is also not per-service even in the applications where it *does* work — it is exactly one value applied to exactly one Coolify-generated service. Confirming this in code prevented what would otherwise have been a plausible-looking but non-functional API call.

**However, a genuinely working, persistent path exists**: `app/Livewire/Project/Application/General.php` (lines 326, 375, 427, 503, 517) binds a `dockerComposeRaw` UI property directly to `$application->docker_compose_raw` — **the exact field `deploy_docker_compose_buildpack()` deploys verbatim**. Coolify's Application "Configuration" page includes a raw Docker Compose editor for `dockercompose`-buildpack apps. Adding `mem_limit: 64m` / `mem_reservation: 16m` to the three redis service blocks there, saving, and redeploying **would** take effect, because it edits the actual source the deploy job writes to disk — unlike the no-op `limits_memory` field.

**Exact UI path** (identifiers obtained via read-only SQL `SELECT id, uuid, name, build_pack, environment_id FROM applications WHERE id=3` and equivalent for `environments`/`projects` — no data beyond these identifier columns was read):
```
https://panel.mythosprod.xyz/project/nae2pn7zo9rq948iwoypjftc/environment/k5emgirp95bhkrhums6ozjxs/application/gi0p3mbss6geqhunih23fy6f/
```
(Project "darhijama" → Environment "production" → Application "dar-hijama" [this is Stack B / Coolify application id 3] → Configuration/General tab → Docker Compose raw content editor.)

**Future mutation procedure (not executed):**
1. Navigate to the URL above.
2. Locate the raw Docker Compose editor section (populated from `docker_compose_raw`).
3. Add `mem_limit: 64m` and `mem_reservation: 16m` to the `redis-cache`, `redis-session`, `redis-queue` service blocks only — same values already applied to Stack A, same scope restriction (do not touch `app`/`web`/`queue`/`scheduler`/`mysql` blocks).
4. Save.
5. Trigger a redeploy (Coolify UI "Redeploy" button, or API `POST /api/v1/applications/gi0p3mbss6geqhunih23fy6f/start`).
6. Verify via the same phased process used for Stack A: `docker inspect` for exact `Memory`/`MemoryReservation` bytes, `RestartCount=0`, `OOMKilled=false`, Redis `PING`, and confirm no other Stack B service (`app`/`web`/`queue`/`scheduler`/`mysql`) was affected — a full Coolify redeploy recreates *all* of the application's containers at once (unlike the `--no-deps` single-service control we had for Stack A's manual compose), so this step carries more blast radius and should be scheduled as its own reviewed, explicitly-authorized stage, not assumed safe merely because the compose edit itself is scoped to 3 services.

**Rollback procedure (not executed, documented for the future stage):** in the same raw compose editor, remove the three `mem_limit`/`mem_reservation` lines (or restore from Coolify's own deployment history / "Rollback" tab, which Coolify tracks natively for compose content changes), save, redeploy.

**Classification: MANUAL_UI_ACTION_REQUIRED** (the automatic/API `limits_memory` route is UNSUPPORTED for this build_pack; the raw-compose-editor route is supported but requires a human in the UI, or a separate authorized API call to `PATCH .../envs`-adjacent endpoints was not found for `docker_compose_raw` itself in the `update_by_uuid` `$allowedFields` list — **`docker_compose_raw` is notably absent from `update_by_uuid`'s allowed fields**, meaning the API does **not** support editing it either; only the UI form (`General.php`) can set it, confirmed by its absence from the API controller's field allowlist).

### 13.2 Target 4: `coolify-redis` — **PERSISTENT_METHOD_CONFIRMED (location), execution BLOCKED (no root)**

- **Authoritative persistent source**: `/data/coolify/source/docker-compose.yml` + `/data/coolify/source/docker-compose.prod.yml` (confirmed via `docker inspect coolify-redis` compose labels: `com.docker.compose.project=source`). This is Coolify's own self-hosted infrastructure stack (distinct entirely from the `Application`/`limits_memory` model above — `coolify-redis` is platform infrastructure, not a user-manageable Coolify "resource").
- **Access check**: `ls`/`cat` on `/data/coolify/source/` returns `Permission denied` for the `deploy` account (confirmed, unchanged from the prior Step 1 investigation). `sudo -n true` confirmed **no passwordless sudo** — none was used or requested, per this project's standing no-privilege-escalation rule.
- **Upgrade-safety check**: Coolify's self-update path (`app/Actions/Server/UpdateCoolify.php:123-124`) downloads a fresh `upgrade.sh` from Coolify's CDN and executes it on every self-upgrade. That external script's exact content (whether it re-fetches `docker-compose.prod.yml` and would overwrite a manual edit, or preserves a documented custom-override file) **was not fetched or inspected** — doing so would require an external network request to Coolify's CDN, which this read-only, VPS-internal investigation did not attempt. This is recorded as **unconfirmed**, not assumed either way.
- **Conclusion**: the mechanism (edit the `redis:` service block in `docker-compose.prod.yml`, then `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps redis` from `/data/coolify/source`) is the same *kind* of solution that worked for Stack A, and is almost certainly correct — but is currently **blocked on two independent unknowns**: (a) no root/sudo access to read or write the file, and (b) unconfirmed whether a manual edit survives Coolify's next self-upgrade.

**Future mutation procedure (not executed, requires root — not used in this session):**
```bash
# Requires root/sudo, NOT available or used in this investigation:
cp -p /data/coolify/source/docker-compose.prod.yml /data/coolify/source/docker-compose.prod.yml.bak-$(date +%Y%m%d)
# edit the `redis:` service block to add: mem_limit: 96m / mem_reservation: 24m
cd /data/coolify/source && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps redis
```
**Rollback**: restore the `.bak` file and re-run the same `up -d --no-deps redis` command.

### 13.3 Target 5: `coolify-sentinel` — **UNSUPPORTED**

- **Authoritative creation source, confirmed via source code**: `app/Actions/Server/StartSentinel.php`, in full. It is **not** managed by docker-compose at all (confirmed absence of any compose labels on the running container, consistent with this). It is created by Coolify's PHP backend constructing and executing a raw shell command over SSH to the server (`instant_remote_process`):
  ```
  docker run -d -e TOKEN=... -e DEBUG=... -e PUSH_ENDPOINT=... ... --name coolify-sentinel \
    -v /var/run/docker.sock:/var/run/docker.sock -v /data/coolify/sentinel:/app/db --pid host \
    --health-cmd "..." --add-host=host.docker.internal:host-gateway --label coolify.managed=true \
    coollabsio/sentinel:<version>
  ```
  preceded by `docker rm -f coolify-sentinel || true`.
- **This hardcoded command contains no `--memory` or `--memory-reservation` flag, and the `StartSentinel` action exposes no parameter for one.** No `ServerSetting` field, UI form, or API endpoint controls Sentinel's resource limits — confirmed by reading the full action and cross-checking `ServerSetting`/`InstanceSettings` models for anything resource-limit-shaped related to Sentinel (only metrics history/refresh-rate/push-interval/debug settings exist).
- **Any manually-applied `docker update coolify-sentinel --memory=...` would be silently discarded** the next time Coolify restarts Sentinel (a user-triggered "Restart Sentinel" action, or an automatic recreation after a Coolify version upgrade) — the action always does `docker rm -f` + a fresh `docker run` from this exact hardcoded command, with no memory flags, every time.
- **Conclusion**: there is no supported persistent mechanism — Coolify 4.1.2 simply does not offer one for this specific container. Given its small real footprint (8.5-9MB observed, per the original audit and this session's re-check), this is a low-priority gap rather than an active risk.

### 13.4 API/UI Summary

| Target | Endpoint/path | Method | Per-service? | Verdict |
|---|---|---|---|---|
| Stack B Redis ×3 (via `limits_memory`) | `PATCH /api/v1/applications/{uuid}` | PATCH | No (whole-app) and also a no-op for `dockercompose` build_pack | UNSUPPORTED |
| Stack B Redis ×3 (via raw compose edit) | UI only — `docker_compose_raw` is absent from the API's `update_by_uuid` allowed-fields list | UI form save + redeploy | Yes (edit exactly the 3 service blocks in the YAML) | MANUAL_UI_ACTION_REQUIRED |
| `coolify-redis` | none (platform infra, not an "Application"/"Database" resource) | host file edit | N/A (single service) | PERSISTENT_METHOD_CONFIRMED, execution BLOCKED (no root) |
| `coolify-sentinel` | none found anywhere in the codebase | N/A | N/A | UNSUPPORTED |

No mutation endpoint was invoked for any target. No Coolify DB row was written.

### 13.5 Whether remaining Step 1 can now be authorized

**Not yet, for any of the 5 remaining targets**, but the picture is now much clearer than "BLOCKED_UNKNOWN":
- Stack B Redis ×3: a real, working mechanism now exists (raw compose edit + redeploy) — but redeploying a Coolify `dockercompose` application recreates *all* of its services at once, not just the 3 redis containers, which is a materially different blast radius than Stack A's `--no-deps` single-service control. This should be scoped and authorized as its own explicit stage, with its own phased verification plan (analogous to, but not identical to, Phases 1-3 already completed for Stack A), rather than folded into "the same Step 1."
- `coolify-redis`: mechanism confirmed, but requires root access this project does not grant to the working account; needs an explicit decision from the user on whether to grant temporary sudo, do it manually themselves, or accept this container stays uncapped.
- `coolify-sentinel`: no mechanism exists in this Coolify version; would require either a Coolify feature request/upgrade, or an unsupported manual `docker update` that would not survive a Sentinel restart (not recommended as a "final implementation" per the original Step 1 task's own explicit rule).

### 13.6 Safety Re-Verification

Performed before and after this investigation:
- All 23 containers present, identical container-ID/name fingerprint before and after (`docker ps -a` hash unchanged).
- Stack A's three Redis caps unchanged: `Memory=67108864`, `MemoryReservation=16777216`, `RestartCount=0` on all three.
- `n8n-n8n-1`: `Memory=3221225472` (unchanged), `RestartCount=0`.
- `darhijama.tn` → HTTP 200. Coolify panel → HTTP 302 (expected unauthenticated redirect).
- `journalctl -k --since` covering the investigation window: **zero** OOM matches.

### 13.7 `coolify-redis` — Final Read-Only Confirmation (2026-08-10, root access via `sudo -n`)

**Session context:** this follow-up investigation ran with `sudo -n` (passwordless root) available for system/Docker inspection and `sudo -u deploy -H bash -lc '...'` for all Git operations — resolving the root-access gap recorded in §13.2. Still fully read-only: no file was edited, no command mutated Docker or Coolify state.

**`docker-compose.yml` `redis` service (base file, read via `sudo -n cat`):**
```yaml
redis:
    image: redis:7-alpine
    container_name: coolify-redis
    restart: always
    networks:
        - coolify
```

**`docker-compose.prod.yml` `redis` service (override file, read via `sudo -n cat`):**
```yaml
redis:
    command: redis-server --save 20 1 --loglevel warning --requirepass ${REDIS_PASSWORD}
    environment:
      REDIS_PASSWORD: "${REDIS_PASSWORD}"
    volumes:
      - coolify-redis:/data
    healthcheck:
      test: redis-cli ping
      interval: 5s
      retries: 10
      timeout: 2s
```
No `mem_limit`/`mem_reservation`/`deploy.resources` field is present anywhere in either file for `redis` (or any other service) — confirms the container is currently fully uncapped, as expected. `coolify-redis` currently shows `Memory=0`, `MemoryReservation=0` via `docker inspect` (re-confirmed live in this session).

**Upgrade-persistence question — now resolved (previously "unconfirmed" in §13.2):**

Read `/data/coolify/source/upgrade.sh` directly (an already-installed local file — no external CDN fetch performed, consistent with the read-only/no-external-script constraint):

- Lines 59-62: on every self-upgrade, the script unconditionally downloads and **overwrites** both `docker-compose.yml` and `docker-compose.prod.yml` from Coolify's CDN:
  ```bash
  curl -fsSL -L $CDN/docker-compose.yml -o /data/coolify/source/docker-compose.yml
  curl -fsSL -L $CDN/docker-compose.prod.yml -o /data/coolify/source/docker-compose.prod.yml
  ```
  **A manual edit to either file is unconditionally destroyed on the next Coolify self-update.** This resolves the prior "unconfirmed" status to **CONFIRMED OVERWRITTEN**.
- Lines 76-78 and 278-280 (image-extraction step and the actual upgrade deploy step) both check for an optional `docker-compose.custom.yml` and, if present, append it to the compose file list:
  ```bash
  if [ -f /data/coolify/source/docker-compose.custom.yml ]; then
      log "Using custom docker-compose.yml"
      COMPOSE_FILES="$COMPOSE_FILES -f /data/coolify/source/docker-compose.custom.yml"
  fi
  ```
  **`upgrade.sh` never downloads, writes, or otherwise touches `docker-compose.custom.yml` anywhere in the script** — it only tests for its existence. This is a genuine, Coolify-supported override mechanism that survives self-upgrades.
- Confirmed via `sudo -n test -f`: `docker-compose.custom.yml` and `docker-compose.postgres-upgrade.yml` **do not currently exist** on this host — the override point exists but is unused.
- The actual upgrade deploy step (lines 256-286) stops/removes **all four** Coolify infra containers (`coolify`, `coolify-db`, `coolify-redis`, `coolify-realtime`) together, then brings the whole stack back up via a helper container running `docker compose ... up -d --remove-orphans --wait`. This is the *upgrade* flow only — irrelevant to a targeted single-service limit change, which would use a direct `docker compose ... up -d --no-deps redis` from the host instead (see below), not this helper-container path.

**Answers to the four specific questions posed:**
| Question | Answer |
|---|---|
| Does a manual change to `docker-compose.prod.yml` survive a normal Coolify self-update? | **NO — CONFIRMED OVERWRITTEN** (unconditional `curl -o` on every upgrade) |
| Is `docker-compose.prod.yml` regenerated/downloaded/overwritten? | **YES**, every upgrade, unconditionally, no diff/merge check |
| Does Coolify provide a supported override/custom compose mechanism? | **YES** — `docker-compose.custom.yml`, auto-included via `-f` if present, never touched by `upgrade.sh` |
| Is there a safer persistent method than editing the vendor-managed compose file? | **YES** — create `docker-compose.custom.yml` with only the `redis:` service's resource-limit fields, instead of editing `docker-compose.prod.yml` in place |

**Future mutation procedure (not executed) — revised and now preferred over the §13.2 draft:**
```bash
# Requires root (sudo -n), NOT executed in this investigation:
sudo -n tee /data/coolify/source/docker-compose.custom.yml > /dev/null <<'EOF'
services:
  redis:
    mem_limit: 96m
    mem_reservation: 24m
EOF
cd /data/coolify/source && sudo -n docker compose --env-file /data/coolify/source/.env \
  -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.custom.yml \
  up -d --no-deps redis
```
**Rollback procedure (not executed):**
```bash
sudo -n rm /data/coolify/source/docker-compose.custom.yml
cd /data/coolify/source && sudo -n docker compose --env-file /data/coolify/source/.env \
  -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --no-deps redis
```
**Expected blast radius:** `--no-deps redis` targets exactly one service; `docker compose up` only recreates a container whose effective config changed, so only `coolify-redis` is expected to be stopped/recreated — `coolify`, `coolify-db`, and `coolify-realtime` are not listed as targets and are not dependents of `redis` (dependency direction is `coolify → redis`, not `redis → coolify`), so they should not be touched. This is a smaller, single-service blast radius, analogous to the Stack A Redis pattern already executed successfully — **not** the whole-stack blast radius of the `upgrade.sh` flow. Not verified by an actual dry run in this read-only session.
**Safe to authorize:** the mechanism is now understood well enough to be **SAFE TO AUTHORIZE as its own explicitly-approved mutation stage** (with backup of the pre-existing `docker-compose.custom.yml` state — currently "does not exist" — and full pre/post `docker inspect` + `redis-cli PING` + all-four-infra-container health verification, per the project's standing pattern), but was **not executed** in this investigation per its explicit read-only scope.

**Live safety re-verification (this session, root-enabled):**
- `coolify-redis`: `State=running`, `Restarting=false`, `OOMKilled=false`, `RestartCount=0`, `Memory=0`/`MemoryReservation=0` (unchanged/uncapped, as expected).
- Stack A's three Redis containers: `Memory=67108864`/`MemoryReservation=16777216`/`RestartCount=0`/`OOMKilled=false` — all three unchanged.
- `n8n-n8n-1`: `State=running`, `Memory=3221225472`, `RestartCount=0` — unchanged.
- `darhijama.tn` → 200, `uthinachess.tn` → 200, `notrejour.tn` → 200, Coolify panel (`panel.mythosprod.xyz`) → 302 (expected unauthenticated redirect).
- `journalctl -k --since "-2 hours"`: zero OOM matches.
- Container count observed as 24 (vs. 23 in prior audits) — noted but not investigated further; out of scope for this task, recorded here for a future session to check.
- `/data/coolify/source/.env` exists but was **not read** — the shell attempted a `cat` and it was blocked by the local permission classifier (consistent with this file holding `DB_PASSWORD`/`REDIS_PASSWORD`/etc.); not needed for this investigation's conclusions, and not retried.

**Files changed by this sub-investigation:** none. No file was edited on the VPS; only `docs/audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md` (this section) and `docs/AI_HANDOVER.md` changed, both in this Git repository.

## 14. `coolify-redis` Memory Cap — Implementation (2026-08-10)

**Type:** Production implementation (mutation). Executed the mechanism confirmed read-only in §13.7. `mem_limit=96m` / `mem_reservation=24m` applied to `coolify-redis` only, via the Coolify-supported `docker-compose.custom.yml` override.

**No subagents used.** `sudo -n` for all system/Docker/root operations, `sudo -u deploy -H bash -lc '...'` for all Git operations.

**Repository baseline verified:** `origin/main` HEAD confirmed as `bfe0ec395cafaac2a162ffa031598741b1e2e23d` before this stage began (matches the SHA specified in the task).

### 14.1 24th container — resolved before mutation

`jellyfin` (`jellyfin/jellyfin:latest`, created `2026-08-10T12:38:31Z`) is the 24th container, distinct from all 23 previously-documented Mythos/Coolify/Dar Hijama containers. **User-confirmed as an intentional, authorized, unrelated deployment** — the user's personal media server, not part of the Mythos stack. Recorded here as an expected additional VPS service:

| Field | Value |
|---|---|
| Container | `jellyfin` |
| Image | `jellyfin/jellyfin:latest` |
| Memory limit | `2GiB` (pre-existing, set by whoever deployed it — not touched by this stage) |
| Network binding | `127.0.0.1:8096` (localhost-only, no public exposure) |
| Authorized | YES (user-confirmed) |
| Relationship to Mythos | None — unrelated to Mythos/Coolify/Dar Hijama |

Not modified, restarted, removed, or reconfigured at any point in this stage, per explicit instruction.

### 14.2 Pre-mutation memory/swap check

```
free -h (before):           total 7.6Gi / used 4.6Gi / free 151Mi / available 2.9Gi
                             Swap: total 2.0Gi / used 2.0Gi / free 4.0Ki
vmstat 1 5 si/so (KB/s):     8/26, 20/0, 4/0, 0/0, 0/0  — low, not sustained
```
Available RAM (2.9Gi) was above the 1.5GiB stop threshold; swap in/out activity was low and not sustained (dropped to 0/0 across 4 of 5 samples). Per the explicit pre-authorized rule ("high allocated swap alone is not a blocker if available RAM remains healthy, no sustained active swap-in/swap-out, no new OOM events"), this did not block the mutation. Recorded, not remediated — no `swapoff`, swap clear, reboot, or swappiness change was performed or considered.

### 14.3 Baselines (pre-mutation)

- `coolify-redis`: ID `a97937581d8f...`, `running`/`healthy`, `RestartCount=0`, `OOMKilled=false`, `Memory=0`, `MemoryReservation=0` (uncapped), `docker exec ... redis-cli -a "$REDIS_PASSWORD" ping` → `PONG` (password read from the container's own env var, never printed).
- Unrelated Coolify containers (for later ID comparison): `coolify` `f86e890512ee...`, `coolify-db` `48e4d7fb36b8...`, `coolify-realtime` `e2edfc0a6093...`.
- Stack A Redis ×3: `Memory=67108864`/`MemoryReservation=16777216`/`RestartCount=0` on all three (unchanged from prior stages).
- Protected domains: `panel.mythosprod.xyz` 302, `darhijama.tn` 200, `uthinachess.tn` 200, `notrejour.tn` 200, `n8n.ssangyong.autos` 200.
- `docker-compose.custom.yml`: confirmed **absent** before mutation.

### 14.4 Backup

Created `/home/deploy/backups/coolify-redis-memcap-20260810/` (root-owned, `chmod 700`, files `chmod 600`/`644` as appropriate, no secrets):
- `vendor-checksums-before.sha256` / `vendor-checksums-after.sha256` — SHA-256 of `docker-compose.yml`, `docker-compose.prod.yml`, `upgrade.sh`, identical before and after (see §14.6).
- `custom-yml-absent-marker.txt` — explicit timestamped marker that `docker-compose.custom.yml` did not exist before this stage.
- `coolify-redis-summary-before.txt` / `coolify-redis-summary-after.txt` — plain-text `docker inspect --format` summaries (ID/state/health/restart count/OOM/memory fields only).
- `docker-compose.custom.yml.applied` — copy of the exact file created.

**Self-caught and remediated secret exposure:** the first backup attempt captured full `docker inspect coolify-redis` JSON output, which includes `.Config.Env` — this contained the live `REDIS_PASSWORD` value in plaintext, written to a file under a then-world-readable directory. This was caught immediately (before any commit or further exposure), the file was deleted, the backup directory was locked to `700 root:root`, and a redacted JSON (with `.Config.Env` and `.NetworkSettings` stripped via a `python3 -c` filter) was written in its place. Verified via `grep -iE "password|secret|token"` on the redacted file: zero matches. No secret was committed to Git or exposed outside this root-only VPS backup directory at any point.

### 14.5 Implementation

Created `/data/coolify/source/docker-compose.custom.yml` (root-owned, `chmod 600`):
```yaml
services:
  redis:
    mem_limit: 96m
    mem_reservation: 24m
```

Validated via `docker compose --env-file .../.env -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.custom.yml config --no-interpolate` before applying: confirmed `mem_limit: 96m` / `mem_reservation: 24m` resolved correctly on `redis`, and that `image` (`redis:7-alpine`), `command` (unchanged, shown un-interpolated as `${REDIS_PASSWORD}`), `volumes` (`coolify-redis:/data`), `healthcheck`, `restart: always`, and `networks` were all identical to baseline. Confirmed no `mem_limit`/`mem_reservation`/any resource field appeared on `coolify`, `postgres`, or `soketi` — the custom file affected `redis` only.

Applied:
```bash
docker compose --env-file /data/coolify/source/.env \
  -f /data/coolify/source/docker-compose.yml \
  -f /data/coolify/source/docker-compose.prod.yml \
  -f /data/coolify/source/docker-compose.custom.yml \
  up -d --no-deps redis
```
Result: `Container coolify-redis Recreate → Recreated → Starting → Started`.

### 14.6 Post-mutation verification

- `coolify-redis`: new ID `b55ea2d64445...` (recreation expected — resource config changed), `running`/`healthy`, `RestartCount=0`, `OOMKilled=false`, `Memory=100663296` (= 96MB exactly), `MemoryReservation=25165824` (= 24MB exactly). `redis-cli ping` → `PONG`. `docker stats`: `5.082MiB / 96MiB`, `0.68%` CPU — normal. `docker logs --tail 30`: only the standard Redis `vm.overcommit_memory` startup advisory (present on every Redis container regardless of Docker memory limits, unrelated to this change) — no errors.
- Unrelated Coolify containers: `coolify` `f86e890512ee...`, `coolify-db` `48e4d7fb36b8...`, `coolify-realtime` `e2edfc0a6093...` — **all three IDs identical to baseline**, `RestartCount=0` — confirmed not recreated.
- `jellyfin`: ID `04ef7f2cb78f...`, `running`, `RestartCount=0` — confirmed untouched.
- Stack A Redis ×3: `Memory=67108864`/`MemoryReservation=16777216`/`RestartCount=0` on all three — unchanged.
- Protected domains post-mutation: `panel.mythosprod.xyz` 302, `darhijama.tn` 200, `uthinachess.tn` 200, `notrejour.tn` 200, `n8n.ssangyong.autos` 200.
- Host: `free -h` after — `total 7.6Gi / used 4.3Gi / free 459Mi / available 3.2Gi`, `Swap: total 2.0Gi / used 2.0Gi / free 8.7Mi`. `journalctl -k --since "-10 minutes"`: zero OOM matches.
- Upgrade-persistence re-confirmation: `docker-compose.custom.yml` still present post-mutation; `sha256sum` of `docker-compose.yml`/`docker-compose.prod.yml`/`upgrade.sh` **identical before and after** (vendor files untouched); `grep` re-confirmed `upgrade.sh` lines 76-78/278-280 still reference and would include `docker-compose.custom.yml` on a future upgrade.

**Rollback status: NOT NEEDED.** All validation passed; no rollback was executed. Rollback procedure remains documented in §13.7 if ever required: remove `docker-compose.custom.yml`, re-run `up -d --no-deps redis` without the `-f docker-compose.custom.yml` flag.

**Result:** `coolify-redis` is now the 4th Redis instance capped in this project (after Stack A's three), using a genuinely upgrade-safe, Coolify-supported override mechanism. Remaining Step 1 targets: Stack B's three Redis containers (`MANUAL_UI_ACTION_REQUIRED`, unchanged from §13.1) and `coolify-sentinel` (`UNSUPPORTED`, unchanged from §13.3) — both still require separate, explicitly-authorized stages before any further Step 1 progress.

## Validation

- `git diff --check`: to be run before commit (see final response).
- Only `docs/audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md` and `docs/AI_HANDOVER.md` are intended to change in this repository. Outside this repository, exactly three files changed on the VPS as authorized: `/home/deploy/deployments/darhijama-v1.0.1/docker-compose.staging.yml` (edited, backed up first) — no other file was modified.
- No credentials, secrets, or IPs were introduced. MySQL was queried using the container's own `$MYSQL_ROOT_PASSWORD` env var referenced symbolically inside `docker exec`; the six Redis instances were queried/authenticated the same way using `$REDIS_{CACHE,QUEUE,SESSION}_PASSWORD`; Coolify's Postgres was queried read-only using `$POSTGRES_USER`/`$POSTGRES_PASSWORD` — no password value was ever echoed to output or written to any file.
- Production mutation in this session: **limited to exactly the authorized Step 1 scope** — `mem_limit`/`mem_reservation` set on `dar-hijama-production-redis-cache-1`, `-redis-session-1`, `-redis-queue-1` only, via their own persistent compose file. No restart policy, no Redis `maxmemory`/eviction/persistence/password/ACL/database change, no other container, no DNS/nginx/firewall change. Everything else (including the prior plan/safety-review stages) remained read-only.
- Container IDs before/after the Step 1 implementation were compared: the three capped Redis containers show new IDs (expected — `docker compose up` recreates a container when its resource config changes) with `RestartCount=0` and `OOMKilled=false` each; all 20 other containers are unchanged, including the two Dar Hijama queue containers' own pre-existing hourly self-recycling (`--max-time=3600`, unrelated to this change).
- The 2026-08-10 Coolify mechanism-discovery investigation (§13) performed **zero mutations**: all Coolify source-code reads were via `docker exec coolify cat/grep` (read-only filesystem access inside Coolify's own container, nothing on the host was written), and the two Postgres queries against `coolify-db` were narrowly-scoped read-only `SELECT`s of non-sensitive identifier columns (`id`, `uuid`, `name`, `build_pack`, `environment_id`, `project_id`) — no environment-variable, secret, or credential table was queried, and no `UPDATE`/`INSERT`/`DELETE` was executed. Container-fingerprint and health checks before/after this investigation are identical to before it began (§13.6).
- No subagents were used at any point across the original plan, the safety review, the Step 1 implementation, or this mechanism-discovery investigation.
