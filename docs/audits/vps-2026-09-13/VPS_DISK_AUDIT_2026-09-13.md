# VPS DISK AUDIT — 2026-09-13 17:15 UTC (READ-ONLY)

Host: vps-4722f0a9 (OVH, 75 GB disk, 7.7 GB RAM, 4 GB swap 100 % used). Nothing was deleted, stopped, pruned or changed.

## 1. Current state

| Metric | Value |
|---|---|
| / (ext4, /dev/sda1) | 72 GB size, 67 GB used, 5.1 GB avail, **93 %** |
| Inodes | 17 % used (no inode pressure) |
| /var | 27 GB (containerd 20 GB, docker 2.9 GB, snapd 1.7 GB, log 0.95 GB, www 0.5 GB) |
| /home | 15 GB (deploy 9.5 GB, ubuntu 4.9 GB) |
| /root | 12 GB (vscode-server 3.1, workspaces 2.6, .claude 1.2, .npm 1.1, ssangyong 0.85, casse.autos 0.83, .cache 0.67, snap 0.55, backups 0.26) |
| /usr | 7.8 GB (OS + desktop + fonts + claude-desktop + global node modules) |
| /opt | 3.2 GB (gh-runner 2.2, course-intelligence 0.52, google-chrome 0.43) |
| swap files | /swapfile + /swapfile2 = 4 GB (both active, both full — keep) |

Key fact: Docker runs with the **containerd snapshotter** (`io.containerd.snapshotter.v1`). Image layers live in `/var/lib/containerd` (16 GB unpacked snapshots + 4.5 GB compressed content blobs), not in `/var/lib/docker` (which only holds volumes 2.6 GB and container logs 0.2 GB). Every image is stored twice (compressed + unpacked), so removing an image frees ~1.2× its `docker images` size. Build cache: 0 B.

## 2. Where the space goes (top consumers)

| Consumer | Size | Status |
|---|---|---|
| Docker images (25) via containerd | ~20.7 GB | 19 in use by running services, ~4.9 GB Coolify (dormant), 1.83 GB evolution:latest (unused tag), 0.05 GB curl images |
| VS Code server builds (root 4 + deploy 3) | 5.0 GB | only the newest is needed; auto-re-downloaded |
| Docker volumes | 2.6 GB | 1.65 GB = 35 anonymous leaked Postgres volumes (0 links) |
| Chrome/Chromium profiles (5 profiles) | 4.2 GB | ~2.5 GB is cache |
| /root/workspaces + /root/ssangyong + /root/casse.autos | 4.3 GB | mostly node_modules/.next; 1.8 GB are merged 09-08 worktrees |
| GitHub Actions runner | 2.2 GB | 1.35 GB = previous version dirs + consumed update package |
| npm cache (root) | 0.96 GB | pure cache |
| opencode + codex CLIs (global + per-user + DB) | 1.6 GB | last used 08-08 / 09-06 |
| Claude Code binaries (8 copies, 5 versions) | 2.1 GB | 0.5 GB clearly stale |
| Playwright browsers (root 1208, ubuntu 1234) | 1.28 GB | root set used by casse/piece (playwright 1.58); ubuntu set only by course-intelligence |
| /var/log | 0.95 GB | syslog.1 389 MB + kern.log.1 163 MB uncompressed (delaycompress), journal 392 MB (capped 500 MB) |
| /home/deploy/worktrees (60) + executor worktrees | 2.0 GB | 44 already merged into origin/main |
| Old backups / transfer archives on-box | 0.9 GB | candidates to archive to R2 |

## 3. Docker inventory

### Images

