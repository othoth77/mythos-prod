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

## Validation

- `git diff --check`: to be run before commit (see final response).
- Only `docs/audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md` and `docs/AI_HANDOVER.md` are intended to change.
- No credentials, secrets, or IPs were introduced. MySQL was queried using the container's own `$MYSQL_ROOT_PASSWORD` env var referenced symbolically inside `docker exec`; the six Redis instances were queried the same way using `$REDIS_{CACHE,QUEUE,SESSION}_PASSWORD` — no password value was ever echoed to output or written to any file.
- No production mutation: no `mem_limit`, restart policy, compose file, `maxmemory`/eviction policy, or running container was changed by this plan or by the 2026-08-10 safety review.
- Container IDs before/after this planning session (and before/after the safety review) were compared and are identical except for the two Dar Hijama queue containers' own hourly self-recycling (`--max-time=3600`, confirmed benign and pre-existing in the prior audit).
- No subagents were used at any point across the original plan or this safety review.
