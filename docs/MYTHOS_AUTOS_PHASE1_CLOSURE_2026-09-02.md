# MYTHOS AUTOS — Phase 0b + Phase 1 closure report (2026-09-02)

Closes the blockers of `docs/MYTHOS_AUTOS_FOUNDATION_2026-09-02.md`. Mission window 07:31–08:00 UTC on the VPS.
No AUTOS application, no `mythos_autos` database, no SPY code change, no scraper reactivation, no sitemap-2
registration, no legacy-site retirement, no firewall/SSH/service change. Evidence tags as before: CONFIRMED /
INFERRED / UNKNOWN / REQUIRES DECISION.

## 1. Phase 0b closure report

### 1.1 Git main reconciliation (CONFIRMED)
| Fact | Value |
|---|---|
| local `main` | `63aec2c` |
| `origin/main` | `f4d5eb9` |
| ahead / behind | **33 / 0** |
| branches containing `f5e503a` | local: main, mythos/autos-foundation-20260902, mythos/mcp-ecosystem-20260901, mythos/vault-architecture-20260901, vps/extraction-advisory-wiring-20260831 — remote: origin/mythos/autos-foundation-20260902, origin/mythos/vault-architecture-20260901, origin/vps/extraction-advisory-wiring-20260831 |
| relay | `mythos-git-push.timer` active; every 5 min: `DENIED main … f5e503a … budgets.json`; `mission branches: pushed=0 skipped=0 denied=2` |
| approvals present | 5 grants (2026-08-18) + `forged.json` (a negative test fixture); none for f5e503a |
| worktrees | 14, unchanged; shared checkout clean |

**Not executed** (no owner authorisation present in the environment). Owner action, as root:
```
sudo mythos-governance-approve --commit f5e503adeb4bfb4f3e80a3db07aace9b017b9ad8 --by "Othman Haddad" --reason "budget grant record reviewed"
```
Expected result within 5 min: relay fast-forwards `origin/main` to `63aec2c` (33 commits, no rebase/reset/force).
Verification: `sudo -u deploy git -C /home/deploy/projects/mythos-prod fetch origin && sudo -u deploy git -C /home/deploy/projects/mythos-prod rev-list --left-right --count main...origin/main` → `0 0`.

### 1.2 Secondary denied branches (CONFIRMED)
| Branch | Commits beyond main | Protected files | Legitimate? | Elsewhere? | Verdict |
|---|---|---|---|---|---|
| `mythos/mcp-ecosystem-20260901` (`d9e5c54`, 2026-09-02, "MCP-ECOSYSTEM-1", 24 files +3,722) | 1 own commit + merges of `feat/mythos-gateway` and `mythos/vault-architecture-20260901` (5 commits already on origin) | `projects/mythos-vault/credential-inventory.json` (metadata-only by its own note: names, owners, env-var NAMES, no values — the verifier flags it by the `/credential/i` pattern) and `projects/mythos-gateway/contextforge.env.example` (`d287b97`, placeholders only, on origin already via `origin/feat/mythos-gateway`) | yes — documented in `docs/MYTHOS_MCP_ECOSYSTEM.md` on the branch, 167/0 tests | **`d9e5c54` exists on no remote branch** → the MCP-ECOSYSTEM-1 work is not on GitHub | **APPROVE** (both shas: `d9e5c541e73239e6159ef30c13fef661377f9851`, `d287b974a91d25d191907755a48e0babf41f5389`) after the owner confirms the inventory holds no values (`grep -cE '"(value|secret|token)":' projects/mythos-vault/credential-inventory.json` on the worktree `/home/deploy/worktrees/mcp-ecosystem`). Note: `feat/mythos-gateway` reached origin outside the relay (raw push), which the governance design says must not happen — record, do not repeat. |
| `mythos/m-msy4a8iz-f2673d/tk-msy4a8j0-f1b3c5` (`1e4a1ee`, 2026-08-18, autonomous loop "capability J — catalog the Codex delegated worker") | 1 commit, **402 behind main** | `config/agents.json` (+29), `core/agent-registry.js` (+3), plus a test | plausible (tests 262/262 per message) but stale: main's `agents.json` has **no `codex` entry** and differs by exactly those 29 lines, so the work was never merged | origin holds the branch at its base `11a63ea` only | **LEAVE** (or MERGE LATER by owner after rebasing intent onto current `agents.json` — main's registry moved on through 0be580d/545d9c5/195ae06). Not approving avoids delivering a stale protected change. |