| ID | Repository:Tag | Size | Created | Used by container(s) | Referenced by | Safe to remove | Reason |
|---|---|---|---|---|---|---|---|
| 89c3df1d31ed | ghcr.io/ibm/mcp-context-forge:latest | 555 MB | 12 d | mythos-contextforge (Up) | deployments/mythos-gateway compose (digest-pinned) | NO | MCP gateway, live |
| a1c44bab54d8 | alpine/curl:latest | 21 MB | 2 w | none | nothing found | YES | ad-hoc test image, re-pullable |
| 5f05c0af808a | coollabsio/coolify:4.3.10 | 628 MB | 3 w | coolify (Up) | /data/coolify/source compose | P2 | Coolify dormant (see §5) |
| 1817b57d4391 | ghcr.io/github/github-mcp-server:latest | 66 MB | 3 w | mythos-github-mcp, mythos-github-mcp-rw | gateway compose + docker run | NO | live |
| ff02b58f971e | redis:7-alpine | 58 MB | 3 w | mcp-auth-redis, coolify-redis | mcp-auth compose (digest) | NO | live |
| 6fb2357f3d59 | coollabsio/coolify-helper:1.0.15 | 581 MB | 4 w | none | pulled on demand by Coolify deploys | P2 | only needed if Coolify stays |
| fe0737ba566a | postgres:15-alpine | 417 MB | 4 w | coolify-db | idauto-postgres compose references this tag | NO | idauto-postgres would pull it on recreate |
| cf78e76683b9 | postgres:16-alpine | 420 MB | 4 w | evolution-postgres | evolution compose | NO | WhatsApp gateway DB |
| 16dc38393eae | coollabsio/coolify-realtime:1.0.17 | 998 MB | 4 w | coolify-realtime | Coolify compose | P2 | Coolify dormant |
| 246e268cecec | ghcr.io/babs/mcp-auth-proxy:1.4.0 | 32 MB | 5 w | mythos-mcp-auth-proxy | mcp-auth compose (digest) | NO | live |
| 2bf79cf16747 | diegosouzapw/omniroute:3.8.49 | 2.63 GB | 6 w | omniroute (Up) | /home/ubuntu/omniroute/compose.yaml (digest) | NO | production |
| ce1b868b31af | mythos-darhijama-production-web:v1.0.1 | 75 MB | 6 w | dar-hijama-production-web-1 | deployments/darhijama-v1.0.1 compose | NO | production (darhijama.tn) |
| b00520192a95 | mythos-darhijama-production-app:v1.0.1 | 1.33 GB | 6 w | app-1, scheduler-1, queue-1 | same | NO | production |
| b3b90af2a655 | mysql:8.4 | 1.12 GB | 6 w | dar-hijama-production-mysql-1 | same | NO | production DB |
| e7723ff73d96 | redis:7.4-alpine | 58 MB | 7 w | 3× dar-hijama redis | same | NO | production |
| 4ffd3bf5c65d | i4mv37ig6xavokv0kpy5517d:52e7b2fd… | 2.17 GB | 7 w | i4mv37…-194407838591 (Up, unreachable) | Coolify app compose | P2 | Coolify test build of notrejour (sqlite, APP_ENV=local); real notrejour.tn is nginx+php-fpm+mariadb |
| 275644b8fb14 | coollabsio/sentinel:0.0.22 | 48 MB | 7 w | coolify-sentinel | Coolify | P2 | Coolify dormant |
| e0d9593724e3 | docker.n8n.io/n8nio/n8n:latest | 2.47 GB | 2 mo | n8n-n8n-1 (Up) | /opt/n8n compose | NO | n8n.ssangyong.autos |
| 3d0f7584ed7d | `<untagged>` (older postgres:15-alpine) | 417 MB | 2 mo | **idauto-postgres (Up)** | idauto-postgres compose (tag moved) | **NO** | hosts idauto_production, mythos_erp, mythos_wp, ssangyong_autos. Shows as *dangling* — never rely on blind image pruning |
| aefb67e6a7ff | jellyfin/jellyfin:latest | 2.27 GB | 3 mo | jellyfin (Up) | docker run (no compose), tv.mythosprod.xyz | NO* | running; *library is empty (/home/ubuntu/TV 4 KB) — decommission is an owner decision |
| 966625532d90 | evoapicloud/evolution-api:latest | 1.83 GB | 4 mo | evolution-inspect (Created, never started) | nothing (compose pins v2.3.7; no EVOLUTION_IMAGE override) | P2 | leftover inspection pull from 09-03 |
| b8469881d3cb | ghcr.io/dexidp/dex:v2.45.0 | 211 MB | 6 mo | mythos-dex | mcp-auth compose (digest) | NO | live |
| 1bd8afc4a6cf | evoapicloud/evolution-api:v2.3.7 | 1.83 GB | 9 mo | evolution-api (Up, healthy) | evolution compose | NO | WhatsApp gateway LIVE |
| 1174e6a29634 | mcp/context7:latest | 425 MB | 15 mo | mythos-context7 (Up) | docker run | NO | live |
| d9b4541e214b | curlimages/curl:8.10.1 | 32 MB | 24 mo | none | nothing found | YES | re-pullable |

### Containers

