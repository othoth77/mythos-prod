# VPS STABILITY REMEDIATION — 2026-09-13 22:15–22:24 UTC

## RUNNER
- before: 2 Runner.Listener (orphan 2641581 from 09-05 11:43 under a parentless run-helper.sh 2641577, holding the GitHub session; service listener 3938080 looping on "A session for this runner already exists"), KillMode=process, NRestarts=122, Runner.Worker 0, GitHub API: runner online, busy=false, no queued/in-progress runs. Version 2.337.0, name mythos-vps-runner, repo othoth77/mythos-prod.
- action: added drop-in /etc/systemd/system/mythos-gh-runner.service.d/10-killmode.conf with `KillMode=control-group` (KillSignal stays SIGINT; override.conf, Restart=always, RestartSec=15, hardening, identity untouched); `systemctl daemon-reload`; `systemctl stop` — with the new KillMode the stop signalled the whole cgroup, the orphan listener logged "Deleting Runner Session… Runner execution been cancelled" and exited on its own (no manual kill needed; 0 listeners, 0 helpers after stop); `systemctl start`; then ONE controlled `systemctl restart` as the compatibility proof: "Stopping… Exiting… Started… Listening for Jobs", no "remains running", no left-over process.
- after (22:24): exactly 1 Runner.Listener (3956484 ← run-helper.sh 3956462 ← run.sh 3956454 = MainPID), 0 Runner.Worker, NRestarts=0 since 22:20:15, 0 conflict messages, GitHub: online, busy=false. `mixed` was rejected because run.sh runs in plain `run()` mode (no manual trap): only the main PID would be signalled and the listener would sit unsignalled until the 5-minute stop timeout.
- duplicate session resolved: YES. restart loop resolved: YES (no restart in 4 min where the loop produced one every 8; 4 diag logs at 22:xx = the stop/start/restart cycle only). No job interrupted.

## CONTEXTFORGE
- before: image ghcr.io/ibm/mcp-context-forge@sha256:89c3df1d…, compose /home/deploy/deployments/mythos-gateway/docker-compose.yml, mem_limit 768m / memswap_limit 1g, command built by the image's run-gunicorn.sh from env (GUNICORN_WORKERS=2, GUNICORN_TIMEOUT=120, max-requests default 100000). cgroup 440 MB + 255 MB swap (at the 256 MB swap cap), 7 processes: master + 2 workers (229/257 MB) + 4 children of the workers (65 MB + 171 MB swap each) — these are per-worker subprocesses spawned by the app, not stale workers as the audit assumed. 23 limit hits since 09-08.
- configuration change: appended to contextforge.env (0600 deploy, perms preserved): `GUNICORN_MAX_REQUESTS=2000`, `GUNICORN_MAX_REQUESTS_JITTER=200` (the documented env names in run-gunicorn.sh; workers kept at 2; limits unchanged). `docker compose up -d contextforge` recreated only that container (github-mcp-rw StartedAt unchanged 09-02).
- after: healthy, restarts 0, command shows `--max-requests 2000 --max-requests-jitter 200`, cgroup 544 MB, **swap 0 MB** (was 255), peak 556 MB, memory.events all zero, 2 worker boots (the initial ones), no SIGKILL, 7 processes as designed, /health 200 locally and via https://mythosprod.xyz/gateway/health, mythos-mcp-http active.
- worker count: 2 (+ master + 4 app subprocesses). worker stability: no churn in the observation window. OOM status: zero events.

## DAR-HIJAMA QUEUE
- before: dar-hijama-production-queue-1 (785353ea) Exited(0) since 2026-09-06 08:20, 352 restarts, error "failed to create task for container: AlreadyExists: task 785353ea…: already exists" (stale containerd task record; no ctr task/container existed any more). Compose project dar-hijama-production, files docker-compose.production.yml + ops-production/docker-compose.host.yml, env .env.production; config hashes of app and queue matched the running containers exactly; queue mounts only the named volume dar-hijama-production_staging-storage; failed_jobs = 0; no other queue worker (scheduler is separate).
- action: `docker compose … -p dar-hijama-production up -d --no-deps --force-recreate queue` (new container bab8e5f3; no other container, volume or database touched — app/scheduler/web/mysql/redis ×3 keep their 08-22 StartedAt and 0 restarts; 4 project volumes still present).
- after: running, healthy, restarts 0, no error, worker `php artisan queue:work redis --queue=notifications,default …` present; it drained the 7-day backlog: 10 364 jobs DONE (QueueHeartbeatJob) with 0 errors; darhijama.tn 200.
- queue status: OPERATIONAL.

## SYSTEM (22:24)
RAM: 7 746 MB total, 4 646 used, 3 099 available. Swap: 3 570 / 4 095 MB (was 3 883 at 22:15, 4 032–4 095 during the audit); si/so 0 KB/s. PSI: memory some 0.00/0.01/0.00, cpu some 4.2/4.5/5.2, io some 0.0/0.2/0.4. OOM counter: 6 812, unchanged (still zero kills since 09-08). Disk: 79 % (16 GB free; other sessions executed further cleanup after P1). Docker: 28 containers, 27 running (only evolution-inspect stays Created, untouched). nginx, docker, containerd, mariadb, mythos-mcp-http active; erp-api, idauto-api, mythos-wp, spy, storefront, executor active; erp/idauto/darhijama/gateway all HTTP 200.
Top RSS: two new ccd-cli 2.1.270 sessions 324/310 MB (a new client version appeared during the window), ccd-cli 2.1.266 269 MB, ContextForge master+workers 261–268 MB, omniroute 259 MB, n8n 243 MB.