### 1.3 Durability — first copies taken (CONFIRMED, all on-host, deploy-owned 0600)
| Store | Copy | Check |
|---|---|---|
| SPY `spy.db` | `/home/deploy/mythos-backups/spy-db/spy-20260902T073512Z.db` and `…T073708Z.db` (40,062,976 B) via SQLite online backup API from a read-only connection | `integrity_check=ok`, sha256 sidecar, manifest: 45,274 observations · 72 events · 5 corrections · 237 runs · 15 snapshots |
| SPY snapshots | `spy-snapshots-20260902T07….tar.gz` (741 KB) | sha256 |
| `ssangyong_autos` (PG) | `/home/deploy/mythos-backups/ssangyong-db/ssangyong_autos-20260902T073317Z.dump` (in-container `pg_dump -Fc`, 87,383 B, 5 TABLE DATA entries) | sha256; counts file: products 346 · models 17 · motorizations 63 · compat 782 · images 311 |
| Legacy site `/var/www/ssangyong.autos` (93 files, 90 MB) | `/home/deploy/mythos-backups/legacy-ssangyong/www-ssangyong.autos-20260902T073317Z.tar.gz` (92,716,845 B) | `SHA256SUMS-20260902T073317Z.txt` |
| Legacy MariaDB `ssangyong_autos` | `mariadb-ssangyong_autos-20260902T073317Z.sql` (`--single-transaction`, 18,530 B) + `.tables.txt` (settings 3 · products 0 · subcategories 26 · models 17 · customer_requests 0 · categories 12 · product_images 0 · admins 0) | sha256 |
| Google Sheet `SSANGYONG_AUTOPART_REFERENCES` | **not exported** — no credential on this host outside n8n's OAuth store | see §3.4 |

These are one-off copies on the same disk as the sources. Scheduled + off-host coverage is §3 (owner install).

### 1.4 What remained unchanged (CONFIRMED)
SPY repo clean (0 modified files); `spy.db` mtime 22:48 (yesterday) — only read; n8n unchanged; no service restarted;
ufw/iptables unchanged; sshd unchanged; Docker unchanged; legacy site untouched.

## 2. Owner action list (exact)
| # | Action | Command / place | Why |
|---|---|---|---|
| O1 | Approve `f5e503a` | §1.1 command | unblocks `origin/main` (33 commits) |
| O2 | Approve `d9e5c54` + `d287b97` | `sudo mythos-governance-approve --commit d9e5c541e73239e6159ef30c13fef661377f9851 --by "Othman Haddad" --reason "vault inventory is metadata-only, reviewed"` and the same for `d287b974a91d25d191907755a48e0babf41f5389` | MCP-ECOSYSTEM-1 is not on GitHub |
| O3 | Leave `tk-msy4a8j0` | none | stale, 402 behind |
| O4 | Install SPY backup timer | `ops/spy-backup/README.md §3` | RPO ≤24 h for spy.db |
| O5 | Add `ssangyong_autos` to the DB backup | §3.2 | irreplaceable 1,519 rows |
| O6 | Decide off-host route for the new copies | §3.1 option A/B | VPS-loss durability |
| O7 | Export the Google Sheet once | §3.4 | historical asset |
| O8 | Decide L1 (autopart.tn) A or B | `docs/SPY_SOURCE_LEGAL_REGISTER_2026-09-02.md` | legal boundary |
| O9 | Coolify realtime ports | §4.1 RESTRICT plan | public 6001/6002 |
| O10 | SSH brute-force mitigation | §4.2 | 4,786 failed attempts / 24 h |
| O11 | Watchdog repo home (S-1) | §4.3 recommendation B | source of truth |
| O12 | Reboot drill window | §4.5 | verify linger claim |

