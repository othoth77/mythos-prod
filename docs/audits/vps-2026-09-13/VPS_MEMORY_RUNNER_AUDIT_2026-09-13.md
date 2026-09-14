# VPS MEMORY / RUNNER AUDIT — 2026-09-13 20:45–21:05 UTC (READ-ONLY)

Host vps-4722f0a9, 4 vCPU, 7 746 MB RAM, 4 095 MB swap (2 files), uptime 22 d 7 h (boot 2026-08-22 13:47). No process was killed, no service restarted, no file changed.

Evidence caveat: the rotated kernel/syslog archives (kern.log.1/.2.gz/.3.gz, syslog.*, auth.log.*, nginx *.gz …) were deleted at 20:50:25 UTC by another Claude session (transcript ad7f2953-1c98…, command `find /var/log -type f \( -name '*.gz' -o -name '*.[0-9]' \) -delete`, run together with `rm -rf` of six /root/workspaces clones). The journal only holds ~1 day of kernel messages (500 MB cap vs ~450 MB/day of noise). The OOM reconstruction below therefore relies on (a) the kernel counter `/proc/vmstat oom_kill`, (b) cgroup-v2 `memory.events` counters since boot, (c) `/opt/mythos-memwatch/memwatch.log` (2-minute samples since 09-01 17:21), (d) the kill-by-name figures captured from kern.log.1 during the 17:00 disk audit before it was purged, and (e) sar.

## 1. Current state

CURRENT MEMORY: total 7 746 MB, used 4 714, free 662, buff/cache 2 986, **available 3 031 MB (39 %)**. Committed_AS 22.1 GB vs CommitLimit 8.2 GB (overcommit heuristic mode 0, swappiness 10, no zswap/zram).
CURRENT SWAP: **4 032–4 095 MB of 4 095 used (98–100 %), 5–63 MB free**. si/so now 12–128 KB/s; sar today avg pswpin 4.6 p/s, pswpout 8.5 p/s; since boot 28 GB swapped in / 47 GB out.
CURRENT PSI: memory some 0.00/0.00/0.00 (spiked to 1.0 at 20:55), full 0.00; cpu some 6.0/5.1/4.7; io some 0.3/0.2/0.1. Cumulative since boot: memory some 17.3 h, memory full 10.3 h, cpu some 42.5 h, io full 3.7 h.
CURRENT OOM STATE: kernel counter oom_kill = **6 812 since boot**, unchanged since 2026-09-08 ≈ 14:15 UTC → **5 days without a single OOM kill**. Load 1.3, 8 users, 395 processes, 56 zombies.

## 2. GitHub Actions runner

| Item | Listener A (orphan) | Listener B (service) |
|---|---|---|
| PID | 2641581 | 3655012 (recycled every ~8 min; was 3497943 at 20:05) |
| Executable | /opt/mythos-gh-runner/bin.2.337.0/Runner.Listener | same |
| Working dir | /opt/mythos-gh-runner | same |
| Parent chain | run-helper.sh 2641577 ← **PID 1** (its run.sh is gone) | run-helper.sh 3655008 ← run.sh 3655004 = unit MainPID |
| Start | Sat 2026-09-05 11:43:18 | 2026-09-13 20:47:20 |
| CPU | 7 m 13 s total in 8 days | ~8–9 s per cycle |
| RAM | RSS 41 MB + 29 MB swap, 12 threads | RSS 118–122 MB, 17 threads |
| Open files | 149 | 158 |
| State | S, "Listening for Jobs"; broker session re-created daily 00:53 after "Runner configuration was updated" | S, `A session for this runner already exists` → Conflict retries |
| Job | none (no Runner.Worker; 0 Worker_* diag logs) | none |
| cgroup | mythos-gh-runner.service (left-over) | mythos-gh-runner.service |

Service: `mythos-gh-runner.service` active (running), enabled, User=mythos-runner, ExecStart=run.sh, **Restart=always, RestartSec=15, KillMode=process**, KillSignal=SIGINT, hardened (NoNewPrivileges, ProtectSystem=full …), drop-in override.conf = `RestrictSUIDSGID=no`. **NRestarts=112 at 20:53** (counter since the last daemon-reload), Result=success. Runner version 2.337.0 (commit 397b032), name `mythos-vps-runner`, agentId 2, repo `https://github.com/othoth77/mythos-prod`, v2 broker flow, credentials dated 08-20, work folder `_work`. No other unit, cron or user service launches the runner; the unit starts exactly one listener per start.

