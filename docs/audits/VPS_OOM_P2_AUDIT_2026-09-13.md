# VPS OOM PROTECTION (PHASE A) + P2 DISK AUDIT (PHASE B) — 2026-09-13 23:03–23:12 UTC

Operator session: Claude Fable 5.1 (root, ccd-cli). Evidence files: /tmp/claude-0/-root/986e4f9e-…/scratchpad/oomA/.

## 1. Executive summary
- Phase A applied the conservative parity protection to the two production units that still carried the inherited OOMScoreAdjust=100: **erp-api** and **mythos-wp** now run at oom_score_adj 0 (oom_score 735/734 → 668/669, same band as every other deploy production service, below omniroute ≈704 and Claude sessions ≈678). Each unit was restarted once, on purpose; nothing else was restarted. ERP, PostgreSQL, runner, ContextForge and the dar-hijama queue are healthy afterwards; OOM counter unchanged at 6 812.
- One deviation, explained and evidenced: erp-api's health endpoint now reports code identity de8c996 instead of 6a2e965. The production checkout was fast-forwarded to de8c996 at 16:58 UTC (four docs/nginx commits, one adding two files under sites/erp.mythosprod.xyz/deploy/ — a README line and an nginx vhost template, neither loaded by the API), long before this phase. The old process reported its 11:10 start-time SHA. The ERP source-tree hash, schema hash, migration count (15) and all 47 table row counts are identical before and after. No rollback was performed: rolling back would mean moving the production checkout, which this order does not authorise.
- Root-side assessments (A4–A7): DefaultOOMScoreAdjust change would touch 6 active + 13 inactive units (blast radius listed) — not changed. Session guard has the right process identification and CAP_KILL only; it cannot set oom_score_adj today (AGENT_PROTECTION_READY = NO, mechanism proposed). MemoryHigh=3G on user-0.slice is technically valid and would touch only root login sessions (MEMORYHIGH_READY = YES with one caveat). DB protection: Docker supports `oom_score_adj:` for idauto-postgres (needs a container recreate = DB restart); MariaDB needs a root drop-in `OOMScoreAdjust=-500` (restart).
- Phase B audit only. Disk 79 %, 16 GB free. Totals: P2-A ≈ 2.1 GB, P2-B ≈ 16.6 GB, P2-C ≈ 25 GB (production + tooling in use), P2-D ≈ 0.4 GB. **Nothing was deleted, pruned or removed.**
- Note for the record: /root/workspaces is now empty and the rotated /var/log archives are gone — both removed by other sessions earlier today (ad7f2953), not by this one.

## 2. Baseline (A1, 23:03 UTC)
| Item | Value |
|---|---|
| erp-api | PID 2101846 (since 11:10:43), active, Result=success, NRestarts 0, RSS 38 MB, swap 5 MB, **oom_score_adj 100, oom_score 735**, MemoryMax 384 M, no drop-in |
| ERP health | 200 local + public, db ready, role erp_app, code_identity head 6a2e965 (measured 11:10), verified:true |
| ERP checkout | /home/deploy/projects/mythos-prod HEAD **de8c996** (already; reflog: fast-forward 16:58:49), 4 untracked docs files from other sessions |
| ERP migrations | 15, last 2026-09-13 11:10:42; 1 erp_app connection |
| ERP source hash | b4372777… (sites/erp.mythosprod.xyz, excluding node_modules) |
| mythos-wp | PID 2670531 (since 09-07 23:49), active, NRestarts 368 (historic), **adj 100, score 734**, MemoryMax 256 M, no drop-in |
| deploy user manager | DefaultOOMScoreAdjust=100; manager PID 688488 itself at adj 0 (root drop-in user@1001.service.d/oom.conf); no ~deploy/.config/systemd/user.conf |
| OOM counter | 6 812 (unchanged since 09-08) |
| Memory | 3 084 MB available; swap 3 557 / 4 095; PSI memory 0.00; load 0.98 |
| PostgreSQL | idauto-postgres running/healthy, 0 restarts, started 08-22 |
| Runner | active, NRestarts 0 (since 22:20), 1 listener, KillMode=control-group |
| ContextForge | healthy, 0 restarts, swap 0 MB |
| Dar Hijama queue | running/healthy, 0 restarts |

## 3. OOM protection actions
A2 — erp-api: created `~deploy/.config/systemd/user/erp-api.service.d/oom.conf` (copy of the 2026-09-01 oom.conf used by the eight other production units, header line updated; content `[Service] OOMScoreAdjust=0`), `systemctl --user daemon-reload` (effective value 0 confirmed before restart), `systemctl --user restart erp-api` at 23:04:23. Verified within 6 s: active, Result=success, NRestarts 0, new PID 4069289, **adj 0, score 670**, health 200 local and public, db ready, journal shows only the usual ProtectHostname notice and "listening on 127.0.0.1:8787 as erp_app", no errors, OOM counter 6 812, PostgreSQL untouched.
A3 — mythos-wp: same drop-in pattern at `~deploy/.config/systemd/user/mythos-wp.service.d/oom.conf`, daemon-reload, `systemctl --user restart mythos-wp` at 23:08:16. Verified: active, Result=success, NRestarts 0, PID 4080936, **adj 0, score 670**, HTTP 302 (login redirect) locally on :8170 and publicly on wp.mythosprod.xyz (same as before), clean startup log, no crash loop after 10 s and after 3 min, no dependent units (reverse deps: only default.target; nginx proxies to :8170 and was not touched).
A4 — not changed (see §12). A5/A6/A7 — read-only (see §12).

## 4. Exact files changed
1. `/home/deploy/.config/systemd/user/erp-api.service.d/oom.conf` — NEW, deploy:deploy 0644, 1 813 bytes.
2. `/home/deploy/.config/systemd/user/mythos-wp.service.d/oom.conf` — NEW, deploy:deploy 0644, 1 815 bytes.
No other file on the host was modified. (This report is written as an untracked file, see §25.)

## 5. Exact services restarted
- erp-api.service (deploy user manager) — once, 23:04:23.
- mythos-wp.service (deploy user manager) — once, 23:08:16.
Not restarted: PostgreSQL, MariaDB, nginx, Docker, the user manager, runner, ContextForge, queue, anything else.

## 6. Before/after OOM scores
| Process | Before adj / score | After adj / score |
|---|---|---|
| erp-api | 100 / 735 | **0 / 668** |
| mythos-wp | 100 / 734 | **0 / 669** |
| idauto-api, command-center, os-console, oth-knowledge, executor, spy, spy-monitor, storefront | 0 / 666–674 | unchanged |
| pulseaudio, gcr-ssh-agent, gpg-agent, dbus (deploy session daemons) | 100 / 733 | unchanged (out of scope) |
| Claude ccd-cli sessions | 0 / ≈678 | unchanged |
| omniroute | 0 / ≈704 | unchanged |
| idauto-postgres / mariadb | 0 / 666–672 | unchanged |
| dockerd / containerd-shim | −500 / −998 | unchanged |
Effect: in a global OOM the kernel no longer prefers the 38 MB ERP API over 300 MB agent sessions; ERP now ranks below omniroute and the agent sessions.

## 7. ERP verification (23:11)
Public 200, local 200 `{"ok":true,"db":"ready","role":"erp_app",…"verified":true}`; code identity de8c996 = checkout HEAD (see §1 for why it differs from the pre-restart value); source tree hash unchanged; schema hash unchanged (7d03434e…); 15 migrations, last 11:10:42; 47 tables with identical n_live_tup; erp-api active, NRestarts 0, adj 0.

## 8. PostgreSQL verification
idauto-postgres running, healthy, RestartCount 0, StartedAt 2026-08-22 (unchanged), volume idauto-postgres-data 214 348 KB before and after, mythos_erp reachable, connections normal.

## 9. Runner verification
active, KillMode=control-group, NRestarts 0 since 22:20:15 (51 min, where the old loop restarted every 8 min), exactly one Runner.Listener, no Runner.Worker, zero "already exists" messages since 22:20:19 (the 14 in the trailing 60-minute window all predate the fix), GitHub API: mythos-vps-runner online, busy=false.

## 10. ContextForge verification
healthy, RestartCount 0, env `GUNICORN_MAX_REQUESTS=2000`, `GUNICORN_MAX_REQUESTS_JITTER=200`, only the 2 initial worker boots since 22:21, cgroup 406 MB, swap 51 MB (it was 0 at 23:03 and 255 MB before the fix; the 51 MB appeared while host swap refilled during the Phase B scans), memory.events oom 0 / oom_kill 0 / max 0, /gateway/health 200.

## 11. Dar Hijama verification
queue-1 running, healthy, RestartCount 0, no error; all other dar-hijama containers unchanged; darhijama.tn 200.