## 3. Backup implementation package
### 3.1 SPY — `ops/spy-backup/` (PROPOSED; script dry-run succeeded as deploy at 07:37 UTC, health file `ok`)
`mythos-spy-backup.sh` (online backup API → integrity_check → sha256 → manifest → snapshots tar → weekly hard-links → retention 14 daily / 8 weekly, only inside `/home/deploy/mythos-backups/spy-db`), `mythos-spy-backup.service` (system unit, `User=deploy`, sandboxed, `ReadWritePaths=/home/deploy/mythos-backups`), `mythos-spy-backup.timer` (03:10 UTC daily, persistent). Restore procedure and RTO in the README. Off-host: option **A** extend the multi-db staged set (reuse), or **B** a second `offhost-backup.js push --prefix spy/daily` — no new credentials either way.

### 3.2 `ssangyong_autos` — reuse the existing pipeline, do not build a second one
Facts: `mythos-backup-capture-db` (root, `/usr/local/sbin`) dumps exactly **one** database named by `MYTHOS_BACKUP_DB_NAME` in `~deploy/.config/mythos/backup-schedule-db.env` (currently `mythos_erp`); the run step stages + pushes it to prefix `mythos-erp/daily`. `feat/backup-multi-db` (709fd2d, 2 commits, +1,249 lines, `docs/BACKUP_MULTI_DATABASE_DESIGN.md`) already designs an explicit allowlist `MYTHOS_BACKUP_DB_LIST=idauto,mythos_command_center,ssangyong_autos` gated by a root-side `ALLOWED_DATABASES`, cluster globals without credentials, and a restore drill — and its audit table lists `ssangyong_autos … backed up: no`.
Recommended path (owner): **review and merge `feat/backup-multi-db`, then set the allowlist** — one capture, one manifest, one verify-remote, one restore drill.
Interim, if the branch review takes time (exact, minimal, reversible): a second config file for the same scripts —
```
# /home/deploy/.config/mythos/backup-schedule-db-ssangyong.env  (deploy, 0600)
MYTHOS_BACKUP_DB_DIR=/home/deploy/mythos-backups/ssangyong-db
MYTHOS_BACKUP_DB_CONTAINER=idauto-postgres
MYTHOS_BACKUP_DB_NAME=ssangyong_autos
MYTHOS_BACKUP_DB_ARCHIVE=/var/backups/mythos-db
MYTHOS_BACKUP_DUMP_PREFIX=ssangyong_autos
MYTHOS_BACKUP_STAGE_ROOT=/home/deploy/mythos-backups/ssangyong-staging
MYTHOS_BACKUP_PREFIX=ssangyong-autos/daily
MYTHOS_BACKUP_HEALTH_FILE=/home/deploy/mythos-backups/health/backup-health-db-ssangyong.json
```
run by copies of `mythos-backup-capture-db.service` / `mythos-backup-db.service` / `.timer` with `Environment=MYTHOS_BACKUP_DB_CONFIG=…-ssangyong.env` (the capture script honours that variable, line 39) and a different `OnCalendar` (e.g. 04:20 UTC). Root installs; nothing in the existing config is edited. Verify the restore-test path accepts the new prefix before relying on it.

### 3.3 Legacy site — snapshot taken (§1.3). Archive home: **REQUIRES DECISION** between (a) `othoth77/ssangyong` (already holds the plans, n8n exports and `site/`) as `legacy-site/` + a MariaDB schema+data SQL, or (b) a new private `othoth77/ssangyong-legacy-site`. PHP `pro/config` may hold DB credentials — inspect and strip before any commit. Off-host: include `legacy-ssangyong/` once in the staged set (it is static; a single push suffices).

### 3.4 Google Sheet — export strategy (no credentials touched)
The sheet id is recorded in the n8n export of `SSANGYONG_PROCESS_MODEL` (the other two exports carry a placeholder) and in the KnowledgeVault project note; the OAuth credential lives only in n8n. Safest immutable export, in order of preference: (1) owner, in Google Sheets UI: File → Download → `.xlsx` **and** each tab as CSV → place under `/home/deploy/mythos-backups/google-sheets/SSANGYONG_AUTOPART_REFERENCES/<UTC>/`, run `sha256sum * > MANIFEST.sha256`, add `spreadsheet_meta.json` (sheet id, tab names incl. the real image tab `products_images`, row counts, export time, exporter) — exactly plan §1; (2) a one-off **read-only** n8n workflow (Google Sheets node, "Get rows", existing credential, output to file) — also an owner action because it creates a workflow. Provenance record: `source=google-sheets`, `collected_at=<export time>`, `method=manual-export`, `origin=n8n SSANGYONG_AUTOPART_SCRAPER (autopart.tn, 2026-07)`.

