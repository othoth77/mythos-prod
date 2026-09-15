# VPS DISK — P2 DEEP AUDIT AND CONTROLLED CLEANUP (2026-09-13, 20:53–21:10 UTC)

Read-only re-audit of every P2 candidate after the P1 cleanup, then execution of
the only items meeting every P2-A condition. Nothing owner-gated was touched.

## Baseline (measured, not assumed)

| | Before | After |
|---|---|---|
| Disk | 57 G / 72 G (79 %), free 16 G | 56 G / 72 G (79 %), free 16 G |
| Inodes | 15 % | 15 % |
| Reclaimed | — | **23 MB** (20 test-harness residue directories) |

Where the space really is: `/var/lib/containerd` **20 G** = Docker's image store
(containerd snapshotter — `du -x /var/lib/docker` under-reports it), `/usr` 7.8 G,
`/home` 13 G (deploy 8.2 G, ubuntu 4.9 G), `/root` 5.8 G, `/opt` 1.9 G,
`/var/lib/snapd` 1.5 G.

## Docker (read-only)

- 28 containers (26 running), 23 images (20.6 G virtual), 17 volumes.
- Container → image map: every image except `coollabsio/coolify-helper:1.0.15`
  (581 M, pulled by Coolify on deploy) is referenced by a container.
- The only "dangling" image, `3d0f7584ed7d` (417 M), **is the image of the running
  `idauto-postgres` container** — a `docker image prune` would try to remove the
  production database's image. Never prune blindly.
- Unreferenced volumes: `gi0p3mbss6geqhunih23fy6f_staging-{mysql,redis-queue,
  redis-session,storage}` (257 M, a retired Coolify staging app) and two empty
  `n8n_caddy_*` volumes (n8n is protected).

## Coolify — DORMANT (report only)

- Containers `coolify`, `coolify-db`, `coolify-redis`, `coolify-realtime`,
  `coolify-sentinel` up 3 weeks; `coolify-proxy` NOT running.
- Coolify DB: 1 server, 2 projects, 3 applications all `exited:unhealthy`
  (`notrejour:main-i4mv…` sslip.io, `mythos-dar-hijama-staging`, `dar-hijama`),
  0 services; single user, last login **2026-08-15**.
- dar-hijama production now runs from plain compose
  (`/home/deploy/deployments/darhijama-v1.0.1`), not Coolify.
- The Coolify-created `notrejour` container (`i4mv37ig6xavokv0kpy5517d-…`, image
  2.17 G) is still running, restart `unless-stopped`, port 3000 unpublished, no
  Traefik in front → unreachable.
- `panel.mythosprod.xyz` nginx vhost still public → 0.0.0.0:8000 (+ 6001/6002
  realtime). No systemd unit depends on Coolify except the
  `mythos-docker-firewall` hardening written for it.
- If retired: 5 containers, 4 images (2.25 G), volumes `coolify-db` 134 M +
  `coolify-redis`, `/data/coolify` (448 K), the vhost, the notrejour container +
  image (2.17 G), the orphan staging volumes (257 M) ≈ **4.8 G**. Owner gate.

## Evolution (report only)

- `evolution-api` v2.3.7 + `evolution-postgres`: ACTIVE (WhatsApp gateway,
  compose `ops/whatsapp/evolution/docker-compose.yml`, `EVOLUTION_IMAGE` override).
- `evolution-inspect`: the documented stray container (created 2026-09-03,
  state `created`, never started, no mounts, `restart=no`) and the sole reference
  to `evoapicloud/evolution-api:latest` (1.83 G, built 2026-05-06 — the newer
  release evaluated in `MYTHOS_WHATSAPP_PROVIDER_STRATEGY.md`).
  Classification: STAGED-FOR-FUTURE-USE / UNKNOWN → owner gate.

## Worktrees (140 checkouts audited; 0 removed)

- Dirty: `worktrees/session-management` (2 modified) → do not touch.
- Unmerged or ahead of upstream (do not touch): `autopilot` (2 ahead),
  `autos-foundation`, `backup-multi-db`, `control`, `dagu-hostops` (1 ahead),
  `erp-modernization` (detached), `master-audit`, `master-remaining`,
  `mcp-oauth-bridge` (2 ahead), `mission-sec` (4 ahead), `report-fix` (2 ahead),
  `task-id-64` (1 ahead), `wa-comms-9`, `wa-log-cleanup`, `wa-notify-policy`,
  `wa-pr2765`, `ssangyong-audit` (2 ahead), `wt-othk-failclosed-20260906`,
  `/root/mythos-prod-sparse`, `/root/othkm` (1 ahead).
- Service-bound (do not touch): `mythos-wp-main` (WP service) and `mythos-wp`
  (a second `node reference/server.js`, up 8.7 days), `oth-mcp` (MCP transport),
  `mythos-ai-executor/worktrees/gh/*` (executor-managed), `erp-gates`
  (ERP session worktree).
- Merged + clean + pushed, ≈ 40 × 21–31 M ≈ 1.1 G (owner confirmation — other
  sessions all report cwd `/root`, so "unused by another session" is not
  provable from the host): `mcp-ecosystem{,-2b,-3,-3-vault,-4,-5,-5-vault}`,
  `github-bridge`, `github-issues`, `governance-approval-group`, `push-guard`,
  `skill-trust`, `bridge-timer`, `bridge-action-resolution-v2`, `hostops-readonly`,
  `hostops-executor`, `wa-provider-verify`, `backlog-reconcile`, `audit-kb`,
  `wa-comms-{1,2,3,4,5,7,8}`, `telegram-channel`, `wa-qr-live`,
  `research-comms-os`, `mythos-gateway`, `mythos-v1`, `mythos-vault`,
  `erp-redesign`, `pr-erp`, `pr-monitoring`, `pr-backup-tests`,
  `github-intake-redaction`, `execution-architecture`, `hub-dashboard`;
  plus `/tmp/othk-verify-cc36e3b`, `/tmp/othkm-postmerge`, `/tmp/othkm-test`
  (detached, 87 M).