Duplicate-session explanation — **category C (orphaned process), produced by the unit's KillMode=process (B-like mechanism), not an auto-update issue (D)**:
1. On a `stop`/`restart`, systemd signals only the main PID (`run.sh`). `run-helper.sh` and `Runner.Listener` survive — the journal literally says "Unit process 2641577 (run-helper.sh) remains running after unit stopped … Found left-over process … Ignoring" on every cycle.
2. The surviving listener keeps the GitHub broker session. Every new listener gets HTTP 409 Conflict (`TaskAgentSessionConflictException`), retries 240 s, tries once more for 240 s, then exits "Session Conflict error, stop the service, no retry needed" → run.sh exits 0 → `Restart=always` relaunches 15 s later → **~8-minute loop, ~180 restarts/day**.
3. Timeline from `_diag/Runner_*.log` counts: episode 1 from 2026-08-29 20:03 to 09-03 (31/181/167/170/82/37 logs per day), cleared 09-04/05 (2.337.0 self-update on 09-04 05:44 completed cleanly; a fresh listener started 09-05 11:43 = today's orphan). Quiet 09-06 → 09-08. **Episode 2 since 2026-09-09 06:56** (131/124/177/181/161 logs per day ≈ 775 cycles). The restart that orphaned listener A on 09-09 can no longer be attributed (journal from that day is gone).
4. The orphan is the functional runner (session alive, daily config refresh), but it is outside systemd's process management; `systemctl stop` would orphan it again.

Runner resource impact: cgroup 140–163 MB RAM (peak 259–271 MB), 47 MB swap, ~2 % of one core continuous, one 66 KB diag log per cycle (10.6 MB/day; `_diag` now 103 MB after today's pruning), two journal lines every 32 s. **Not a meaningful RAM or swap contributor.** No runner-related zombies; the two orphans (2641577, 2641581) are the only stale processes; no stale workers.

## 3. Swap analysis

- Occupied: contextforge gunicorn workers 927 MB (5 stale workers at 171 MB swap each + 2 live), omniroute 507 MB (container 537 MB), dar-hijama mysql 408 MB, Claude Desktop remote sessions 517 MB, three VNC desktops ≈ 500 MB, coolify stack 126 MB, jellyfin 109 MB, mariadb 93 MB, n8n 79 MB.
- Behaviour: today's swap traffic is low (≈ 50 KB/s), so most of the 4 GB is **cold pages of idle services** — legitimate use. But sar shows %swpused rising 82 % (09-10) → 88 → 93 → 96 % (today) and memwatch shows 4 095/4 095 on every storm day: **there is no swap headroom left**; the next anonymous burst cannot be paged out and goes straight to the OOM killer. Swap was full during every OOM storm (median 4 095 MB at kill samples, avail median 563 MB).
- Performance: PSI memory "full" stall totals 10.3 h since boot (2 % of wall time), concentrated in the storm days (psi60 peaks 78–96 % on 09-01/02/04/05/06/07, 32 % on 09-08, ≤ 2.6 % since 09-09). Today swap is not degrading performance (PSI ≈ 0).

## 4. OOM investigation

Kills per day (delta of the kernel counter, memwatch 2-min samples): before 09-01 17:21 → 920 (includes the documented 08-31 event, 519 kills in 2 h); 09-01 106; 09-02 297; 09-03 0; 09-04 295; 09-05 29; 09-06 676; 09-07 507; **09-08 3 982**; 09-09 → 09-13 **0**. Total 6 812.

Attribution via cgroup-v2 memory.events (hierarchical, since boot):

| cgroup | limit-hit events (`oom`) | victims (`oom_kill`) | meaning |
|---|---|---|---|
| system.slice | 8 527 | 4 120 | kills inside memory-limited containers/units whose cgroups have since been recreated. Identified member: **mythos-contextforge** (768 MB limit, 256 MB swap cap): its log shows 1 443 "Booting worker" on 09-08 alone and "Worker was sent SIGKILL! Perhaps out of memory?"; memwatch ranks its cgroup #1 during kills; container restarted 09-08 17:10 |
| user.slice | 3 | 2 692 | only 3 limit hits → **≈ 2 690 global-OOM victims** |
| ├ user-1001 (deploy) | 3 | 2 385 | user@1001.service 1 284 → app.slice 869 (production node services; mythos-wp NRestarts=368) + session.slice 415 (pulseaudio, gcr-ssh-agent, dbus) |
| ├ user-1000 (ubuntu) | 0 | 171 | VNC desktop / omniroute-adjacent |
| └ user-0 (root) | 0 | 125 | Claude session scopes (session-2265 19) |

Kill-by-name for Sep 6–13 from kern.log.1 (captured at 17:00 before the purge): node 658, pulseaudio 233, gcr-ssh-agent 153, dbus-daemon 63, systemd (user managers) 49, omniroute "v16." 10, sh 6, npm install 5 = 1 182 logged vs 5 165 counted by the kernel for the same days → the kernel rate-limited its OOM messages during the storms.

Who was involved: Docker — yes (ContextForge cgroup kills, omniroute killed/restarted 22×, no container has OOMKilled=true today); Node — yes (658 victims: deploy's user-unit services and bridge processes); Claude — as the pressure source (session scopes 3.3–4.2 GB peaks) but rarely the victim (adj 0); Chrome — 1 victim; CI/Runner — no; PostgreSQL — **never** (idauto-postgres 0 restarts, OOMKilled=false, 0 OOM lines in 22 days of container logs, 44 MB of 384 MB); multiple processes competing — yes: on storm days memwatch shows avail 229–431 MB with swap full while root session scopes held 3.3–4.2 GB, omniroute 440–460 MB, contextforge 430 MB+.

Victim selection defect (confirmed): deploy's user manager runs with `DefaultOOMScoreAdjust=100` (systemd default for user@ managers; `/etc/systemd/system/user@1001.service.d/oom.conf` reset the manager's own adj to 0 but not the units it spawns). Result today: erp-api adj 100 / oom_score 735, mythos-wp 100 / 734, pulseaudio 733, gcr-ssh-agent 733 — the highest scores on the host — while 300 MB Claude sessions score 677–688, omniroute 704, n8n 682. In a global OOM the kernel kills 20–40 MB production services first. Other adj: containerd-shim −998, dockerd −500, sshd −1000, session-guard +500, dagu-poc +300.

## 5. Top 20 memory consumers (RSS, with swap; unit = cgroup)

| PID | PROCESS | USER | RSS MB | VSZ MB | SWAP MB | CPU % | SERVICE / CATEGORY |
|---|---|---|---|---|---|---|---|
| 1074449 | ccd-cli 2.1.266 (Claude Desktop remote) | root | 322 | 5 436 | 25 | 2.2 | session-2989.scope — AI/AGENTS |
| 1087569 | ccd-cli 2.1.266 | root | 304 | 5 438 | 66 | 3.3 | AI/AGENTS |
| 2134617 | ccd-cli 2.1.266 | root | 273 | 5 436 | 31 | 2.5 | AI/AGENTS |
| 1091350 | gunicorn worker (ContextForge) | container | 253 | 1 408 | 24 | 0.4 | docker mythos-contextforge — DOCKER |
| 3040209 | ccd-cli 2.1.266 | root | 253 | 5 436 | 22 | 1.9 | AI/AGENTS |
| 4043 | node n8n | ubuntu | 235 | 26 449 | 57 | 0.6 | docker n8n — DOCKER |
| 1091346 | gunicorn worker (ContextForge) | container | 224 | 1 405 | 46 | 0.3 | DOCKER |
| 368744 | omniroute (node v16) | ubuntu | 164 | 12 995 | **507** | 0.2 | docker omniroute — DOCKER |
| 2147092 | ccd-cli 2.1.266 | root | 162 | 5 436 | 65 | 1.5 | AI/AGENTS |
| 2119318 | ccd-cli 2.1.266 | root | 152 | 5 436 | 81 | 1.7 | AI/AGENTS |
| 3627141 | uvicorn spy.api | deploy | 132 | 351 | 0 | 0.5 | spy.service — MYTHOS-SVC |
| 3655012 | Runner.Listener (conflict loop) | mythos-runner | 118 | 267 819 | 0 | 2.0 | RUNNER |
| 2913349 | node dist/main (Evolution API) | root | 88 | 9 413 | 28 | 0.2 | docker evolution-api — DOCKER |
| 1054798 | ccd-cli 2.1.266 | root | 82 | 5 436 | 118 | 0.9 | AI/AGENTS |
| 2213472 | ccd-cli 2.1.266 (2 d 13 h old) | root | 77 | 5 436 | 110 | 0.8 | AI/AGENTS |
| 3672428 | php artisan horizon (Coolify) | container | 72 | 187 | 0 | 1.8 | docker coolify — DOCKER |
| 1439 | dockerd | root | 69 | 3 787 | 10 | 3.2 | docker.service — SYSTEM |
| 1090623 | gunicorn master (ContextForge) | container | 65 | 373 | 171 | 0 | DOCKER |
| 1091351 | gunicorn stale worker | container | 64 | 375 | 171 | 0 | DOCKER |
| 1091353 | gunicorn stale worker | container | 64 | 375 | 171 | 0 | DOCKER |

Category totals (process RSS / swap, MB): DOCKER 2 047 / 2 502 (122 procs); AI/AGENTS 1 699 / 577 (8 sessions + server); SYSTEM 692 / 256; BROWSER/DESKTOP (3 VNC desktops, no Chrome running) 466 / 496; MYTHOS-SVC 345 / 140; RUNNER 167 / 29; ERP/APPS (erp-api + idauto-api) 56 / 47; DEVELOPMENT (VS Code CLIs) 46 / 26; OTHER 49 / 56. cgroup view: user-0.slice 3 229 MB (session-2989.scope 3 046 MB = 1 462 anon + 1 093 file cache + 478 slab; peak 3 887 MB), system.slice 2 853 MB + 2 930 MB swap, user-1001 (deploy) 308 MB + 153 MB swap. Session guard (observe mode): 3–10 active sessions over 7 days, resident 649–1 965 MiB, 8 active now.

## 6. Docker memory

| Container | Usage / limit | Restarts | OOMKilled | Note |
|---|---|---|---|---|
| mythos-contextforge | 418 MiB / 768 MiB (54 %), swap 255 MB of 256 MB cap, peak = limit | 1 (09-08 17:10) | false | 23 limit hits since restart; 1 443 worker reboots on 09-08; 5 stale workers |
| n8n-n8n-1 | 290 MiB / 3 GiB | 0 | false | healthy |
| omniroute | 186 MiB / no limit, peak 1 006 MB, 537 MB swapped | 22 (last 09-07) | false | global-OOM victim 10× in audit week |
| coolify (+db, redis, realtime, sentinel) | 138 + 22 + 8 + 34 + 15 MiB | 0 | false | dormant stack, no limits except redis 96 MiB |
| evolution-api / evolution-postgres | 90 MiB / 768; 10 / 256 | 0 | false | 56 wget zombies from healthcheck (npm is PID 1, no init) |
| dar-hijama app/scheduler/web/mysql | 55 / 7 / 3 / 51 MiB, no limits; mysql 408 MB swapped | 0 | false | **queue-1 Exited since 09-06 08:20 with containerd error "task … already exists" (352 restarts) — queue jobs not running; not memory** |
| idauto-postgres | 44 MiB / 384 MiB | 0 | false | production DB, healthy |
| jellyfin | 26 MiB / 2 GiB (109 MB swapped) | 0 | false | idle |
| mythos-dex / mcp-auth-proxy / github-mcp(-rw) / context7 / redis ×3 | 2–11 MiB, limits 64–256 MiB | 0 | false | healthy |

No container is currently OOMKilled and none has hit its limit except ContextForge.

## 7. ERP safety

erp-api: active, PID 2101846 since 11:10:43 UTC, NRestarts 0, RSS 34 MB, swap 7 MB, peak 154 MB, MemoryMax 384 M / MemoryHigh 300 M, cgroup oom 0 / oom_kill 0 since 11:10 (earlier history lost with the log purge), health `http://127.0.0.1:8787/api/v1/health` → 200 `{"ok":true,"db":"ready"}` and public HTTPS 200, code identity 6a2e965 verified, no migrations today after 11:10. **Risk: oom_score_adj = 100 (unit OOMScoreAdjust=100 inherited) makes erp-api the single most likely global-OOM victim on the host.**
PostgreSQL (idauto-postgres): running, healthy, 0 restarts, OOMKilled=false, 44 MB / 384 MB, backends 12 MB RSS + 1–3 MB swap, shared_buffers 128 MB, 7 connections, 0 OOM lines in container log. MariaDB: 13 MB RSS, 93 MB swap, no OOM.

## 8. Memory pressure verdict: **YELLOW**

Green signals: PSI memory 0.0 now, 3.0 GB available, zero OOM kills for 5 days, all production containers under their limits. Yellow signals: swap 98–100 % full (no headroom), Committed_AS 2.7× CommitLimit, one root session scope alone at 3.0–3.9 GB, ContextForge at its swap cap with 5 stale workers, production services carry the worst OOM score. Red would be avail < 700 MB or psi60 > 20 — the exact pattern of every storm day 09-01…09-08.

## 9. Root causes (ranked)

#1 ContextForge gunicorn workers exceeding the container's 768 MB / 256 MB-swap cgroup. EVIDENCE (confirmed): container log SIGKILL/"out of memory" errors and 1 443 worker boots on 09-08; system.slice 8 527 limit hits / 4 120 kills in recreated cgroups; memwatch cgroup ranking during kills; today 5 stale workers with 171 MB swap each. FREQUENCY: one massive storm 09-08 (≈ 3 982 kills) plus smaller ones; 23 limit hits since 09-08. MEMORY IMPACT: ~1.7 GB footprint (RSS + swap) for a service capped at 1 GB. CONFIDENCE: high for 09-08; the exact share of the 4 120 is inferred (other recreated cgroups — omniroute, drill containers — cannot be excluded).

#2 Global exhaustion driven by root Claude Desktop remote sessions on a 7.7 GB host. EVIDENCE (confirmed): session scopes peak 3.3–4.2 GB (user-0 peak 4.4 GB), 8 sessions resident now (1.6 GB RSS + 0.5 GB swap + 1.6 GB cache/slab), memwatch storm days avail 229–431 MB with swap 4 095/4 095 and psi60 78–96 %, docs/MYTHOS_RESOURCE_GUARD.md names it the dominant consumer. FREQUENCY: daily 09-01 → 09-07 (≈ 1 900 kills), 519 kills on 08-31; none since 09-09 (fewer/lighter sessions: largest scope 1.0–2.9 GB on 09-09…09-12, 3.6 GB today). MEMORY IMPACT: 3–4.4 GB. CONFIDENCE: high.

#3 Victim mis-prioritisation: DefaultOOMScoreAdjust=100 for deploy's user units. EVIDENCE (confirmed): /proc oom_score_adj=100 on erp-api, mythos-wp, pulseaudio, gcr-ssh-agent; 2 385 of 2 692 global victims lived in deploy's slice; mythos-wp NRestarts=368; kill names node 658 / pulseaudio 233 / gcr-ssh-agent 153. IMPACT: turns every global OOM into a production-service kill instead of reclaiming from the 300 MB–1 GB consumers. CONFIDENCE: high.

#4 Swap saturated by cold, unlimited residents (omniroute peak 1 GB + 537 MB swap, dormant Coolify ≈ 250 MB + 126 MB swap, dar-hijama mysql 408 MB swap, jellyfin 109 MB, three VNC desktops ≈ 1 GB incl. swap). EVIDENCE: per-process VmSwap, container peaks. IMPACT: removes the 4 GB buffer that would absorb bursts. CONFIDENCE: high as a contributor, medium as a trigger.

#5 Runner restart loop: ~160 MB and ~2 % CPU; log noise only. CONFIDENCE: high, impact negligible.

#6 SPY at MemoryMax on 09-07 (prior note): app.slice shows only 1 limit hit since boot → not an OOM source. Inference.

## 10. Recommendations (none executed)

| # | ACTION | WHY | EXPECTED IMPACT | RISK | PRIORITY | RESTART? | CONFIG CHANGE? |
|---|---|---|---|---|---|---|---|
| 1 | End the runner loop: stop the unit, terminate the orphan pair 2641577/2641581, start the unit; then set `KillMode=mixed` (or `control-group`) in a drop-in so future restarts do not orphan the listener | KillMode=process is the root cause; ~180 restarts/day, 10 MB/day of diag logs | one listener, no conflicts, NRestarts stops climbing | low (no job running; runner stays registered; ≤ 1 min offline) | P1 | YES (runner only) | YES (drop-in) |
| 2 | Protect production from the OOM killer: set `OOMScoreAdjust=-500` (or lower) on erp-api, idauto-api, mythos-wp, ssangyong-storefront, command-center, os-console, oth-knowledge, executor, spy; set `DefaultOOMScoreAdjust=0` in deploy's user.conf; give Claude session scopes a positive adj (+500) via the session guard or a `user-0.slice` policy | victims are chosen by adj today; ERP scores highest on the host | global OOM would reclaim from 300 MB–1 GB agents/containers instead of 30 MB services | low; applies on unit restart | P1 | YES per unit (schedule ERP in a window) | YES |
| 3 | ContextForge: lower `--max-requests` (e.g. 2 000) so leaking workers recycle before hitting the cap, keep `--workers 2`, and restart the container once to shed the 5 stale workers (≈ 1.2 GB RSS+swap) | 09-08 storm; still 23 limit hits and swap at cap | −0.9 GB swap, no worker SIGKILL churn | low (gateway is not public; ~10 s outage) | P1 | YES (container) | YES (compose/env) |
| 4 | Throttle instead of kill for agent sessions: `MemoryHigh=3G` on user-0.slice (systemd set-property), session guard from observe → enforce with an idle timeout, cap concurrent sessions | root sessions are the largest and most variable consumer (peak 4.4 GB) | pressure becomes reclaim/throttle inside the slice, not host-wide OOM | medium (slows agents when over budget) | P1 | NO (live property) | YES |
| 5 | Free swap headroom: decommission the dormant Coolify stack (P2 of the disk audit), add `mem_limit` to omniroute (≈ 768 M–1 G) and dar-hijama mysql/app, or move omniroute's cold data out of swap by a scheduled restart in a window | ~1 GB of cold pages pinned in swap | swap 100 % → ~70 %, restores burst buffer | medium (limits can OOM the container itself if set too low) | P2 | YES for the affected containers | YES |
| 6 | Fix dar-hijama-production-queue-1 (containerd "task already exists": recreate the container) | queue worker down since 09-06, 352 restarts | queue jobs resume | low | P1 (app correctness, not memory) | YES (that container) | NO |
| 7 | Evolution API: add `init: true` to the service so healthcheck `wget` zombies are reaped | 56 zombies accumulating (PID table only) | zombies stop growing | low; WhatsApp state is in the volume | P3 | YES (container) | YES |
| 8 | Log/evidence retention policy: no agent session may delete /var/log rotations; keep 4 weekly compressed kernel logs (~70 MB) and raise journald SystemMaxUse or silence the bridge JSON so the journal keeps > 1 week of kernel messages | today's purge erased the OOM audit trail | reconstructible incidents | none | P2 | NO | YES (journald/rsyslog) |
| 9 | Alerting on memwatch: notify when avail < 700 MB or psi60 > 20 for 3 samples; expose oom_kill delta | storms were visible 10–30 min ahead in memwatch | early warning before kills | none | P2 | NO | YES (small script) |
| 10 | Do not add swap (disk 81 %); consider zswap on next reboot (kernel cmdline) | compresses cold pages, cuts swap I/O | more effective 4 GB | low | P3 | YES (reboot) | YES |

CRITICAL ACTION: none required right now (no OOM for 5 days, PSI 0). The three fixes to schedule are #1 runner KillMode/orphan, #2 OOM-score protection of ERP and the other deploy services, #3 ContextForge worker recycling — in that order of ease and value.

NO ACTION EXECUTED: YES

FINAL STATUS
RUNNER_AUDIT_COMPLETE
SWAP_AUDIT_COMPLETE
OOM_AUDIT_COMPLETE
READ_ONLY: YES
CHANGES_MADE: NO