## 12. Root-side OOM protection assessment (read-only)
**A4 — DefaultOOMScoreAdjust inheritance.** No `~deploy/.config/systemd/user.conf` or `/etc/systemd/user.conf.d` override exists; the manager reports DefaultOOMScoreAdjust=100 (inherited from the manager's own adj at its start on 2026-09-03 16:52, i.e. before the root drop-in was effective for this instance — the drop-in file is dated 09-02 23:00 but the running manager still carries default 100; a `systemctl --user daemon-reexec` would re-derive it from the manager's current adj 0). Blast radius of setting DefaultOOMScoreAdjust=0 (user.conf or reexec): units WITHOUT an explicit drop-in would change from 100 to 0 on their next start — active: dbus, gcr-ssh-agent, gpg-agent, pulseaudio, mythos-github-bridge (timer-run every minute); inactive/oneshot: dirmngr, gnome-keyring-daemon, keyboxd, launchpadlib-cache-clean, pk-debconf-helper, snapd.session-agent, spy-backup, ssh-agent, systemd-remount-fs, user-session-migration, xdg-desktop-portal-rewrite-launchers, xdg-user-dirs, xfce4-notifyd. The 10 production units keep their explicit 0. Effect is benign (all become "ordinary" processes) but it touches 19 units and needs a manager reexec, so it is **NOT changed in this phase**; recommended as a follow-up together with a documented reexec window.
**A5 — Agent protection.** ccd-cli sessions are forked by `/root/.claude/remote/srv/<rev>/server --serve` inside the root login-session scope (currently session-2989.scope, 8 sessions: 4×2.1.266 + 4×2.1.270, all adj 0, user root). The session guard (`/usr/local/lib/mythos-session-guard/session-guard.js`, oneshot timer every 5 min, User=root, OOMScoreAdjust=500 on itself, CapabilityBoundingSet=CAP_KILL, ProtectSystem=strict, observe mode, enforcement gated by an operator marker) already classifies processes precisely ("remote-session" = argv path `/.claude/remote/ccd-cli/` AND parent is the srv server; executor sessions are excluded by regex) — so it CAN target only agent sessions and cannot mis-identify sshd, systemd, ERP, PostgreSQL or nginx. It has NO oom_score_adj code today, and its sandbox (ProtectSystem=strict, ReadWritePaths only its state dir) would block writes to /proc/<pid>/oom_score_adj. **AGENT_PROTECTION_READY = NO** (needs code + a `ReadWritePaths=/proc` or a dedicated tiny root oneshot). Recommended mechanism: a new `plan()` action `oom_adj` in session-guard.js that writes `500` to `/proc/<pid>/oom_score_adj` for positively classified remote-session PIDs only, idempotent, logged in the ledger, enabled by the same marker model; add `ReadWritePaths=/proc` (or run it as a separate `mythos-session-oomadj.service` with the same classifier). Raising a root process's adj needs no extra capability.
**A6 — user-0.slice MemoryHigh.** Slice has MemoryAccounting=yes, MemoryHigh/Max=infinity, cpu+memory+pids controllers delegated; current 2 532 MB (peak 4 420 MB, swap 882 MB). Members: session-2989.scope 2 370 MB (8 ccd-cli + srv server + shells), session-338.scope 16 MB (xdg/gvfs desktop helpers), session-3299 87 MB (sshd + sftp + one srv server), session-1613 3 MB (VS Code CLI), session-1801 tmux/bash, session-2265 6 MB. It contains NO production service (ERP, PostgreSQL, nginx, Docker, runner are in system.slice / user-1001). MemoryHigh=3G is technically valid (`systemctl set-property user-0.slice MemoryHigh=3G`, live, reversible with `MemoryHigh=infinity`); above 3 GB the kernel throttles and reclaims inside the slice instead of OOM-killing host-wide. Caveat: root SSH shells and VS Code tunnels share the slice and would be slowed together with the agents when over budget; peak observed 4.4 GB means the throttle would engage in practice. **MEMORYHIGH_READY = YES** — recommend 3G (or 3.5G) with the session guard's resident_mib as the monitoring signal; not applied.
**A7 — Database protection.** idauto-postgres: compose `/home/deploy/deployments/idauto-postgres/docker-compose.yml`, service `postgres`, mem_limit 384m, HostConfig.OomScoreAdj currently 0 (unset); Docker 29.6.1 / Compose v5.3.1 support `oom_score_adj: -500` (HostConfig.OomScoreAdj) — applying it requires `docker compose up -d` = container recreate = PostgreSQL restart (~5 s; clients: erp_app, idauto, ssangyong_autos_owner, mythos_wp reconnect). Note the container currently runs the untagged image 3d0f7584ed7d while the compose tag postgres:15-alpine now resolves to fe0737ba566a (same major, data-compatible) — a recreate will switch image; do it in an announced window with a fresh dump first. MariaDB: system unit /usr/lib/systemd/system/mariadb.service, no drop-in, adj 0; root drop-in `OOMScoreAdjust=-500` + `systemctl restart mariadb` (notrejour/ssangyong sites reconnect). Recommended order: MariaDB first (cheaper), then Postgres in a window. Neither restarted now.

## 13. P2 disk audit — global baseline (B1)
/ 72 GB: 56 GB used, 16 GB free, **79 %**; inodes 15 %; /boot 16 %, /boot/efi 6 %. Top level: /var 24 GB (containerd 20 GB, docker 2.9 GB incl. volumes 1.0 GB, snapd 1.7 GB, log 0.3 GB), /home 13 GB, /usr 7.8 GB, /root 6.0 GB, /opt 1.9 GB, /tmp 0.4 GB. Journal 403 MB (cap 500 MB). Docker: 23 images 20.58 GB (reclaimable per docker: 569 MB = coolify-helper), 28 containers, 17 volumes 1.0 GB, build cache 0.

## 14. Docker inventory (B2)
Images (23): all have a container except **coollabsio/coolify-helper:1.0.15 (581 MB, pulled on demand by Coolify)**. Untagged but in use: 3d0f7584ed7d (idauto-postgres, 417 MB — P2-C, never prune), 246e268cecec (mcp-auth-proxy), b8469881d3cb (dex), 2bf79cf16747 (omniroute). evoapicloud/evolution-api:latest (1.83 GB) is held only by the never-started `evolution-inspect` container.
Containers: 27 running (all production/tooling as inventoried on 09-13), 1 Created (evolution-inspect). Stopped: none.
Volumes (17): links=1 in production: idauto-postgres-data 210 MB (P2-C), dar-hijama-production_* (212/2/9/30 MB), evolution pgdata 65 MB + instances 4 MB, n8n_n8n_data 61 MB, coolify-db 129 MB, coolify-redis 1 MB, 93b0756d… 1 MB (anonymous, linked). links=0: gi0p3mbss6geqhunih23fy6f_staging-{mysql 199, redis-queue 46, redis-session 1, storage 2} MB (last write 08-15/08-13, contains a `dar_hijama_production` schema copy = Coolify staging app 3 "dar-hijama", exited:unhealthy since 08-15), n8n_caddy_config / n8n_caddy_data (0 B, 07-09, not referenced by /opt/n8n/docker-compose.yml nor its 08-10 backup copy). Build cache 0.

## 15. Coolify inventory (B3)
Containers coolify, coolify-db, coolify-realtime, coolify-redis, coolify-sentinel all Up 3 weeks; server row heartbeats (updated 23:07) — the daemon is alive, but: applications table = 3 apps, all `exited:unhealthy` (notrejour:main-i4mv… 08-25, dar-hijama 08-15, mythos-dar-hijama-staging 08-25); 13 deployments total, last 2026-07-29; no proxy (traefik) container; the i4mv… container is on the `coolify` network only and its sslip.io host hits nginx's default vhost (301), i.e. unreachable as an app; panel.mythosprod.xyz vhost → :8000 exists (only scanner hits in the access log). /data/coolify 448 KB (3 app dirs). Resources: images 628 + 998 + 581 + 48 + 2 170 MB = **4.43 GB**, volumes 129 + 1 + 248 MB, container logs ≈ 55 MB. Classification: whole stack **P2-B** (owner decision: retire or keep as future PaaS); gi0p3 staging volumes **P2-B** (archive the mysql dir before removal; they are the only copy of that staging DB); coolify-db/redis P2-B with the stack; postgres:15-alpine and redis:7-alpine images **P2-C** (shared with idauto-postgres compose / mcp-auth).