## 4. Security remediation package
### 4.1 Coolify realtime ports — verdict **RESTRICT (after a proxy path is in place)**
Facts (CONFIRMED): `coolify-realtime` (soketi 1.0.17) publishes `0.0.0.0:6001-6002` (compose `docker-compose.prod.yml:66-68`, `SOKETI_HOST=0.0.0.0`); **ufw rules 4/5 and 12/13 explicitly ALLOW 6001/6002 from anywhere**; the DOCKER-USER drop covers only :8000; from the host's public IP `:6001/` answers HTTP 200 and `:6002/` 404; no established connections at audit time; `APP_URL` host is `panel.mythosprod.xyz`; nginx `panel.mythosprod.xyz` proxies only `/` → 127.0.0.1:8000 (with Upgrade headers) and has **no** route for the websocket. Coolify docs: 6001 = real-time, 6002 = terminal; "you can safely close 8000, 6001 and 6002 after accessing the dashboard from your custom domain" **when using Coolify's integrated proxy** — here the proxy is nginx, so the browser most likely dials `panel.mythosprod.xyz:6001` directly (UNKNOWN without a browser test). Blocking now would probably break live logs/terminal in the panel, not deployments.
Plan (owner, in this order, each reversible): (1) add to the panel vhost `location /app/ { proxy_pass http://127.0.0.1:6001; … Upgrade }` and `location /terminal/ws { proxy_pass http://127.0.0.1:6002; … }`; (2) in `/data/coolify/source/.env` set `PUSHER_HOST=panel.mythosprod.xyz`, `PUSHER_PORT=443`, `PUSHER_SCHEME=https` and restart the coolify container; (3) test live logs + terminal in the panel; (4) `ufw delete allow 6001/tcp`, `ufw delete allow 6002/tcp` (IPv4 and v6) and add a DOCKER-USER drop for 6001/6002 like the :8000 rule (`ops/security/mythos-docker-firewall`); (5) re-test. Rollback = re-add the ufw rules. Not done in this mission.

### 4.2 SSH / fail2ban — verdict **safe today, add rate limiting**
CONFIRMED: `PasswordAuthentication no`, `KbdInteractive no`, `PermitRootLogin prohibit-password`, `MaxAuthTries 3`, `LoginGraceTime 30`, pubkey only (`00-hardened.conf`); 4 keys each for root/deploy/ubuntu; root and ubuntu have local passwords (console only); ufw active, default deny, OpenSSH allowed from anywhere; **fail2ban not installed** (`dpkg`: not-found). Last 24 h: 4,786 failed/invalid attempts, 98 accepted logins, all `publickey` from two owner IPs. Risk = log noise + CPU, not credential compromise. Plan (owner, root, reversible): `ufw limit OpenSSH` (6 connections / 30 s per source, no package) **or** `apt install fail2ban` with `/etc/fail2ban/jail.d/sshd.local` (`[sshd] enabled=true backend=systemd maxretry=3 findtime=10m bantime=1h ignoreip=127.0.0.1/8 197.14.148.18 41.227.219.252`). Do not change sshd.

### 4.3 Watchdog repository decision (S-1) — recommendation **B: `mythos-prod/ops/spy-monitor/`**
Ownership: the watchdog observes SPY but is an operations tool written outside SPY's release cycle; SPY's repo policy for this mission is "unchanged", and SPY's `deploy/` holds only the unit + nginx conf. Deployment coupling: it runs from `/home/deploy/spy-monitor` with SPY's venv and reads `spy.db` read-only — no import of SPY internals in `monitor.py` (only `apply_correction_20260901.py` imports `spy.corrections`, and that one is a completed one-off to archive, not deploy). Release/rollback: ops tooling in mythos-prod already follows the pattern (`ops/backup`, `ops/security`, `ops/runner`), installed by copying to a fixed path; rollback = reinstall previous file. Security: no secrets in either file. Source of truth: GitHub either way. Exact later steps: copy both files to `ops/spy-monitor/` (+ the user unit as `spy-monitor.user.service` documenting install), commit via a mission branch, then change the unit `ExecStart`/`WorkingDirectory` to the repo path (a user-unit edit as deploy — owner-approved change), `daemon-reload`, restart. Option A (spy repo) is the right choice only if SPY later adopts the watchdog as a feature.