## Build residue (not residue)

`/root/ssangyong/storefront` (node_modules 674 M + `.next` 419 M) and
`/root/casse.autos` (701 M + 387 M): modified 2026-09-12, owned by the running
"Mythos Auto release preparation" session — required. `/root/piece.autos`: peer
session. `/home/ubuntu/omniroute`, `/opt/n8n`: live compose working dirs.

## Browser (0 touched)

16 profiles found (root, deploy, ubuntu; Chrome, headless scoped dirs, Claude
desktop partitions, snap chromium, `/opt/course-intelligence/*-profile`).
`ubuntu` has a live TigerVNC desktop (`:3`). Pure, regenerable caches for owner
decision: `/root/snap/chromium/common/chromium/Default/Cache` 426 M (2026-08-23),
`/home/ubuntu/.config/google-chrome/Default/Cache` 686 M and `Profile 1/Cache`
355 M (2026-09-01). Playwright: `/root/.cache/ms-playwright` 622 M,
`/home/ubuntu/.cache/ms-playwright` 656 M — `casse.autos` declares Playwright.

## AI / CLI tools (0 touched)

`/usr/local/bin/{opencode,codex,claude}` present; `opencode-ai` 704 M,
`@openai/codex` 301 M, three `claude` installs 206 M each, deploy
`.local/share/opencode` 318 M (files touched within 7 days); one `ccd-cli`
version (2.1.266, in use); VS Code servers running for root and deploy;
`/opt/mythos-gh-runner` = active GitHub Actions runner (`_diag` 103 M);
`/opt/course-intelligence` 520 M audited by a session the same day.

## Archives (0 touched; none has a verified off-host copy)

`/root/backups/pre-coolify_*` 258 M (2026-07-21 snapshot of `/var/www`, nginx,
letsencrypt, mariadb); `/home/deploy/darhijama-release-704b3a3.{tar,zip}` 103 M
+ `deployments/darhijama-09ffdb…tar` 54 M (2026-07-28/29 release artefacts);
`recovery-darhijama-20260728…/nginx-letsencrypt-before.tar.gz` 89 M;
`/home/ubuntu/incoming/VPS_TRANSFER` 160 M (+ SHA256SUMS); `/home/ubuntu/
othk-archive` 29 M; duplicate notrejour clones `/home/deploy/repos/notrejour.tn`
373 M and `/home/deploy/projects/mythos/notrejour` 107 M (same HEAD `e8fbf52`,
pushed) beside the live `/var/www/notrejour`.

## Decision matrix

| # | Resource | Size | State | Dependency | Risk | Safe now? | Owner confirmation? |
|---|---|---|---|---|---|---|---|
| 1 | Test-harness residue dirs (20) | 24 M | finished runs | none | none | **yes — executed** | no |
| 2 | Coolify stack + notrejour container/image + orphan staging volumes | ≈4.8 G | dormant | public panel vhost | medium | no | **yes** |
| 3 | `evolution-api:latest` + `evolution-inspect` | 1.83 G | staged/unknown | provider strategy | low | no | **yes** |
| 4 | Browser pure caches | ≈1.5 G | regenerable | VNC desktop (ubuntu) | low | no | **yes** |
| 5 | Playwright caches | 1.3 G | possibly used by casse.autos | release prep | low | no | **yes** |
| 6 | Merged/clean/pushed worktrees + `/tmp/othk*` | ≈1.2 G | merged | other sessions unprovable | low | no | **yes** |
| 7 | Archives / duplicate clones | ≈0.9 G | old, no off-host copy verified | none | medium | no | **yes** |
| 8 | journald 392 M, apt 253 M, runner `_diag` 103 M | 0.75 G | maintenance | — | low | no ("no global cleanup") | yes |
| 9 | Everything protected (ERP DB, backups, live services, dirty/unmerged worktrees, AI tools, course-intelligence, profiles) | — | — | — | — | **do not touch** | — |

## Executed

Removed, with a per-directory re-check (no process cwd, no open file, not a
registered worktree of any real repository) immediately before each `rm`:
12 × `/home/deploy/mythos-telegram-events-test-*`,
`/home/deploy/mythos-github-bridge-test-3183742`,
3 × `/root/mythos-telegram-events-test-*`,
3 × `/home/ubuntu/mythos-campaign-test-*`, 2 × `/home/ubuntu/mythos-ai-executor-test-*`.
They are created under `$HOME` by `tests/mythos-telegram-events-test.js` (and
siblings), which never cleans up — a test-harness fix candidate.

## Post-cleanup verification

28 containers (unchanged), 26 running; `idauto-postgres` accepting connections;
ERP `/api/v1/health` ok, `code_identity` `6a2e965` verified, 15 migrations,
1 tenant / 1 user / 0 invoices, fiscal stamp enabled; `nginx -t` successful; all
deploy production units running; 4 failed system units pre-existing
(2026-08-31 / 2026-09-04 transient `run-*` and `user@` instances); no OOM;
memory PSI ≈ 0, 3.1 G available; 8 live agent sessions intact (a concurrent
"VPS disk audit" session was running — one more reason nothing owner-gated was
executed here).

DISK_P2_AUDIT_COMPLETE · P2_CLEANUP_EXECUTED: YES (24 MB) · OWNER_GATED_ITEMS_TOUCHED: NO · ERP_MODIFIED: NO · POSTGRES_MODIFIED: NO · PRODUCTION_SERVICES_MODIFIED: NO