## 16. Worktree / repository inventory (B5)
- /root/workspaces: **empty** (all clones, incl. cont-*, removed by session ad7f2953 at 20:50 and later). /home/deploy/workspaces does not exist.
- /root clones: ssangyong 846 MB (main 0a04e50, clean, pushed, storefront node_modules 609 + .next 202 = build residue; repo is docs/evidence only, the live storefront runs from mythos-prod), casse.autos 831 MB (main 08b5102, clean, pushed; node_modules 645 + .next 170; active launch-prep project), piece.autos 52 MB (audit branch, merged), othdesign 10 MB (merged), othkm-handoff 10 MB (not a git repo), memori-main 11 MB (upstream clone). No process cwd and no transcript directory references any of them right now; no systemd/nginx/docker reference.
- /home/deploy/worktrees + executor gh worktrees + wt-othk-* + /tmp/othk*: 79 worktrees of mythos-prod: **48 MERGED into origin/main (1 313 MB)** — of which mythos-wp-main is **referenced by mythos-wp.service (P2-C)** and session-management is dirty (3 files, P2-B); the other 46 merged, clean, unreferenced (≈ 1 250 MB) — P2-A via `git worktree remove` as deploy; **31 UNMERGED (806 MB) — P2-C** (erp-gates dirty, open PRs such as wa-comms-9/#229).
- /home/ubuntu/mythos-ai-executor/worktrees: 23 dirs, 336 MB, from 08-18; executor now runs as deploy (0 ubuntu executor processes) — P2-B.
- /tmp/othk-verify-cc36e3b, othkm-postmerge, othkm-test: 3 detached test worktrees, 87 MB — P2-B (git worktree remove).

## 17. Browser / AI inventory (B6)
| Item | Size | Last use | Class |
|---|---|---|---|
| /home/ubuntu/.config/google-chrome | 2 351 MB (cache 1 522) | 09-01 | profile P2-C, cache P2-B |
| /home/deploy/.config/google-chrome | 1 153 MB (cache 453) | 08-31 | profile P2-C, cache P2-B |
| /root/snap/chromium/common (default snap profile, not used by the mythos-chromium wrapper) | 548 MB (cache 459) | 08-23 | cache P2-B |
| /home/ubuntu/.config/chrome-work, /root/.config/google-chrome, /root/.mythos-browser | 158 / 70 / 38 MB | — | P2-C |
| /opt/course-intelligence (venv 179, chatgpt-profile 289 incl. cache 159, browser-profile 49) + /home/ubuntu/.cache/ms-playwright (656, chromium-1234 used only by its venv) | 520 + 656 MB | 08-31 | P2-B (throwaway per record; archive output/ first) |
| /root/.cache/ms-playwright chromium-1208 | 622 MB | 09-08 | P2-C (playwright 1.58 in casse/piece) |
| Claude: /root/.claude 1 207 MB (remote ccd-cli 2.1.266 + 2.1.270 = 431, plugins 360, projects/transcripts ≈ 400), ~/.local/share/claude versions (root 2.1.258, deploy/ubuntu 2.1.251) 206 MB each, /usr/local/bin/claude 2.1.226 (285 MB, 08-10), /home/ubuntu/.config/Claude (375 MB: desktop bundle 2.1.246 + 2.1.247) | ≈ 2.5 GB | 2.1.266 and 2.1.270 running (4 + 4) | active P2-C; stale: /usr/local/bin/claude 285 MB and desktop 2.1.246 ≈ 250 MB P2-B; ccd-cli 2.1.266 P2-C until its 4 sessions end |
| VS Code servers (root/deploy Stable-645f29c 655 MB each) + deploy agent-host sdk-cache 306 MB | 1.6 GB | in use | P2-C (sdk-cache P2-B) |
| opencode (global 704 + ubuntu 171 + deploy db 318) | 1 193 MB | 09-06 | P2-B |
| codex (global 301 + ubuntu 75 + deploy 48) | 424 MB | 08-31 | P2-B |
| claude-desktop deb 549 MB, snaps 1 527 MB (chromium + gnome/mesa bases) | 2.1 GB | desktop/VNC | P2-C |
| uv tools 359, pnpm store 208, graphify-venv 197, dagu-poc 157 | 921 MB | — | P2-C / P2-B (graphify, dagu-poc owner) |
| OTHMODE/OTHKM: oth-knowledge 1 MB, othmode-store 1 MB, othk-archive 29 MB, othkm-handoff 10 MB, mythos-prod/.opencode 64 MB | 105 MB | — | P2-C (records) |

## 18. Logs / caches / temp inventory (B7)
| Candidate | Size | Purpose / used? | Safe method | Reclaim | Risk |
|---|---|---|---|---|---|
| journal | 403 MB | capped at 500 MB; holds ~1 day because of bridge JSON + UFW noise | keep; reduce noise at source | 0 | — |
| /var/log | 300 MB | live logs only (archives purged by another session today) | policy: keep 4 weekly gz | 0 | evidence loss already happened |
| Docker container json logs | 173 MB | bounded 10 m × 3 per container | none needed | 0 | — |
| /root/.npm | 255 MB | re-grew after P1 (_npx + new cache) | `npm cache clean --force` later | ~0.2 GB | none |
| /home/ubuntu/.cache 753 MB (playwright 656 + chrome 82), /root/.cache 676 MB (playwright 622, prisma 33) | 1.4 GB | see §17 | with owners | see §17 | — |
| /var/lib/snapd/cache | 304 MB | snapd download cache | snapd self-manages | 0.3 GB | low, forbidden this order |
| /var/lib/apt/lists 148 + /var/cache/apt 105 | 253 MB | apt metadata | keep | 0 | — |
| /tmp 412 MB: /tmp/claude-0 224 (session scratchpads incl. this one), node-compile-cache 32 (re-created), othk worktrees 87, snap-private-tmp 11 | 412 MB | active sessions | age-based (>7 d) | ~0.1 GB now | low |
| /opt/mythos-gh-runner/_diag | 104 MB | runner diag; loop fixed so growth stops | `find -mtime +14 -delete` monthly | ~0.05 GB | none |
| executor bridge/events.log 45 MB, dar-hijama laravel.log 28 MB | 73 MB | unbounded app logs | add rotation | 0 | needs code/config change |
| composer cache | 0 (cleaned in P1) | — | — | — | — |

## 19. Backup inventory (B8)
| Location | Size | Files | Oldest → newest | Notes |
|---|---|---|---|---|
| /var/backups/mythos (idauto archive) | 8 MB | 63 | 08-22 → 09-13 | daily 03:30; 32 dumps, SHA256SUMS present, latest verified OK; no local retention (grows ~190 KB/day) |
| /var/backups/mythos-db (ERP + ssangyong + wp archive) | 7 MB | 70 | 09-01 → 09-13 | 30 mythos_erp dumps (all distinct hashes — no duplicates), 2 pre-0007, 2 wp pre-0005, 3 ssangyong; last 3 SHA256SUMS verified OK; R2 verify last_success 15:33 / 16:23 today |
| /home/deploy/mythos-backups | 411 MB | 943 | 08-22 → 09-13 | staging sets 33 (18 MB) + erp-staging 31 (7 MB) never pruned; **spy-db 259 MB** (7 dumps: 2 × 09-02 identical size, 5 × 09-13 from today's SPY sprint by another session) + spy-db-20260901 38 MB; legacy-ssangyong 89 MB (www tarball 09-02) |
| /home/deploy/backups | 6 MB | 149 | 07-28 → 09-05 | ship-point dumps (idauto pre-ida4 etc.) — P2-C |
| /root/backups | 258 MB | 7 | 07-21 | pre-Coolify snapshot of /var/www (tar 268 MB) + mariadb dump — P2-B (archive to R2, then remove) |
| /home/deploy/darhijama-release-704b3a3.{tar,zip,runtime.zip} 104 MB, deployments/darhijama-09ffdb…tar 54 MB, recovery-darhijama-20260728 89 MB | 247 MB | — | 07-28/29 | superseded by the running v1.0.1 deployment — P2-B (archive) |
| /home/ubuntu/incoming/VPS_TRANSFER | 161 MB | — | transfer from old VPS | P2-B (archive) |
| /opt/n8n/backups 2 MB, omniroute backups 18 MB, erp-preservation-snapshot 5 MB | 25 MB | — | — | P2-C |
Retention pattern: daily dumps + off-host R2 with verify; nothing local is pruned. ERP backups: **P2-C, never delete.**

## 20. P2 classification table (B10)
| Item | Path/Name | Size | Owner | Active? | Dependency | Classification | Possible Action | Reclaim |
|---|---|---|---|---|---|---|---|---|
| Coolify stack | coolify* containers, images coolify/realtime/helper/sentinel, i4mv… app image+container, coolify-db/redis volumes, /data/coolify, panel vhost | 4.9 GB | root (coolify) | daemon up, 0 working apps since 08-25, no proxy | panel.mythosprod.xyz vhost; shares postgres:15-alpine/redis images (keep those) | P2-B | compose down, rm images/volumes, drop vhost — after owner says Coolify is retired; dump coolify-db first | 4.9 GB |
| Coolify staging volumes | gi0p3…_staging-{mysql,redis-queue,redis-session,storage} | 248 MB | Coolify app "dar-hijama" (exited 08-15) | no (0 links, last write 08-15) | none | P2-B | archive mysql dir to R2, then `docker volume rm` | 0.25 GB |
| evolution-api:latest + evolution-inspect | image 966625532d90 + Created container | 1.83 GB | deploy (09-03 inspection) | no | none (compose pins v2.3.7) | P2-B | confirm not the 2.4.0 activation image; `docker rm evolution-inspect && docker rmi …:latest` | 1.8 GB |
| n8n caddy volumes | n8n_caddy_config, n8n_caddy_data | 0 B | n8n (07-09) | no | none | P2-A | `docker volume rm` | 0 |
| coolify-helper image | 6fb2357f3d59 | 581 MB | Coolify | no container | Coolify deploys | P2-B (with stack) | with Coolify | (in 4.9) |
| Merged clean mythos-prod worktrees (46) | /home/deploy/worktrees/* except mythos-wp-main, session-management; executor gh-issue-196/250; wt-othk-failclosed-r2 | ≈1.25 GB | deploy | no procs | none (branches on origin) | P2-A | `sudo -u deploy git -C ~deploy/projects/mythos-prod worktree remove <p>`; `git worktree prune` | 1.25 GB |
| Unmerged worktrees (31) + mythos-wp-main + session-management | … | 0.87 GB | deploy | wp service; open PRs | mythos-wp.service | P2-C | keep | 0 |
| ubuntu executor worktrees (23) | /home/ubuntu/mythos-ai-executor/worktrees | 336 MB | ubuntu | no (executor runs as deploy) | none | P2-B | `git worktree remove` from their parent or rm | 0.34 GB |
| /tmp test worktrees (3) | /tmp/othk*, /tmp/othkm* | 87 MB | root | no | registered in mythos-prod .git | P2-B | `git worktree remove` | 0.09 GB |
| /root/ssangyong build residue | storefront/node_modules + .next | 811 MB | root | no (clean, pushed, docs-only repo) | none | P2-A | `rm -rf` those two dirs | 0.8 GB |
| /root/casse.autos build residue | node_modules + .next | 815 MB | root | launch prep (idle now) | none | P2-B | regenerable; owner decides timing | 0.8 GB |
| /root/piece.autos, othdesign, othkm-handoff, memori-main | clones | 83 MB | root | no | none | P2-B | remove after owner confirms | 0.08 GB |
| Browser caches (Chrome closed) | ubuntu 1 522, deploy 453, root snap 459, course-intel 159 MB | 2.6 GB | owners | profiles idle since 08-23…09-01 | profile data untouched | P2-B | targeted cache-dir removal | 2.6 GB |
| opencode / codex | global node_modules + user dirs + opencode.db | 1.62 GB | root/ubuntu/deploy | last 09-06 / 08-31 | none | P2-B | `npm -g uninstall`, rm user dirs | 1.6 GB |
| Stale Claude binaries | /usr/local/bin/claude 2.1.226, ubuntu desktop bundle 2.1.246, deploy agent-host sdk-cache | 0.84 GB | root/ubuntu/deploy | no | none | P2-B | rm | 0.8 GB |
| ccd-cli 2.1.266 | /root/.claude/remote/ccd-cli/2.1.266 | 215 MB | root | **yes (4 sessions)** | sessions | P2-C now | later, when 0 processes use it | (0.2) |
| course-intelligence + ubuntu playwright | /opt/course-intelligence, /home/ubuntu/.cache/ms-playwright | 1.18 GB | root/ubuntu | no (08-31) | none | P2-B | archive output/, rm | 1.2 GB |
| Archives to R2 | /root/backups 258, darhijama tar/zip 158, recovery-darhijama 89, VPS_TRANSFER 161, legacy-ssangyong 89, spy-db duplicates ≈ 220 | 0.98 GB | root/deploy/ubuntu | no | none | P2-B | upload to mythos-offhost-backups/archive, verify, rm | 1.0 GB |
| notrejour duplicates | repos/notrejour.tn vendor+node_modules 267, ubuntu/notrejour 50 | 317 MB | deploy/ubuntu | no (live site /var/www/notrejour) | none | P2-B | rm | 0.3 GB |
| snapd cache | /var/lib/snapd/cache | 304 MB | snapd | managed | snapd | P2-B | snapd prunes; optional | 0.3 GB |
| /root/.npm | _cacache/_npx | 255 MB | root | regrows | none | P2-B | `npm cache clean --force` (P1-class, but outside this order) | 0.2 GB |
| /tmp/claude-0 scratchpads | /tmp/claude-0/* | 224 MB | root | active sessions | sessions | P2-B | age > 7 d | 0.1 GB |
| Runner _diag | /opt/mythos-gh-runner/_diag | 104 MB | mythos-runner | growing stopped | none | P2-B | `-mtime +14 -delete` | 0.05 GB |
| Unknown-purpose items | deployments/darhijama-09ffdb…tar 54 MB, opencode.db 322 MB content, /home/deploy/spy-measure 52 MB (today's sprint) | 0.43 GB | deploy | ? | ? | P2-D | ask owner | — |
| Production & tooling in use | idauto-postgres-data + all linked volumes, all running images, journal, apt lists, VS Code current servers, root playwright 1208, /root/.claude, snaps, claude-desktop, uv, ERP/idauto backups | ≈ 25 GB | — | yes | — | P2-C | none | 0 |

## 21. Reclaimable-space totals (B11)
- TOTAL_P2_RECLAIMABLE_CONFIRMED (P2-A): **≈ 2.1 GB** (merged clean worktrees 1.25 + /root/ssangyong build residue 0.8 + n8n caddy 0).
- TOTAL_P2_RECLAIMABLE_OWNER_CONFIRMATION (P2-B): **≈ 16.6 GB** (Coolify 4.9 + staging vols 0.25 + evolution:latest 1.8 + browser caches 2.6 + opencode/codex 1.6 + stale Claude 0.8 + course-intel 1.2 + archives 1.0 + casse residue 0.8 + ubuntu executor 0.34 + tmp worktrees 0.09 + notrejour dups 0.3 + snapd cache 0.3 + npm 0.2 + scratchpads 0.1 + misc 0.3).
- TOTAL_P2_PROTECTED (P2-C): ≈ 25 GB.
- TOTAL_P2_UNKNOWN (P2-D): ≈ 0.43 GB.
Disk after P2-A only: ≈ 76 %; after P2-A + all P2-B: ≈ 53 %.

## 22. Recommended next actions (no execution)
- P2-1 (highest value / lowest risk): Coolify retirement decision (4.9 GB) — dump coolify-db and the gi0p3 mysql dir to R2, then compose down + image/volume removal + drop the panel vhost.
- P2-2: merged clean worktrees (1.25 GB) + /root/ssangyong build residue (0.8 GB) + evolution:latest (1.8 GB after a one-line confirmation).
- P2-3 (optional): browser caches (2.6 GB), opencode/codex (1.6 GB), course-intelligence (1.2 GB), archives to R2 (1.0 GB).
OOM follow-ups in order: (1) session-guard oom_adj action + MemoryHigh=3G on user-0.slice; (2) DefaultOOMScoreAdjust=0 + user-manager reexec in a window; (3) MariaDB drop-in −500, then idauto-postgres `oom_score_adj: -500` with a fresh dump and an announced restart.

## 23. Blocked / unknown items
- A4 DefaultOOMScoreAdjust: deliberately not changed (19-unit blast radius, manager reexec required).
- A5: session guard lacks the oom_adj capability (code + sandbox change needed) — AGENT_PROTECTION_READY = NO.
- P2-D: darhijama-09ffdb…tar, opencode.db contents, spy-measure — purpose to be confirmed by owner.
- Evidence gap: kernel OOM log archives were purged at 20:50 by session ad7f2953; the cgroup counters and memwatch remain the source of truth.
- Swap refilled from 3 557 MB to 4 080 MB during the Phase B filesystem scans (page-cache pressure from `du`/`find` over 56 GB); PSI memory 0.4, no OOM. Swap headroom remains the structural risk noted in the 20:45 audit.

## 24. Rollback information
- erp-api: `rm /home/deploy/.config/systemd/user/erp-api.service.d/oom.conf && sudo -u deploy XDG_RUNTIME_DIR=/run/user/1001 systemctl --user daemon-reload && … restart erp-api` (returns adj to 100). Not needed — service healthy.
- mythos-wp: same with `mythos-wp.service.d/oom.conf`.
- Nothing else to roll back; Phase B made no changes.

## 25. Final classification
Phase A gate: erp-api protection applied and verified; mythos-wp applied and verified; ERP healthy; PostgreSQL healthy; schema/migrations/rows unchanged; no OOM event (6 812 → 6 812); runner, ContextForge and queue healthy. The code-identity label change is explained by the pre-existing 16:58 fast-forward and is not an ERP code change (tree hash identical).

**OOM_PROTECTION_COMPLETE_P2_AUDIT_COMPLETE**

Report copies: /home/deploy/projects/mythos-prod/docs/audits/VPS_OOM_P2_AUDIT_2026-09-13.md (untracked, deploy-owned, alongside the existing VPS_* audits; the git-push relay delivers only committed work) and /root/workspaces/reports/vps-oom-p2-audit-2026-09-13.md.

## 26. P2-A execution addendum (GO received 2026-09-13 23:17 UTC, executed 23:18–23:29)
Scope executed: merged clean unreferenced mythos-prod worktrees + /root/ssangyong storefront build residue. n8n caddy volumes not named in the GO — untouched.
- Worktrees removed (40 of 43 candidates, as deploy via `git worktree remove`, each re-verified merged-into-origin/main + clean + no process inside): audit-kb, backlog-reconcile, bridge-action-resolution-v2, bridge-timer, erp-redesign, execution-architecture, github-bridge, github-intake-redaction, github-issues, governance-approval-group, hostops-executor, hostops-readonly, hub-dashboard, mcp-ecosystem, mcp-ecosystem-2b/-3/-3-vault/-4/-5/-5-vault, mythos-v1, mythos-vault, pr-backup-tests, pr-erp, pr-monitoring, push-guard, research-comms-os, skill-trust, telegram-channel, wa-comms-1/2/3/4/5/7/8, wa-provider-verify, wa-qr-live, wt-othk-failclosed-r2, and mythos-gateway (git deregistered it but nine root-owned copies of committed files blocked the file delete; after a blob-level check of all 236 leftover files against the branch head d287b97 — 0 mismatches — the directory was removed as root and `git worktree prune` run). Branches remain on origin.
- Skipped: mythos-wp (held by a stray `node reference/server.js`, PID 1229461, deploy, since 09-05 02:59, listening 127.0.0.1:18170, in root session-2265.scope, not referenced by nginx or any unit — P2-B: stop it, then remove the worktree, 30 MB); gh-issue-196 and gh-issue-250 (executor-managed; the bridge still retries gh-issue-196 every minute — left to the executor's GC); mythos-wp-main (runs the WP service) and session-management (dirty) were excluded up front.
- /root/ssangyong/storefront/node_modules + .next removed (810 MB) after confirming main clean, pushed, merged, git-ignored paths, no process inside, and that ssangyong-storefront.service runs from /home/deploy/projects/mythos-prod; store.ssangyong.autos 200 before and after.
- Result: disk 79 % → **76 %**, used 60.01 → 58.04 GB, available 16.9 → **18.8 GB** (1.96 GB reclaimed + 5 MB gateway leftover). Worktrees registered: 79 → 41 (22 unmerged/dirty/service + 14 executor + 3 /tmp + mythos-wp + main checkout entries); /home/deploy/worktrees now 21 dirs.
- Post-checks: all deploy services active; ERP 200 / db ready / head de8c996; wp 302; idauto 200; gateway 200; idauto-postgres healthy 0 restarts; OOM counter 6 812; runner 1 listener; ContextForge healthy; dar-hijama queue healthy (RestartCount 1 = its designed hourly `--max-time=3600` exit 0 at 23:19, relaunched by the restart policy).

## 27. P2-2 execution addendum (GO received 2026-09-13 23:30 UTC, executed 23:31–23:36)
- evolution: `evolution-inspect` (Created 09-03, never started, 0 mounts) removed; image `evoapicloud/evolution-api:latest` (966625532d90, 1.83 GB, held only by that container; compose pins v2.3.7 and no EVOLUTION_IMAGE override exists) untagged and deleted. Production `evolution-api` (v2.3.7, 1bd8afc4a6cf) untouched: running/healthy, 0 restarts, same StartedAt 09-05, API 200; both evolution volumes present.
- Stray node: PID 1229461 (`node reference/server.js`, deploy, started 09-05 02:59 in root session-2265.scope, cwd /home/deploy/worktrees/mythos-wp/projects/mythos-wp, listening 127.0.0.1:18170, no nginx or loaded-unit reference, no children) stopped with SIGTERM; exited within 5 s, port 18170 closed. mythos-wp.service (PID 4080936 from mythos-wp-main, :8170) unaffected: active, public 302 before and after.
- Worktree /home/deploy/worktrees/mythos-wp (mythos/wp-20260905 @ d5a6ff5, merged into origin/main, clean, branch still on origin) removed as deploy via `git worktree remove` + prune (29 MB). The only textual reference was `~deploy/.config/systemd/user/mythos-wp.service.pre-main-20260905`, a rollback backup of the pre-09-05 unit that systemd does not load (no `.service` suffix; 0 loaded units match); it is now stale as a rollback target and is left in place for the owner.
- Result: disk 76 % → **74 %**, used 58.04 → 56.18 GB, available 18.8 → **20.7 GB** (1.86 GB reclaimed). Images 23 → 22, containers 28 → 27 (all running). Worktrees registered 41 → 40; /home/deploy/worktrees 20 dirs.
- Post-checks: ERP 200 / db ready; idauto-postgres healthy 0 restarts; OOM counter 6 812; runner 1 listener; deploy services active.

## 28. P2-3 execution addendum (GO received 2026-09-13 23:33 UTC, executed 23:34–23:40)
- Browser caches (no Chrome/Chromium process was running for any profile): cache-only directories (Cache, Code Cache, GPUCache, Service Worker, component_crx_cache, screen_ai, optimization_guide_model_store, Safe Browsing, WasmTtsEngine, extensions_crx_cache, BrowserMetrics, shader/Dawn caches) removed from /home/ubuntu/.config/google-chrome (2 407 → 856 MB, −1 514 MB), /home/deploy/.config/google-chrome (1 180 → 723 MB, −446 MB), /root/snap/chromium/common/chromium (517 → 52 MB, −453 MB), /opt/course-intelligence/chatgpt-profile (295 → 139 MB, −152 MB); plus the XDG dirs /home/ubuntu/.cache/google-chrome (84 MB) and /home/deploy/.cache/google-chrome (34 MB). Total ≈ 2.68 GB. Cookies, History, Preferences, Login Data, Extensions, Local Storage and IndexedDB verified present afterwards in every profile. /root/.config/google-chrome, chrome-work and .mythos-browser (P2-C) untouched. First attempt used a mangled find expression and removed nothing from the profiles; corrected and re-run.
- opencode / codex: no process had an executable or cwd under either tool (the pre-check's "codex=1" was this session's own shell matching its command line). `npm -g uninstall opencode-ai @openai/codex` (7 packages), then removed /home/ubuntu/.opencode, /home/deploy/.local/share/opencode (incl. opencode.db, last write 09-06), /home/ubuntu/.codex, /home/deploy/.codex; empty /usr/local/lib/node_modules/@openai scope dir removed; /usr/local/bin/opencode and /usr/local/bin/codex symlinks gone. Total ≈ 1.61 GB. Kept: /home/deploy/.config/opencode (63 MB config), the repo-tracked mythos-prod/.opencode, /root/.codex (1 MB).
- Result: used 56.24 -> 53.57 GB, reclaimed 2.66 GB; avail 20.62 -> 23.29 GB; use 70%. Cumulative 2026-09-13: 93 % → 70 % (df); per-item removals in P2-3 sum to ≈ 4.3 GB while df moved 2.66 GB — the difference is concurrent growth elsewhere on the host during the window (see §28 note).
- Post-checks: ERP ok/db ready; idauto-postgres healthy 0 restarts; OOM counter 6 812; runner 1 listener; deploy services and VNC/desktop units active; erp/idauto/darhijama 200.
- §28 note: the concurrent growth at 23:34 was another session pulling/building a container image (new containerd content blobs ≈ 0.3 GB + snapshot 2527) and creating /home/deploy/deployments/darhijama-v1.0.0-rollback-src (notre-jour.rar 49 MB) — a darhijama rollback preparation, not part of this cleanup; executor bridge events.log and session transcripts also grew a few MB.

## 29. P2-4 execution addendum (GO received 2026-09-13 23:58 UTC, executed 23:59–00:12 on 2026-09-14)
- R2 archive: 17 objects uploaded to `mythos-offhost-backups/archive/2026-09-13/` (660 MB) with a SHA256SUMS-20260913.txt index; every object verified by size and a full streaming re-download hash before the local copy was deleted (transport: python boto3 with the deploy off-host credentials; the offhost-backup.js tool was not used because it is bound to the dump/media set format).
- course-intelligence: archived as course-intelligence-20260913.tar.gz (86 MB: scripts, output, videos, audio, frames, logs, cookies/session files, both browser profiles — note the tarball contains Teachable/ChatGPT session cookies; venv excluded as regenerable), then removed /opt/course-intelligence and /home/ubuntu/.cache/ms-playwright (chromium-1234, used by nothing else) — 1 022 MB.
- VPS_TRANSFER: archived as vps-transfer-20260913.tar.gz (131 MB, 2 241 files), /home/ubuntu/incoming/VPS_TRANSFER removed — 159 MB.
- /root/backups (pre-Coolify 2026-07-21 snapshot: var-www tar, mariadb dump, nginx/letsencrypt/n8n tars): archived under root-backups/, directory removed — 257 MB (two 0-byte files were not uploaded).
- legacy-ssangyong (www tarball + mariadb dump of ssangyong_autos, 09-02): archived under legacy-ssangyong/, directory removed — 88 MB; ssangyong.autos still served from /var/www (200).
- SPY: the 09-02 pair was byte-identical (db and snapshot tars, matching sidecars); the 073708Z set (5 files) and the 09-01 spy-db-20260901T100736Z snapshot were archived under spy-db/ and removed; the empty root-owned spy-db-20260901T100729Z dir removed. Kept locally: the 073512Z set and all 2026-09-13 dumps of the active SPY sprint; spy-backup's last-backup.json untouched (ok). — 75 MB.
- STOPPED sub-step (dependency): the dar-hijama release archives (darhijama-release-704b3a3.tar/.zip/-runtime.zip, deployments/darhijama-09ffdb…tar) and recovery-darhijama-20260728-172125 / darhijama-recovery-source were NOT archived or removed: session 162b3f73 is running a dar-hijama v1.0.0 rollback preparation (built images v1.0.0-fixed at 23:58, working dir deployments/darhijama-v1.0.0-rollback-src, same 56 115 200-byte size as those tars). Re-evaluate after that work is finished.
- Result: local freed ≈ 1.6 GB; df used 54.17 → 52.49 GB, available 22.7 → **24.4 GB**, **69 %**. Post-checks: ERP ok/db ready; idauto-postgres healthy 0 restarts; OOM counter 6 812; runner 1 listener; erp-api, spy, spy-monitor, idauto-api, storefront, wp active; ssangyong.autos and spy.mythosprod.xyz 200.

## 30. P2-5 execution addendum (GO received 2026-09-14 00:05 UTC, executed 00:05–00:14)
- Removed: /usr/local/bin/claude (2.1.226, 284 MB — no process ran from it; no root-side unit, cron or script calls a bare `claude`; the executor and github-bridge resolve `claude` via /home/deploy/.local/bin first → 2.1.251; Desktop Remote sessions use ccd-cli). Consequence to know: root's PATH has no ~/.local/bin entry and /root/.profile does not add one, so an interactive root shell no longer finds `claude` by name — use /root/.local/bin/claude (2.1.258) or add ~/.local/bin to root's PATH (owner choice; no file changed for that).
- Removed: /home/deploy/.vscode-server/data/agent-host/sdk-cache (305 MB, Copilot agent-host SDK cache from 08-24, no open files, regenerable).
- Removed: /home/deploy/repos/notrejour.tn/vendor + node_modules (265 MB, git-ignored, regenerable from composer.lock / package-lock.json; the clone itself at e8fbf52 stays); /home/ubuntu/notrejour (49 MB: a single notre-jour.rar byte-identical to the copies in the clone, in /var/www/notrejour and in deployments/darhijama-v1.0.0-rollback-src). notrejour.tn 200 after.
- NOT removed (evidence contradicted the audit): /home/ubuntu/.config/Claude/claude-code/2.1.246 (248 MB) is the complete bundle; 2.1.247 is a 79 MB partial download from 09-01, so 2.1.246 is the working copy for the ubuntu desktop app — both left in place (owner may delete the partial 2.1.247 or let the app re-download). ccd-cli 2.1.266 is still in use by 4 sessions (P2-C).
- Result: df used 52.49 → 51.55 GB, available 24.4 → **25.3 GB**, **68 %** (net 0.93 GB; item sum 0.90 GB). Post-checks: ERP ok/db ready; idauto-postgres healthy 0 restarts; OOM counter 6 812; runner 1 listener; erp-api, executor, idauto-api, wp, spy active.

## 31. P2-6 execution addendum (GO received 2026-09-14 00:08 UTC, executed 00:09–00:20)
- /root/casse.autos: node_modules + .next removed (814 MB) after confirming main @ 08b5102 clean, pushed, merged into origin/main, both paths git-ignored, package-lock.json present (regenerable with `npm ci`), no process inside, no unit/nginx/docker reference, no session transcript for that path in 24 h, last source change 09-12. Clone now 17 MB, git status clean.
- /home/ubuntu/mythos-ai-executor/worktrees (23 dirs, 336 MB) removed. Finding: they were not plain copies but orphaned git worktrees of /home/deploy/projects/mythos-prod created by the ubuntu-era executor on 08-17/18 (each tk-*/.git pointed at a .git/worktrees/tk-… entry the parent had already pruned, so git could not read branch or HEAD). Content check: 13 422 files / 716 unique blobs, all present in the mythos-prod object database except the 23 .git pointer files and one projects/meta/current-context.json (mission metadata, copied to the evidence dir before deletion). No process inside, ubuntu executor unit not running (user manager down; the executor runs as deploy), no unit references. `git worktree prune` run on the parent (nothing left to prune). The task records under /home/ubuntu/mythos-ai-executor/tasks (193, historical) were left untouched.
- Result: used 51.55 → 50.35 GB, net 1.20 GB; available 25.31 → 26.51 GB; 66%. Post-checks: ERP ok/db ready; idauto-postgres healthy 0 restarts; OOM counter 6 812; runner 1 listener; erp-api, executor, idauto-api, wp, spy, storefront active.

## 32. P2-7 — SMALL ITEMS EXECUTION (GO received 2026-09-14 00:17 UTC, executed 00:17–00:20)
1. GO authorization: /var/lib/snapd/cache, /root/.npm, files older than 14 days under /opt/mythos-gh-runner/_diag. Nothing else touched.
2. Baseline (00:17): disk 66 %, used 50.35 GB, avail 26.51 GB, inodes 13 %; RAM avail 3 147 MB, swap 4 090/4 095 MB, PSI memory 0.00, OOM counter 6 812, load 0.65. ERP public 200 / db ready / identity de8c996, checkout 3e427b5 (monorepo fast-forwarded again since 23:04; ERP source hash b4372777… unchanged), 15 migrations, erp-api PID 4069289 NRestarts 0; idauto-postgres healthy 0 restarts, volume 214 348 KB; runner active, MainPID 3956454, NRestarts 0, KillMode=control-group, 1 listener, 0 workers, online/idle, 0 conflicts since the 22:20 fix; ContextForge healthy, 0 restarts, 335 MB + 137 MB swap, max-requests 2000 / jitter 200, oom 0; dar-hijama queue healthy, 0 restarts, no error.
3. snapd pre-check: 3 files, 304 MB apparent, root:root 700, 0 open files, snapd active, no change in progress (last: removals of core22/snapd revisions at 20:06 on 09-13), 10 snaps. Each cache blob has link count 2 and shares its inode with an installed snap (chromium_3520.snap, snapd_27738.snap, core22_2955.snap); `du -c` over cache+snaps = 1 527 MB = snaps alone.
4. snapd action: NONE (deleting hard links frees nothing; snapd drops them itself when the snap is superseded).
5. snapd result: SNAPD_BEFORE 304 MB apparent / 0 MB reclaimable, SNAPD_AFTER unchanged, SNAPD_RECLAIMED 0. The audit's "snapd cache 304 MB" P2-B row is withdrawn.
6. npm pre-check: /root/.npm 254 MB (_cacache 182 MB, _npx 67 MB, _libvips 7 MB, _logs/_prebuilds ≈1 MB), root:root, npm 9.2.0 / node v22.22.1, no npm or npx process, 0 open files, `npm cache verify` OK (421 entries, 182 327 459 bytes).
7. npm action: `npm cache clean --force` (root cache only) + removal of /root/.npm/_npx (npx package cache, regenerable, no npx process). Not touched: deploy/ubuntu npm caches, pnpm, node_modules, global packages, _libvips/_prebuilds.
8. npm result: `npm cache verify` OK (0 entries); NPM_BEFORE 254 MB, NPM_AFTER 6 MB, NPM_RECLAIMED 247 MB.
9. runner diag pre-check: 103 MB, 1 460 files (mythos-runner:mythos-runner 755), one open file = the live listener log Runner_20260913-222016-utc.log; age tiers: >14 d 32 files / 2 MB (08-29, 08-30), 7–14 d 641 files / 41 MB, <7 d 787 files / 50 MB; non-log artifacts: two SelfUpdate-*.log.succeed (09-03/09-04) and empty pages/ blocks/ dirs.
10. runner diag action: `find _diag -type f -mtime +14 -delete` after confirming the open file was not a candidate. No restart, no change to service, config, credentials, _work, _tool, bin, externals.
11. runner diag result: RUNNER_DIAG_BEFORE 103 MB, AFTER 100 MB, RECLAIMED 2 MB, FILES_REMOVED 32, FILES_RETAINED 1 428 (all 08-30 → 09-14 files incl. the conflict-loop evidence and the live log); _diag writable by root and mythos-runner.
12. Exact paths affected: /root/.npm/_cacache (emptied by npm), /root/.npm/_npx (removed), 32 files /opt/mythos-gh-runner/_diag/Runner_20260829-*.log and Runner_20260830-*.log (older than 14 d).
13. Preserved: everything else under _diag, /var/lib/snapd/cache (unchanged), all other caches, all production data.
14. Reclaimed: SNAPD 0 + NPM 247 MB + RUNNER_DIAG 2 MB = **TOTAL 249 MB measured at the targets**; filesystem: used 50.35 → 50.09 GB, avail 26.51 → 26.77 GB (df delta 262 MB), 66 % → 66 %.
15. ERP: public 200, db ready, identity de8c996 (process unchanged, PID 4069289, NRestarts 0), checkout 3e427b5 (unchanged during the window), 15 migrations, source-tree hash and schema hash identical before/after.
16. PostgreSQL: healthy, RestartCount 0, volume 214 348 KB unchanged, mythos_erp reachable.
17. Runner: active, KillMode=control-group, NRestarts 0, 1 listener, 0 workers, 0 duplicate-session messages since the fix, GitHub online/idle. No restart was needed.
18. ContextForge: healthy, 0 restarts, max-requests 2000 / jitter 200, 328 MB + 144 MB swap, oom 0 / oom_kill 0.
19. Dar Hijama: queue healthy, 0 restarts, no task/container error.
20. OOM: 6 812 before and after.
21. Disk: 66 % / 26.8 GB free, inodes 13 %.
22. Unexpected observations (not caused by this order): (a) the dar-hijama production stack (app, scheduler, queue, web) is now running images tagged v1.0.0-fixed, recreated by session 162b3f73 at ≈23:59 on 09-13 (before this GO) from deployments/darhijama-v1.0.0-rollback-src; the fingerprint comparison covers only the P2-7 window and is identical; (b) the monorepo checkout advanced to 3e427b5 without ERP source changes; (c) host swap moved from 4 090 to 4 095 MB (full) during the window — recorded, not a cleanup effect.
23. Rollback/recovery: npm caches rebuild themselves on the next install/npx; the removed diag files were 32 conflict-loop logs from 08-29/30 (their content pattern is fully represented by the retained 08-30 → 09-13 files); snapd untouched.
24. Remaining P2 inventory: see §33.
25. Final classification: **P2_7_COMPLETE** (snapd audited and confirmed non-reclaimable; npm cleaned and verified; diag age policy applied; no restart; all production checks green; no other item touched).

## 33. Remaining P2 inventory after P2-7 (2026-09-14 00:20 UTC)
P2-B / OWNER DECISION
- Coolify stack ≈ 4.9 GB: 6 containers up (coolify, -db, -redis, -realtime, -sentinel, i4mv app), images coolify 628 + realtime 998 + helper 581 + sentinel 48 + i4mv 2 170 MB, volumes coolify-db/redis + 4 gi0p3 staging volumes (0 links, last write 08-15), 0 non-exited Coolify applications. Unchanged.
- Dar Hijama archives (darhijama-release-704b3a3.tar/.zip/-runtime.zip, deployments/darhijama-09ffdb…tar, recovery-darhijama-20260728, darhijama-recovery-source): status CHANGED — the rollback has been executed (production on v1.0.0-fixed since ≈23:59), but session 162b3f73 is still active (transcript 00:18) and darhijama-v1.0.0-rollback-src still exists; keep until that session declares the work closed, then re-evaluate (also whether v1.0.1 images/deployment dir become the rollback point).
- Claude Desktop bundle: 2.1.246 (237 MB, working copy) + 2.1.247 (76 MB partial) — owner may delete the partial or let the app re-download.
- /tmp test worktrees (othk-verify, othkm-postmerge, othkm-test, 87 MB, registered), n8n_caddy_* volumes (0 B), /tmp/claude-0 session scratchpads (226 MB, age-based), executor bridge events.log 44 MB and dar-hijama laravel.log 27 MB (need rotation, not deletion), mythos-backups staging/erp-staging sets (25 MB, retention policy), /home/deploy/.config/opencode (63 MB config).
- Withdrawn: snapd cache (0 reclaimable, hard links).
P2-C
- ccd-cli 2.1.266 (4 sessions) and 2.1.270 (6 sessions) — both in use; 20 remaining deploy worktrees (unmerged, dirty or in service) + 14 executor gh worktrees; idauto-postgres-data and all linked production volumes; ERP/idauto backups and R2 archive; VS Code current servers; root Playwright chromium-1208; snaps, claude-desktop, uv/pnpm tools; journal (capped).
P2-D
- deployments/darhijama-09ffdb0386d1a2bd78b69385a4e3359fbdb6201e.tar (56 MB, same size as the release tar — likely the same build; confirm with the rollback session), /home/deploy/spy-measure (52 MB, today's SPY sprint output — owner).
Status changes since the audit: P2-A executed (worktrees, ssangyong residue); P2-2 (evolution:latest, stray node, mythos-wp worktree); P2-3 (browser caches, opencode/codex); P2-4 (course-intelligence, archives to R2; dar-hijama archives deferred); P2-5 (stale claude binary, sdk-cache, notrejour duplicates; desktop bundle kept); P2-6 (casse residue, ubuntu executor worktrees); P2-7 (npm, diag; snapd withdrawn). Disk 93 % → 66 %, free 5.1 → 26.8 GB.

## 34. P2-8 — COOLIFY STACK REMOVAL (GO received 2026-09-14 00:22 UTC, executed 00:23–00:27)
- Pre-checks (00:23): 5 Coolify containers + the orphaned i4mv notrejour build container; only those six on the `coolify` network; no other container, unit, cron or vhost referenced coolify-db/redis or port 8000 (the only unit mentioning Coolify is mythos-docker-firewall.service, which keeps a DOCKER-USER DROP for port 8000 and never references the bridge — left untouched); 3 managed apps all `exited:unhealthy` (08-15 / 08-25), last deployment 2026-07-29, 0 services/databases, last login 08-15; panel.mythosprod.xyz vhost only received scanner traffic.
- Archive to R2 (archive/2026-09-14/coolify/, each verified by size + full re-download hash; SHA256SUMS.txt beside them, local copy r2-archive-coolify-SHA256SUMS-2026-09-14.txt): coolify-db-final-20260914.dump (pg_dump -Fc, 1.1 MB, 66 table-data sections), data-coolify-20260914.tar.gz (33 KB: /data/coolify incl. source/.env with APP_KEY and the ssh/ keys — needed to reuse the dump), coolify-volumes-20260914.tar.gz (57 MB: coolify-db, coolify-redis and the four gi0p3 staging volumes incl. the staging dar_hijama_production MySQL data).
- Removed, in order: container i4mv37ig6xavokv0kpy5517d-194407838591; container coolify-sentinel; `docker compose -p source down` (coolify, coolify-db, coolify-redis, coolify-realtime); volumes coolify-db, coolify-redis, gi0p3…_staging-{mysql,redis-queue,redis-session,storage}; images coollabsio/coolify:4.3.10, coolify-realtime:1.0.17, coolify-helper:1.0.15, sentinel:0.0.22, i4mv37ig6xavokv0kpy5517d:52e7b2fd… (5 image IDs deleted; shared postgres:15-alpine and redis:7-alpine kept); nginx: sites-enabled/panel.mythosprod.xyz symlink removed (sites-available file kept; a copy is in /root/workspaces/reports/), `nginx -t` OK, graceful reload; /data/coolify removed (448 KB).
- NOT done (blocked by the session's permission classifier, not by a technical problem): `docker network rm coolify` — the network is now empty (0 containers) and harmless; owner/operator command: `docker network rm coolify`.
- Follow-ups for the owner: the Let's Encrypt certificate panel.mythosprod.xyz still exists with the nginx authenticator and will fail to renew without a vhost (`certbot delete --cert-name panel.mythosprod.xyz`); the DNS record can go; the DOCKER-USER port-8000 rule in mythos-docker-firewall is now moot but harmless; `5:# on this host for panel.mythosprod.xyz and tv.mythosprod.xyz.` in ordre.mythosprod.xyz is a textual reference to review. The panel hostname now falls into nginx's first 443 block (darhijama.tn) like any unmatched name.
- Result: used 50.09 → 45.18 GB (net 4.90 GB); available 26.77 → 31.68 GB; 66% → 59%. Docker now 21 containers (all running), 19 images, 11 volumes; /var/lib/containerd 16.2 GB (was 20 GB), /var/lib/docker 1.1 GB. Docker's "reclaimable images" figure (1.7 GB) is postgres:15-alpine (kept: the idauto-postgres compose tag) and the dar-hijama v1.0.1 images (now unused because production runs v1.0.0-fixed since 23:59 — they are that rollback's return point, P2-C for now); dangling 3d0f7584ed7d is the running idauto-postgres image.
- Post-checks: ERP public 200 / db ready / de8c996, erp-api PID unchanged NRestarts 0, 15 migrations; idauto-postgres healthy 0 restarts, volume unchanged; runner active, 1 listener, NRestarts 0; ContextForge, dar-hijama queue, evolution, omniroute, dex, jellyfin healthy/running; nginx, docker, containerd, mariadb, mcp-http, docker-firewall active; all deploy services active; idauto, darhijama, notrejour, wp, gateway, n8n, tv endpoints answering; OOM counter 6 812; swap 3 797 / 4 095 (dropped 300 MB with the stack).

## 35. P2-9 — DAR-HIJAMA ARCHIVES AND v1.0.1 IMAGES: BLOCKED (GO received 2026-09-14 00:32 UTC)
- Stop condition 1 (v1.0.1 images): /home/deploy/deployments/darhijama-v1.0.1/.env.production still declares SOURCE_COMMIT=v1.0.1 and `docker compose … config` resolves app/web to the v1.0.1 images; the running v1.0.0-fixed containers (started ≈23:59 by session 162b3f73 from the same directory) carry config-hash 132dcd6f… ≠ the on-disk config hash 8830d2db…, i.e. they were started with an ad-hoc override. Deleting the images would leave the deployment directory unable to recreate its own stack and remove the roll-forward point. Not deleted.
- Stop condition 2 (archives): session 162b3f73 is still active (transcript 00:32; at 00:21 it announced "actual execution and deployment" of the static pre-Laravel site) and its transcript references every candidate path (darhijama-release-704b3a3 ×6, darhijama-09ffdb0386 ×5, recovery-darhijama-20260728 ×4, darhijama-recovery-source ×6). Deleting inputs of an in-flight operation is a stop condition. Not deleted.
- Provenance recorded: 704b3a3 = commit on origin/release/darhijama-1.0.0, 09ffdb0386 = commit on origin/release/darhijama-1.0.1 (both in projects/darhijama and on GitHub); the two 56 115 200-byte tars differ in content (different releases).
- Non-destructive preparation done: all six artefacts placed on R2 under archive/2026-09-14/darhijama/ and verified by full re-download hash (SHA256SUMS.txt beside them; local index r2-archive-darhijama-SHA256SUMS-2026-09-14.txt): docker save of both v1.0.1 images (363 MB gz), recovery-darhijama-20260728-172125 + darhijama-recovery-source (93 MB gz), darhijama-release-704b3a3.tar/.zip/-runtime.zip, darhijama-09ffdb…tar. Staging copies removed; nothing on the host deleted; both v1.0.1 images still present.
- Unblock conditions: (a) session 162b3f73 declares its dar-hijama work closed; (b) the owner decides the production target — either update .env.production to SOURCE_COMMIT=v1.0.0-fixed (then the v1.0.1 images become unreferenced and can be removed, 1.4 GB) or return to v1.0.1 (then the v1.0.0-fixed images become the candidates); (c) after that, the release tars/recovery dirs (≈ 260 MB) can be removed in one step since verified copies exist on R2. Also flag: the on-disk config ≠ running state mismatch means any routine `compose up -d` today would silently revert production to v1.0.1.
- Post-checks: darhijama.tn 200, ERP 200, OOM counter 6 812, no service touched. Disk 59 % → 61 % during the window is other activity (P2-9 deleted nothing).

## 36. P2-10 — /tmp test worktrees + n8n caddy volumes (GO received 2026-09-14 00:38 UTC, executed 00:39–00:41)
- Removed worktrees /tmp/othk-verify-cc36e3b and /tmp/othkm-postmerge (deploy-owned, `git worktree remove` as deploy) and /tmp/othkm-test (root-owned directory: rm, then `git worktree prune` as deploy). All three were detached at commits already on origin/main (cc36e3b, cf6a42d, 1a61396), clean, unreferenced, untouched since 09-06, no process inside. Registry: 40 → 37 worktrees, no /tmp entries left. ≈ 87 MB.
- Removed Docker volumes n8n_caddy_config and n8n_caddy_data (created 07-09 by an earlier n8n compose; 0 bytes, 0 files, 0 links; caddy absent from the current /opt/n8n compose and from its 08-10 backup copy). n8n container untouched (Up 3 weeks), n8n.ssangyong.autos still answering. 0 bytes reclaimed by design.
- Result: used 46.18 → 46.18 GB; available 30.68 → 30.68 GB; 61%; target reclaimed 85 MB. Post-checks: ERP ok/db ready; idauto-postgres healthy 0 restarts; OOM 6 812; runner 1 listener; erp-api, oth-knowledge-http, executor active.
- Observation (not touched, outside this GO): /tmp also holds 3 418 `othk-cache-<id>` temp entries (≈ 22 MB, created 09-05 → 09-08 by oth-knowledge test runs, none open) plus a few othkm-* scratch files — a small age-based P2 candidate for a later GO.

## 37. P2-11 — othk temp directories + Claude Desktop 2.1.247 partial (GO received 2026-09-14 00:42 UTC, executed 00:43–00:46)
- Correction to §36's observation: the "3 418 othk-cache entries" were a family of mkdtemp test scratch directories created by tests/othk-*-test.js (prefixes othk-test-, othk2-…othk8-*, othk-fc-, othk-search-, othk-md-, othk-eval-, othk-cache-), 3 414 directories / 25 MB, all created 2026-09-05 → 09-08 (an earlier breakdown that missed the digit-suffixed prefixes said 1 255), none open, plus hand-made othkm-* dry-run/review scratch items and three othk-*.txt notes.
- Removed: the 3 414 <id>-suffixed othk* test directories older than 2 days (25 MB; othk-cache-* = 32 of them; none open). Not touched: othkm-review-20260906, othkm-probe, othkm-dryrun-20260906, othkm-migration-dryrun-20260906-*, othkm-propose-erp-*.js, othkm-erp-ui-local.patch, othk-baseline-set.txt, othk-now-set.txt, othk-check.txt (operator artefacts, 09-06/07). oth-knowledge-http untouched and active.
- Removed: /home/ubuntu/.config/Claude/claude-code/2.1.247 — a single download.5bff56908157.zst.partial (75 MB, zstd partial from 09-01 20:40), no open handle, desktop app not running; 2.1.246 (working bundle) intact; the app re-downloads on next update.
- Result: used 46.18 → 46.10 GB; available 30.68 → 30.76 GB; 60% (≈ 100 MB at the targets: 25 MB temp dirs + 75 MB partial). Post-checks: ERP ok/db ready; idauto-postgres healthy 0 restarts; OOM 6 812; runner 1 listener; erp-api and oth-knowledge-http active.

## 38. P2-12 — /tmp/claude-0 scratchpads + othkm scratch artefacts (GO received 2026-09-14 00:46 UTC, executed 00:47–00:49)
- othkm artefacts (/tmp/othkm-review-20260906, othkm-probe, othkm-dryrun-20260906, othkm-migration-dryrun-20260906-130353, othkm-propose-erp-auth.js, othkm-propose-erp-final.js, othkm-erp-ui-local.patch; 1 040 KB, 09-06/07, none open): the .js/.patch content existed in no repository, so the set was tarred (193 KB) to R2 archive/2026-09-14/tmp-othkm/ (verified by re-download hash) and to /root/workspaces/reports/, then removed. The three othk-*.txt notes were not named in the GO and remain.
- Scratchpads: policy = keep any session still running (6 live ccd-cli sessions incl. this one) or whose transcript changed within 3 days; remove the rest. Removed 24 session directories (92 MB): 66d5e142 (80 MB, session ended 09-07), 466dc1cc (12 MB, 09-07), b7bd85ee (09-08) and 21 empty leftovers without a transcript, plus 12 stale cache-break-state-*.json files of finished sessions. Kept 9 (162b3f73, 4f9e748e, 6ef2e6ca, 986e4f9e = this session, ad7f2953, c447f7e7 72 MB, e9d20300, ee7d1b23, efbbe439). /tmp/claude-0: 226 → 134 MB. Session transcripts under /root/.claude/projects were not touched.
- Result: ≈ 93 MB at the targets (df unchanged at 2-decimal resolution, 60 %, 30.76 GB free). Post-checks: ERP ok/db ready; idauto-postgres healthy 0 restarts; OOM 6 812; runner 1 listener; this session's scratchpad and all evidence intact.