| Name | Image | Status | Project / working dir | Safe | Reason |
|---|---|---|---|---|---|
| evolution-api | evolution-api:v2.3.7 | Up 8 d | mythos-whatsapp-evolution | NO | WhatsApp LIVE |
| evolution-postgres | postgres:16-alpine | Up 8 d | same | NO | its DB |
| evolution-inspect | evolution-api:latest | Created (09-03), never ran | none | P2 YES | inspection leftover; pins the 1.83 GB :latest image |
| mythos-mcp-auth-proxy / mythos-dex / mcp-auth-redis | — | Up 11 d | mythos-mcp-auth | NO | OAuth bridge |
| mythos-github-mcp-rw / mythos-contextforge | — | Up | mythos-gateway | NO | gateway |
| mythos-context7 / mythos-github-mcp | — | Up 2 w | docker run | NO | MCP servers |
| coolify, coolify-db, coolify-redis, coolify-realtime, coolify-sentinel | — | Up 3 w | /data/coolify/source | P2 | dormant: all 3 Coolify apps `exited:unhealthy`, last deploy 2026-07-29, last user activity 2026-08-15, no traefik proxy running |
| omniroute | omniroute:3.8.49 | Up 6 d | /home/ubuntu/omniroute | NO | production |
| idauto-postgres | 3d0f7584ed7d | Up 3 w | deployments/idauto-postgres | NO | **production Postgres incl. ERP** |
| jellyfin | jellyfin:latest | Up 3 w | docker run | NO* | see image note |
| dar-hijama-production-{redis-queue,redis-session,redis-cache,scheduler,app,web,mysql}-1 | — | Up 3 w | deployments/darhijama-v1.0.1 | NO | production |
| dar-hijama-production-queue-1 | darhijama-app:v1.0.1 | **Exited(0) 7 d** | same | NO | production compose member; exit is a service-health item, not disk. `docker container prune` would delete it — never run it |
| n8n-n8n-1 | n8n:latest | Up 3 w | /opt/n8n | NO | production |
| i4mv37ig6xavokv0kpy5517d-194407838591 | 4ffd3bf5c65d | Up 3 w | Coolify app | P2 | unreachable test build (port not published, proxy absent) |

### Volumes

| Volume | Size | Links | Created | Owner | Safe | Reason |
|---|---|---|---|---|---|---|
| idauto-postgres-data | 219 MB | 1 | — | idauto-postgres | **NO** | production DBs incl. mythos_erp |
| mythos-whatsapp-evolution_evolution_pgdata / _instances | 67 MB / 0.3 MB | 1 | — | evolution | NO | WhatsApp session + DB |
| n8n_n8n_data | 64 MB | 1 | 07-09 | n8n | NO | workflows DB |
| n8n_caddy_config, n8n_caddy_data | 0 B | 0 | 07-09 | old n8n caddy | YES (0 B) | nothing to gain |
| coolify-db / coolify-redis | 134 MB / 0.6 MB | 1 | — | Coolify | P2 | dormant stack |
| dar-hijama-production_staging-{mysql,redis-queue,redis-session,storage} | 221/54/9/30 MB | 1–4 | — | darhijama prod | NO | production (the "staging" name is historical) |
| gi0p3mbss6geqhunih23fy6f_staging-{mysql,redis-queue,redis-session,storage} | 208/48/0.03/1 MB | 0 | 07-29 | Coolify darhijama staging app (exited since 08-15) | P2 | orphaned; archive mysql dir first |
| 93b0756d… / 9024d3ec… / a6706c6b… / 51243ca9… | ≤ 8 KB | 0–1 | — | anonymous redis dumps | trivial | — |
| **35 anonymous 64-hex volumes** (full list in §9) | 42–80 MB each, **1.65 GB total** | 0 | 08-11 → 09-12 | PG 15 data dirs (4–6 DBs each) created by `tests/erp-*-drill.sh` (`docker run … postgres:15-alpine -P`) when the `docker rm -f -v` cleanup did not run (drills killed/OOM) | **P1 YES** | no container references them; production ERP data is in idauto-postgres-data, not here |

## 4. Services → disk map

| Service | Runs from | Disk it owns | Verdict |
|---|---|---|---|
| Mythos ERP (erp-api.service, deploy) | /home/deploy/projects/mythos-prod/sites/erp.mythosprod.xyz (2.3 MB; migrations in api/migrations) | DB `mythos_erp` (12 MB) in idauto-postgres-data; dumps /home/deploy/mythos-backups/erp-db-dumps (1 current) + /var/backups/mythos-db (30 archived, 6 MB) + erp-staging (33 sets, 6 MB) | P0 |
| ERP backup mechanism (verified) | mythos-backup-db.timer daily ~04:07 → `ops/backup/mythos-backup-run-db.sh backup` → stage → manifest → verify-local → push to Cloudflare R2 bucket `mythos-offhost-backups` prefix `mythos-erp/daily` → verify-remote; mythos-backup-db-verify.timer daily; mythos-restore-db-test.timer monthly. Health file 2026-09-13 15:33 status ok, 0 consecutive failures. | — | P0, working |
| idauto (idauto-api, nginx idauto.tn) | /home/deploy/projects/idauto | idauto_production + media, nightly R2 (mythos/…), archive /var/backups/mythos (32 dumps, 6 MB) | P0 |
| ssangyong storefront, WP, command-center, os-console, oth-knowledge | /home/deploy/projects/mythos-prod (WP from /home/deploy/worktrees/mythos-wp-main) | small | P0 (mythos-wp-main must not be removed) |
| SPY | /home/deploy/projects/spy + /home/deploy/deployments/spy (venv 267 MB, spy.db 47 MB) | spy-db backups (a new pre-sprint copy was written 17:08 today — a concurrent SPY session is active) | P0 |
| darhijama.tn | compose deployments/darhijama-v1.0.1 | 6 containers, 4 volumes, 2.5 GB images | P0 |
| n8n / omniroute / jellyfin / evolution / mysql / postgres | Docker | see tables | P0 |
| notrejour.tn, uthinachess.tn, fixpert.tn, ssangyong.autos, status | nginx + php-fpm + mariadb (/var/lib/mariadb 162 MB) | /var/www 0.5 GB | P0 |
| GitHub runner (mythos-gh-runner.service) | /opt/mythos-gh-runner, bin/externals → 2.337.0 | old 2.336.0 + _work/_update are leftovers | P1 leftovers |
| Coolify (panel.mythosprod.xyz → :8000) | /data/coolify | ~4.9 GB Docker | P2 dormant |