### 4.4 Watchdog logging — recommendation **systemd journal**
`monitor.log` = 328 lines / 58 KB after ~21 h (≈65 KB/day, ≈24 MB/year — slow, but unbounded). No logrotate entry exists for deploy-owned files (`/etc/logrotate.d` has only system packages); journald is capped (`SystemMaxUse=500M`, 398 MB used) and user units log there when they write to stdout. Comparison: journal = zero new files, rotation and permissions handled, survives reboot, `journalctl --user -u spy-monitor` for deploy; logrotate = one more root-owned config for a deploy file, copytruncate races with an append-only writer. Change (later, owner-approved, with §4.3): make `log()` print to stdout instead of the file and drop `ReadWritePaths` to only the state file. Failure behaviour: a full journal drops oldest entries; a full disk stops file logging silently — journal is safer.

### 4.5 SPY reboot drill (verified facts, procedure only)
CONFIRMED: `spy.service`, `spy-monitor.service` enabled (symlinks in `default.target.wants`), active; `loginctl show-user deploy` → `Linger=yes`, `State=active`; `/var/lib/systemd/linger/deploy` exists; `user@1001.service` static + active; `StartLimit` 5/300 s; `Restart=on-failure`. The "would not survive reboot" claim is obsolete.
Procedure (owner, maintenance window, after O4): (1) `curl -s https://spy.mythosprod.xyz/api/health` and note `run` count via the monitor log; (2) run `ops/spy-backup/mythos-spy-backup.sh`; (3) `reboot`; (4) within 5 min: `loginctl user-status deploy`, `sudo -u deploy XDG_RUNTIME_DIR=/run/user/1001 systemctl --user is-active spy.service spy-monitor.service`, `/api/health` 200, `tail -3 /home/deploy/spy-monitor/monitor.log` shows `MONITOR START`; (5) status-center probes green; (6) record the result in `AI_HANDOVER.md`. Expected: both units up without intervention.

## 5. Legal / source register
`docs/SPY_SOURCE_LEGAL_REGISTER_2026-09-02.md` (10 domains). Decision document for autopart.tn: **Option A** request written authorisation — **Option B** keep depth extraction disabled. Until A: n8n SsangYong workflows inactive (CONFIRMED still inactive), SPY unchanged, historical data internal only, no automatic republication. The 3–5 s jitter vs 5 s Crawl-delay is recorded as a SPY change request, not made.

## 6. Documentation amendments (committed on the mission branch, historical text retained)
- `AUTOMOTIVE_DATA_GOVERNANCE.md` §8: dated AMENDMENT — Vehicle **Type** → MYTHOS AUTOS; IDAuto keeps Vehicle **Instance** (IVID). Ownership table: "Parts Network" is a module of AUTOS; **AUTOS is the Reference Authority**.
- `AUTOMOTIVE_INTEGRATION_CONTRACTS.md` §1: dated Amendment row — "never scraping" binds **AUTOS**; **SPY crawling is separate from AUTOS**, governed by the source legal register; AUTOS consumes SPY via I1–I5 only.
- `AUTOMOTIVE_ARCHITECTURE.md` ownership table: amendment row for Vehicle Type.

## 7. Final architecture lock (verified, nothing implemented)
| Lock | State | Evidence |
|---|---|---|
| OTH → Automotive Knowledge Graph | LOCKED (0 automotive records today) | othk-store 224 records, no automotive hits |
| MYTHOS AUTOS → operational/commercial system | LOCKED, not built | no `projects/mythos-autos`, no DNS for autos.mythosprod.xyz |
| SPY → market sensor | LOCKED, unchanged | repo clean; no reference-matching code |
| IDAuto → Vehicle Instance identity | LOCKED | IVID in `reference/ivid.js`; no parts concept |
| Vehicle Type → AUTOS | LOCKED (amendment §6) | seed 17/63 in `ssangyong_autos` |
| Reference Authority → AUTOS | LOCKED (amendment §6) | — |
| No shared DB SPY↔AUTOS | LOCKED | SPY = SQLite file; AUTOS = future `mythos_autos` |
| AUTOS DB `mythos_autos` in the existing cluster (`idauto-postgres`, PG 15) — no new cluster | LOCKED | cluster holds 7 DBs; 3.1 GB RAM available |
| PostgreSQL search first; no OpenSearch; no graph DB; no Redis without evidence | LOCKED | — |