## ERP
- health: 200, `{"ok":true,"db":"ready","role":"erp_app"}` locally and public HTTPS.
- code identity: 6a2e965 verified (checkout HEAD de8c996 unchanged); ERP source-tree hash identical before/after.
- migrations: 15, last applied 2026-09-13 11:10:42 — unchanged.
- data integrity: 44 of 47 tables byte-identical in row counts; three tables moved by exactly +1 row each (audit_log 104→105, login_attempts 65→66, sessions 51→52) = one user login event through the application during the window, not a remediation effect. erp-api not restarted (PID 2101846 since 11:10, NRestarts 0).

## POSTGRES
- idauto-postgres running, healthy, restarts 0, started 08-22 (unchanged), volume idauto-postgres-data 214 348 KB before and after, mythos_erp reachable (SELECT 1).

## OOM PROTECTION — READ-ONLY ASSESSMENT (nothing changed)
Current inheritance: deploy's user manager (user@1001.service) itself runs at adj 0 (root drop-in oom.conf from 2026-09-01), but the manager's `DefaultOOMScoreAdjust` is still **100**, so every unit created after the 09-01 remediation inherited 100. The eight services patched on 09-01 sit at 0 (idauto-api, executor, command-center, os-console, oth-knowledge, spy, spy-monitor, storefront). Still at 100: **erp-api (score 735, highest on the host), mythos-wp (734, NRestarts 368), pulseaudio (326 restarts), gcr-ssh-agent (211), gpg-agent, dbus**. For comparison: Claude sessions 678, omniroute ≈ 704, nginx 666, postgres 666, dockerd −500, containerd-shim −998.
Technical constraints: a user manager runs unprivileged (no CAP_SYS_RESOURCE), so a unit-level `OOMScoreAdjust` **below 0 cannot be applied from deploy's --user units** (systemd logs a permission error and ignores it). Values ≥ 0 work. Negative values are only possible from root: system units (User=deploy), Docker `oom_score_adj:` in compose, or a root helper writing /proc/PID/oom_score_adj.
Proposed plan (separate change, owner-approved):
1. Parity (safe, no capability needed): drop-ins `OOMScoreAdjust=0` for erp-api and mythos-wp under ~deploy/.config/systemd/user/<unit>.service.d/oom.conf, plus `DefaultOOMScoreAdjust=0` in ~deploy/.config/systemd/user.conf; apply with `systemctl --user daemon-reload` and a restart of erp-api and mythos-wp in a window (erp-api restart ≈ 2 s). Effect: ERP stops being the preferred victim; scores drop from 735 to ≈ 670.
2. Shift blame to the reclaimable consumers (root-side, safe): agent session scopes to +500 (session guard already runs as root with OOMScoreAdjust=500 on itself; it can set /proc/PID/oom_score_adj for ccd-cli PIDs), and `MemoryHigh=3G` on user-0.slice so the slice is throttled before the host OOMs. Restart NO.
3. Real protection for the data layer (root-side): compose `oom_score_adj: -500` for idauto-postgres (container recreate = DB restart, schedule it) and a system drop-in `OOMScoreAdjust=-500` for mariadb; optionally migrate erp-api to a system unit (User=deploy) to allow −500 there too.
Values −500/0/+500 are technically safe: they only reorder victims, never prevent the OOM killer from acting (no −1000 anywhere except sshd/udev which already have it).

## P2 CLEANUP
NOT EXECUTED (Coolify, evolution:latest, worktrees, browser profiles, opencode/codex, Claude binaries, course-intelligence, archives, duplicate clones all untouched by this session).

## CHANGES (exact)
1. NEW file /etc/systemd/system/mythos-gh-runner.service.d/10-killmode.conf (`KillMode=control-group`); `systemctl daemon-reload`; mythos-gh-runner.service stopped, started, restarted once.
2. /home/deploy/deployments/mythos-gateway/contextforge.env: appended two lines `GUNICORN_MAX_REQUESTS=2000`, `GUNICORN_MAX_REQUESTS_JITTER=200` (+ comment); container mythos-contextforge recreated by `docker compose up -d contextforge`.
3. Container dar-hijama-production-queue-1 recreated by `docker compose … up -d --no-deps --force-recreate queue` (old container 785353ea removed by compose; image, volumes, env, other containers unchanged).
No other file, unit, container, volume, database or swap setting was modified.

FINAL STATUS
RUNNER_FIXED: YES
CONTEXTFORGE_STABILIZED: YES
DAR_HIJAMA_QUEUE_FIXED: YES
ERP_HEALTHY: YES
POSTGRES_HEALTHY: YES
P2_EXECUTED: NO