## 5. Ranked plan

### P0 — MUST NOT TOUCH
- idauto-postgres container, image 3d0f7584ed7d, volume idauto-postgres-data (ERP + idauto + WP + ssangyong DBs).
- /home/deploy/projects/mythos-prod (ERP source, migrations, ops/backup scripts), /home/deploy/worktrees/mythos-wp-main (WP service), /home/deploy/projects/idauto, /home/deploy/projects/spy + deployments/spy, deployments/darhijama-v1.0.1, deployments/mythos-gateway, deployments/mythos-mcp-auth, deployments/idauto-postgres, /opt/n8n, /home/ubuntu/omniroute, /opt/jellyfin/config, /var/www, /var/lib/mariadb.
- All backup trees: /var/backups/mythos, /var/backups/mythos-db, /home/deploy/mythos-backups/*, /home/deploy/.config/mythos/*.env, /home/deploy/backups/* (ship-point dumps).
- All running containers and their images/volumes listed NO above; dar-hijama-production-queue-1 even though exited.
- /root/workspaces/cont-* and /root/piece.autos (peer agent sessions active today), /home/deploy/worktrees/erp-gates and session-management (uncommitted changes), every UNMERGED worktree.
- Swap files, kernel 7.0.0-30 (running) and 7.0.0-31 (pending reboot), journald (already capped).
- Never run: `docker system prune`, `docker container prune`, `docker volume prune -a`, `docker image prune -a`.

### P1 — SAFE TO RECLAIM (≈ 8.7 GB)

| # | Path / resource | Size | What | Why safe | Dependencies | Recovers | Command (NOT executed) |
|---|---|---|---|---|---|---|---|
| 1 | Old VS Code server builds: root Stable-110a328…, Stable-88e44fa…, Stable-a44adf7…; deploy Stable-88e44fa…, Stable-a44adf7…; stale CLI binaries code-08d4889 (root+deploy), code-e4c7e7b (deploy) | 3.6 GB | Remote-SSH server downloads, one per client version | no `servers/Stable-*` process is running; LRU head is Stable-645f29c…; VS Code re-downloads on demand | keep Stable-645f29c… for both users; keep running CLIs code-110a328 and deploy code-df53daab | 3.6 GB | `rm -rf /root/.vscode-server/cli/servers/Stable-110a328ea54b42367b803ec53ee0bf52ef26b419 /root/.vscode-server/cli/servers/Stable-88e44fa0e00b08f7758b4f6d05632e4fd5e4df6f /root/.vscode-server/cli/servers/Stable-a44adf7f53e00964ab890f9f8758a334f1fc15bc /home/deploy/.vscode-server/cli/servers/Stable-88e44fa0e00b08f7758b4f6d05632e4fd5e4df6f /home/deploy/.vscode-server/cli/servers/Stable-a44adf7f53e00964ab890f9f8758a334f1fc15bc /root/.vscode-server/code-08d4889f9ec4a1685d257b9b95de036c8e1ce1e5 /home/deploy/.vscode-server/code-08d4889f9ec4a1685d257b9b95de036c8e1ce1e5 /home/deploy/.vscode-server/code-e4c7e7b1d6d060162f4aa7f8225271b67ce1df75` |
| 2 | 35 anonymous dangling Docker volumes (PG 15 drill leftovers) | 1.65 GB | ERP drill test databases | 0 links, anonymous, created by test scripts; production ERP data lives elsewhere | none | 1.65 GB | `docker volume ls -q -f dangling=true \| grep -E '^[0-9a-f]{64}$' \| xargs -r docker volume rm` |
| 3 | /root/.npm/_cacache | 0.96 GB | npm download cache | pure cache, rebuilt on next install | none | 0.95 GB | `npm cache clean --force` |
| 4 | /opt/mythos-gh-runner/bin.2.336.0, externals.2.336.0, _work/_update | 1.35 GB | previous runner version + already-applied 2.337.0 update package (bin/externals symlinks → 2.337.0 since 09-04) | runner runs 2.337.0; _update consumed on 09-04 | run only while no job is executing (check `_diag/Worker_*` for an open job) | 1.35 GB | `rm -rf /opt/mythos-gh-runner/bin.2.336.0 /opt/mythos-gh-runner/externals.2.336.0 /opt/mythos-gh-runner/_work/_update` |
| 5 | /opt/mythos-gh-runner/_diag files older than 14 d | 40 MB (2 074 files) | runner diagnostics logs | logs only | none | 40 MB | `find /opt/mythos-gh-runner/_diag -type f -mtime +14 -delete` |
| 6 | Rotated-but-uncompressed /var/log/syslog.1 (389 MB) + kern.log.1 (163 MB) | 552 MB | last week's logs waiting for delaycompress | forcing rotation compresses them to ~70 MB; no data lost | rsyslog (HUP by postrotate) | ~480 MB | `logrotate -f /etc/logrotate.d/rsyslog` |
| 7 | /root/.claude/remote/ccd-cli/2.1.260 | 215 MB | previous Claude Code desktop CLI | all 8 running sessions use 2.1.266 | none | 215 MB | `rm -f /root/.claude/remote/ccd-cli/2.1.260` |
| 8 | Snap disabled revisions core22 rev 2437, snapd rev 27710 | 125 MB | superseded snap revisions | disabled = not mounted | none | 125 MB | `snap remove core22 --revision 2437 && snap remove snapd --revision 27710` |
| 9 | /tmp/node-compile-cache | 189 MB | Node compile cache (deploy, 09-07) | regenerated automatically | none | 189 MB | `rm -rf /tmp/node-compile-cache` |
| 10 | Images alpine/curl:latest, curlimages/curl:8.10.1 | 53 MB | unreferenced utility images | no container/compose/script references | none | ~60 MB | `docker rmi alpine/curl:latest curlimages/curl:8.10.1` |
| 11 | /home/deploy/.cache/composer | 56 MB | composer download cache | cache | none | 56 MB | `sudo -u deploy rm -rf /home/deploy/.cache/composer` |

### P2 — RECLAIMABLE AFTER CONFIRMATION (≈ 18 GB)

| # | Path / resource | Size | What | Why confirmation is needed | Dependencies | Recovers | Command (NOT executed) |
|---|---|---|---|---|---|---|---|
| 1 | Coolify stack: 5 containers + i4mv… app container; images coolify, coolify-realtime, coolify-helper, sentinel, i4mv… build; volumes coolify-db, coolify-redis, gi0p3…_staging-*; /data/coolify; nginx vhost panel.mythosprod.xyz | ~4.9 GB | self-hosted PaaS, installed 07-21; all apps exited since 08-15/08-25, no proxy, last login 08-15 | owner may still intend to use it; the panel vhost is public | keep postgres:15-alpine and redis:7-alpine (shared) | ~4.9 GB (+ ~0.6 GB containerd blobs) | 1) `docker exec coolify-db pg_dump -U coolify coolify > coolify-final.dump` and archive gi0p3 mysql dir to R2; 2) `cd /data/coolify/source && docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.custom.yml down`; 3) `docker rm -f i4mv37ig6xavokv0kpy5517d-194407838591 coolify-sentinel`; 4) `docker rmi coollabsio/coolify:4.3.10 coollabsio/coolify-realtime:1.0.17 coollabsio/coolify-helper:1.0.15 coollabsio/sentinel:0.0.22 i4mv37ig6xavokv0kpy5517d:52e7b2fdb4f7bc28ffc7f211e4f80bc1d94cf167`; 5) `docker volume rm coolify-db coolify-redis gi0p3mbss6geqhunih23fy6f_staging-mysql gi0p3mbss6geqhunih23fy6f_staging-redis-queue gi0p3mbss6geqhunih23fy6f_staging-redis-session gi0p3mbss6geqhunih23fy6f_staging-storage`; 6) `rm /etc/nginx/sites-enabled/panel.mythosprod.xyz && nginx -t && systemctl reload nginx`; 7) `rm -rf /data/coolify` |
| 2 | evolution-inspect container + evoapicloud/evolution-api:latest | 1.83 GB | leftover from 09-03 inspection | confirm it is not the staged 2.4.0 activation image | production pins v2.3.7 | 1.83 GB | `docker rm evolution-inspect && docker rmi evoapicloud/evolution-api:latest` |
| 3 | /root/workspaces/{piece-autos,piece-autos-p2,piece-autos-p3-20260908,kitchen,mythos-prod-kitchen-p2,ssangyong} | 1.8 GB | 09-08 feature clones, all clean, pushed, branches merged into origin/main | /root is shared by concurrent agent sessions; confirm nobody has them open | none (cont-* stay) | 1.8 GB | `rm -rf /root/workspaces/piece-autos /root/workspaces/piece-autos-p2 /root/workspaces/piece-autos-p3-20260908 /root/workspaces/kitchen /root/workspaces/mythos-prod-kitchen-p2 /root/workspaces/ssangyong` |
| 4 | /root/ssangyong/storefront/node_modules + .next | 0.81 GB | build residue in the docs-only ssangyong repo (storefront runs from mythos-prod) | regenerable (`npm ci`) | none | 0.8 GB | `rm -rf /root/ssangyong/storefront/node_modules /root/ssangyong/storefront/.next` |
| 5 | Browser caches only (Chrome closed): /home/ubuntu/.config/google-chrome (1.5 GB cache incl. Service Worker 730 MB), /home/deploy/.config/google-chrome (0.45 GB), /root/snap/chromium/common/chromium (0.47 GB, default snap profile not used by the mythos-chromium wrapper), /root/.config/google-chrome (45 MB), /home/ubuntu/.cache/google-chrome (82 MB) | 2.5 GB | Cache, Code Cache, GPUCache, Service Worker/CacheStorage, component_crx_cache, screen_ai, optimization_guide, Safe Browsing, BrowserMetrics | owner's desktop profiles (Teachable/ChatGPT logins live in Cookies/Login Data, which are NOT touched) | no Chrome process running for that user | ~2.4 GB | per profile: `find "<profile>" -type d \( -name Cache -o -name "Code Cache" -o -name GPUCache -o -name "Service Worker" -o -name component_crx_cache -o -name screen_ai -o -name optimization_guide_model_store -o -name "Safe Browsing" -o -name BrowserMetrics -o -name WasmTtsEngine -o -name extensions_crx_cache -o -name GrShaderCache -o -name ShaderCache \) -prune -exec rm -rf {} +` |
| 6 | opencode: /usr/local/lib/node_modules/opencode-ai (704 MB, five platform binaries), /home/ubuntu/.opencode (171 MB), /home/deploy/.local/share/opencode/opencode.db (322 MB) | 1.2 GB | alternative coding CLI, last log 08-08, DB last written 09-06 | confirm opencode is retired | none | 1.2 GB | `npm -g uninstall opencode-ai; rm -rf /home/ubuntu/.opencode /home/deploy/.local/share/opencode` |
| 7 | codex: /usr/local/lib/node_modules/@openai/codex (301 MB), /home/ubuntu/.codex (75 MB), /home/deploy/.codex (48 MB) | 0.42 GB | OpenAI Codex CLI | confirm retired | none | 0.4 GB | `npm -g uninstall @openai/codex; rm -rf /home/ubuntu/.codex /home/deploy/.codex` |
| 8 | Stale Claude binaries: /usr/local/bin/claude (2.1.226, Aug 10), /home/ubuntu/.config/Claude/claude-code/2.1.246, /home/deploy/.vscode-server/data/agent-host/sdk-cache | 0.85 GB | superseded copies (users run 2.1.251/2.1.258/2.1.266 from ~/.local or ccd-cli) | confirm nothing calls /usr/local/bin/claude explicitly (systemd units do not) | none | 0.85 GB | `rm -f /usr/local/bin/claude; rm -rf /home/ubuntu/.config/Claude/claude-code/2.1.246 /home/deploy/.vscode-server/data/agent-host/sdk-cache` |
| 9 | /opt/course-intelligence (520 MB) + /home/ubuntu/.cache/ms-playwright (656 MB, chromium-1234 used only by its venv) | 1.18 GB | throwaway Teachable scripts (2026-08-08) | archive output/ first | none | 1.15 GB | `tar czf /home/deploy/mythos-backups/course-intelligence-20260913.tgz -C /opt course-intelligence/output course-intelligence/*.py && rm -rf /opt/course-intelligence /home/ubuntu/.cache/ms-playwright` |
| 10 | 42 merged, clean mythos-prod worktrees under /home/deploy/worktrees (all MERGED rows in §9 except mythos-wp-main and session-management) + executor gh-issue-196, gh-issue-250 + /tmp/othk* (3) + /home/ubuntu/mythos-ai-executor/worktrees (23, from 08-18, executor now runs as deploy) | 1.6 GB | finished feature worktrees | shared kitchen; confirm with owner; branches stay on origin | run as deploy | 1.6 GB | `sudo -u deploy git -C /home/deploy/projects/mythos-prod worktree remove <path>` per worktree, then `git worktree prune`; `rm -rf /home/ubuntu/mythos-ai-executor/worktrees` |
| 11 | Archives to move off-host then delete: /root/backups/pre-coolify_* (258 MB, 07-21), /home/deploy/darhijama-release-704b3a3.{zip,tar,runtime.zip} (104 MB), /home/deploy/recovery-darhijama-20260728-172125 (89 MB), /home/ubuntu/incoming/VPS_TRANSFER (161 MB), /home/deploy/mythos-backups/legacy-ssangyong (89 MB), duplicate spy-db dumps (one of the two identical 09-02 40 MB files + spy-db-20260901T100736Z 38 MB) | 0.8 GB | historical snapshots | archive, don't delete | R2 credentials in ~/.config/mythos/idauto-offhost.env | 0.8 GB | upload with the existing off-host tool or rclone to `mythos-offhost-backups/archive/2026-09/`, verify checksum, then `rm` |
| 12 | Duplicate notrejour clones: /home/deploy/repos/notrejour.tn vendor+node_modules (267 MB), /home/ubuntu/notrejour (50 MB) | 0.32 GB | same commit e8fbf52 as projects/mythos/notrejour; live site is /var/www/notrejour | confirm | none | 0.3 GB | `rm -rf /home/deploy/repos/notrejour.tn/vendor /home/deploy/repos/notrejour.tn/node_modules /home/ubuntu/notrejour` |

### P3 — KEEP / LOW VALUE
- /root/casse.autos (0.83 GB, active launch prep), /root/workspaces/cont-* (active today), unmerged worktrees (31), executor unmerged gh worktrees (12).
- /root/.cache/ms-playwright chromium-1208 (622 MB, required by playwright 1.58 in casse/piece), /root/.claude/remote/plugins (360 MB), session transcripts /root/.claude/projects (361 MB) + ubuntu/deploy (223 MB).
- Chromium snap + gnome-46/mesa/gtk bases (1.3 GB): used by the mythos-chromium wrapper; Google Chrome (432 MB), claude-desktop (553 MB), libreoffice (327 MB), fonts-noto-* (~750 MB): desktop/VNC tooling — remove only as a deliberate "one browser" decision.
- /home/deploy/dagu-poc (157 MB, pending owner install), uv tools/python (359 MB, installed tools not cache), graphify-venv (197 MB), pnpm store (208 MB), /var/lib/snapd/cache (304 MB, snapd-managed).
- Old kernel leftovers /usr/lib/modules/7.0.0-{14,27,28,29} (29 MB, rc packages) and linux-headers-7.0.0-30 (140 MB, removable only after reboot into -31).
- Jellyfin (2.27 GB image, empty library): owner decision, not a cleanup item.
- Local dump archives /var/backups/mythos (6 MB) and mythos-db (6 MB): tiny, but have no retention.

## 6. Numbers

| | Used | Available | Use % |
|---|---|---|---|
| Now | 67.0 GB | 5.1 GB | 93 % |
| After P1 (−8.7 GB) | 58.3 GB | 13.8 GB | ~81 % |
| After P1 + P2 (−18 GB more) | 40.3 GB | 31.8 GB | ~56 % |

(Docker image removals free ~20 % more than shown because containerd also drops the compressed blob.)

## 7. Recommended order
1. P1-6 `logrotate -f` (0.5 GB, instant, zero risk).
2. P1-1 old VS Code servers (3.6 GB).
3. P1-2 anonymous Postgres volumes (1.65 GB) — verify `docker volume ls -f dangling=true` output once more just before.
4. P1-4/5 runner leftovers (1.4 GB) while the runner is idle.
5. P1-3 npm cache (0.95 GB), P1-7/8/9/10/11 small items (0.6 GB).
6. Owner decision on Coolify (P2-1, 4.9 GB) — biggest single dormant consumer.
7. P2-2 evolution:latest (1.8 GB), P2-3/4 /root build residue (2.6 GB), P2-6/7/8 retired CLIs (2.5 GB).
8. P2-5 browser caches when Chrome is closed (2.4 GB), P2-9/10/11/12 with archiving.

## 8. Growth drivers and long-term fixes
- **OOM storms drive log growth.** kern.log.1: 1.2 M lines/week, ~50 % are OOM process-table dumps (1 182 OOM kills last week, 658 of them node; swap 4 GB is 100 % used). Same lines are duplicated into syslog. Fix memory pressure (session accumulation, per-unit MemoryMax) and log volume drops by ~300 MB/week.
- **mythos-github-bridge.timer logs a 62-line JSON report every minute** to stdout → journal + syslog (~33 k lines/day, ~28 MB/week). Send it to a file with logrotate, or lower verbosity.
- **Anonymous volume leak**: ERP drill scripts leave 50 MB PG volumes when their cleanup trap does not run. Add `--rm` to the `docker run` (removes anonymous volumes automatically) and a weekly `docker volume prune -f` (anonymous only by default) timer.
- **VS Code server accumulation**: each client update adds ~700 MB per user. Weekly timer: delete every `cli/servers/Stable-*` not first in `lru.json` and not running.
- **Runner self-update leftovers**: after each update, delete `bin.<old>`, `externals.<old>`, `_work/_update`; cap `_diag` at 14 days.
- **Unbounded app logs**: dar-hijama `storage/logs/laravel.log` (27 MB, single file; switch to `daily` channel with 14-day retention) and executor `bridge/events.log` (44 MB, no rotation).
- **Backup retention**: local archives (/var/backups/mythos, mythos-db) and staging sets (35 + 33 dirs) are never pruned. R2 holds history; keep 30 days locally. Confirm R2 lifecycle rules.
- **Docker retention**: pin tags in compose (idauto-postgres already lost its tag), avoid `:latest` pulls for inspection, and never keep `Created` containers.
- **Storage**: 75 GB with ~20 GB of images and ~9 GB of dev tooling for three users is structurally tight. Options: an OVH additional block volume (50–100 GB) mounted at /var/lib/containerd (+/var/lib/docker) — needs a maintenance window; or keep the host lean with the timers above.
- **Monitoring**: add disk % (alert at 85 %) and dangling-volume count to mythos-status-monitor / memwatch; sar already records daily.
- **Automatic known-safe cleanup** (weekly systemd timer, root): npm cache clean, `docker volume prune -f`, old VS Code servers, runner `_diag` > 14 d, `/tmp/claude-0` scratchpads > 7 d, `logrotate` already daily.

## 9. Full lists (for execution reference)

Merged + clean mythos-prod worktrees (P2-10 candidates, excludes mythos-wp-main and session-management):
hub-dashboard, pr-backup-tests, pr-erp, pr-monitoring, erp-redesign, github-issues, bridge-action-resolution-v2, bridge-timer, hostops-executor, hostops-readonly, mythos-gateway, mythos-vault, push-guard, github-bridge, governance-approval-group, mcp-ecosystem, mcp-ecosystem-2b, mcp-ecosystem-3, mcp-ecosystem-3-vault, mcp-ecosystem-4, mcp-ecosystem-5, mcp-ecosystem-5-vault, skill-trust, wa-provider-verify, audit-kb, backlog-reconcile, execution-architecture, github-intake-redaction, telegram-channel, wa-qr-live, research-comms-os, mythos-v1, mythos-wp, wa-comms-1, wa-comms-2, wa-comms-3, wa-comms-4, wa-comms-5, wa-comms-7, wa-comms-8, /home/deploy/wt-othk-failclosed-r2, executor gh-issue-196, gh-issue-250.

Anonymous dangling volumes (P1-2), size KB:
203412 gi0p3…_staging-mysql (NAMED — P2, not in this list); anonymous: eee94ce9…(79628) 50627c89…(79612) 1e3a1a7a…(79612) a4230975…(70396) 035af102…(66144) 874bbcf9…(50832) d3b338a7…(50452) 04a74d2f…(50008) f11dc653… eaf2e0aa… bf6bf068… 6c6aae07… 4f1bb0b4…(49856 each) 5d163db5…(49824) 59ece44f…(49796) 20462bf6…(49704) 8293da65… 45508974… 15c95b15… 0137f65c…(49464 each) 39ba4458… 1d387cac…(49264 each) dd803c58…(49240) bd30b95e…(48808) 730e6edc…(48220) 01dbfb2e…(48196) 6ccfd6b2…(47228) 3a521706…(46820) 3bb87ea2…(46440) 8c9f9cb3…(44392) 139edb08…(43020) ca802eda…(42024) a6706c6b…(8) 9024d3ec…(8) 51243ca9…(4).

## FINAL STATUS
DISK_AUDIT_COMPLETE
CLEANUP_EXECUTED: NO
SAFE_RECLAMATION_AVAILABLE: YES
ESTIMATED_RECLAIMABLE_SPACE: 8.7 GB (P1) + 18 GB (P2) ≈ 26.7 GB
TOP_RECOMMENDATION: run the P1 set (forced logrotate, old VS Code servers, anonymous Postgres volumes, runner leftovers, npm cache) → 93 % → ~81 % with no service impact; then decide on the dormant Coolify stack (4.9 GB) and fix the two growth drivers (OOM storms filling kern.log, bridge timer JSON in syslog).