## 8. Final ownership matrix
| Entity | Owner |
|---|---|
| Vehicle Instance (IVID, VIN fact, plate, facts, evidence, merge/split, org scopes) | **IDAuto** |
| Vehicle Type | **AUTOS** |
| Part · Reference (+aliases/cross-refs) · Product · Compatibility | **AUTOS** |
| Supplier · Supplier Offer · Purchase Price · Margin · Selling Price | **AUTOS** |
| Customer 360 · Orders · Procurement · Delivery · Casse inventory | **AUTOS** |
| Market observation (competitor, source, observation, event, evidence, demand signal) | **SPY** |
| Automotive knowledge graph (systems, repairs, diagnostics, relationships, claims) | **OTH** |
| n8n | orchestration / enrichment adapter only — no authoritative state |

Datasets that must not be confused: **45,000** = `sitemap-products-1.xml` frontier (SPY source 34); **8,164** =
`sitemap-products-2.xml` frontier (unregistered); **53,164** = total URL frontier, **not** 53,164 understood
products; **346** = the catalog. **Legacy MariaDB `ssangyong_autos`** (products 0, taxonomy only, PHP site) ≠
**PostgreSQL `ssangyong_autos`** (`sya_*`, 1,519 rows, storefront API). SPY = breadth; n8n = depth (INACTIVE until L1);
AUTOS = canonical.

Build/Buy/Reuse — finalised as in the foundation §P: REUSE IDAuto, SPY, n8n, SsangYong catalog, NHTSA vPIC seed,
MIT/CC seeds (verified per brand); BUILD Vehicle Type, Part, Reference, Product, Compatibility, Supplier Offer,
Order; BUY LATER TecDoc via WDATABASE, Wheel-Size only if wheel/tyre scope appears; REJECT grey-market TecDoc
sources, irrelevant OSS repos, commerce platforms. No implementation.

## 9. Phase 1 acceptance report
| Check | Result |
|---|---|
| Git `main == origin/main` | **NO** — 33/0, blocked on O1 (mechanism verified; no unsafe op) |
| Backups — SPY | **YES (on-host copy + verified script)**; scheduled + off-host = O4/O6 |
| Backups — SsangYong PG | **YES (on-host dump)**; scheduled = O5 |
| Backups — legacy site + MariaDB | **YES (on-host snapshot)** |
| Backups — Google Sheet | **NO** — needs O7 (no credential outside n8n) |
| Phase 1 docs amended | **YES** (three amendments, committed) |
| Owner decisions L1 / Q-2 / S-1 | **prepared, not decided**: L1 = O8, Q-2 = O9, S-1 = recommendation B (O11) |
| Architecture | **LOCKED** |
| Ownership | **LOCKED** |
| Existing assets preserved | YES — nothing deleted, SPY/n8n/DBs untouched |
| Premature implementation | NONE |

Phase 1 is **closed on the engineering side**; four items are owner-gated (O1, O4–O7, O8, O9). MYTHOS AUTOS may be
built once O1 (Git coherence) and O4/O5 (scheduled durability) are done and O8 is recorded either way.

## 10. Exact next implementation task (NOT started)
**AUTOS-0 — Foundation skeleton, Phase 2 of the roadmap:** create `projects/mythos-autos` (Next.js + TypeScript +
Prisma + Zod) on a `mythos/autos-0-*` branch; owner provisions role + database `mythos_autos` in `idauto-postgres`
(no new cluster) and DNS for `autos.mythosprod.xyz`; first migration = `source_registry`, `provenance` columns,
`vehicle_type`, `vehicle_instance_type_link`; user unit with `MemoryMax`, loopback + nginx vhost; status-center
probe; single-operator token auth (SPY precedent). Acceptance: health probe green; `vehicle_type` seeded with the 17
models / 63 motorizations as a **copy** from `ssangyong_autos` with provenance; no reference/product tables yet.
Preconditions: O1 done, O4 + O5 installed, O8 recorded.
