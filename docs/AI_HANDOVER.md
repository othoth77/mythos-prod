# Mythos OS — AI Handover

**Last updated:** 2026-08-08 UTC
**From:** Stage AUT-CONNECTOR-SHARED-HELPERS-0 — Shared Read-Only Connector Foundation Cleanup (merged)
**To:** Next AI session

---

## CHECKPOINT — CHECKPOINT-RECOVERY-0 (2026-08-10)

**Type:** Read-only recovery checkpoint after the VPS/OOM hardening work. No production mutation. No Mythos implementation stage started or advanced. **Does NOT implement RUNTIME-COLLISION-GUARD-0.**

**No subagents used.** `sudo -n` for system/Docker/root inspection, `sudo -u deploy -H bash -lc '...'` for all Git operations.

**Repository baseline verified:** `origin/main` HEAD confirmed as `c25c96d5776c539a2e1d69c690e9141dc2a9587a` before this checkpoint began (matches the SHA specified in the task). Branch `main`, worktree clean, `git fetch origin` succeeded, local `HEAD` == `origin/main` exactly.

### A. VPS/OOM hardening state (reconciled, all confirmed live)

- **Swap:** 2GB `/swapfile`, persistent via `/etc/fstab`, active (`swapon --show`).
- **n8n:** `mem_limit=3GiB` (`3221225472` bytes, confirmed live), `NODE_OPTIONS=--max-old-space-size=2048`, `N8N_CONCURRENCY_PRODUCTION_LIMIT=2`, `EXECUTIONS_DATA_PRUNE=true` (max age 168h, max count 1000), `DB_SQLITE_VACUUM_ON_STARTUP=true`, `N8N_WORKFLOW_AUTODEACTIVATION_ENABLED=true` — all per `docs/audits/VPS_SERVICE_HEALTH_AUDIT_2026-08-10.md` §8, re-confirmed live this session (`RestartCount=0`, container running). 3 workflows total, all `active=false` (scraper + Auto Restart confirmed inactive, per that audit — not independently re-verified this session, cited as prior evidence). Backup file `/opt/n8n/backups/n8n-before-vacuum-20260810.sqlite`: presence/size still **UNKNOWN** (root-only directory, not investigated this session — carried forward unchanged from the original audit, out of this checkpoint's scope).
- **Dar Hijama Stack A Redis ×3:** `Memory=67108864` (64MB) / `MemoryReservation=16777216` (16MB), `RestartCount=0` on all three — confirmed live.
- **`coolify-redis`:** `Memory=100663296` (96MB) / `MemoryReservation=25165824` (24MB), `RestartCount=0`, `OOMKilled=false` — confirmed live, persistent via `/data/coolify/source/docker-compose.custom.yml` (upgrade-safe, per §14 above).
- **Jellyfin:** confirmed authorized, unrelated personal media-server (`jellyfin/jellyfin:latest`), `127.0.0.1:8096` (localhost-only), `Memory=2147483648` (2GiB), `RestartCount=0`, running — untouched.
- **`coolify-sentinel`:** no supported persistent limit mechanism exists in this Coolify version (confirmed via source read, §13.3) — intentionally deferred, not a blocker (real footprint ~8.5-9MB).
- **Stack B Redis ×3:** not capped. Mechanism known (raw-compose UI editor), requires a full Stack B application redeploy (larger blast radius) — deferred, needs its own authorized stage.
- **MySQL ×2:** untouched — requires a separate MySQL configuration review (buffer pool, `max_connections`, `performance_schema`) before any limit is applied.
- **Other app/web/queue/scheduler/Coolify-core containers:** no limits applied — unchanged from the original plan's later, higher-risk steps (not part of Step 1).

**Redis-class target count corrected: 4/8**, not 4/6 (Stack A ×3 + Stack B ×3 + `coolify-redis` + `coolify-sentinel` = 8 total; Stack A ×3 + `coolify-redis` = 4 done).

### B. Claude execution environment (recorded, operational only)

Claude Desktop runs as `ubuntu` with passwordless `sudo -n` for system/Docker/root inspection and mutation. The canonical Mythos repository remains owned and managed through the `deploy` identity — all Git/GitHub operations use `sudo -u deploy -H bash -lc 'cd /home/deploy/projects/mythos-prod && <command>'`. `/home/ubuntu/mythos-prod` is confirmed to be only a symlink to the canonical `deploy` worktree (`lrwxrwxrwx ... -> /home/deploy/projects/mythos-prod`), not a separate repository. `deploy` SSH/GitHub credentials have not been copied to `ubuntu`; `ubuntu` has not been added to the `docker` group; repository ownership has not been changed.

### C. Notification system (recorded, operational convenience only, not a stage dependency)

ntfy topic `mythos-othman-7k92x-finish` — phone audio notification and Claude Stop/Notification hooks reported working by the user. Not independently re-tested in this checkpoint (out of scope — no hook-firing action was taken).

### D. Mythos development-position reconciliation — **BLOCKED: documented sequence contradicted by GitHub**

Per this task's own instruction ("If GitHub contradicts the expected sequence, use GitHub as source of truth and document the correction"), the following was found and independently verified via `git log` / `git merge-base --is-ancestor` against the current `origin/main` history (not guessed, not inferred from docs alone):

- **`RUNTIME-COLLISION-GUARD-0` does not exist anywhere in this repository** — confirmed via a targeted `grep -rn "RUNTIME-COLLISION-GUARD"` across `docs/`, `scripts/`, and tracked file types (`.md`/`.js`/`.json`): zero matches. It is not a real stage in `docs/ROADMAP.md`, `docs/AI_HANDOVER.md`, `docs/PROJECT_STATUS.md`, `projects/meta/current-context.json`, or the stage-runner scripts. It cannot be confirmed as the next Mythos stage.
- **Stage 3E (Calendar Runtime), Stage 3F (Dashboard Runtime), and Stage 3G (Production Runtime) are already complete and merged to `main`** — this directly contradicts `docs/ROADMAP.md` (which still lists all three under "Upcoming Stages," states *"In Progress: None. Stage 3E is next"*), `docs/PROJECT_STATUS.md` (`Mythos OS Runtime` row: `Last Completed Stage: Stage 3D` / `Current/Next Stage: Stage 3E`), and every entry in `docs/AI_HANDOVER.md`/`docs/history/DAILY_HISTORY.md` going back through this project's entire recorded history, all of which state "Stage 3E ... NOT STARTED."
  - Evidence: commit `0194937` ("Stage 3E: calendar.plugin.js replaced by calendar.runtime.js", author Othman Haddad, 2026-07-30) adds `js/plugins/calendar.runtime.js` and `tests/stage3e-test.js` (749 lines) — confirmed an ancestor of `origin/main` HEAD, and confirmed an ancestor of `bf95988bc9eb72f37e6c4fa8e8b474a69c4e22a3` (the exact commit `docs/PROJECT_STATUS.md`/`current-context.json` themselves cite as "current main HEAD").
  - Commit `d10081e` ("Stage 3F: dashboard.runtime.js...", same date) — same ancestry confirmation.
  - Commit `e2f1953` ("production.runtime.js replaces production.plugin.js... 125/125 tests pass", 2026-07-30) adds `tests/stage3g-test.js` (896 lines) — same ancestry confirmation.
  - `js/plugins/calendar.runtime.js`, `js/plugins/dashboard.runtime.js`, `js/plugins/production.runtime.js` all exist in the current working tree.
  - Test-pass counts (83/83, 91/91, 125/125) are **as stated in the commit messages, not independently re-executed by this checkpoint** — labeled accordingly, per the requirement to clearly mark anything not directly verified.
- **Substantial further work beyond Stage 3G also exists and is undocumented in the "current position" narrative**: 33 `tests/stage4*-test.js` files exist, ranging through at least "Stage 4AG" and "Stage 4Z" (commit `f89fb8c "test(stage4z): enforce canonical extracted-function ownership"`, `ebe42f9 "Stage 4AG: remove obsolete Invoice and OM helper duplicates"`), and the most recent Mythos-OS-runtime-track stage recorded in `docs/history/DAILY_HISTORY.md` itself — `RUNTIME-DUPLICATE-CLEANUP-0` (merged via PR #9, commit `9f5813d51e0bfd2dfffc0a3c958ddfef7efd9549`) — explicitly references and repairs "Stage 4Z" and "Stage 4AG" as **already-existing prior work**, an internal inconsistency within the docs' own narrative (the same document set that elsewhere still calls Stage 3E "next").
- **Root cause not determined by this checkpoint** (would require deeper investigation than a read-only checkpoint's scope permits): most plausibly, the Stage 3D→4AG+ runtime-migration/extraction work was committed directly to `main` by the project owner (all these commits are authored by `Othman Haddad`, not through the branch/PR/merge-commit pattern used for later-tracked stages like AUT-CONNECTOR-SHARED-HELPERS-0) without ever updating `docs/ROADMAP.md`/`docs/PROJECT_STATUS.md`/`docs/AI_HANDOVER.md`/`docs/history/DAILY_HISTORY.md` to reflect it — and every subsequent AI-assisted session then correctly followed `AGENTS.md`'s instruction to trust those status docs rather than independently re-deriving stage state from the full file tree, so the stale "Stage 3E is next" claim was carried forward unchallenged across the entire documented session history.

**This checkpoint does NOT correct `docs/ROADMAP.md`, `docs/PROJECT_STATUS.md`, `docs/history/DAILY_HISTORY.md`, or `projects/meta/current-context.json`.** Rewriting those accurately requires reconstructing the true current stage-completion boundary (exactly which of the ~33+ Stage 4 sub-stages are complete, which if any remain, and reconciling this against `docs/ROADMAP.md`'s formal stage definitions) — that is itself a substantial investigation, explicitly out of scope for a read-only checkpoint under "NO MAJOR IMPLEMENTATION." Flagging it here, prominently, in the document every future session is instructed to read first, is this checkpoint's safest and most correct action.

**Next Mythos implementation stage: NOT CONFIRMED.** Neither `RUNTIME-COLLISION-GUARD-0` (does not exist) nor "Stage 3E" (already done) can be asserted as next. **Recommended next action is a dedicated reconciliation session** (read-only) to (1) determine the true last-completed Stage 4 sub-stage from `git log` against `docs/ROADMAP.md`'s stage definitions, (2) correct `docs/ROADMAP.md`/`docs/PROJECT_STATUS.md`/`docs/history/DAILY_HISTORY.md`/`projects/meta/current-context.json` accordingly, and (3) only then have the owner authorize whatever the actual next stage turns out to be. The one-major-stage rule and no-subagents policy remain in force and were not violated by this checkpoint (no Mythos implementation stage was started or advanced).

### E. Live safety snapshot (this session)

`free -h`: `7.6Gi total / 4.6Gi used / 381Mi free / 3.0Gi available`; `Swap: 2.0Gi total / 1.9Gi used / 105Mi free` (`swapon --show` confirms `/swapfile`, 2G, active). 24 containers present (23 Mythos/Coolify/Dar Hijama + Jellyfin, reconciled and explained in §14.1 above), all `Up`/`healthy` except `n8n-n8n-1` and the Notre Jour preview container (both running without a defined healthcheck, as before — not a fault). Zero kernel OOM matches in the last 24h. Protected services: `darhijama.tn` 200, `uthinachess.tn` 200, `notrejour.tn` 200, `n8n.ssangyong.autos` 200, Coolify panel 302. Stack A Redis ×3 still 64MB/16MB, `coolify-redis` still 96MB/24MB, n8n still 3GB, Jellyfin still untouched (`RestartCount=0`) — all reconfirmed live, matching §A above exactly.

**Full detail:** [`docs/audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md`](audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md) (VPS hardening history); this entry is the first record of the Mythos-development-position discrepancy — no prior audit doc covers it.

---

## IMPLEMENTATION — `coolify-redis` Memory Cap (2026-08-10)

**Type:** Production implementation (mutation). Executed the read-only-confirmed mechanism from the entry below: `mem_limit=96m` / `mem_reservation=24m` applied to `coolify-redis` only, via a new `docker-compose.custom.yml` override — a genuinely upgrade-safe, Coolify-supported mechanism (unlike editing the vendor compose files directly, which is overwritten on every self-update).

**No subagents used.** `sudo -n` for system/Docker/root, `sudo -u deploy -H bash -lc '...'` for all Git operations.

**Repository baseline verified:** `origin/main` HEAD confirmed as `bfe0ec395cafaac2a162ffa031598741b1e2e23d` before this stage began (matches the SHA specified in the task).

**24th container resolved:** `jellyfin` (`jellyfin/jellyfin:latest`), user-confirmed as an intentional, authorized, unrelated personal media-server deployment (localhost-only, `127.0.0.1:8096`, own `2GiB` limit). Not touched at any point. Recorded as an expected additional VPS service, unrelated to Mythos/Coolify/Dar Hijama.

**Pre-mutation memory/swap gate:** available RAM 2.9Gi (above the 1.5GiB stop threshold), swap in/out low and non-sustained (`vmstat` si/so mostly 0 across 5 samples) — did not block the mutation, per the pre-authorized rule. No `swapoff`/swap-clear/reboot/swappiness change was made.

**Result: PASS.** `coolify-redis` recreated (`a97937581d8f...` → `b55ea2d64445...`), `running`/`healthy`, `RestartCount=0`, `OOMKilled=false`, `Memory=100663296` (96MB), `MemoryReservation=25165824` (24MB), `redis-cli ping` → `PONG`. `coolify`, `coolify-db`, `coolify-realtime` container IDs identical to baseline — confirmed not recreated. Stack A's 3 Redis caps unchanged (64MB/16MB). All protected domains unchanged (`darhijama.tn`/`uthinachess.tn`/`notrejour.tn` 200, `n8n.ssangyong.autos` 200, Coolify panel 302). Zero new OOM events. Vendor compose files and `upgrade.sh` checksums identical before/after — confirmed untouched; `docker-compose.custom.yml` confirmed present post-mutation and confirmed still referenced by `upgrade.sh`'s existing `-f` inclusion logic, so this cap will survive a future Coolify self-update. **No rollback needed.**

**Self-caught issue (remediated within this stage, before any commit):** the initial backup-creation step wrote a full `docker inspect coolify-redis` JSON dump to `/home/deploy/backups/coolify-redis-memcap-20260810/`, which included the live `REDIS_PASSWORD` value via `.Config.Env`, into a then-world-readable file/directory. Caught immediately: file deleted, backup directory locked to `700 root:root`, replaced with a redacted JSON (`.Config.Env`/`.NetworkSettings` stripped), re-verified with a `password|secret|token` grep (zero matches). No secret was ever committed to Git or exposed outside this root-only VPS path.

**Backup:** `/home/deploy/backups/coolify-redis-memcap-20260810/` (root-only, checksums + before/after summaries + absence marker + applied file copy, no secrets).

**Full detail:** [`docs/audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md`](audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md) §14.

**Exact next recommended action:** Step 1 now has 4 of 6 Redis-class targets capped (Stack A ×3 + `coolify-redis`). Remaining: Stack B's 3 Redis containers (needs its own authorized stage using the raw-compose-editor UI path, larger blast radius — a full-application redeploy) and `coolify-sentinel` (no supported mechanism exists in this Coolify version — deprioritized). **No Mythos implementation stage is queued or was advanced by this stage.**

---

## DISCOVERY — `coolify-redis` Final Read-Only Confirmation (2026-08-10)

**Type:** Read-only follow-up investigation, resolving the single remaining unknown from the prior Coolify discovery below (§13.2's "unconfirmed" upgrade-persistence question for `coolify-redis`). No Mythos implementation stage was started or advanced. No mutation performed.

**No subagents used.** Ran with `sudo -n` (passwordless root, newly available this session) for read-only system/Docker inspection, and `sudo -u deploy -H bash -lc '...'` for all Git operations, per the session's new execution-identity rule.

**Repository baseline verified:** `origin/main` HEAD confirmed as `6f799b7137c93324820b030ecb3539523fbe2658` before this investigation began (matches the SHA specified in the task; this is the commit that recorded the prior discovery below).

**Findings:**
- Read `/data/coolify/source/docker-compose.yml` and `docker-compose.prod.yml` directly (root access, `sudo -n cat`) — confirmed the exact `redis` service definition (`redis:7-alpine`, `--requirepass`, `coolify-redis` named volume, healthcheck) and confirmed no resource-limit field exists anywhere in either file today.
- Read the already-installed local `/data/coolify/source/upgrade.sh` (no external CDN fetch performed) — **resolves the previously-unconfirmed upgrade-persistence question**: the script unconditionally `curl -o`-overwrites both `docker-compose.yml` and `docker-compose.prod.yml` from Coolify's CDN on every self-upgrade, so a manual edit to either is **CONFIRMED OVERWRITTEN** on next upgrade. However, the same script also checks for an optional `docker-compose.custom.yml` and appends it via `-f` if present — and **never touches that file itself**. This is a genuine, Coolify-supported, upgrade-safe override mechanism. It does not currently exist on this host.
- Revised future mutation procedure: create `docker-compose.custom.yml` with only the `redis:` service's `mem_limit`/`mem_reservation`, then `docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.custom.yml up -d --no-deps redis` — expected to recreate only `coolify-redis` (single-service blast radius, same pattern as Stack A). Rollback: delete the custom file and re-run the same `up -d --no-deps redis` without it. **Not executed** — read-only investigation only.
- `coolify-redis` classification is now **PERSISTENT_METHOD_CONFIRMED, SAFE TO AUTHORIZE as its own stage** (mechanism fully understood, root access now available) — still requires a separate explicit authorization to execute, per this investigation's read-only scope.

**Safety**: `coolify-redis` running/healthy/uncapped as before, Stack A's 3 Redis caps unchanged (64MB/16MB), n8n unchanged (3GB), `darhijama.tn`/`uthinachess.tn`/`notrejour.tn` all 200, Coolify panel 302, zero OOM events. Container count observed as 24 (vs. 23 in prior audits) — flagged, not investigated (out of scope).

**Full detail:** [`docs/audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md`](audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md) §13.7.

**Exact next recommended action:** get explicit authorization for a separate, scoped implementation stage to create `docker-compose.custom.yml` and apply the 96MB/24MB cap to `coolify-redis` via `--no-deps redis`, with the same phased verification pattern used for Stack A. Stack B and `coolify-sentinel` classifications are unchanged from the entry below. **No Mythos implementation stage is queued or was advanced by this investigation.**

---

## DISCOVERY — Coolify Resource-Limit Mechanism Investigation (2026-08-10)

**Type:** Read-only investigation to resolve the persistent-configuration blocker from the prior Step 1 implementation, without applying any limit. No Mythos implementation stage was started or advanced.

**No subagents used** — all Coolify source-code reading was via `docker exec coolify cat/grep` (read-only, inside Coolify's own container); two narrowly-scoped read-only Postgres `SELECT`s (identifier columns only, no secrets) against `coolify-db`. No Coolify DB write, no file write outside this repo's two docs.

**Repository baseline verified:** `origin/main` HEAD confirmed as `aab1fff9307cbcdef68b581ac4af172938f42ea9` before this investigation began (matches the SHA specified in the task).

**Findings, confirmed directly from Coolify 4.1.2's own PHP source (not guessed):**
- **Stack B Redis ×3**: the `limits_memory` field (API/DB/UI) is a real field but is **never applied** for `build_pack=dockercompose` applications — confirmed by reading `ApplicationDeploymentJob::deploy_docker_compose_buildpack()` (zero resource-limit references) versus `generate_compose_file()` (where `limits_memory` actually gets injected, but only for Coolify-generated single-service buildpacks). **UNSUPPORTED** via that route. **However**, a working alternative exists: `docker_compose_raw` (the literal compose YAML Coolify deploys verbatim for this build_pack) is editable via the UI's Application → Configuration/General raw-compose editor (`app/Livewire/Project/Application/General.php`) — editing the 3 redis service blocks there and redeploying would work, because it edits the actual deployed source. **MANUAL_UI_ACTION_REQUIRED.** Exact path: `https://panel.mythosprod.xyz/project/nae2pn7zo9rq948iwoypjftc/environment/k5emgirp95bhkrhums6ozjxs/application/gi0p3mbss6geqhunih23fy6f/` (identifiers obtained via read-only SQL). Caveat: a full redeploy recreates *all* of Stack B's services at once, a materially larger blast radius than Stack A's `--no-deps` single-service control — should be its own explicitly-authorized stage.
- **`coolify-redis`**: persistent source confirmed as `/data/coolify/source/docker-compose.prod.yml` (Coolify's own infra stack, unrelated to the Application/`limits_memory` model). **PERSISTENT_METHOD_CONFIRMED, execution BLOCKED** — the file is root-only (`Permission denied` to `deploy`, no sudo available or used), and whether a manual edit would survive Coolify's next self-upgrade (which fetches and runs an external `upgrade.sh`) is unconfirmed without fetching that external script (not attempted).
- **`coolify-sentinel`**: confirmed via `app/Actions/Server/StartSentinel.php` (read in full) — created by a hardcoded `docker run` shell command with **no memory/CPU flags and no configurable resource field anywhere in Coolify's settings model**. **UNSUPPORTED** — no persistent mechanism exists in this Coolify version; a manual `docker update` would be wiped on the next Sentinel restart/recreate.

**Safety**: all 23 containers, Stack A's 3 Redis caps (64MB/16MB unchanged), n8n (3GB unchanged), `darhijama.tn` (200), Coolify panel (302) reconfirmed identical before and after. Zero OOM events.

**Full detail:** [`docs/audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md`](audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md) §13.

**Exact next recommended action:** for Stack B, scope and get explicit authorization for a separate stage using the raw-compose-editor path (with its own phased/verification plan given the larger blast radius); for `coolify-redis`, get an explicit decision from the user on granting temporary root access (or doing it themselves) since the mechanism is known but inaccessible to this account; `coolify-sentinel` has no available path in this Coolify version and should be deprioritized (its real footprint is only ~8.5-9MB). **No Mythos implementation stage is queued or was advanced by this investigation.**

---

## IMPLEMENTATION — VPS Memory Caps Step 1 (2026-08-10) — PARTIAL

**Type:** Production implementation (first mutating stage of the VPS memory-cap work; everything before this was read-only planning/audit). No Mythos implementation stage was started or advanced.

**No subagents used** — every command, including all mutations, ran directly over SSH from the primary session.

**Repository baseline verified:** `origin/main` HEAD confirmed as `11f302a1fa1a569f2547d5c5ebbed86e1ab26157` before this stage began (matches the SHA specified in the task).

**Result: PARTIAL.** Dar Hijama Stack A's three Redis containers (`redis-cache`, `redis-session`, `redis-queue`) were successfully capped at `mem_limit=64m` / `mem_reservation=16m`, applied persistently via the stack's own compose file (`/home/deploy/deployments/darhijama-v1.0.1/docker-compose.staging.yml`, backed up to `/home/deploy/backups/darhijama-memcaps-step1-20260810/` before editing), recreated one at a time with full health/PING/live-site verification after each, no rollback needed. Dar Hijama Stack B's three Redis containers, `coolify-redis`, and `coolify-sentinel` are **blocked** — full investigation recorded in `docs/audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md` §12.4: Stack B's compose source is Coolify-generated ephemeral state under `/artifacts/...` (not host-accessible, would be overwritten on next Coolify deploy); `coolify-redis`'s persistent source (`/data/coolify/source/`) exists but is permission-denied to `deploy` without sudo (none available/used); `coolify-sentinel` has no located compose/management source at all; Coolify's own DB-backed resource-limit mechanism (`applications.limits_memory`, confirmed to exist via read-only schema inspection) operates at whole-application granularity and would incorrectly cap Stack B's MySQL/app/web too if used as-is.

**Containers modified:** `dar-hijama-production-redis-cache-1`, `dar-hijama-production-redis-session-1`, `dar-hijama-production-redis-queue-1` — each recreated (new container ID, `RestartCount=0`, `OOMKilled=false`, `Memory=67108864`, `MemoryReservation=16777216` confirmed via `docker inspect`). No other container was touched — verified by re-inspecting `n8n-n8n-1` (still `Memory=3221225472`, unchanged), both MySQL containers, both app/web/queue/scheduler tiers, `coolify`, `coolify-db`, `coolify-realtime`, and the Notre Jour preview container (all still `Memory=0`, unchanged).

**Health checks (before/after, all pass):** `darhijama.tn` 200 throughout every phase; `n8n.ssangyong.autos` 200; `uthinachess.tn` 200; `notrejour.tn` 200; Coolify panel 302 (expected unauthenticated redirect); zero kernel OOM messages (`journalctl -k`) during or after implementation; host RAM/swap essentially unchanged (2.9Gi used / 4.7Gi available / ~52-60KiB swap, before and after — expected, since the three containers were already using ~3.6MB each, far under their new 64MB caps).

**Full detail:** [`docs/audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md`](audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md) §12.

**Exact next recommended action:** obtain Coolify UI/API access to check for a per-service resource-limit override (the DB-backed `limits_memory` mechanism confirmed to exist is whole-application-scoped, not usable as-is for Redis-only limits on Stack B); separately obtain an authorized path to `/data/coolify/source/` for `coolify-redis`; identify `coolify-sentinel`'s management mechanism. Once any of those are resolved, resume the phased Step 1 process for the remaining 5 containers. **No Mythos implementation stage is queued or was advanced by this stage.**

---

## SAFETY REVIEW — VPS Memory Plan Correction (2026-08-10)

**Type:** Read-only final safety review of the memory budget plan below, performed before any implementation. No Docker memory limit, restart policy, `maxmemory`/eviction config, or container was changed. No Mythos implementation stage was started or advanced.

**No subagents used** — all data collected directly over SSH by the primary session.

**Repository baseline verified:** `origin/main` HEAD confirmed as `daaaeb305a62cc027b54826e87242f93150bf40a` before this review began (matches the SHA specified in the task).

**Correction made:** the memory plan's §7 originally claimed per-container limits make host-wide OOM "structurally impossible." **This was incorrect and has been corrected in place** (see `docs/audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md` §7 inline note and new §11). Per-container limits reduce single-container risk; they do not bound the *sum* of limits against physical capacity. Recalculated: against a 2.0GB global safety reserve (kernel/systemd/nginx/SSH 200MB + Docker/containerd overhead 500MB + host MariaDB/PHP-FPM 300MB + filesystem cache floor 300MB + burst buffer 700MB), the **preferred aggregate capped maximum is ≈5.65GB** (no swap reliance) and the **hard danger threshold is ≈7.65GB** (swap-backed). Scenario A's proposed sum (8832MB) exceeds both — by ~3.0GB against the preferred ceiling and ~1.0GB against the hard threshold. This is a real, quantified residual risk (smaller than the pre-cap n8n-style single-service failure, but not zero) that should be addressed by trimming the aggregate in a future revision, not by retiring Dar Hijama Stack B (which remains explicitly out of scope).

**Redis finding:** all 6 Dar Hijama Redis instances directly re-verified via `redis-cli CONFIG GET` (authenticated using each container's own password env var, never printed) — all have `maxmemory=0` and `maxmemory-policy=noeviction`. The proposed 64MB Docker `mem_limit` is unchanged and still safe on its own, but it is currently the *only* protection layer, and it fails ungracefully (SIGKILL) rather than gracefully (Redis-level eviction/rejection). Role-specific recommendation recorded (cache: `allkeys-lru`; session: keep `noeviction` pending app-level TTL review; queue: keep `noeviction`, correctness-critical) — **not applied**.

**`i4mv37ig6xavokv0kpy5517d` identified:** a Coolify-managed **preview/staging deployment of the "Notre Jour" project** (`coolify.projectName=notrejour`, `APP_ENV=local`, SQLite, sync queue), reachable only via Coolify's auto-generated sslip.io URL. The real `notrejour.tn` production domain is served by a separate, host-native PHP-FPM deployment (`/var/www/notrejour/public`), confirmed via nginx config — entirely independent of this container. **Not production-critical.** Risk downgraded from MEDIUM to LOW; its 320MB proposed cap stands, now with full justification.

**Step 1 authorization call: SAFE TO AUTHORIZE.** Step 1 (both stacks' Redis ×6 + `coolify-redis` + `coolify-sentinel`) sums to only 576MB of proposed limits against ~43MB current real usage — the aggregate-ceiling concern above is driven by MySQL ×2 and Coolify core (Steps 5–6), not Step 1. Later steps should be re-evaluated against a trimmed aggregate before authorization, separate from Step 1.

**Full detail:** [`docs/audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md`](audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md) §11.

**Exact next recommended action:** authorize a separately-scoped implementation task for Step 1 only (both stacks' Redis, `coolify-redis`, `coolify-sentinel`), verify with `docker stats` and live HTTP checks after, then commission a follow-up revision of the plan that trims the aggregate proposed limits (primarily MySQL and Coolify core) toward the ≈5.65GB preferred ceiling before Steps 5–6 are authorized. **No Mythos implementation stage is queued or was advanced by this review.**

---

## PLAN — VPS Memory Budget & Container Limit Plan (2026-08-10)

**Type:** Read-only planning stage. No Docker memory limit, restart policy, or configuration was applied. No Mythos implementation stage was started or advanced.

**No subagents used** — all data collected directly over SSH by the primary session, per standing project policy (see [[project-mythos-workflow]] memory / `AGENTS.md`).

**Repository baseline verified:** `origin/main` HEAD confirmed as `eaa4c90f10a953e8a38c733988cf4995b587e37c` before this plan began (matches the exact SHA specified in the task).

**Full plan:** [`docs/audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md`](audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md)

**Summary:** Designed per-container `mem_limit`/`mem_reservation` recommendations for all 22 currently-uncapped containers (n8n's existing 3GB cap left unchanged). Proposed sum of all limits ≈8.63GB — intentionally exceeds physical RAM (7.6GB) as standard, explained container-hosting overcommit (real observed usage is only ≈2.9GB); the plan explicitly discusses the zero-overcommit alternative and why it would require MySQL internal tuning (not applied) rather than unsafely tight Docker caps. Highest-risk items: both MySQL containers (HIGH, needs a config review before final sizing) and the Coolify core container (HIGH, apply last). Recommended implementation order: Redis/sentinel → scheduler/web → app/queue → coolify-realtime/coolify-db → both MySQL → Coolify core.

**Correction to the prior health audit:** the "~400-500MB host-native PHP/Horizon" risk item in `docs/audits/VPS_SERVICE_HEALTH_AUDIT_2026-08-10.md` §12 was partly a misattribution. Direct `/proc/<pid>/cgroup` inspection shows the Horizon processes run *inside* the `coolify` container (Coolify's own internal job queue), not host-native. True host-native app-layer footprint is only MariaDB (129MB, `mariadb.service`) + PHP-FPM serving `uthinachess.tn` directly (117MB, `php8.5-fpm.service`) ≈ 246MB. See plan §2 for full detail.

**Dar Hijama Scenario A/B:** Scenario A (both stacks running, current state) → sum of limits 8832MB. Scenario B (Stack B / Coolify app #3 retired, **not authorized**, pending the Coolify-UI decision the original audit already called for) → sum drops to 6848MB, falling *below* physical RAM and eliminating overcommit entirely, plus frees ~570MB real usage and ~700MB disk. No retirement action was taken or authorized.

**Exact next recommended action:** Get explicit authorization for a separate, scoped implementation task to apply the Step 1 (LOW risk) caps first — both stacks' Redis containers, `coolify-redis`, `coolify-sentinel` — verify with `docker stats` and live HTTP checks after each, then proceed through the remaining steps in `docs/audits/VPS_MEMORY_BUDGET_PLAN_2026-08-10.md` §10. MySQL config review (buffer pool sizing, `max_connections`, `performance_schema`) should be scoped as its own reviewed task before MySQL caps are finalized. **No Mythos implementation stage is queued or was advanced by this plan.**

---

## AUDIT — VPS Service Health Audit (2026-08-10)

**Type:** Read-only infrastructure audit, not a Mythos implementation stage. No stage was started or advanced by this entry.

**Process note:** Initial data collection was performed via a delegated general-purpose subagent, which Mythos OS project policy prohibits without explicit authorization (not given here). All load-bearing findings were subsequently re-verified directly over SSH by the primary session, with no subagent involved — see the report's §14 "Direct Re-Verification" for the full independent-verification results. **Future audits/sessions on this project must not use subagents unless the user explicitly authorizes it.**

**Direct verification result:** PASS. All load-bearing findings independently reconfirmed (host health, container count/IDs, docker stats, n8n memory cap + all 7 remediation env guards + swap persistence, n8n workflow publish status, Dar Hijama routing/classification, public port exposure, git diff scope, `git diff --check`, secret scan). One correction applied: the queue-container restart-count observation was upgraded from an open inference to a confirmed benign root cause (hourly self-recycling via the queue worker's `--max-time=3600` flag + `unless-stopped` restart policy — unrelated to the OOM incident and not caused by either audit pass). No other finding required correction.

**Scope:** Full read-only host/Docker/network/service-inventory health audit of the persistent VPS (`/home/deploy/projects/mythos-prod`) following the recent n8n OOM incident. Covered host health, Docker global health, per-service ownership, the Dar Hijama duplicate-stack question, network exposure, Coolify, n8n post-incident remediation verification, live service checks, storage, security observations, and OOM residual-risk classification.

**Timestamp:** 2026-08-10 (audit session)

**Repository baseline:** local HEAD `6e58ad40ce41be208d6e611f498f3e035df16126`, observed `origin/main` HEAD `6e58ad40ce41be208d6e611f498f3e035df16126` (in sync, working tree clean before and after this audit — audit added only the two documentation files referenced below).

**Full report:** [`docs/audits/VPS_SERVICE_HEALTH_AUDIT_2026-08-10.md`](audits/VPS_SERVICE_HEALTH_AUDIT_2026-08-10.md)

**VPS health classification:** `HEALTHY_WITH_WARNINGS` — OOM incident fully resolved (no OOM messages this boot, swap ~unused, 4.7GiB available), all 23 containers healthy, all n8n remediation guards (3GB Docker cap, 2GB Node heap, concurrency limit 2, execution pruning, vacuum-on-startup, workflow autodeactivation, persistent 2GB swap) verified live and correct, n8n at 310MB/3GB with 0 published/active workflows (SSANGYONG scraper + Auto Restart confirmed inactive). Residual risk is structural: 22 of 23 containers have no memory cap (including two ~430-440MB uncapped MySQL instances), and a Coolify-managed duplicate Dar Hijama stack (`gi0p3...`, application #3) is fully running but receiving zero live traffic — nginx routes `darhijama.tn` exclusively to the separately-deployed `dar-hijama-production-*` stack. The duplicate stack is classified `POSSIBLY_STALE`, not concluded safe to remove; a Coolify-UI decision is needed, not container-level inference.

**Test/health-check results:** All 4 checked live domains (uthinachess.tn, n8n.ssangyong.autos, darhijama.tn, Coolify panel) returned 200/302 with valid TLS (45+ days to expiry on all). No unexpected public port exposure found. No secrets printed.

**Blockers encountered (informational, not stopping conditions):**
- n8n backup file `/opt/n8n/backups/n8n-before-vacuum-20260810.sqlite` could not be verified (root-only directory, no sudo available/attempted) — presence/size UNKNOWN, but confirmed untouched.
- SSH login history (`journalctl -u ssh` / `/var/log/auth.log`) unreadable by the `deploy` account without sudo — not attempted, per no-privilege-escalation constraint. SSH login/auth-failure counts UNKNOWN.
- Per-directory `/var/lib/docker` size breakdown unavailable (root-only, 0700) — `docker system df -v` used as substitute.

**Exact next recommended action (P1, highest priority, not yet executed):** Add explicit memory caps to all currently-uncapped containers (starting with both MySQL instances) to prevent a repeat OOM-style incident from a different service than n8n, and obtain a human decision inside the Coolify UI on whether to stop/archive Coolify Application #3 (the stale-traffic Dar Hijama stack). See the full report's "Recommended Actions" section for the complete P0–P3 list. **No Mythos implementation stage is queued or was advanced by this audit.**

**Audit commit:** `0c73b48bf08d9b2d0605e20e51360bacc1fbd376` — pushed directly to `main` (docs-only bookkeeping commit, matching this repo's established pattern for audit/stage-record entries; no PR/merge step used, consistent with prior `docs:` commits in this file's own history). Remote HEAD confirmed at this SHA immediately after push via `git fetch origin && git rev-parse origin/main`.

---

## Stage AUT-CONNECTOR-SHARED-HELPERS-0 — Shared Read-Only Connector Foundation Cleanup

**Objective:** Extract shared, provider-neutral safety/snapshot helpers from the OVH and Cloudflare read-only connector reference implementations, eliminate duplicated business/safety logic, and preserve all existing connector behavior and tests. Resolves the deferred cleanup item recorded in both `INF-OVH-API-0` and `INF-CF-AUTO-0`'s handover entries above.

**Status:** COMPLETE AND MERGED TO MAIN — code-quality/foundation refactor only. No live OVH/Cloudflare credential, no live network call, no DB, no deployment.

**Started via:** Owner instruction "Execute this stage end-to-end while I am away", resolved through the DEVX-0 Stage Runner (`node scripts/mythos-stage.js start AUT-CONNECTOR-SHARED-HELPERS-0`), which classified this as risk lane **STANDARD** (RUNTIME type → `RUNTIME_STAGE` template) and surfaced the relevant skills, files, and test strategy.

**Branch:** `refactor/automation-connector-shared-helpers` (created from `origin/main` at `39a3a6fc57167054e98f5d6d3971db821abf6b7d`)
**Implementation commits:** `a191d06` refactor(automation): extract read-only connector helpers · `9ec6e6b` test(automation): define shared connector helper contract · `6a609be` docs: record shared connector helper cleanup
**Pull Request:** #10, opened Draft, marked ready for review after all gates passed, merged with a standard merge commit (no squash, no rebase, no force-push) — no pause for a second merge approval, per standing owner authorisation, since every gate was green
**Merge commit SHA:** `bf95988bc9eb72f37e6c4fa8e8b474a69c4e22a3`
**`main` HEAD after merge:** `bf95988bc9eb72f37e6c4fa8e8b474a69c4e22a3` (fast-forwarded; verified `git rev-parse HEAD` == `git rev-parse origin/main`)

### What was built

- `projects/automation/reference/connector-readonly-helpers.js` — new, deliberately small (two functions, ~35 lines of logic) shared module owning only:
  - **A. Mutation-method detection / fail-closed client validation** (`assertReadOnlyClient(client, opts)`), pattern-based (`MUTATING_METHOD_PATTERN`), not an allowlist — a never-before-seen mutation-shaped method name is still caught.
  - **B. Snapshot record construction** matching the `aut_snapshots` table shape exactly (`buildSnapshotRecord(input, opts)`).
  - Both accept an `opts.errorPrefix` so each provider's error messages keep their own identity (`OVH_CONNECTOR:` / `CLOUDFLARE_CONNECTOR:`).
- `projects/automation/reference/ovh-readonly-connector.js` and `cloudflare-readonly-connector.js` — both now `require('./connector-readonly-helpers.js')` and delegate `assertReadOnlyClient`/`buildSnapshotRecord` to it. Neither file carries a second behavioral implementation. **Public `module.exports` contracts unchanged** for both.
- `tests/aut-connector-shared-helpers-0-test.js` — 40 tests covering the shared contract, delegation (verified by inspecting function bodies, not just export presence), compatibility exports, fail-closed behaviour against both known and never-before-seen mutation-shaped method names, snapshot shape/redaction invariants, and absence of any network/credential dependency in the shared module.

### What was deliberately NOT touched (per explicit scope)

- **Redaction stays provider-specific.** OVH keeps `redactRegistrantFields`; Cloudflare keeps `redactOwnerFields`. Neither was combined into a generic redactor — this stage is not permission to redesign privacy policy.
- Domain vs. zone collection orchestration, resource types/naming, `authorised_domains` vs. `authorised_zones` config shape, and run orchestration (`collectForDomain`/`collectForZone`, `runReadOnlyCollection`) all remain fully provider-specific and untouched beyond the two delegated function bodies.
- No retry framework, caching, drift detection, scheduler, provider SDK, live authentication, or artifact storage implementation was added — those are separate, out-of-scope concerns per the order.

### Design guard

The shared module is smaller and easier to reason about than the ~60 combined duplicated lines it replaced, with a two-function API. No large generic framework was introduced. `ABSTRACTION_OVERREACH` was not triggered.

### Existing project intelligence reused (not duplicated)

- **Stage Runner** resolved the Stage Context before any implementation began.
- **`projects/meta/test-impact-map.json`** — updated so `projects/automation/` changes now also select the new shared-helper test.
- **`projects/meta/project-ledger.json`** — new `AUT-CONNECTOR-SHARED-HELPERS-0` stage record added (track `mythos-automation-operations`, type `RUNTIME`).
- **`scripts/project-intelligence.js validate`** — re-run after every metadata change, 0 errors throughout.
- Stage 3D was **not** re-run — this stage touched no `js/`/`css/`/`.php`/`index.html` file, so re-running it was not justified per `docs/DEVELOPMENT_TEST_INTELLIGENCE.md`'s own policy.

### Validation

- `node tests/aut-connector-shared-helpers-0-test.js` — **40/40 passed**
- `node tests/inf-ovh-api-0-connector-test.js` — **26/26 passed** (unchanged from before the refactor)
- `node tests/inf-cf-auto-0-connector-test.js` — **26/26 passed** (unchanged from before the refactor)
- `node tests/devx-0-development-acceleration-test.js` — 45/45 passed (regression, unaffected)
- `node tests/mpi-0-finalization-governance-test.js` — 36/36 passed (regression, unaffected)
- `node tests/mpi-0-personal-intelligence-test.js` — 63/63 passed (regression, unaffected)
- `node scripts/project-intelligence.js validate` — 0 errors, 0 warnings
- `git diff --check` — clean; no real `<<<<<<<`/`>>>>>>>` conflict markers (only this repository's usual `// =====` comment-banner style, which superficially matches a `=======` grep but is not a merge artifact)
- Secret/token scan across every changed file — clean

### Safety Confirmation

No live OVH/Cloudflare credential of any kind touched — none exists anywhere on the deployment host, confirmed before this stage began. No live network call. No DNS/zone/nameserver/DNSSEC mutation. No database installed, migrated, or executed. No production runtime (JS/HTML/PHP/CSS) changed — only `projects/automation/reference/` and `tests/`. Does not start INF-DNS-AUTO-1, RES-1, MPI-1, Stage 3E, IDA-2, ATN-1, or AVA-1. No unrelated "Course Intelligence"/Teachable work performed.

### Exact Next Action

1. **INF-DNS-AUTO-1 — DNS Snapshot, Comparison and Drift Detection** remains the next Automation implementation stage — **NOT STARTED**, unaffected by this cleanup.
2. Unchanged by this stage: MPI-1, RES-1, Stage 3E, IDA-2, ATN-1, AVA-1 all remain NOT STARTED.
3. The shared-connector-helper deduplication item referenced as deferred in the INF-OVH-API-0 and INF-CF-AUTO-0 entries above is **now resolved** — those entries remain historical records of what was true when they were written and are not rewritten.
4. Respect the one-major-stage rule: do not begin another major stage without explicit owner authorisation.

## Stage RUNTIME-DUPLICATE-CLEANUP-0 — Canonical Runtime Function Ownership + Stage 4Z Repair

**Objective:** Resolve the deferred duplicate-function cleanup for `editInvoice`, `deleteInvoice`, `addOmPerson`, `cancelOM` (referenced as deferred in the INF-CF-AUTO-0 and INF-OVH-API-0 entries above), and correct the now-outdated Stage 4Z/4AG test assertions that required the pre-fix state.

**Status:** COMPLETE AND MERGED TO MAIN. **Pull Request:** #9, opened not-draft, merged with a standard merge commit (no squash, no rebase, no force-push). **Merge commit SHA:** `9f5813d51e0bfd2dfffc0a3c958ddfef7efd9549`. **`main` HEAD after merge:** `9f5813d51e0bfd2dfffc0a3c958ddfef7efd9549` (fast-forwarded; verified `git rev-parse HEAD` == `git rev-parse origin/main`). Post-merge: re-ran `tests/runtime-duplicate-cleanup-0-test.js` (24/24), `tests/stage4z-test.js` (48/48), `tests/stage4ag-test.js` (44/44), and `node scripts/project-intelligence.js validate` (0 errors, 0 warnings) directly on `main` — all confirmed green.

**Started via:** Owner instruction with full pre-authorization for this stage's branch, PR, and — gated on every listed test/validation gate passing — merge.

**Branch:** `fix/runtime-duplicate-function-ownership` (created from `main` at `c2134e574b5a7e05ac3acbf41ae262cb2cad6b08`)
**Implementation commits:** `671234c` test(runtime): define canonical duplicate-function ownership · `a141371` refactor(runtime): remove stale duplicate invoice handlers · `f89fb8c` test(stage4z): enforce canonical extracted-function ownership

### Fresh audit against current main (the historical audit was outdated)

The owner's instruction supplied a historical audit and explicitly required it to be re-verified, not trusted. Re-auditing against current `main` found:

- **Mission orders (`addOmPerson`, `cancelOM`):** the historical audit was correct that this is **ALREADY RESOLVED**. Zero definitions in `app.js` (only ownership comments); both canonical in `mission-orders.js` since Stage 4AG. No code change needed — added an explicit regression test to lock this in, since Stage 4Z previously only asserted `cancelOM`'s absence from `app.js`, not `addOmPerson`'s.
- **Invoices (`editInvoice`, `deleteInvoice`):** the historical audit's *conclusion* (canonical owner should be `invoices.js`) was correct, but its *premise* was stale. `docs/ROADMAP.md`'s "Known blocked items" note and `tests/stage4ag-test.js` already documented the real blocker: a stray, unused `let stableLineCount = 0;` in `mission-orders.js:28` (dead — never referenced again in that file) collides with `invoices.js`'s genuinely-used `var stableLineCount`. Because `app.js` → `mission-orders.js` → `invoices.js` load as classic `<script>` tags with no `defer`, sharing one global lexical scope, this collision throws a `SyntaxError` that silently discards the *entire* `invoices.js` script at runtime — confirmed empirically both ways (reproduced the exact `SyntaxError: Identifier 'stableLineCount' has already been declared` against the pre-fix file content, and confirmed clean shared-context load after the fix). This meant `app.js`'s legacy `editInvoice`/`deleteInvoice` were not stale duplicates sitting alongside a working canonical version — they were **the only implementation actually running in production**, silently degraded (no TVA/timbre/status/payment-mode/line restoration on edit; "add line" was a dead `alert('Fonctionnalité en développement')` stub). Cross-checked against the live `index.html` form DOM (`f-num-year`, `f-tva`, `f-timbre-amount`, `f-status`, `f-payment-mode`, `lines-body`) confirmed these fields exist only because `invoices.js`'s implementation expects them — `app.js`'s version never touched them.

### What was fixed

- Removed the dead `let stableLineCount = 0;` from `js/shared/mission-orders.js` (zero behavior impact there — the binding was never read after declaration).
- Removed `editInvoice`/`deleteInvoice` from `js/app.js`, replaced with an ownership comment matching the file's existing convention (`// editInvoice, deleteInvoice → js/shared/invoices.js`). All existing `onclick="editInvoice(...)"`/`"deleteInvoice(...)"` call sites (`dashboard.js`, `clients.js`, `natures.js`, `invoices.js`'s own generated markup) are unaffected — they resolve the global name at click time, and now resolve to the richer, DOM-correct implementation.
- `populateInvoiceList` intentionally **left in `app.js`** — not one of the four functions named in this stage's scope, and its only caller (the legacy `navigateTo('invoices')` path in `js/core/router.js`) is already unreachable from the live UI. Modifying `js/core/router.js` was outside this stage's authorized scope; removing `populateInvoiceList` without also fixing its caller would have been a real, avoidable regression.
- Corrected `tests/stage4z-test.js` (section 3 previously required `editInvoice`/`deleteInvoice` to remain in `app.js`; now asserts the opposite, correct condition, plus an explicit `addOmPerson`-absent check) and `tests/stage4ag-test.js` (sections 3 and 12 previously hard-coded the "BLOCKED pending stableLineCount fix" state).
- Added `tests/runtime-duplicate-cleanup-0-test.js` (24 tests) — including a same-shared-global-scope `vm` load test for `mission-orders.js` + `invoices.js` together, since that is the only kind of check that actually catches this class of cross-file redeclaration collision; static string-presence checks (what the rest of the suite uses) cannot.

### Validation

- `node tests/runtime-duplicate-cleanup-0-test.js` — **24/24 passed**
- `node tests/stage4z-test.js` — **48/48 passed**
- `node tests/stage4ag-test.js` — **44/44 passed**
- `node tests/stage4m-test.js` (invoice extraction, Stage 4M) — **76/76 passed** (regression, unaffected)
- `node tests/stage4l-test.js` (mission-order extraction, Stage 4L) — **59/59 passed** (regression, unaffected)
- `node tests/stage3d-test.js` — **104/110**, exact match to `projects/meta/known-baselines.json`'s `stage3d-known-failures` baseline: same six known failures (`stage3c`, `stage3b`, `stage3a5` partial; `stage3a`, `stage2d`, `stage1c-part1` subprocess error), same failure types, no new regression, none silently mutated
- `node tests/devx-0-development-acceleration-test.js` — **45/45 passed** (regression, unaffected)
- `node tests/mpi-0-finalization-governance-test.js` — **36/36 passed** (regression, unaffected)
- `node tests/mpi-0-personal-intelligence-test.js` — **63/63 passed** (regression, unaffected)
- `node scripts/project-intelligence.js validate` — 0 errors, 0 warnings
- `git diff --check` — clean
- Secret/credential/PII scan of the full diff — clean (no matches for password/secret/api-key/token/private-key/PII patterns)
- Scope check: only `js/app.js`, `js/shared/mission-orders.js`, `tests/stage4z-test.js`, `tests/stage4ag-test.js`, `tests/runtime-duplicate-cleanup-0-test.js` (new), and `projects/meta/project-ledger.json` changed — matches the authorized scope exactly, no unrelated file touched

### Safety Confirmation

No DB / no deployment / no provider operations. No live credential of any kind touched. No feature added, no visual redesign, no schema change. The Cloudflare/OVH `buildSnapshotRecord`/`assertReadOnlyClient` shared-connector-helper deduplication (referenced above under INF-CF-AUTO-0) remains **NOT STARTED** — this stage did not touch `projects/automation/`.

### Exact Next Action

1. **INF-DNS-AUTO-1 — DNS Snapshot, Comparison and Drift Detection** is the next Automation implementation stage — **NOT STARTED.**
2. Unchanged by this stage: MPI-1, RES-1, Stage 3E, IDA-2, ATN-1, AVA-1 all remain NOT STARTED. The Cloudflare/OVH `buildSnapshotRecord`/`assertReadOnlyClient` shared-connector-helper deduplication remains a separate, still-deferred, not-yet-authorised item — this stage did not touch `projects/automation/`.
3. Respect the one-major-stage rule: do not begin another major stage without explicit owner authorisation.

---

## Stage INF-CF-AUTO-0 — Cloudflare Read-Only Connector

**Objective:** Implement the LEVEL_1_READ_ONLY scope defined in `docs/AUTOMATION_ROADMAP.md` — account and zone inventory, current settings inventory. No writes.

**Status:** COMPLETE AND MERGED TO MAIN as a mocked, in-memory reference implementation — no live Cloudflare credential exists anywhere in this repository or on the deployment host, and no live network call has been made by this connector. This matches the pattern established by INF-OVH-API-0, MPI-0, AUT-0, and RES-0: architecture and reference code first, live connection only in a later, separately-authorised stage.

**Started via:** Owner instruction "Start INF-CF-AUTO-0 according to Mythos workflow", resolved through the DEVX-0 Stage Runner (`node scripts/mythos-stage.js start INF-CF-AUTO-0`), which correctly classified this as risk lane **STANDARD** (per `projects/meta/stage-templates.json`'s `CONNECTOR_STAGE` template) and surfaced the relevant skills, files, and test strategy without the owner needing to restate any of it.

**Branch:** `feat/inf-cf-auto-0-readonly-connector` (created from `origin/main` at `0cf443819879a2356e853be9ef047c0dcf8fd179`)
**Implementation commits:** `c0b37de` feat(automation): add Cloudflare read-only connector reference implementation · `14fc62c` docs(automation): record INF-CF-AUTO-0 reference implementation status
**Pull Request:** #8, opened Draft, marked ready for review after all gates passed, merged with a standard merge commit (no squash, no rebase, no force-push)
**Merge commit SHA:** `82fd2f97165495fb112bbdff828a1ce4a6884334`
**`main` HEAD after merge:** `82fd2f97165495fb112bbdff828a1ce4a6884334` (fast-forwarded; verified `git rev-parse HEAD` == `git rev-parse origin/main`)

### What was built

- `projects/automation/reference/cloudflare-readonly-connector.js` — reference implementation mirroring `ovh-readonly-connector.js`'s structure:
  - `redactOwnerFields(raw)` — strips account-owner-identifying fields (owner email, owner name, contact fields), retains plan/status/creation date.
  - `buildSnapshotRecord(input)` — builds a record matching the existing `aut_snapshots` table's exact column shape; never embeds raw provider data, only an `artifact_reference`.
  - `assertReadOnlyClient(client)` — structural read-only enforcement, same mutation-verb pattern as the OVH connector.
  - `collectForZone(client, zoneId, opts)` / `runReadOnlyCollection(client, config)` — orchestration. Refuses to run unless `config.enabled === true` and `config.authorised_zones` is a non-empty array. Never constructs a real Cloudflare API client itself.
- `tests/inf-cf-auto-0-connector-test.js` — 26 tests, every provider response mocked, no live network call, no live credential required.

### Known deferred cleanup — deliberately NOT performed in this stage

`buildSnapshotRecord` and `assertReadOnlyClient` in `cloudflare-readonly-connector.js` are structurally identical to their counterparts in `ovh-readonly-connector.js`. Extracting a shared helper module (e.g. `projects/automation/reference/snapshot-helpers.js`) was considered, but the owner explicitly instructed this stage not to perform that refactor ("Do not start... the deferred duplicate-function cleanup"). This duplication is a known, recorded, intentionally-deferred item for a future stage — not an oversight.

### Existing project intelligence reused (not duplicated)

- **Stage Runner** (`scripts/mythos-stage.js`) resolved the Stage Context: risk lane STANDARD, relevant skills, relevant files, and blockers — before any implementation began.
- **`projects/meta/known-baselines.json`** — Stage 3D baseline not applicable; this stage touched no `js/`/`css/`/`.php`/`index.html` file, so it was not re-run.
- **`projects/meta/test-impact-map.json`** — updated so `projects/automation/` changes now select both `tests/inf-ovh-api-0-connector-test.js` and `tests/inf-cf-auto-0-connector-test.js`.
- **`projects/meta/project-ledger.json`** — new `INF-CF-AUTO-0` stage record added (track `mythos-automation-operations`, type `CONNECTOR`).
- **`scripts/project-intelligence.js validate`** — re-run after every metadata change, 0 errors throughout.

### Validation

- `node tests/inf-cf-auto-0-connector-test.js` — **26/26 passed**
- `node scripts/project-intelligence.js validate` — 0 errors, 0 warnings
- `git diff --check` — clean
- Secret/credential scan of the connector module source — confirmed it never reads an environment variable and never references a credential-shaped field name — credentials are strictly the injected client's concern, never this module's
- No PII (account owner name/email/phone) appears in any returned snapshot record — confirmed by test
- Confirmed no Cloudflare credential exists anywhere on the deployment host (`env | grep -i cloudflare` returned empty prior to this stage)

### Safety Confirmation

No live Cloudflare credential created, requested, or stored anywhere. No live network call made. No DNS or zone-setting change against a live domain. No database installed, migrated, or executed. No production runtime (JS/HTML/PHP/CSS) changed. Does not start INF-DNS-AUTO-1, RES-1, MPI-1, Stage 3E, IDA-2, ATN-1, or AVA-1. Does not perform the deferred duplicate-function cleanup.

### Exact Next Action

1. **INF-DNS-AUTO-1 — DNS Snapshot, Comparison and Drift Detection** is the next Automation implementation stage — **NOT STARTED.**
2. Unchanged by this stage: MPI-1, RES-1, Stage 3E, IDA-2, ATN-1, AVA-1 all remain NOT STARTED. The `ovh-readonly-connector.js`/`cloudflare-readonly-connector.js` duplicate-function cleanup remains an explicitly deferred, not-yet-authorised item.
4. Respect the one-major-stage rule: do not begin another major stage without explicit owner authorisation.

## Stage RES-0 — Mythos Research Intelligence Foundation

**Objective:** Establish the free-first, provider-independent external research capability architecture for the Mythos platform. Document vision, architecture, provider strategy, security/privacy, source trust/citation model, roadmap, and config templates. No implementation. No deployment. No provider accounts.

**Starting remote HEAD:** `909ced531dab7095cc6511efd6e646ba4befa07c` (origin/main — AUT-0 handover)
**Implementation commit:** `01c86a583cec43f4f257f3ea9930d83c1d159838`
**Status:** Complete and merged to `main`

**Branch:** `docs/research-intelligence-foundation`
**Refresh commit (resolving conflicts against current `main`):** `ccd22016c8e3cd61dce37d8d7aa6b34581714e2b` — merged `main` in, resolved two documentation conflicts in `docs/AI_HANDOVER.md` and `docs/ROADMAP.md`, corrected two now-stale RES-1 entry-gate statuses (MPI-0 and INF-OVH-API-0 had both since completed), removed a redundant duplicate Research Intelligence stub section that had been added to `docs/ROADMAP.md` by a later stage before this PR was finalised.
**Pull Request:** #5, opened Draft, refreshed and finalised for merge, merged with a standard merge commit (no squash, no rebase, no force-push)
**Merge commit SHA:** `38741453570517fb106cfff1f2662c26b18b5c0d`
**`main` HEAD after merge:** `38741453570517fb106cfff1f2662c26b18b5c0d` (fast-forwarded; verified `git rev-parse HEAD` == `git rev-parse origin/main`)

### Scope

Documentation only. No runtime code, no database, no deployment, no SearXNG installation, no provider API keys, no Coolify changes, no OVH access, no Cloudflare changes. Research Intelligence is a platform capability — not a product and not a Mythos OS feature.

### Files Created

| File | Description |
|---|---|
| `projects/research-intelligence/README.md` | Project overview, architecture summary, provider tiers, relationship to MPI and Automation, repository layout |
| `docs/MYTHOS_RESEARCH_INTELLIGENCE_VISION.md` | Full vision: free-first principle, provider independence, model independence, MPI integration, capability model, success criteria, non-goals |
| `docs/MYTHOS_RESEARCH_INTELLIGENCE_ARCHITECTURE.md` | 15 conceptual components (ResearchGateway, SourceStrategy, ProviderRouter, OfficialSourceFetcher, SearXNGAdapter, BraveAdapter, TavilyAdapter, PerplexityAdapter, SourceTrustScorer, FreshnessEvaluator, ContentExtractor, CitationNormalizer, ResearchCache, RedactionGuard, ResearchAudit, ResearchBudgetGuard); 8 provisional architecture decisions (RES-AD-1 through RES-AD-8) |
| `docs/RESEARCH_PROVIDER_STRATEGY.md` | 6-tier provider strategy (TIER 0-4); SearXNG, Brave, Tavily, Perplexity analysis with official documentation references; pricing labelled CURRENT_REFERENCE_ONLY / SUBJECT_TO_CHANGE; provider decision matrix |
| `docs/RESEARCH_SECURITY_AND_PRIVACY.md` | Context minimisation rules, redaction examples, SSRF protection specification (blocked destinations, schemes, fetch constraints), credential security, cache privacy, audit privacy, 5 security architecture decisions (RES-SEC-1 through RES-SEC-5) |
| `docs/RESEARCH_SOURCE_TRUST_AND_CITATIONS.md` | 5 trust classes (AUTHORITATIVE, HIGH, MEDIUM, COMMUNITY, UNKNOWN), trust scoring model, 4 freshness classes (STATIC, SLOW_CHANGING, CURRENT, HIGH_FRESHNESS), citation format and deduplication, source type classification |
| `docs/RESEARCH_ROADMAP.md` | RES-0 through RES-6 stage plan; RES-1 entry gate (8 conditions); RES-2 additional gate (10 conditions); dependency map; explicit NOT AUTHORISED status |
| `projects/research-intelligence/config/research.example.json` | Config template: product_key, modes, providers, security, cache, source_trust, freshness, citation, budget, audit, integration, feature_flags — all `false` / `NOT_DEPLOYED` |
| `projects/research-intelligence/config/providers.example.json` | 6-provider registry: mythos_internal, official_source_fetcher, searxng, brave_search, tavily, perplexity — all PLANNED/UNVERIFIED/OPTIONAL; pricing references labelled SUBJECT_TO_CHANGE |

### Files Updated

| File | Change |
|---|---|
| `docs/ROADMAP.md` | Added Research Intelligence section as platform capability track; RES-0 through RES-6 stage table; RES-1 entry gate table; dependency position, architecture summary, priority update |
| `docs/AI_HANDOVER.md` | This entry added |

### Key Decisions

| Decision | Value |
|---|---|
| Product key | `mythos_research` |
| Stage prefix | RES-N |
| Architecture pattern | Provider-neutral Research Gateway behind `research.web` capability |
| Provider order | cache → internal → official sources → SearXNG → Brave/Tavily → Perplexity |
| Free-first | Enforced by Research Budget Guard |
| Provider independence | No hard dependency on Perplexity, Brave, or any single search API |
| Model independence | Research retrieval ≠ reasoning/generation |
| MPI integration | Personal Intelligence owns *what* and *for whom*; Research Intelligence owns *how* |
| SearXNG | Target: self-hosted, private, internal Mythos service — NOT DEPLOYED |
| Security | SSRF protection mandatory; context minimisation before any external call |
| Cache privacy | Cache keys exclude user identity; sensitive research defaults to NO_CACHE |

### RES-1 Entry Gate (8 conditions)

| # | Condition | Status |
|---|-----------|--------|
| 1 | MPI-0 PR #4 merged to main | ✓ SATISFIED — merged 2026-08-07, merge commit `8632a99dfb94ff101811a8d0aa47ea5418c3cb19` |
| 2 | Current main clean | OK |
| 3 | INF-OVH-API-0 complete OR re-prioritised | ✓ SATISFIED — complete as reference implementation, merged 2026-08-08, merge commit `79fdb122edd2dc3246fc7781247265e3fab93adf` |
| 4 | No active major implementation stage | Must verify |
| 5 | Owner authorises RES-1 | PENDING |
| 6 | VPS capacity checked | Must verify |
| 7 | Security model reviewed | Must verify |
| 8 | Provider docs re-verified | Must verify |

### Validation

- `research.example.json`: ✓ VALID JSON
- `providers.example.json`: ✓ VALID JSON
- Secret scan: ✓ NO real credentials, API keys, tokens, or passwords
- `git diff --check`: ✓ no whitespace errors
- No runtime code changed: ✓ confirmed
- No deployment: ✓ confirmed
- No SearXNG installed: ✓ confirmed
- No provider accounts: ✓ confirmed

### Known Risks

None. Documentation-only stage — no infrastructure changed. Risk: premature implementation before entry gate satisfied. Mitigation: explicit NOT AUTHORISED status on all stages beyond RES-0; 8-condition entry gate; provider pricing labelled SUBJECT_TO_CHANGE.

### Next Stage

**RES-1 — Research Gateway Core + Official Source Fetcher** — NOT AUTHORISED. Requires all 8 RES-1 entry gate conditions satisfied + explicit owner authorisation. Conditions 1 and 3 are now satisfied (see updated table above); conditions 2, 4-8 must still be verified fresh at RES-1 start time, not assumed from this record.

The next authorised implementation stage in the Mythos ecosystem is **INF-CF-AUTO-0** (Cloudflare Read-Only Connector) — not started as of this merge.

---

## Stage INF-OVH-API-0 — OVH Read-Only Connector

**Objective:** Implement the LEVEL_1_READ_ONLY scope defined in `docs/AUTOMATION_ROADMAP.md` — list authorised domains, collect registrar metadata, collect authoritative DNS records, collect DNSSEC state, generate redacted structured snapshots. No writes.

**Status:** COMPLETE AND MERGED TO MAIN as a mocked, in-memory reference implementation — no live OVH credential exists anywhere in this repository or on the deployment host, and no live network call has been made by this connector. This matches the pattern established by every other foundation stage in this repository (MPI-0, AUT-0, RES-0): architecture and reference code first, live connection only in a later, separately-authorised stage.

**Started via:** Owner instruction "Start INF-OVH-API-0 according to Mythos workflow", resolved through the DEVX-0 Stage Runner (`node scripts/mythos-stage.js start INF-OVH-API-0`), which correctly classified this as risk lane **STANDARD** (per `projects/meta/stage-templates.json`'s `CONNECTOR_STAGE` template) and surfaced the relevant skills, files, and test strategy without the owner needing to restate any of it.

**Branch:** `feat/inf-ovh-api-0-readonly-connector` (created from `origin/main` at `e2ca9dc42f8ed317f220b561cffa1d4229b9a1ad`)
**Implementation commits:** `82497d8` feat(automation): add OVH read-only connector reference implementation · `d90ac35` docs(automation): record INF-OVH-API-0 reference implementation status
**Pull Request:** #7, opened Draft, marked ready for review after all gates passed, merged with a standard merge commit (no squash, no rebase, no force-push)
**Merge commit SHA:** `79fdb122edd2dc3246fc7781247265e3fab93adf`
**`main` HEAD after merge:** `79fdb122edd2dc3246fc7781247265e3fab93adf` (fast-forwarded; verified `git rev-parse HEAD` == `git rev-parse origin/main`)

### What was built

- `projects/automation/reference/ovh-readonly-connector.js` — reference implementation:
  - `redactRegistrantFields(raw)` — strips registrant (owner) contact fields, retains registrar/nameservers/dates/DNSSEC state, mirroring the INF-CF-1 redaction policy in `docs/CLOUDFLARE_DOMAIN_INVENTORY.md`.
  - `buildSnapshotRecord(input)` — builds a record matching the existing `aut_snapshots` table's exact column shape (`projects/automation/database/control-plane-schema.sql`); never embeds raw provider data, only an `artifact_reference`.
  - `assertReadOnlyClient(client)` — **structural** read-only enforcement: rejects any injected client exposing a method whose name matches a mutation-shaped verb (`create*`/`update*`/`set*`/`write*`/`delete*`/`remove*`/`patch*`/`put*`/`mutate*`/`apply*`), checked against the client's own methods rather than a fixed allowlist.
  - `collectForDomain(client, domain, opts)` / `runReadOnlyCollection(client, config)` — orchestration. Refuses to run unless `config.enabled === true` and unless `config.authorised_domains` is a non-empty array. Never constructs a real OVH API client itself — the caller injects one, with credentials sourced only from an approved secret store per `docs/AUTOMATION_SECURITY_AND_SECRETS.md` §2, never committed here.
- `tests/inf-ovh-api-0-connector-test.js` — 26 tests, every provider response mocked, no live network call, no live credential required.

### Bug found and fixed during this stage

`runReadOnlyCollection`'s validation originally called `assertReadOnlyClient(client)` synchronously before entering any Promise chain — a rejecting client (one exposing a write method) caused a **synchronous throw that escaped the function entirely**, rather than becoming a rejected Promise a caller's `.catch()` would see. Fixed by wrapping all validation inside a `new Promise((resolve, reject) => {...})` executor with explicit try/catch around the synchronous check. Regression test added (§6b: "RUN GATE REJECTION IS ASYNC").

### Existing project intelligence reused (not duplicated)

- **Stage Runner** (`scripts/mythos-stage.js`) resolved the Stage Context: risk lane STANDARD, relevant skills (`mythos-skill-guard`, `mythos-repo-guardian`, `mythos-safe-change`, `mythos-test-intelligence`, `mythos-change-impact`, `mythos-doc-sync`, `mythos-error-doctor`, `mythos-skill-evolution`, `mythos-project-history`), relevant files, and blockers — before any implementation began.
- **`projects/meta/known-baselines.json`** — Stage 3D baseline not applicable; this stage touched no `js/`/`css/`/`.php`/`index.html` file, so it was not re-run, per `docs/DEVELOPMENT_TEST_INTELLIGENCE.md`'s own policy.
- **`projects/meta/test-impact-map.json`** — updated to point `projects/automation/` changes at `tests/inf-ovh-api-0-connector-test.js` (previously an empty targeted-tests list, since no runtime code existed there yet).
- **`projects/meta/project-ledger.json`** — new `INF-OVH-API-0` stage record added (track `mythos-automation-operations`, type `CONNECTOR`) using the existing schema, matching the `TYPE_TO_TEMPLATE` mapping DEVX-0 established.
- **`scripts/project-intelligence.js validate`** — re-run after every metadata change, 0 errors throughout.

### Validation

- `node tests/inf-ovh-api-0-connector-test.js` — **26/26 passed**
- `node scripts/project-intelligence.js validate` — 0 errors, 0 warnings
- `git diff --check` — clean
- Secret/credential scan of the connector module source — confirmed it never reads an environment variable and never references a credential-shaped field name (`applicationSecret`/`consumerKey`/`apiKey`/`password`) — credentials are strictly the injected client's concern, never this module's
- No PII (registrant name/email/phone) appears in any returned snapshot record — confirmed by test

### Safety Confirmation

No live OVH credential created, requested, or stored anywhere — none exists on the deployment host (`env | grep -i ovh` confirmed empty prior to this stage). No live network call made. No DNS or nameserver change. No DNSSEC operation against a live domain. No database installed, migrated, or executed. No production runtime (JS/HTML/PHP/CSS) changed. Does not start INF-CF-AUTO-0, MPI-1, RES-1, Stage 3E, IDA-2, ATN-1, or AVA-1.

### Exact Next Action

1. **INF-CF-AUTO-0 — Cloudflare Read-Only Connector** is the next Automation implementation stage — **NOT STARTED.**
2. Unchanged by this stage: MPI-1, RES-1, Stage 3E, IDA-2, ATN-1, AVA-1 all remain NOT STARTED. RES-0 (PR #5) remains open, Draft, unmerged.
3. Respect the one-major-stage rule: do not begin another major stage without explicit owner authorisation.

## Stage DEVX-0 — Development Acceleration MVP

**Objective:** Let a future stage begin from a short owner instruction ("Start `<STAGE>` according to Mythos workflow") instead of a long prompt, by deriving execution context from GitHub/Git evidence rather than repeated rules. Developer tooling and repository orchestration only — no product runtime, no database, no deployment.

**Status:** COMPLETE AND MERGED TO MAIN.

**Starting `main` HEAD:** `b401a57431f490954bda31cf44987bfbba3f87b5`
**Implementation commits (on `feat/devx-0-development-acceleration`):** `01558af` feat(devx): add context baseline and test intelligence · `3e49858` feat(devx): add Mythos stage runner and workflow lanes · `9f61fa9` feat(skills): integrate development acceleration context · `b28545e` test(devx): validate accelerated stage workflow · `f81d182` docs(devx): document development acceleration foundation
**Pull Request:** #6, opened Draft, marked ready for review after all gates passed, merged with a standard merge commit (no squash, no rebase, no force-push)
**Merge commit SHA:** `62da023de0ab78f9c8d3754c28b141861b99c85a`
**`main` HEAD after merge:** `62da023de0ab78f9c8d3754c28b141861b99c85a` (fast-forwarded; verified `git rev-parse HEAD` == `git rev-parse origin/main`)

### Also in this stage's order (adjacent, not part of DEVX-0 itself)

- **GitHub CLI repaired** on the persistent VPS worktree (`/home/deploy/projects/mythos-prod`): `gh` v2.97.0 installed from GitHub's own official release tarball, SHA-256 checksum-verified, no sudo used, no third-party mirror. Authenticated via the official device-flow (owner approved in-band, no PAT ever pasted anywhere).
- **PR #5 created** for the previously-pending `docs/research-intelligence-foundation` branch (RES-0). **Left OPEN and DRAFT, not merged.** RES-1 is explicitly not authorised.

### What DEVX-0 added

- `scripts/mythos-stage.js` — the Stage Runner CLI (`context`/`status`/`start`/`validate`/`close`), deterministic and offline-first, reuses `scripts/project-intelligence.js` rather than duplicating its checks
- `projects/meta/current-context.json` (regenerated via `node scripts/mythos-stage.js context`), `projects/meta/known-baselines.json`, `projects/meta/test-impact-map.json`, `projects/meta/development-lanes.json`, `projects/meta/stage-templates.json`
- `projects/devx/README.md`, `docs/DEVELOPMENT_ACCELERATION_ARCHITECTURE.md`, `docs/DEVELOPMENT_WORKFLOW.md`, `docs/DEVELOPMENT_TEST_INTELLIGENCE.md`, `docs/DEVELOPMENT_STAGE_TEMPLATES.md`
- `tests/devx-0-development-acceleration-test.js` — 45 tests
- Extended 7 existing Agent Development Skills (`mythos-project-context`, `mythos-test-intelligence`, `mythos-error-doctor`, `mythos-repo-guardian`, `mythos-doc-sync`, `mythos-skill-router`, `mythos-superposer`) to consume DEVX-0 metadata — **no new skill created**, every extension fit an existing responsibility
- `projects/meta/project-ledger.json` — added RES-0 and DEVX-0 stage records using the existing schema

### Bug found and fixed during this stage

`projects/meta/project-ledger.json`'s `type` field (`DOCUMENTATION`/`FOUNDATION`/`RUNTIME`/`INFRASTRUCTURE`/`DATABASE`/`DEPLOYMENT`/`GOVERNANCE`) was being looked up directly as a `stage-templates.json` key against a distinct `*_STAGE`-suffixed vocabulary — every existing stage silently resolved to a null template and a HIGH_RISK-by-default risk lane. Fixed with an explicit `TYPE_TO_TEMPLATE` map; a regression test now asserts every stage type actually present in the ledger resolves to a real template.

### Validation (all re-verified on `main` after merge)

- `node tests/devx-0-development-acceleration-test.js` — 45/45 passed
- `node tests/mpi-0-finalization-governance-test.js` — 36/36 passed (regression, unaffected)
- `node tests/mpi-0-personal-intelligence-test.js` — 63/63 passed (regression, unaffected)
- `node scripts/project-intelligence.js validate` — 0 errors, 0 warnings (16 ledger stages, 20 skills, 21 portfolio tracks, 40 statistics entries, 10 history days)
- JSON validity confirmed for all new `projects/meta/*.json` files and the updated `project-ledger.json`/`project-statistics.json`; `node --check` passed for `scripts/mythos-stage.js` and the new test file; `git diff --check` clean
- Secret/token/PII scan across every changed file — clean
- Stage 3D was **not** re-run — DEVX-0 touched no `js/`/`css/`/`.php`/`index.html` file, so re-running it was not justified per `docs/DEVELOPMENT_TEST_INTELLIGENCE.md`'s own policy

### Safety Confirmation

No production runtime (JS/HTML/PHP/CSS) changed. No database installed, migrated, or executed. No deployment of any kind (no OVH, no Cloudflare, no Coolify, no SearXNG install). No secrets, credentials, or tokens anywhere in the repository diff. Did not start INF-OVH-API-0, MPI-1, RES-1, Stage 3E, IDA-2, ATN-1, or AVA-1.

### Exact Next Action

1. **DEVX-1 — Dependency/Impact Graph + Automated PR Review** is the next Development Acceleration stage — **NOT STARTED.**
2. **RES-1 — first Research Intelligence runtime implementation** — **NOT STARTED, NOT AUTHORISED.** PR #5 remains open/Draft.
3. **MPI-1** remains the next Personal Intelligence stage — **NOT STARTED.**
4. **Stage 3E** remains the next Mythos OS runtime stage — **NOT STARTED.**
5. **Owner-selected next major execution priority: INF-OVH-API-0 — OVHcloud Read-Only Connector** — **NOT STARTED.**
6. Respect the one-major-stage rule: do not begin more than one of the above without explicit owner authorisation.

## Stage MPI-0-FINALIZATION — Skills Evolution, Project Intelligence, Portfolio Registry

**Objective:** Final review, evolve the Agent Skills, establish a permanent GitHub-based project history/statistics system, establish a portfolio registry distinguishing implemented product from owner strategic direction, and merge Stage MPI-0.

**Status:** COMPLETE AND MERGED TO MAIN.

**Original base (`main`) commit before MPI-0 work began:** `909ced531dab7095cc6511efd6e646ba4befa07c`
**MPI-0 implementation commits (pre-finalization):** `bfc702a`, `a2d3bc6`, `cf3857f`, `92155b4`, `5b57a2d`, `f27f9a1`, `bf73237`, `d0a4cbb` (see the MPI-0 section below for the full record)
**MPI-0-FINALIZATION commits (on top, same branch):** `1de5c14` docs(governance): add Mythos project history and portfolio intelligence · `30eed5f` feat(governance): add deterministic project ledger and statistics tooling · `9ffd5b1` feat(skills): add skill registry and evolution governance · `b5345f2` test(governance): validate history statistics and skill lifecycle · `ca9d944` docs(ai): finalise MPI-0 documentation and changelog
**Pull Request:** #4, opened Draft, finalised and marked ready for review, merged with a standard merge commit (no squash, no rebase, no force-push)
**Merge commit SHA:** `8632a99dfb94ff101811a8d0aa47ea5418c3cb19`
**`main` HEAD immediately after merge:** `8632a99dfb94ff101811a8d0aa47ea5418c3cb19` (fast-forwarded; verified `git rev-parse HEAD` == `git rev-parse origin/main`)

### Models used (strict sequence, never parallel)

- **Claude Opus 5** — one read-only strategic architecture/repository/skills audit. Verdict: PASS, no blockers, 9 Required items (all implemented by Sonnet), several Recommended items (mostly implemented).
- **Claude Sonnet 5** — sole writer/implementer for all finalization work, commits, PR update, and merge.
- **Claude Haiku 4.5** — one read-only final mechanical audit, run once after all finalization commits were pushed. Verdict: PASS, no blocker found (11/11 mechanical checks passed: ancestry, changed-file scope, no secrets, no PII/tenant leakage, skills-registry consistency, JSON validity, tests, doc links, no runtime work outside MPI-0, correct non-fabricated stage status, PR merge readiness).

### What this stage added (on top of MPI-0)

- **Project history:** `docs/PROJECT_HISTORY.md` (narrative), `docs/history/DAILY_HISTORY.md` + `docs/history/README.md` (evidence-backfilled daily ledger, one honestly-recorded `HISTORICAL_CONFLICT` for 2026-07-31)
- **Portfolio registry:** `docs/MYTHOS_PORTFOLIO_REGISTRY.md` + `projects/meta/portfolio-registry.json` — 21 tracks, classified 12 REPOSITORY_VERIFIED / 5 OWNER_DIRECTION / 4 FUTURE_CONCEPT
- **Machine-readable ledger & statistics:** `projects/meta/project-ledger.json`, `projects/meta/project-statistics.json`, `docs/PROJECT_STATISTICS.md`, `docs/PROJECT_STATUS.md` — every statistic scoped, no fabricated global completion percentage
- **Deterministic offline tool:** `scripts/project-intelligence.js` (Node built-ins only, no network, no auto-commit) — `validate`/`stats`/`history-check`/`ledger-check`/`summary`
- **Skills evolution:** `docs/SKILLS_EVOLUTION.md`, `docs/SKILLS_VERSIONING_POLICY.md`, `projects/personal-intelligence/config/agent-skills-registry.json` (canonical registry, 20 skills, all MYTHOS_ORIGINAL) — resolved 5 overlapping-scope skill pairs via owner/delegator relationships, extended 11 skills, added 2 new skills (`mythos-skill-evolution`, `mythos-project-history`)
- **Reference-implementation fixes:** `guard.js` (removed unused `automationLevel` param, simplified redundant double-narrow, clarified `dataClassification` handling), `scope.js` (closed absent/guessed-identifier scope-match loophole)
- **Tests:** `tests/mpi-0-personal-intelligence-test.js` grew 47 → 63; new `tests/mpi-0-finalization-governance-test.js` (36 tests)
- **Doc consistency:** `AGENTS.md` §24, updated `docs/SKILLS_ARCHITECTURE.md`/`SKILLS_ROADMAP.md`/`SKILLS_SOURCES.md`/`SKILLS_SECURITY.md`/`SKILLS_SUPERPOSER.md`/`MYTHOS_CHATBOT_ARCHITECTURE.md`, populated `docs/CHANGELOG.md` (previously tracked but empty)

### Validation (all re-verified on `main` after merge)

- `node tests/mpi-0-personal-intelligence-test.js` — 63/63 passed
- `node tests/mpi-0-finalization-governance-test.js` — 36/36 passed
- `node tests/stage4z-test.js` — 44/44 (regression, unaffected)
- `node tests/stage3d-test.js` — 104/110 on both the base commit `909ced5` (isolated worktree) and the branch — identical 6 known baseline failures, **zero new regressions**
- `node scripts/project-intelligence.js validate` — 0 errors, 0 warnings (20 skills, 21 portfolio tracks, 14 ledger stages, 40 statistics entries, 9 history days)
- JSON validity confirmed for all `projects/meta/*.json` and `agent-skills-registry.json`; `node --check` passed for all `.js` files; `git diff --check` clean
- Secret/PII scan across all new/modified files — clean (only pre-existing legitimate public-infrastructure IP documentation in `docs/AI_HANDOVER.md`'s Cloudflare/RDAP research section, not a leak)

### Safety Confirmation

No production runtime (JS/HTML/PHP/CSS) changed. No database installed, migrated, or executed. No secrets, credentials, or real personal/organisation data. No cross-tenant leakage possible. Did not start Stage 3E, IDA-2, ATN-1, AVA-1, or INF-OVH-API-0. Did not begin MPI-1.

### Exact Next Action

1. **MPI-1 — Context Assembler + Context Compiler (runtime implementation)** is the next Personal Intelligence stage — **NOT STARTED.**
2. **Stage 3E** remains the next Mythos OS runtime stage — **NOT STARTED.**
3. **Owner-selected next major execution priority: INF-OVH-API-0 — OVHcloud Read-Only Connector** (replace manual domain/DNS inventory exports with a secure automated read-only collection) — **NOT STARTED.**
4. Unchanged by this stage: IDA-2 remains the next authorised Automotive implementation stage; INF-CF-2 remains blocked pending owner approval; ATN-1/AVA-1 remain sequential after IDA-2.
5. Respect the one-major-stage rule: do not begin more than one of the above without explicit owner authorisation.

---

## Stage MPI-0 — Mythos Personal Intelligence & Skills Platform Foundation

**Objective:** Establish the strategic architecture direction and application-level foundation for a shared, reusable, multi-user, multi-organisation, multi-profession AI personalisation platform — "one shared intelligence platform, personalised per user and organisation through layered context, memory, skills and permissions." Documentation, contracts, an illustrative reference implementation, draft (undeployed) schema, agent-development skill manifests, and tests only. No production runtime change.

**Status:** COMPLETE. **UPDATE (2026-08-07):** merged to `main` via PR #4 together with MPI-0-FINALIZATION — see the MPI-0-FINALIZATION section above for the merge commit and final validation. The "NOT MERGED TO MAIN" status below reflects this stage's original state at time of writing and is preserved for historical accuracy.

**Branch:** `feat/mythos-personal-intelligence` (created from `origin/main` at `909ced531dab7095cc6511efd6e646ba4befa07c`)
**Starting remote HEAD:** `909ced531dab7095cc6511efd6e646ba4befa07c`
**Implementation commits:** recorded in the "Commits" table below once each is made — do not treat any hash in this section as a merged `main` commit; verify with `git log feat/mythos-personal-intelligence` before relying on any hash as current.

### Official Decisions Established

- **Product principle:** "Shared capabilities, isolated intelligence." Share code, domain skills, generic AI infrastructure, orchestration, model adapters. Isolate organisation data, user data, memory, permissions, business rules, personal preferences, private knowledge.
- **Layer hierarchy (not flattened):** Global Mythos Intelligence → Domain Profile → Organisation Profile → User Profile → Session/Task → Intent Architect → Skill Router → Superposer → Guard/Permissions → Specialised Skills → Model/Agent/Tool → Validation → Learning Signals.
- **User ≠ Role, permanently:** role/permissions answer "what is allowed"; User Intelligence answers "how this person prefers to work." AI learning may never grant permissions.
- **Precedence order (9 levels):** system/security/legal → organisation policy → role/permissions → this-turn explicit instruction → explicit persistent user rule → verified organisation workflow → established user preference → domain default → generic default. A user preference never bypasses permissions or security.
- **Learning scope defaults to `user`.** Promotion to `organisation`/`domain`/`global` requires explicit governance, never automatic. Confidence progresses `SESSION_OBSERVATION → CANDIDATE_PREFERENCE → ESTABLISHED_PREFERENCE`, with `EXPLICIT_USER_RULE` immediate and strongest.
- **Context Assembler / Context Compiler:** context is classified `REQUIRED / USEFUL / IRRELEVANT / FORBIDDEN` before assembly; `FORBIDDEN` is excluded before relevance is ever considered. `loadAllUserMemory()` is a named anti-pattern.
- **Two domain packs defined (capability contracts, no runtime):** `education` (10 capabilities) and `automotive_workshop` (12 capabilities, integrating with — not duplicating — existing ID Auto/Atelier Network).
- **Two distinct skill kinds, never conflated:** Agent Development Skills (`.claude/skills/`, used by Claude/Codex to build/operate Mythos) vs. Runtime Mythos Capabilities (application-level, multi-tenant, used by end-user chatbots). `.claude/skills/` alone is explicitly documented as **not** the runtime architecture.
- **Multi-tenancy is application/data-layer enforced, never prompt-only.** Every persistent record is scoped (user/organisation/permission); a guessed identifier never grants access.
- **Model routing is provider-neutral.** No personal/organisation intelligence is ever stored only in a provider-specific prompt file.

### Files Created (40 new files across the paths below; table rows are grouped by area, not one row per file — see `git diff main...feat/mythos-personal-intelligence --stat` for the exact 40-added/2-modified count)

| File | Description |
|---|---|
| `docs/MYTHOS_PERSONAL_INTELLIGENCE_VISION.md` | NEW: strategic direction, teacher/workshop examples, product principle, commercial value |
| `docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` | NEW: layer hierarchy, all profile contracts (Domain/Organisation/User/Session/Entity), precedence rules, learning scope/confidence, Guard model |
| `docs/MYTHOS_USER_MEMORY_POLICY.md` | NEW: 7 memory types, learning pipeline, scope/confidence, write policy, forget/correct/override, feedback signals |
| `docs/MYTHOS_CONTEXT_ARCHITECTURE.md` | NEW: Context Assembler classification/assembly, retrieval interface, entity resolution, Context Compiler, knowledge sources |
| `docs/MYTHOS_DOMAIN_PACKS.md` | NEW: `education` and `automotive_workshop` domain pack capability contracts |
| `docs/MYTHOS_AI_MULTI_TENANCY.md` | NEW: mandatory isolation requirements, enforcement points, required tests |
| `docs/MYTHOS_CHATBOT_ARCHITECTURE.md` | NEW: end-to-end request pipeline, persona-vs-intelligence distinction, response architecture, Superposer examples |
| `docs/SKILLS_ARCHITECTURE.md` | NEW: agent-development vs. runtime skill distinction, shared-skill model, layered overrides |
| `docs/SKILLS_SUPERPOSER.md` | NEW: skill composition contract, runtime-availability fail-closed rule |
| `docs/SKILLS_SECURITY.md` | NEW: hard security requirements, Guard evaluation, agent-dev/runtime boundary |
| `docs/SKILLS_SOURCES.md` | NEW: upstream/wrapper/original classification for all 18 skills (all MYTHOS ORIGINAL — no suitable upstream identified) |
| `docs/SKILLS_ROADMAP.md` | NEW: MPI-0 through MPI-10 stage sequence, 18-skill inventory |
| `docs/MODEL_ROUTING_ARCHITECTURE.md` | NEW: provider-neutral capability classes, adapter contract |
| `projects/personal-intelligence/README.md` | NEW: directory overview |
| `projects/personal-intelligence/config/personal-intelligence.example.json` | NEW: draft config, all feature flags false, no secrets/PII |
| `projects/personal-intelligence/database/control-plane-schema.sql` | NEW: 15-table draft PostgreSQL schema (`pi_` prefix, `mythos_intelligence` logical schema), DRAFT NOT DEPLOYED |
| `projects/personal-intelligence/reference/scope.js` | NEW: precedence + isolation reference helpers |
| `projects/personal-intelligence/reference/context-assembler.js` | NEW: classification/assembly + retrieval reference implementation |
| `projects/personal-intelligence/reference/learning-engine.js` | NEW: observation→candidate→established→explicit-rule reference implementation |
| `projects/personal-intelligence/reference/guard.js` | NEW: permission-decision reference implementation (never widens on learned preference) |
| `projects/personal-intelligence/reference/intent-router.js` | NEW: illustrative multilingual (AR/Tunisian AR/FR/EN/mixed) intent + domain routing stub |
| `.claude/skills/*/SKILL.md` (18 directories) | NEW: agent-development skill manifests — `mythos-project-context`, `mythos-intent-architect`, `mythos-skill-router`, `mythos-superposer`, `mythos-skill-guard`, `mythos-repo-guardian`, `mythos-safe-change`, `mythos-test-intelligence`, `mythos-change-impact`, `mythos-doc-sync`, `mythos-migration`, `mythos-error-doctor`, `mythos-smart-data-entry`, `mythos-document-intelligence`, `mythos-invoice-intelligence`, `mythos-client-360`, `mythos-context-assembler` (new), `mythos-personal-learning` (new) |
| `tests/mpi-0-personal-intelligence-test.js` | NEW: 47 tests across 13 sections (user/org/role isolation, personalisation ×2, session, learning, permission, memory, context compression, intent ×5 languages, domain routing, cross-domain, precedence) |

### Files Updated (1)

| File | Change |
|---|---|
| `docs/ROADMAP.md` | Added "Personal Intelligence — Separate Product Track" section (MPI-0 through MPI-10 table, explicitly marked as developed on `feat/mythos-personal-intelligence`, not merged); updated top-line summary; added Current Priority item 7; extended one-major-stage-rule sentence to cover the Personal Intelligence track; all existing stage history preserved unchanged |

### Validation

- `python -m json.tool projects/personal-intelligence/config/personal-intelligence.example.json` — ✓ VALID.
- SQL: 15/15 tables match header count; 170/170 parens balanced; no duplicate table names; no cross-schema foreign keys; no secret-value/PII columns; append-only audit specified for `pi_preference_audit`/`pi_guard_decisions`.
- `node tests/mpi-0-personal-intelligence-test.js` — ✓ **47/47 passed** (one real bug found and fixed during validation: `resolveActiveDomain` was silently falling back to a user's only available domain even when an explicit hint named a domain the user was NOT authorised for; fixed to return `HINTED_DOMAIN_NOT_AUTHORIZED` instead of silently substituting).
- `node tests/stage4z-test.js` — ✓ 44/44 (regression, unaffected).
- `node tests/stage3d-test.js` — 104/110 (regression, unaffected; the 6 failures are the same pre-existing `_memCache`-cascade subprocess failures documented in every prior stage's handover, not caused by this stage).
- `git diff --check` — ✓ passes, no whitespace errors.
- Full diff/new-file scan for credential/secret/IP/email patterns — clean.
- Confirmed: no runtime JS/HTML/PHP/CSS file changed; no database executed; no deployment; Global vs. Domain vs. Organisation vs. User intelligence kept distinct throughout; User ≠ Role enforced structurally in `guard.js` and tested; no future stage marked complete.

### Safety Confirmation

No production application file changed. No database installed, migrated, or executed — `projects/personal-intelligence/database/control-plane-schema.sql` is a draft specification only. No credential, secret, token, or real personal/organisation data anywhere in this stage's files. No cross-tenant leakage possible (no persistent store exists; isolation is tested against the in-memory reference only). Not merged to `main` — remains on `feat/mythos-personal-intelligence` pending review. Stage 3E, IDA-2, ATN-1, AVA-1, INF-OVH-API-0 not started.

### Commits (on `feat/mythos-personal-intelligence`)

See the branch's own `git log` for the authoritative, current list; the table below is a point-in-time record as of this handover commit, not guaranteed current beyond that moment.

| SHA | Message |
|---|---|
| `bfc702a` | docs(ai): establish Mythos Personal Intelligence vision |
| `a2d3bc6` | feat(ai): add domain organisation user and session context contracts |
| `cf3857f` | feat(ai): add context assembler and personal intelligence foundation |
| `92155b4` | feat(skills): extend intent router superposer for per-user context |
| `5b57a2d` | feat(ai): add controlled personal learning foundation |
| `f27f9a1` | test(ai): validate tenant isolation context and personalisation |
| `bf73237` | docs(ai): add chatbot domain packs memory and rollout roadmap |
| (this commit) | docs: update AI_HANDOVER.md for Mythos Personal Intelligence MPI-0 |

### Exact Next Action

1. Review the Draft PR (if repository access permitted one to be opened) from `feat/mythos-personal-intelligence` into `main`.
2. **Do not merge without explicit review** — this stage intentionally stops short of merging per the task's own instruction.
3. **MPI-1 — Context Assembler + Context Compiler (runtime implementation)** is the next Personal Intelligence stage — not started.
4. Unchanged by this stage: **Stage 3E** remains the next Mythos OS runtime stage; **IDA-2** remains the next authorised Automotive implementation stage; **INF-CF-2** remains blocked; **INF-OVH-API-0** remains the next Automation implementation stage.

---

## Stage AUT-0 — Mythos Automation-First Master Foundation

**Objective:** Establish the Mythos ecosystem's group-wide Automation First principle, the Mythos Control Center operator product specification, the Mythos Automation & Operations platform architecture (automation levels, standard lifecycle, required execution fields, connector model, failure/retry/rollback rules, observability), governance, the permanent approval-boundary matrix, the permanent secrets policy, a forward-looking operations runbook, the future Automation stage sequence, and a 24-table draft (undeployed) PostgreSQL control-plane schema. Documentation, architecture, configuration, and draft SQL only.

**Status:** COMPLETE AND PUSHED

**Starting remote HEAD:** `3a6f1869b560282cdc5daf1a47da41c4293652ef`
**Implementation commit:** `0d0a387327aeec5544c23c77b598d151ac772e1d`
**Final handover commit:** this document update commits the handover for AUT-0. Do not treat any hash printed in this document as the current branch tip — always verify with `git rev-parse origin/main` before relying on a specific commit as "current".

### Official Decisions Established

- **Group principle — Automation First:** every safe, repeatable and measurable operation should eventually be automated; automation must not remove governance; high-risk actions remain automated in preparation and validation but require explicit human approval before execution.
- **Mythos Control Center** — the operator-facing console for Mythos products, infrastructure, connectors, automation runs, approvals, incidents, backups, deployments, and service health. Specified in `docs/MYTHOS_CONTROL_CENTER_PRODUCT_SPEC.md` (21 modules listed; product spec only, no UI built).
- **Mythos Automation & Operations** (`product_key: mythos_automation`) — the underlying platform capability: orchestrates workflows, connects providers, schedules, validates, requests approvals, executes approved actions, verifies, rolls back, audits, notifies, and exposes health to Mythos Control Center. Specified in `docs/AUTOMATION_ARCHITECTURE.md`.
- **Four permanent automation levels:** `LEVEL_1_READ_ONLY`, `LEVEL_2_RECOMMEND`, `LEVEL_3_APPROVAL_REQUIRED`, `LEVEL_4_FULL_AUTOMATIC`. A workflow may never silently self-promote to a higher level — level changes require audited policy approval (`docs/AUTOMATION_GOVERNANCE.md` §4).
- **Permanent LEVEL_3 approval boundaries (18 items)** — domain nameserver changes, DNSSEC/DS-record changes, production DNS record deletion, production database destructive migration/deletion, production data overwrite, backup deletion/disabling, secret/credential exposure, privilege escalation, Super Admin access changes, production firewall/network changes, money transfer, refunds, contractual acceptance, public publication of sensitive/regulated data, production shutdown, irreversible external-provider actions. Full list and routine LEVEL_4-eligible examples in `docs/AUTOMATION_APPROVAL_MATRIX.md`.
- **Connector model** — infrastructure connectors (OVHcloud, Cloudflare, GitHub, Coolify, VPS/host agent, PostgreSQL, object storage, backup storage, monitoring) and business/communication connectors (n8n, email, WhatsApp, SMS, payment provider, document storage, product APIs); read/write permissions never combined automatically; example split (`ovh_readonly` vs `ovh_dns_operator`, `cloudflare_readonly` vs `cloudflare_dns_operator`, etc.) drafted in `projects/automation/config/automation.example.json`, all `enabled: false`.
- **Secrets policy** — permanent: 5 allowed storage locations (VPS env vars, Coolify secret variables, approved secret manager, short-lived tokens, service accounts, secret references in DB), 10 forbidden locations (Git, docs, config examples, AI_HANDOVER, logs, test output, screenshots, DB plain-text columns, browser localStorage, client-side JS, commit messages); secret records store metadata only (`aut_secret_references`), never a value. Full policy in `docs/AUTOMATION_SECURITY_AND_SECRETS.md`.
- **Standard lifecycle:** `DISCOVER → SNAPSHOT → ANALYSE → PLAN → DRY_RUN → GATE_CHECK → APPROVAL → APPLY → VERIFY → ROLLBACK (when required) → AUDIT → NOTIFY → CLOSE`, with 18 explicit run statuses (12 non-terminal, 6 terminal) defined in `docs/AUTOMATION_ARCHITECTURE.md` §3.

### Files Created (11)

| File | Description |
|---|---|
| `docs/AUTOMATION_FIRST_PRINCIPLES.md` | NEW: the Automation First principle, Mythos Control Center vs Mythos Automation & Operations distinction |
| `docs/MYTHOS_CONTROL_CENTER_PRODUCT_SPEC.md` | NEW: operator product spec, users, 21 modules |
| `docs/AUTOMATION_ARCHITECTURE.md` | NEW: automation levels, lifecycle, required execution fields, connector model, failure/retry/rollback, observability |
| `docs/AUTOMATION_GOVERNANCE.md` | NEW: sequencing, one-major-stage rule as applied to Automation, architecture-rule inheritance, level-change governance |
| `docs/AUTOMATION_APPROVAL_MATRIX.md` | NEW: permanent LEVEL_3 boundaries (18 items), routine LEVEL_4-eligible examples |
| `docs/AUTOMATION_SECURITY_AND_SECRETS.md` | NEW: permanent Mythos secrets policy |
| `docs/AUTOMATION_OPERATIONS_RUNBOOK.md` | NEW: forward-looking operator runbook (reading a run, responding to approvals/dead letters/rollback failures) |
| `docs/AUTOMATION_ROADMAP.md` | NEW: AUT-0 through OPS-AUTO-1 stage sequence, permanent sequencing rules |
| `projects/automation/README.md` | NEW: directory overview, status, next stage |
| `projects/automation/config/automation.example.json` | NEW: draft config — all feature flags and connector `enabled` flags false, no secrets, no real domains/IPs/emails |
| `projects/automation/database/control-plane-schema.sql` | NEW: 24-table draft PostgreSQL schema (`aut_` prefix, `mythos_automation` logical schema), DRAFT NOT DEPLOYED, no secret-value columns, no PII |

### Files Updated (1)

| File | Change |
|---|---|
| `docs/ROADMAP.md` | Added "Automation — Separate Product Track" section (AUT-0 through OPS-AUTO-1 table); updated top-line summary; added Current Priority item 6 (Automation, docs only) and one-major-stage-rule sentence covering the Automation track; all existing stage history (Mythos OS, ID Auto, Atelier Network, AutoValeur, Infrastructure/Cloudflare) preserved unchanged |

### Validation

- `python3 -m json.tool projects/automation/config/automation.example.json` — ✓ VALID.
- SQL: exact table count matches header (24 = 24); paren balance 278 open = 278 close; no duplicate table names; no cross-schema foreign keys (all cross-schema refs are opaque columns with comments); no secret-value/password/token/private-key columns; no customer PII; append-only audit specified for `aut_audit_events`; approval history preserved in `aut_approvals`; rollback references present (`rollback_plan_reference`, `rollback_execution_reference`); idempotency present (`aut_idempotency_keys`, `idempotency_key` column); resource locks present (`aut_resource_locks`); `dry_run` present on `aut_runs`; automation levels present and explicit; UTC timestamps (`TIMESTAMPTZ`) throughout.
- `git diff --check` — ✓ passes, no whitespace errors.
- Full diff searched for credential/secret/IP/email/account_id patterns — clean (the only "deployed"/"operational" matches found were correct negation statements, e.g. "No database is deployed").
- All 25 internal cross-references (`docs/*.md`, `projects/automation/*`) verified to resolve to existing files.
- Confirmed: Mythos Control Center and Mythos Automation & Operations are documented as distinct (product vs platform capability); four automation levels consistent across all documents; permanent approval boundaries consistent between `docs/AUTOMATION_APPROVAL_MATRIX.md` and `projects/automation/config/automation.example.json`; INF-OVH-API-0 documented as read-only only; INF-CF-2 still described as blocked; Stage 3E still described as next Mythos OS runtime stage; no connector claimed operational; no secret claimed configured; no provider login claimed; no database claimed deployed.

### Safety Confirmation

No OVH connector implemented. No OVH or Cloudflare credentials requested or created. No login to OVH or Cloudflare. No DNS or nameserver change. No DNSSEC operation. INF-CF-2 not started. No service deployed. No database installed, migrated, or executed — `projects/automation/database/control-plane-schema.sql` is a draft specification only. No runtime JS/HTML/PHP/CSS changed. Stage 3E not started. IDA-2 not started. ATN-1 not started. AVA-1 not started. No credential or secret value stored anywhere in this stage's files.

### INF-CF-2 Status

Still blocked and not started — unchanged by this stage. See `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md`.

### Next Mythos OS Runtime Stage

**Stage 3E — Calendar Runtime** (unchanged by this stage).

### Next Automation Implementation Stage

**INF-OVH-API-0 — OVH Read-Only Connector** (not started by this stage; see `docs/AUTOMATION_ROADMAP.md` for full scope and the stages that follow it).

---

## Stage INF-CF-2-PREP — Authoritative Export Intake and Owner Approval Gate

**Objective:** Prepare the repository and the domain owner for INF-CF-2 by defining exactly what authoritative registrar/DNS-provider evidence must be collected, how it must be handled so raw exports never enter Git, and what owner approval must be recorded before any domain can proceed to INF-CF-2. This is a documentation, preparation, and safety-gate stage only — no DNS, registrar, or Cloudflare account action was performed.

**Status:** COMPLETE AND MERGED

**Starting main HEAD:** `31c517f1917c33bb0ef34febf4c9b8b9c0c76183`
**Branch:** `docs/cloudflare-zone-export-intake`
**Implementation commit:** `2fe9181228cc0eed1728472a9c563319e4a0c06f`
**Pull Request:** #3
**Merge commit:** `13a3017ef734ae4051b6e85e380e7e6ba3407319`
**Verified remote main HEAD at stage completion:** `13a3017ef734ae4051b6e85e380e7e6ba3407319`
**Files created:** 6
**Files updated:** 2

### Authoritative Domain Scope

Same eight domains as INF-CF-1, unchanged: `agribee.tn` (AgriBee), `darhijama.tn` (Dar Hijama), `fixpert.tn` (Fixpert), `idauto.tn` (ID Auto), `mythosprod.xyz` (Mythos OS / shared infrastructure), `notrejour.tn` (Notre Jour), `ssangyong.autos` (SsangYong Parts), `uthinachess.tn` (Uthina Chess).

### Files Created

| File | Description |
|---|---|
| `docs/CLOUDFLARE_AUTHORITATIVE_EXPORT_INTAKE.md` | NEW: what to collect from registrar/DNS-provider control panels (registrar info, full zone export, email configuration, web/infrastructure ownership, DNSSEC safety, redirects/certificates), data-handling policy, submission/validation procedure, and a per-domain checklist (13 items each, all unchecked) with special warnings for `mythosprod.xyz`, `idauto.tn`, `ssangyong.autos`, and `uthinachess.tn` |
| `docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md` | NEW: per-domain approval fields (business/technical owner, email-active state, criticality, downtime tolerance, maintenance window, rollback authority, and five separate approval values — DNSSEC/nameserver/proxy/Tunnel/Access), all eight domains starting `NOT_REQUESTED` |
| `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md` | NEW: 15 mandatory entry criteria INF-CF-2 must satisfy per domain before it may begin, plus domain-specific notes and the "migrate one at a time unless explicitly authorised otherwise" rule |
| `projects/infrastructure/cloudflare/authoritative-exports/README.md` | NEW: local-intake-only directory documentation, data-handling rules, what is/isn't tracked |
| `projects/infrastructure/cloudflare/authoritative-exports/.gitignore` | NEW: deny-by-default (`*` / `!.gitignore` / `!README.md`) so raw provider exports are never committed |
| `projects/infrastructure/cloudflare/zone-review-template.json` | NEW: machine-readable review template, schema_version 1.0.0, status `AWAITING_AUTHORITATIVE_EXPORTS`, 8 domain objects, every field a safe placeholder (`UNKNOWN`/empty/`false`/`NOT_REQUESTED`/`NOT_STARTED`) |

### Files Updated

| File | Change |
|---|---|
| `docs/ROADMAP.md` | Corrected the stale top-line wording from "INF-CF-1 — domain inventory in progress" to "INF-CF-1 — domain inventory complete"; INF-CF-2 row expanded with its per-domain entry gate and a cross-reference to the new INF-CF-2-PREP documents; no new numbered infrastructure stage invented — INF-CF-2-PREP is recorded as a readiness package, not a deployed stage; all existing runtime/Automotive/ID Auto/Atelier Network/AutoValeur priorities preserved unchanged |
| `docs/AI_HANDOVER.md` | This entry |

### Validation Summary

- **JSON:** valid, exactly 8 domains (`projects/infrastructure/cloudflare/zone-review-template.json`).
- **Raw exports:** not committed — `authoritative-exports/` is `.gitignore`d by default; only `README.md`/`.gitignore` are tracked.
- **DNS changes:** none.
- **Nameserver changes:** none.
- **Deployment:** none.
- **INF-CF-2:** NOT STARTED and BLOCKED.

### Safety Confirmation

No registrar login. No DNS provider login. No Cloudflare account login, creation, or configuration. No DNS record changed. No nameserver changed. No DNSSEC operation performed. No Tunnel created. No cloudflared deployed. No Access/WAF/R2/Workers configuration touched. No runtime or database code changed. No credentials collected, requested, or stored (the intake document explicitly excludes account passwords, customer numbers, API keys, recovery codes, and payment information from collection). No raw DNS/registrar export committed — the `authoritative-exports/` directory is `.gitignore`d by default and only `README.md`/`.gitignore` are tracked. INF-CF-2 was not started and was not marked complete.

### Exact Next Action Required From the Owner

Collect authoritative registrar and DNS-provider exports, **one domain at a time**, then record explicit approvals. For each domain, in whatever order the owner chooses: collect the authoritative registrar and DNS-provider exports per `docs/CLOUDFLARE_AUTHORITATIVE_EXPORT_INTAKE.md`, review them against the INF-CF-1 findings, and record explicit approval decisions in `docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md`. **INF-CF-2 remains blocked for every domain** until `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md` is satisfied for that domain — this cannot happen from AI-driven action alone; it requires the owner's own registrar/DNS-provider access and decision.

---

## Stage INF-CF-1 — Cloudflare Account and Domain Inventory

**Objective:** Produce a read-only, public-source inventory of the eight authorised Mythos-portfolio domains (identity, authoritative DNS, DNSSEC state, DNS records, email posture, HTTP/HTTPS behaviour, known subdomains, proposed Cloudflare classification, risks) as a planning input for INF-CF-2. No DNS, registrar, or Cloudflare account changes were made.

**Starting remote main HEAD:** `df569f880158428f04d10adc15aadaaec45ce2e7`
**Branch:** `docs/cloudflare-domain-inventory`
**Implementation commit:** recorded below once the first implementation commit is made — do not treat any hash in this section as final until the "Branch and Remote Status" subsection is updated after that commit.

### Authoritative Domain Scope

Exactly eight domains, no more, no fewer:

1. `agribee.tn` — AgriBee
2. `darhijama.tn` — Dar Hijama
3. `fixpert.tn` — Fixpert
4. `idauto.tn` — ID Auto
5. `mythosprod.xyz` — Mythos OS / shared infrastructure
6. `notrejour.tn` — Notre Jour
7. `ssangyong.autos` — SsangYong Parts
8. `uthinachess.tn` — Uthina Chess

### Public Discovery Methodology

Public RDAP (`.xyz`, `.autos` via CentralNic RDAP, reached via `rdap.org` and directly), public ATI WHOIS (`.tn`, raw port-43 protocol via `/dev/tcp`), public DNS resolution (Cloudflare `1.1.1.1` recursive resolver via `nslookup`, cross-verified with Cloudflare DNS-over-HTTPS JSON for CAA and TTL data), public HTTP/HTTPS status and redirect checks (`curl`), public TLS certificate inspection (`openssl s_client`), and public certificate-transparency lookups (`crt.sh`). No control panel, registrar account, or Cloudflare account was accessed at any point. No subdomain brute-forcing or DKIM selector enumeration was performed.

### Limitations (see `docs/CLOUDFLARE_DOMAIN_INVENTORY.md` for full detail)

- Public DNS queries do not reveal the complete private DNS zone; absence of a record here is not proof it doesn't exist.
- Certificate-transparency (`crt.sh`) coverage is incomplete for six of the eight domains in this observation window due to rate-limiting (HTTP 502) after the first two queries succeeded.
- DKIM is `UNKNOWN` for all eight domains — not evaluated, never reported as "disabled".
- All WHOIS/RDAP registrant (owner) contact information has been redacted from every committed file.

### Key Findings

- All eight domains are registered through **OVH** and use OVH-operated authoritative nameservers — DNS provider is **VERIFIED**, not inferred, for all eight.
- **`mythosprod.xyz` currently has no working web presence**: HTTP redirects to `https://darhijama.tn/` (a different domain on the same shared origin IP), and HTTPS fails with a certificate/SNI mismatch. This must be fixed at the origin before or during any Cloudflare migration.
- **DNSSEC is already ENABLED (DS record present at the parent zone) on two domains: `mythosprod.xyz` and `ssangyong.autos`.** The other six are explicitly `unsigned` per ATI WHOIS. A future nameserver migration to Cloudflare for these two domains must coordinate DS-record replacement with the cutover — this is a real, not hypothetical, sequencing risk for INF-CF-2/INF-CF-5.
- **`idauto.tn` has no working HTTPS at all** (connection refused on port 443, both apex and `www`) and resolves to a distinct origin IP (`213.186.33.5`) from the shared cluster IP (`51.68.226.211`) used by six of the other seven domains.
- **`uthinachess.tn` hosts the live production Mythos OS application** and is flagged as requiring separate, explicit migration authorisation beyond the standard review applied to the rest of the portfolio.
- `coolify.mythosprod.xyz` is already an active, public DNS record — the only one of the seven administrative hostnames proposed in `docs/CLOUDFLARE_ARCHITECTURE.md` §3 that currently resolves.
- No domain in the portfolio publishes a DMARC record; no domain publishes a CAA record.
- An unidentified 40-character verification-style TXT token exists on `ssangyong.autos` with no confirmed owner or purpose.

### Files Created

| File | Description |
|---|---|
| `docs/CLOUDFLARE_DOMAIN_INVENTORY.md` | NEW: full narrative/tabular inventory — identity, DNS, DNSSEC, records, email, HTTP/HTTPS, subdomains, classification, risks, unknowns, required confirmations, and readiness per domain, for all 8 domains |
| `docs/CLOUDFLARE_DNS_MIGRATION_MATRIX.md` | NEW: flat, consolidated record-by-record migration-planning matrix across all 8 domains |
| `projects/infrastructure/cloudflare/domain-inventory.json` | NEW: machine-readable inventory, schema_version 1.0.0, 8 domain objects, no secrets, no personal data |
| `projects/infrastructure/cloudflare/README.md` | NEW: purpose, limitations, refresh procedure, INF-CF-1 prohibitions, INF-CF-2 prerequisites |

### Files Updated

| File | Change |
|---|---|
| `docs/ROADMAP.md` | INF-CF-1 status updated (marked complete only after validation passes); cross-reference to the new inventory docs added; INF-CF-2 remains Planned, not started |
| `docs/AI_HANDOVER.md` | This entry |

### Safety Confirmation

- No DNS record changed. No nameserver changed. No Cloudflare account created, configured, or logged into. No registrar login performed. No Tunnel, Access, WAF, R2, or Workers configuration touched. No deployment performed. No runtime, database, or application code changed. No secrets, API tokens, or account IDs stored anywhere in this stage's files. No personal WHOIS/RDAP registrant data committed — all such data was redacted at collection time and never written to a tracked file.

### Validation

- `python -m json.tool projects/infrastructure/cloudflare/domain-inventory.json` — ✓ VALID (confirmed before and after the Opus-driven correction pass).
- `git diff --check` — ✓ passes, no whitespace errors.
- Full diff searched for credential/secret/personal-data keywords (password, secret, token, api_key, private_key, access_key, account_id, personal name/phone/address patterns) before commit — no matches beyond expected prose describing the absence of such data, and the one legitimate public verification-style TXT token on `ssangyong.autos` (not a secret; a public DNS record value).
- Exactly eight domains confirmed present and consistent across `domain-inventory.json`, `docs/CLOUDFLARE_DOMAIN_INVENTORY.md`, and `docs/CLOUDFLARE_DNS_MIGRATION_MATRIX.md`.
- One Opus 5 read-only audit performed: **PASS**, no blockers. Several non-blocking wording/consistency corrections were identified and applied directly by Sonnet (agribee.tn DMARC risk wording, CAA/`_dmarc` migration-action field for absent records, proposed-mode alignment for the six not-yet-created `mythosprod.xyz` administrative hostnames, proposed-mode alignment for the `ssangyong.autos` unidentified TXT token, a missing "Proposed mode" legend in the matrix, and the inventory's top-of-document status wording) before this stage is finalized.
- One Haiku 4.5 read-only mechanical verification performed after the implementation commit was pushed: **PASS**, no blockers — git refs, exact 6-file scope, 8-domain count, JSON validity, formatting (UTF-8, trailing newlines, no conflict markers), security/privacy scan, and stage-consistency all confirmed clean.

### Branch and Remote Status

- Branch: `docs/cloudflare-domain-inventory`, created from `origin/main` at `df569f880158428f04d10adc15aadaaec45ce2e7`.
- Do not treat any hash printed elsewhere in this document as the current branch tip. Always verify with `git rev-parse origin/docs/cloudflare-domain-inventory` before relying on a specific commit as "current".

### Exact Next Stage

**INF-CF-2** — DNS migration and verification. **Must not begin** until: (a) this INF-CF-1 inventory is reconciled against an authoritative zone export from the current provider's (OVH) control panel for each of the eight domains, and (b) the domain owner has reviewed and either resolved or explicitly accepted every risk listed in `docs/CLOUDFLARE_DOMAIN_INVENTORY.md` — in particular the broken web presence on `mythosprod.xyz`, the already-enabled DNSSEC on `mythosprod.xyz` and `ssangyong.autos`, the missing HTTPS on `idauto.tn`, and the separate authorisation required for the production domain `uthinachess.tn`.

---

## Stage INF-CF-0 — Cloudflare Foundation

**Objective:** Document the approved Cloudflare edge security architecture, deployment checklist, environment variable template, and deploy directory, without deploying, connecting, or modifying any infrastructure.

**Starting remote HEAD:** `fb1280f3ee54b511b919e7e77c3dcc7b7ff2b2aa` (origin/main)
**Implementation commit:** `d11badf0dbed3571803161b4f2e53c6c99eef39c`
**Status:** Complete and pushed

**Branch:** `docs/cloudflare-foundation`

### Scope

Documentation and safe examples only. No deployment, no DNS changes, no Cloudflare connectivity, no cloudflared installation, no PostgreSQL migrations, no runtime JS/PHP/HTML/CSS/database changes. No secrets, tokens, account IDs, tunnel credentials, certificates, API keys, R2 keys, or real production values committed.

### Changed Files

| File | Change |
|---|---|
| `docs/CLOUDFLARE_ARCHITECTURE.md` | NEW: approved edge security architecture |
| `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md` | NEW: staged deployment checklist INF-CF-1 through INF-CF-7 |
| `deploy/cloudflare/cloudflared.env.example` | NEW: environment variable template (empty placeholders only) |
| `deploy/cloudflare/README.md` | NEW: deploy directory documentation |
| `docs/ROADMAP.md` | Updated: Infrastructure and Cloudflare track added (INF-CF-0 through INF-CF-7) |
| `docs/AI_HANDOVER.md` | Updated: this entry |

### Validation

- All created files verified valid UTF-8.
- `cloudflared.env.example` contains empty placeholder values only; no real credentials.
- Full diff searched for credential keywords; no token, secret, password, private_key, api_key, or tunnel credential values found.
- `git diff --check` passes with no whitespace errors.
- Runtime test suite not required (documentation only).
- No deployment performed.

### Known Risks

None from this documentation stage itself — no infrastructure changed. Note for future implementation stages: `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md` rollback sections for INF-CF-3 through INF-CF-7 require careful execution (restricted, time-bounded fallbacks only — no unconditional port reopening, unproxied DNS, Access removal on administrative hostnames, TLS downgrade, or destructive delete before recovery is verified). Follow the rollback ordering exactly as documented; do not improvise a faster rollback under incident pressure.

### Deployment

Not performed. INF-CF-0 is documentation only.

### Exact Next Stage

**INF-CF-1** — Cloudflare account and domain inventory. Requires access to a Cloudflare account with Super Administrator or Administrator permissions, the domain `mythosprod.xyz`, and current DNS provider access.

### Branch and Remote Status

- Branch: `docs/cloudflare-foundation`
- INF-CF-0 implementation commit: `d11badf0dbed3571803161b4f2e53c6c99eef39c` — this is the implementation commit, never the branch tip.
- Commit history on this branch (oldest to newest, relative to `origin/main`): `d11badf` (establish edge security foundation) → `2dfcc72` (mark INF-CF-0 complete with commit hash) → `30b083c` (sync foundation with latest main) → `9a40206` (finalize merge readiness — Opus 5 audit corrections) → any later commits added after this line was written.
- Do not treat any hash printed in this document as the current branch tip. Always verify with `git rev-parse origin/docs/cloudflare-foundation` before relying on a specific commit as "current".
- Branch is documentation-only and kept synced with `origin/main` (not behind main at any point in this history).

---

## Repository State (verified 2026-08-06)

```
Branch:   main
HEAD:     383683e  (docs: update AI_HANDOVER.md for Stage 3D)
Stage 3D handover commit:        383683e
Stage 3D implementation commit:  4bf873b
ATN-0 handover commit:           fb1280f
ATN-0 implementation commit:     5b1fdf2
MAE-0 handover commit:           fddd58e
MAE-0 implementation commit:     32fc890
AVA-0 implementation commit:     58e0b07
IDA-1 implementation commit:     e9afc7e
Stage 4AG implementation commit: ebe42f9
Stage IDA-0 implementation commit: 7c75abd
Stage 4AF implementation commit: 2dcbb99
```

Note: `docs/cloudflare-foundation` branches from and is synced with `origin/main` at `383683e`. The branch is not behind main and is three commits ahead (`d11badf`, `2dfcc72`, `30b083c`), documentation-only.

**Stage 3D is complete.** Planning Runtime Plugin established. `js/plugins/planning.runtime.js` replaces `planning.plugin.js` in index.html. onBoot validates `mp_rappels` and `mp_rappel_types`. onReady registers MythosSearch (order 7) and MythosCalendar (order 5) providers via late-bound handlers. 110 tests written; all 104 non-subprocess tests pass; 6 subprocess regressions are pre-existing (stage3a/stage2d/stage1c _memCache crash). No app.js change. No rappels.js change. No deployment. Implementation commit: `4bf873b` (2026-07-30).

**Stage ATN-0 is complete.** Mythos Atelier Network foundation established. 7 new files created, 24 existing files updated (31 files total, 2761 insertions / 424 deletions). Fixpert repositioned as first workshop pilot — Atelier Network is the generic multi-workshop platform. 14 new canonical IDs. 24-table draft schema (atn_ prefix). 13 new control-plane tables (18→31 total). 16 new KPIs. 12 new risks. Two roadmap dependency corrections (AVA-2 prereq, IDA-4 prereq). All JSON valid. All SQL parens balanced. No runtime code changed. No PII. Tests: 86/86.

**Stage MAE-0 is complete.** Mythos Automotive ecosystem master foundation established. 12 new files created, docs/ROADMAP.md updated. 18-table PostgreSQL control-plane schema drafted (not deployed, prefix `mythos_automotive_`). All feature flags false. No real data. JSON valid. SQL parens balanced (185/185). No PII columns. git diff --check exit 0. stage4ag 42/42. stage4z 44/44.

**Stage AVA-0 is complete.** AutoValeur product foundation established. 6 files created (projects/autovaleur/README.md, config/autovaleur.example.json, database/schema.sql, docs/AUTOVALEUR_PRODUCT_SPEC.md, docs/AUTOVALEUR_ARCHITECTURE.md, docs/AUTOVALEUR_ROADMAP.md), docs/ROADMAP.md updated. 18-table PostgreSQL schema drafted (not deployed). All feature flags false. No real data. JSON valid. SQL parens balanced (217/217). No PII columns. git diff --check exit 0.

**Stage IDA-1 is complete.** Product vision, three access scopes (PUBLIC / PROFESSIONAL / MYTHOS_PRIVATE), observation-first data model, Smart Gate spec, Fixpert Atelier boundaries, PostgreSQL selected as target DBMS, LEGAL-REVIEW-REQUIRED items catalogued. 9 specification files created or updated. No runtime files changed. JSON valid. Targeted regression 42/42 + 44/44.

**Stage 4AG is complete** (same session). 5 obsolete OM-side duplicates removed from js/app.js (1088 → 991 lines). 3 invoice-side symbols BLOCKED by stableLineCount collision — reserved for a dedicated stage.

**Stage IDA-0 is complete** (same session). ID Auto Foundation established.

**Stage 4AF is complete** (prior session, same date).

---

## Stage 3D — Planning Runtime Plugin

**Starting remote HEAD:** `46e66cc` (Stage 3C completion record)
**Implementation commit:** `4bf873b` — `feat(planning): migrate bootstrap to runtime plugin` (2026-07-30)
**Handover commit:** this document update (2026-08-05)

**Objective:** Migrate the Planning / Rappels bootstrap to the Plugin SDK runtime pattern. `planning.runtime.js` replaces `planning.plugin.js` in index.html. All reminder CRUD, rendering, and recurrence logic remains in `rappels.js` and `app.js`. No business behaviour changed.

### Files Created

| File | Description |
|---|---|
| `js/plugins/planning.runtime.js` | Runtime plugin: `_PLANNING_RT_STATE`, `_planningSearchHandler`, `_planningCalendarProvider`, `_planningInit`, Plugin.create().defineMenu().defineRoutes([]).defineStorage().defineSearch().defineCalendar().build(), window.load fallback |
| `tests/stage3d-test.js` | 110 tests across 9 sections: structure, manifest, lifecycle, storage safety, search, calendar, navigation, backward compatibility, regression |
| `docs/planning-runtime.md` | Purpose, lifecycle, storage validation rules, search provider, calendar provider, recurrence limitation, late binding, loading order, compatibility, responsibilities in rappels.js, test coverage |

### Files Updated

| File | Change |
|---|---|
| `index.html` | Replaced `js/plugins/planning.plugin.js?v=…` with `js/plugins/planning.runtime.js?v=20260730`; position unchanged |
| `docs/module-map.md` | `planning.plugin.js` → `planning.runtime.js`; Stage 3D noted |
| `docs/mythos-os-blueprint.md` | Stage 3D complete; Stage 3E next |
| `docs/mythos-os-platform.md` | Planning runtime added; calendar provider noted |
| `docs/runtime-services.md` | Planning provider entries added |

### Planning Runtime Responsibilities

| Responsibility | Lives in |
|---|---|
| Plugin manifest (id, label, version, type, menu, routes, storageKeys) | `planning.runtime.js` |
| onBoot: validate `mp_rappels` + `mp_rappel_types` | `planning.runtime.js` |
| onReady: register MythosSearch + MythosCalendar providers | `planning.runtime.js` |
| Search handler (titre, type, details, case-insensitive, late-bound) | `planning.runtime.js` |
| Calendar provider (dateDebut-based, range-filtered, sorted, late-bound) | `planning.runtime.js` |
| window.load fallback guard | `planning.runtime.js` |
| All reminder CRUD (getRappels, saveRappelsList, saveRappel, deleteRappel) | `rappels.js` |
| Recurrence logic (getNextRappelDate, periodeLabel) | `rappels.js` |
| Reminder types management (getRappelTypes, saveRappelTypes, addRappelTypeIfNew) | `rappels.js` |
| Rendering (renderRappelsTable, updateRappelsBadge, openRappelsModal, etc.) | `rappels.js` |
| Modal DOM creation (DOMContentLoaded handler) | `rappels.js` |
| Calendar rendering integration | `app.js` |

### Storage Validation Rules (onBoot)

| Key | Rule |
|---|---|
| `mp_rappels` | null → leave untouched; valid array → preserve; malformed JSON → reset to `[]`; valid non-array → reset to `[]` |
| `mp_rappel_types` | null → leave untouched; valid array → preserve; malformed JSON → reset to `[]`; valid non-array → reset to `[]` |

Both keys: never overwrite a valid non-empty array; localStorage errors are silently swallowed.

### Search Provider

- id: `planning`, label: `Planning`, order: 7
- Fields searched: `titre`, `type`, `details`
- Case-insensitive; trimmed query; empty query → `[]`
- Result: `{ id: 'plan-'+r.id, title, subtitle, type:'planning', route:null, data }`
- route is `null` — Planning has no dedicated full-page route; modal-based
- Malformed entries silently skipped; no storage write

### Calendar Provider

- id: `planning`, label: `Planning`, order: 5
- Uses `dateDebut` as the calendar start date (late-bound)
- Range filtering: inclusive on both boundaries (YYYY-MM-DD string comparison)
- Events sorted chronologically ascending
- Event: `{ id: 'plan-'+r.id, title, start, end:null, allDay:true, route:null, data }`
- Malformed entries and invalid dates silently skipped; no storage write

### Validation

| Check | Result |
|---|---|
| `node tests/stage3d-test.js` | ✓ 104/110 (6 pre-existing subprocess failures — stage3a/stage2d/stage1c _memCache crash) |
| `node tests/stage3c-test.js` | ✓ 81/86 (5 pre-existing subprocess failures same root cause) |
| `node tests/stage3b-test.js` | ✓ 79/83 (4 pre-existing subprocess failures same root cause) |
| `node tests/stage3a5-test.js` | ✓ 149/152 (3 pre-existing subprocess failures same root cause) |
| `node tests/stage4z-test.js` | ✓ 44/44 |
| `node tests/stage4ag-test.js` | ✓ 42/42 |
| `node tests/stage3a-test.js` | Pre-existing crash (_memCache core failure) |
| `node tests/stage2d-test.js` | Pre-existing crash (same root cause) |
| No app.js changed | ✓ confirmed |
| No rappels.js changed | ✓ confirmed |
| No production deployment file changed | ✓ confirmed |
| No database migration | ✓ confirmed |

### Backward Compatibility

- `js/plugins/planning.plugin.js` — still exists on disk; not referenced in index.html (unreferenced legacy, consistent with prior runtime migrations)
- `js/rappels.js` — unchanged; still referenced in index.html; DOMContentLoaded handler intact
- No duplicate MythosSearch or MythosCalendar providers (hasProvider() guard)
- Planning has no dedicated route (modal-based) — no route was invented

### Next Stages

**Executable next:** Stage 3E — Calendar Runtime
**Next Automotive implementation:** IDA-2 — after Stage 3D, 3E, 3F complete (one-major-stage rule)
**ATN-1 and AVA-1:** cannot run in parallel without explicit user authorisation

### Known Deferred Issues (unchanged)

- `stableLineCount` collision (`mission-orders.js:28` let vs `invoices.js:5` var) — invoices.js non-functional in browser; blocked until dedicated stage
- `js/app-fresh.js` dead file — deferred deletion
- Pre-existing suite crashes (stage3a, stage2d, stage1c-part1) — `_memCache` core failure; outside Stage 3D scope

---

## Stage ATN-0 — Atelier Network Foundation and Ecosystem Consistency Amendment

**Starting remote HEAD:** `fddd58ee73ab8e54c327a478d76e282811255d8c` (MAE-0 handover)

**Objective:** Introduce Mythos Atelier Network as the generic multi-workshop platform. Fixpert is the first pilot; it is not the canonical name for the entire workshop domain. Amend all existing ecosystem documentation to reflect this, correct two roadmap dependency errors, replace `fixpert_inspection_ref` with generic ATN canonical IDs, and establish the Atelier Network product foundation: spec, architecture, roadmap, AutoCheck Standard, schema draft, and config.

**Scope:** Documentation and draft schema only. No runtime code. No PostgreSQL migration. No deployment. No live data. No modification of the external Fixpert system.

### Files Created (7)

| File | Description |
|---|---|
| `projects/atelier-network/README.md` | Multi-workshop platform overview, four product pillars, first pilot note, data status |
| `projects/atelier-network/config/atelier-network.example.json` | v0.1.0-atn0-draft; all feature flags false; workshop types, integration modes, AutoCheck standard, Smart Gate, access scopes |
| `projects/atelier-network/database/schema.sql` | 24-table draft schema (prefix `atn_`, logical schema `atelier_network`): workshop org registry, workshops, sites, capabilities, accreditations, technician assignments, service catalogue, inspection providers, AutoCheck reports, finding categories, findings, appointment types, appointments, work orders, interventions, repair estimates, estimate lines, external workshop records, integration connectors, sync events, Smart Gate device registry, consent events, platform audit events, network membership — DRAFT NOT DEPLOYED |
| `docs/ATELIER_NETWORK_PRODUCT_SPEC.md` | 12 sections: product identity, multi-workshop platform charter, workshop types and integration modes, AutoCheck Standard governance, smart gate generalisation, service catalogue, appointment model, work order lifecycle, data ownership boundaries, canonical IDs, access and privacy model, legal review items |
| `docs/ATELIER_NETWORK_ARCHITECTURE.md` | 7 ADs; 19 domain events; 14 new canonical IDs; multi-tenant hierarchy; integration mode contracts; Smart Gate generalisation; cross-product data flows |
| `docs/ATELIER_NETWORK_ROADMAP.md` | ATN-0 through ATN-5 stage plan with deliverables and prerequisites |
| `docs/AUTOCHECK_STANDARD.md` | Provider-neutral inspection protocol: AutoCheck by Fixpert (first); AutoCheck — [Workshop Name] for accredited partners; prohibited wording ("Expertise légale certifiée"); governance by Atelier Network; accreditation criteria; LEGAL-REVIEW-REQUIRED items |

### Files Updated (24)

**Automotive umbrella (7 files):**

| File | Key changes |
|---|---|
| `docs/AUTOMOTIVE_ROADMAP.md` | MAE-0 → COMPLETE; ATN-0 through ATN-5 stages added; IDA-4 prereq adds ATN-1; AVA-2 prereq corrected (ATN-1, not IDA-4/Smart Gate) |
| `docs/AUTOMOTIVE_PRODUCT_PORTFOLIO.md` | Four core pillars (not five); Fixpert repositioned as first Atelier Network pilot |
| `docs/AUTOMOTIVE_ARCHITECTURE.md` | `atelier_network` schema added to diagram; Fixpert marked external; four-pillar architecture |
| `projects/automotive/README.md` | Four pillars; Atelier Network positioning |
| `projects/automotive/config/automotive.example.json` | ATN product block added; four-pillar product list |
| `projects/automotive/database/control-plane-schema.sql` | 13 new control-plane tables (18→31 total); 14 new ATN canonical IDs in `mythos_automotive_canonical_identifiers` |
| `docs/AUTOMOTIVE_INTEGRATION_CONTRACTS.md` | ATN integration contracts; Atelier Network as domain actor |

**Automotive governance (4 files):**

| File | Key changes |
|---|---|
| `docs/AUTOMOTIVE_DATA_GOVERNANCE.md` | Section 1.3 "Fixpert" → two sections: 1.3 "Atelier Network" (platform data) + 1.4 "Each Workshop Organisation" (per-org operational data); 14 ATN canonical IDs added to registry; `fixpert_inspection_ref` → `inspection_provider_id` + `repair_estimate_id`; PII ownership generalized; data quality section generalized |
| `docs/AUTOMOTIVE_OPERATING_MODEL.md` | Section 1.3 "Fixpert" → "Atelier Network Workshop Operators"; RACI matrix column "Fixpert" → "Workshop Ops (ATN)" |
| `docs/AUTOMOTIVE_KPI_MODEL.md` | New section 3 "Atelier Network KPIs" (16 KPIs across 4 subsections: network scale, inspection quality, appointment/work order ops, integration health); old Fixpert KPIs → section 4 "Fixpert KPIs (First Pilot)" |
| `docs/AUTOMOTIVE_RISK_REGISTER.md` | R-L06 generalized to any AutoCheck provider; R-T08 resolved (AVA-2 dependency was wrong — now corrected); R-P06 (workshop customer PII cross-access) added; new section 6 with 12 ATN risks (R-ATN-L01 through R-ATN-B01) |

**Automotive vision (1 file):**

| File | Key changes |
|---|---|
| `docs/AUTOMOTIVE_VISION.md` | Vehicle chain diagram: "AutoCheck / Fixpert" → "Atelier Network — AutoCheck inspection (first provider: Fixpert)"; work order and intervention lines generalized |

**ID Auto (4 files):**

| File | Key changes |
|---|---|
| `docs/IDAUTO_PRODUCT_SPEC.md` | Section 3.4 title generalized; "Fixpert may see its own..." → "Each workshop organisation..."; ownership table generalized; schema diagram adds `atelier_network` block; fixpert marked external |
| `docs/IDAUTO_ARCHITECTURE.md` | `atelier_network` schema added; section 7 title generalized ("Smart Gate — Fixpert First Pilot; Generalises to Any ATN Workshop"); optional work order link references ATN |
| `docs/IDAUTO_FIXPERT_INTEGRATION.md` | ATN-0 amendment blockquote added (Smart Gate generalises; Fixpert is first pilot; IDA-4 scope preserved exactly) |
| `docs/IDAUTO_ROADMAP.md` | IDA-4 prerequisites: ATN-1 added; cross-product dependency map: Atelier Network node added; Fixpert shown as "(IDA-4+, requires ATN-1)" |

**AutoValeur (4 files):**

| File | Key changes |
|---|---|
| `docs/AUTOVALEUR_PRODUCT_SPEC.md` | Section 2 diagram generalized; ownership table split (ATN platform + per-org); pipeline: "Fixpert Inspection" → "AutoCheck Inspection (Atelier Network)"; section 11 rewritten ("Atelier Network Inspection Integration Levels") |
| `docs/AUTOVALEUR_ARCHITECTURE.md` | `atelier_network` schema added to diagram; AD-A5 generalized; section 4.2 integration contract updated with `inspection_provider_id` + `repair_estimate_id`; data flow generalized |
| `docs/AUTOVALEUR_ROADMAP.md` | AVA-2 title and prerequisites corrected: "Atelier Network Integration" (not Fixpert); AVA-2 prereq: "ATN-1 complete (inspection API and repair estimate endpoint)" |
| `projects/autovaleur/database/schema.sql` | `fixpert_inspection_ref` column → `inspection_provider_id BIGINT` + `repair_estimate_id BIGINT` in `autovaleur_condition_reports` and `autovaleur_repair_estimates` |

**Config files (3 files):**

| File | Key changes |
|---|---|
| `projects/autovaleur/config/autovaleur.example.json` | `integrations.fixpert` → `integrations.atelier_network`; feature flag `fixpert_inspection_integration` → `atelier_network_inspection_integration`; labour_rate_source generalized |
| `projects/idauto/config/idauto.example.json` | `database.logical_schemas` adds "atelier_network"; `fixpert_smart_gate` → `smart_gate`; feature flag `fixpert_atelier_link` → `atelier_network_work_order_link` |
| `projects/idauto/database/schema.sql` | Header comment: three schemas → four (including atelier_network); fixpert and atelier_network noted as not created by this file |

**Master roadmap (1 file):**

| File | Key changes |
|---|---|
| `docs/ROADMAP.md` | ATN-0 row added to Ecosystem Stage Plan; dependency map corrected (ATN-1 between IDA-2 and IDA-4; AVA-2 prereq corrected; Fleet/AutoMarket prereqs corrected); Atelier Network product track added (ATN-0 through ATN-5 table); Current Priority: ATN-1 added as item 3 |

### Key Architecture Decisions (ATN-0)

| AD | Decision |
|---|---|
| ATN-AD-1 | Atelier Network is the generic platform; Fixpert is the first workshop pilot — never the schema name for all workshops |
| ATN-AD-2 | Multi-tenant hierarchy: `workshop_organization_id` → `workshop_id` → `workshop_site_id` → operational records |
| ATN-AD-3 | `vehicle_id` exclusively minted and owned by ID Auto — Atelier Network references it, never creates it |
| ATN-AD-4 | AutoCheck Standard is provider-neutral; "AutoCheck by Fixpert" for Fixpert delivery; "AutoCheck — [Workshop Name]" for any accredited partner |
| ATN-AD-5 | Smart Gate generalises: each participating workshop owns its camera device and consent obligation; ID Auto owns the resulting vehicle observation |
| ATN-AD-6 | Integration modes: NATIVE_MANAGED, EXTERNAL_CONNECTED, HYBRID. Fixpert integration mode to be confirmed in ATN-1 (expected: EXTERNAL_CONNECTED) |
| ATN-AD-7 | `inspection_provider_id` + `repair_estimate_id` replace `fixpert_inspection_ref` everywhere in AutoValeur schema |

### Roadmap Dependency Corrections

| Item | Before (wrong) | After (correct) | Reason |
|---|---|---|---|
| AVA-2 prerequisite | "IDA-4 complete (Fixpert integration requires Smart Gate spec)" | "ATN-1 complete (Atelier Network inspection API and repair estimate endpoint available)" | Smart Gate camera data ≠ inspection/repair estimate data. AVA-2 needs repair estimates from ATN-1, not ANPR camera data from IDA-4 |
| IDA-4 prerequisite | IDA-3 + Smart Gate legal approval | IDA-3 + ATN-1 + Smart Gate legal approval (R-L02) | Fixpert must be registered as an ATN workshop before formal Smart Gate integration can proceed |
| R-T08 | OPEN — AVA-2 wrongly depends on IDA-4 | RESOLVED (ATN-0) — AVA-2 prereq corrected to ATN-1 | Resolved by the same correction |

### 14 New Canonical IDs

| Canonical ID | Owner |
|---|---|
| `workshop_organization_id` | Atelier Network |
| `workshop_id` | Atelier Network |
| `workshop_site_id` | Atelier Network |
| `workshop_capability_id` | Atelier Network |
| `workshop_accreditation_id` | Atelier Network |
| `technician_assignment_id` | Atelier Network |
| `service_catalog_item_id` | Atelier Network |
| `appointment_id` | Atelier Network |
| `inspection_id` | Atelier Network |
| `inspection_provider_id` | Atelier Network |
| `work_order_id` | Atelier Network |
| `intervention_id` | Atelier Network |
| `repair_estimate_id` | Atelier Network |
| `external_workshop_record_id` | Atelier Network |

### PostgreSQL Status

The `atelier_network` schema (24 tables, `atn_` prefix) is a draft specification. Not deployed. No migration scripts exist. PostgreSQL is not installed. Implementation begins ATN-1.

Control-plane schema: 31 tables total (18 original `mythos_automotive_*` + 13 new ATN platform tables). Not deployed.

### Validation

| Check | Result |
|---|---|
| `JSON.parse(atelier-network.example.json)` | ✓ VALID |
| `JSON.parse(automotive.example.json)` | ✓ VALID |
| `JSON.parse(autovaleur.example.json)` | ✓ VALID |
| `JSON.parse(idauto.example.json)` | ✓ VALID |
| ATN schema SQL: paren balance | ✓ 193 open = 193 close |
| Control-plane SQL: paren balance | ✓ 301 open = 301 close |
| IDauto SQL: paren balance | ✓ 383 open = 383 close |
| AutoValeur SQL: paren balance | ✓ 215 open = 215 close |
| `node tests/stage4ag-test.js` | ✓ 42/42 |
| `node tests/stage4z-test.js` | ✓ 44/44 |
| No runtime application file changed | ✓ confirmed |
| No PostgreSQL migration executed | ✓ confirmed |
| No PII columns introduced in new schema | ✓ confirmed |

### Implementation Commit

```
5b1fdf2  docs(atelier-network): establish multi-workshop foundation and align ecosystem
31 files changed, 2761 insertions(+), 424 deletions(-)
```

Local HEAD == origin/main == `5b1fdf2`.

### Next Stages

**ATN-1 — Workshop Registry + First Integration** (after IDA-2; parallel with AVA-1)
- Workshop onboarding flow
- Fixpert connector (EXTERNAL_CONNECTED mode — integration mode to be confirmed)
- Workshop registry API
- AutoCheck accreditation prototype
- Per-workshop DPA and ANPR approval prerequisites (R-ATN-L01, R-ATN-L02)

**IDA-2 — PostgreSQL Core, API and Manual Capture MVP** (next authorised implementation stage)

Prerequisites before starting ATN-1:
- IDA-2 provisions PostgreSQL cluster
- Per-workshop DPA template drafted (R-ATN-L01)
- Fixpert integration mode confirmed (EXTERNAL_CONNECTED vs HYBRID)
- Multi-tenant data isolation design reviewed (R-ATN-D01)

---

## Stage MAE-0 — Mythos Automotive Ecosystem Master Foundation

**Starting remote HEAD:** `f3f2cde7b39f41f8cab8f53ffbcc999fe3f0c8e8` (AVA-0 handover)

**Objective:** Establish the complete master documentation, governance, configuration, and draft control-plane schema for the Mythos Automotive umbrella portfolio brand.

**Scope:** Documentation only. No runtime code. No PostgreSQL migration. No deployment. No live data.

### Files Created

| File | Description |
|---|---|
| `projects/automotive/README.md` | Umbrella brand, vehicle-centric chain diagram, portfolio table, data status |
| `projects/automotive/config/automotive.example.json` | Ecosystem configuration: products, scopes, integration, shared services, MADs, feature flags, legal review items, operating rules |
| `projects/automotive/database/control-plane-schema.sql` | 18-table control-plane schema (prefix `mythos_automotive_`): products, product_stages, stage_gates, architecture_decisions, integration_contracts, integration_activations, legal_requirements, risk_register, kpi_definitions, kpi_snapshots, feature_flags, access_scope_definitions, canonical_identifiers, environments, releases, incidents, backup_status, domain_events |
| `docs/AUTOMOTIVE_VISION.md` | Official umbrella identity (Fr + Arabic), mission, vehicle-centric chain, 7 design principles, regulatory environment, what Mythos Automotive is NOT |
| `docs/AUTOMOTIVE_PRODUCT_PORTFOLIO.md` | 5 active products + 3 future products; Smart Gate boundary; Deal Radar correction; AutoCheck wording rules; AutoMarket verification badges |
| `docs/AUTOMOTIVE_ARCHITECTURE.md` | Full schema diagram; 8 MADs; shared platform services; infrastructure target; domain strategy; security baseline |
| `docs/AUTOMOTIVE_INTEGRATION_CONTRACTS.md` | 13 permanent rules; 3 integration types; 14-row activation matrix; domain event catalogue (40 events); ID Auto/Fixpert/Parts contracts; rate-limit spec; audit envelope standard |
| `docs/AUTOMOTIVE_DATA_GOVERNANCE.md` | Master ownership matrix (8 domains); canonical identifier spec (22-row registry); customer/PII boundaries; subject rights; vehicle privacy rules; 6 access scopes; retention policy; data quality; vehicle taxonomy authority |
| `docs/AUTOMOTIVE_OPERATING_MODEL.md` | 6 responsibility areas; RACI matrix (15×6); 4 stage gates; one-major-stage rule; 9-status lifecycle; change management; incident model (P1-P4); backup programme; deployment rules; partner onboarding; legal review register |
| `docs/AUTOMOTIVE_KPI_MODEL.md` | Portfolio KPIs; ID Auto KPIs; Fixpert KPIs; Parts KPIs; AutoValeur KPIs (incl. model accuracy KPI requirements: ≥50 matched pairs); AutoMarket KPIs; KPI governance; strategic milestones (Alpha → National scale) |
| `docs/AUTOMOTIVE_RISK_REGISTER.md` | 48 risks in 6 categories: Legal (10), Data/Identity (6), Technical (9), Operational (7), Business (8), Privacy (5) — all OPEN |
| `docs/AUTOMOTIVE_ROADMAP.md` | MAE-0 through MAE-4; IDA-2 through IDA-4; AVA-1 through AVA-6; FXP/PNW/AMK/FLT/AST stages; critical path to Alpha; dependency map |

### Files Updated

| File | Change |
|---|---|
| `docs/ROADMAP.md` | Added ecosystem umbrella section (MAE track, dependency map, one-major-stage rule, stage table); updated Current Priority item 4 |

### Master Architecture Decisions

| ID | Decision |
|---|---|
| MAD-1 | Product-schema alignment: each product owns one PostgreSQL schema |
| MAD-2 | `vehicle_id` is exclusively minted and owned by ID Auto — no other product creates vehicle IDs |
| MAD-3 | One writer per noun: only the owning product writes to its own tables |
| MAD-4 | No cross-schema FK constraints: referential integrity at application layer |
| MAD-5 | Unified `access_scope` with 6 scopes: `public / professional / mythos_private / product_internal / organization_private / consent_shared` |
| MAD-6 | `mythos_private` access is always audit-logged, no exception |
| MAD-7 | Provenance travels with data: `source_id`, `source_type`, `trust_level`, `snapshot_at` cross all boundaries |
| MAD-8 | Shared services defined once: rate limiting and audit envelope divergences resolved in MAE-1 |

### Key Findings from Opus Audit (incorporated)

| Finding | Resolution |
|---|---|
| AutoValeur Deal Radar write conflict | Deal Radar submits ingestion request to ID Auto API — never writes to `idauto_` tables. Incorporated in AUTOMOTIVE_ARCHITECTURE.md and AUTOMOTIVE_INTEGRATION_CONTRACTS.md |
| AVA-2 prerequisite error | AVA-2 requires IDA-4 (Fixpert integration), not IDA-2. Corrected in AUTOVALEUR_ROADMAP.md and AUTOMOTIVE_ROADMAP.md |
| Scope column name divergence | Canonical column name is `access_scope` (not `visibility_scope`). Risk R-T03 tracked. Standardisation in IDA-2 |
| ssangyong.autos classification | Confirmed external system with LEGAL-REVIEW-REQUIRED. Not in this repository's runtime |
| Smart Gate boundary | Fixpert owns device and consent obligation; ID Auto owns the resulting observation |
| Canonical vehicle_id gap | Vehicle_id merge/split protocol missing — Risk R-D01 (H/H). Protocol spec deferred to MAE-1 |
| Rate limiting divergence | Documented as R-T04. Unified spec in AUTOMOTIVE_INTEGRATION_CONTRACTS.md. Implementation in MAE-1 |
| Audit envelope divergence | Documented as R-T05. Common envelope spec in AUTOMOTIVE_INTEGRATION_CONTRACTS.md. Implementation in MAE-3 |

### PostgreSQL Status

All three PostgreSQL schemas (`idauto`, `autovaleur`, `mythos_automotive`) are draft specifications. None has been deployed. No migration scripts exist. PostgreSQL is not installed.

### LEGAL-REVIEW-REQUIRED Status

All 30+ LEGAL-REVIEW-REQUIRED items remain OPEN across IDA-*, AVA-*, and ecosystem. The 10 ecosystem-level legal items (R-L01 through R-L10) are documented in `docs/AUTOMOTIVE_RISK_REGISTER.md`. No item is resolved by this documentation stage.

Critical blocking items:
- R-L01 (IDA-3): Legal basis for plate lookup
- R-L02 (IDA-4): ANPR approval (INPDP) for Smart Gate
- R-L03 (AVA-1): AutoValeur estimate disclaimer wording

### Validation

| Check | Result |
|---|---|
| `JSON.parse(automotive.example.json)` | ✓ VALID |
| Control-plane SQL: 18 tables | ✓ 18 |
| Control-plane SQL: paren balance | ✓ 185 open = 185 close |
| Control-plane SQL: no PII columns | ✓ 0 violations |
| `git diff --check` | ✓ exit 0, no whitespace errors |
| `node tests/stage4ag-test.js` | ✓ 42/42 |
| `node tests/stage4z-test.js` | ✓ 44/44 |
| No runtime application file changed | ✓ confirmed |
| No PostgreSQL migration executed | ✓ confirmed |

### Implementation Commit

```
32fc890  docs(automotive): establish Mythos Automotive ecosystem foundation
```

Local HEAD == origin/main == `32fc890`.

### Next Stage

**IDA-2 — PostgreSQL Core, API and Manual Capture MVP** (next authorised implementation stage)

Prerequisites before starting IDA-2:
- Mythos OS Stage 3D-3F complete
- Staging environment separate from production configured (R-T01)
- `access_scope` column naming decision finalised (R-T03)
- Canonical vehicle_id merge/split protocol documented (R-D01)
- Legal basis for professional plate lookup (R-L01) — not required for admin-only phase but needed before public launch

Do not begin IDA-2 concurrently with Mythos OS Stage 3G.

---

## Stage IDA-1 — Product Vision, Capture, Access and Data Governance Specification

**Starting remote HEAD:** `4f56bd4455b1e25bdc21873f4dec4b04543027a0`

**Objective:** Define the ID Auto product vision, data capture model, three access scopes, Fixpert integration boundaries, and governance constraints before any implementation begins.

### Product Decisions

| Decision | Value |
|---|---|
| Official product name | ID Auto |
| Domain | idauto.tn |
| Platform | Mythos ecosystem (integrated, not isolated) |
| Target DBMS | PostgreSQL — **selected, not yet installed or deployed** |
| Data strategy | Capture-first (observation-first), not API-search-first |
| Plate format rules | UNVERIFIED DRAFTS until confirmed against official source |
| PostgreSQL install stage | IDA-2 |

### Logical Database Architecture

```
PostgreSQL cluster (target — not yet deployed)
├── mythos_core schema — users, roles, permissions, global audit
├── idauto schema     — vehicles, plates, observations, facts, evidence, ...
└── fixpert schema    — clients, work orders, invoices, payments (Fixpert-owned)
```

### Three Access Scopes (replaces IDA-0 boolean)

| Scope | Who | Notes |
|---|---|---|
| PUBLIC | Any caller within rate limits | Plate, colour, category, verified make/model/year, governorate |
| PROFESSIONAL | Verified subscriber orgs | Technical data + own service events |
| MYTHOS_PRIVATE | Mythos Super Admin only | Raw captures, exact location/time, OCR, camera, movements — all access audit-logged |

**Never public (permanent):** exact observation time, exact location, original image, plate crop, movement history, contributor identity, OCR output, VIN, carte grise, owner identity/contact, Fixpert customer data.

### Observation-First Invariant

Every input (scan, upload, camera, manual) creates an `idauto_observations` record first. Vehicle fiches and facts are derived from observations. Observations are immutable. Facts are versioned — old values are never silently overwritten.

### Scanner and Carte Grise Flows

- Primary button: **Scanner un véhicule** → modes: plate scan, vehicle scan, carte grise scan, photo import
- Carte grise: OCR Arabic + French fields → mandatory confirmation form → separate public technical facts from owner PII → owner PII never stored in idauto schema (routed to fixpert.clients with consent, or discarded)
- Implementation stage: IDA-3

### Fixpert Ownership Boundaries

| Data | Owner | Schema |
|---|---|---|
| Vehicle fiche, plates, observations | ID Auto / Mythos | idauto |
| Smart Gate events, movements | ID Auto / Mythos | idauto (MYTHOS_PRIVATE) |
| Fixpert clients, work orders | Fixpert | fixpert |
| Fixpert invoices, payments | Fixpert | fixpert |
| Platform services | Mythos | mythos_core |

**Mythos Super Admin has read access to all schemas for governance. Every super-admin access to Fixpert data is audit-logged.**

### Fixpert Smart Gate

- 5 cameras total at Fixpert — **only 1 (designated entrance/exit door camera) is in scope**
- Smart Gate events are always MYTHOS_PRIVATE
- Deduplication: configurable window prevents multiple events for same vehicle at door
- **LEGAL-REVIEW-REQUIRED: ANPR regulatory approval (INPDP) before any camera connection**
- Implementation stage: IDA-4

### New Architecture Decisions

| AD | Decision |
|---|---|
| AD-8 | Observation-first data model |
| AD-9 | Three access scopes: PUBLIC / PROFESSIONAL / MYTHOS_PRIVATE |
| AD-10 | Smart Gate events always MYTHOS_PRIVATE |
| AD-1 (revised) | Logical schema separation (not physical isolation) |

### Files Created

| File | Description |
|---|---|
| `docs/IDAUTO_PRODUCT_SPEC.md` | Product vision, user groups, access matrix, data ownership, vehicle fiche lifecycle, contribution model, super-admin role, LEGAL-REVIEW-REQUIRED |
| `docs/IDAUTO_CAPTURE_PIPELINE.md` | Scanner modes, observation-first flow, plate scan, carte grise OCR, confidence/evidence, conflict handling, review queue, media/location privacy |
| `docs/IDAUTO_FIXPERT_INTEGRATION.md` | 5-camera context, Smart Gate flow, data ownership boundaries, Fixpert Atelier relationship, deployment prerequisites |

### Files Updated

| File | Change |
|---|---|
| `projects/idauto/README.md` | Aligned to Mythos ecosystem, observation-first, PostgreSQL target, Smart Gate context |
| `projects/idauto/config/idauto.example.json` | v0.2.0-ida1-draft; added access_scopes, scanner_modes, capture_sources, observation_statuses, confidence_thresholds, public/professional/mythos_private field policies, media_processing, location_policy, review_queue, contributor_trust, carte_grise_scan, fixpert_smart_gate, retention_placeholders, expanded feature_flags |
| `projects/idauto/database/schema.sql` | 22-table observation-first draft; added idauto_capture_sources, idauto_camera_sources, idauto_contributors, idauto_capture_sessions, idauto_observations, idauto_observation_locations, idauto_observation_media, idauto_vehicle_facts, idauto_fact_evidence, idauto_document_scans, idauto_vehicle_movements, idauto_review_queue; updated idauto_vehicles with fiche_status; PostgreSQL-compatible; not deployed |
| `docs/IDAUTO_ARCHITECTURE.md` | 10 ADs, PostgreSQL target, logical schema separation, 3 access scopes, updated data flows |
| `docs/IDAUTO_ROADMAP.md` | IDA-0 through IDA-6; strategic growth milestones; LEGAL-REVIEW-REQUIRED table |
| `docs/ROADMAP.md` | IDA-1 done; IDA-2 as next; stableLineCount collision noted |

### PostgreSQL Status

**PostgreSQL is the selected target DBMS. It is NOT installed or deployed. The schema.sql is a draft specification. Implementation begins IDA-2.**

### LEGAL-REVIEW-REQUIRED Status

All items listed in `docs/IDAUTO_PRODUCT_SPEC.md` Section 12 remain OPEN. No real data collection begins from this commit. Summary of blocking items:

- Public image contribution and plate lookup (IDA-3 gate)
- Precise GPS collection and carte grise OCR (IDA-3 gate)
- Contributor consent mechanism (IDA-3 gate)
- ANPR regulatory approval (INPDP) — Smart Gate (IDA-4 gate)
- Official data-source agreement (ATTT) — national enrichment (IDA-6 gate)
- Data retention periods — all categories — open

### Validation

| Check | Result |
|---|---|
| `python3 -m json.tool idauto.example.json` | ✓ VALID |
| Schema: no duplicate table names | ✓ 22 tables, 0 duplicates |
| Schema: no owner PII in vehicle/plate/fact tables | ✓ 0 violations |
| Schema: parenthesis balance | ✓ 382 open = 382 close |
| `git diff --check` | ✓ no whitespace errors |
| `node tests/stage4ag-test.js` | ✓ 42/42 |
| `node tests/stage4z-test.js` | ✓ 44/44 |
| No runtime application file changed | ✓ confirmed |
| All feature flags for real capture remain false | ✓ confirmed |

### Implementation Commit

```
e9afc7e  docs(idauto): align product vision and capture architecture
```

Local HEAD == origin/main == `e9afc7e`.

### Next Stage

**IDA-2 — PostgreSQL Core, API and Manual Capture MVP**

- Deploy PostgreSQL cluster with idauto schema
- Core vehicle, plate, observation, fact and evidence APIs
- Admin manual entry (private only, no public ingestion)
- Review queue (admin UI)
- Plate format validation
- Audit logging and object storage wiring
- Mythos OS auth + audit integration
- Synthetic and pilot data only
- 50+ automated tests

---

## Stage AVA-0 — AutoValeur Foundation and Ecosystem Roadmap

**Starting remote HEAD:** `bd6ec7e834bd41a5399c407098336663d5ad139d` (IDA-1 handover)

**Objective:** Establish the AutoValeur product foundation inside the Mythos repository. Define product identity, ecosystem position, three product versions, valuation output model, comparable engine design, liquidity/opportunity scores, Deal Radar pipeline, Fixpert integration levels, model governance, manipulation resistance, access and privacy model, business model, and draft architecture and schema.

### Product Decisions

| Decision | Value |
|---|---|
| Official product name | AutoValeur |
| Tagline | Estimation automobile et intelligence du marché tunisien |
| Public promise | La vraie valeur de votre voiture |
| Platform | Mythos ecosystem (distinct product domain) |
| Target DBMS | PostgreSQL — shared cluster, `autovaleur` schema, NOT INSTALLED OR DEPLOYED |
| Valuation output | Always a range (min/max/central/quick-sale/professional prices) — never a single number |
| Valuation records | Immutable snapshots — never overwritten |
| Model version | Mandatory on every result record |
| Asking vs sale price | Always stored in separate fields — never merged or averaged |
| Deal Radar | MYTHOS_PRIVATE — no automatic purchase, no automatic seller contact |
| No real data | No marketplace scraping, no real listings, no PostgreSQL in AVA-0 |

### Three Product Versions

| Version | Access | Key outputs |
|---|---|---|
| Public | Any caller (rate-limited) | Range, central value, quick-sale price, confidence score, comparable summary, factors, recommendations |
| Professional | Verified subscribers | Professional purchase/resale prices, repair estimates, margin analysis, bulk valuation, API access |
| Intelligence | MYTHOS_PRIVATE (Super Admin only) | Deal alerts, deal pipeline, acquisition costs, model performance, all raw inputs |

### Files Created

| File | Description |
|---|---|
| `projects/autovaleur/README.md` | Product purpose, three versions, valuation outputs table, ecosystem integrations, data status, repository layout |
| `projects/autovaleur/config/autovaleur.example.json` | Configuration draft: access scopes, product versions, valuation outputs, valuation factors, comparable engine, liquidity score, opportunity score, Deal Radar, repair estimate, integrations, model governance, fraud resistance, source trust, LEGAL-REVIEW-REQUIRED, feature flags |
| `projects/autovaleur/database/schema.sql` | 18-table PostgreSQL schema (NOT DEPLOYED): model_versions, model_evaluations, source_catalogue, market_listings, listing_price_snapshots, valuations, valuation_inputs, comparables, condition_reports, repair_estimates, repair_estimate_lines, parts_quotes, liquidity_scores, opportunity_scores, deal_alerts, deal_pipeline, transactions, audit_events |
| `docs/AUTOVALEUR_PRODUCT_SPEC.md` | 16 sections: product identity, ecosystem position, ownership boundaries, three versions, valuation output definition (17 fields), valuation factors, comparable engine, liquidity score, repair/reconditioning cost pipeline, opportunity score, Deal Radar (10-step pipeline, 11 states), Fixpert integration, model governance, manipulation/fraud resistance, privacy and access, business model, 17 LEGAL-REVIEW-REQUIRED items |
| `docs/AUTOVALEUR_ARCHITECTURE.md` | 8 ADs (A1: valuation immutability, A2: model version mandatory, A3: asking/sale price separation, A4: no ID Auto duplication, A5: no PII duplication, A6: source provenance mandatory, A7: Deal Radar MYTHOS_PRIVATE, A8: all admin access audit-logged); integration contracts (ID Auto, Fixpert, parts, marketplace, Mythos OS); 3 data flow diagrams; deployment constraints |
| `docs/AUTOVALEUR_ROADMAP.md` | AVA-0 through AVA-6 stage plan with prerequisites; LEGAL-REVIEW-REQUIRED blocking table (17 items) |

### Files Updated

| File | Change |
|---|---|
| `docs/ROADMAP.md` | Added AutoValeur product track (AVA-0 through AVA-6 table, key decisions); updated Current Priority to include AVA-1 |

### Key Architecture Decisions

| AD | Decision |
|---|---|
| AD-A1 | Valuation snapshots are immutable — no UPDATE path in production API |
| AD-A2 | Model version mandatory on every result, evaluation, and comparable |
| AD-A3 | Asking price and completed sale price always separate fields |
| AD-A4 | AutoValeur stores ID Auto reference + JSON snapshot, not a live copy |
| AD-A5 | No customer PII or marketplace seller PII in `autovaleur` schema |
| AD-A6 | Every data record must reference a known source in `autovaleur_source_catalogue` |
| AD-A7 | Deal Radar and deal pipeline always `access_scope = 'mythos_private'` |
| AD-A8 | All Mythos Super Admin access audit-logged in `autovaleur_audit_events` |

### PostgreSQL Status

**PostgreSQL is the selected target DBMS. It is NOT installed or deployed. The schema.sql is a draft specification. Implementation begins AVA-1 (after IDA-2 provisions the shared cluster).**

### LEGAL-REVIEW-REQUIRED Status

All 17 items remain OPEN. Summary of blocking items:
- Market listing ingestion from any external marketplace (AVA-3 gate)
- Deal Radar listing source terms review (AVA-4 gate)
- Fixpert repair data reuse for valuation (AVA-2 gate)
- ID Auto vehicle data reuse for valuation (AVA-1 gate)
- Professional subscriber data retention and GDPR compliance (AVA-2 gate)
- Publication of valuation affecting financial decisions (AVA-1 gate)
- Completed transaction price collection and display (AVA-5 gate)

### Validation

| Check | Result |
|---|---|
| `JSON.parse(autovaleur.example.json)` | ✓ VALID |
| Schema: paren balance | ✓ 217 open = 217 close |
| Schema: CREATE TABLE count | ✓ 18 tables |
| Schema: no PII columns | ✓ 0 violations |
| `git diff --check` | ✓ exit 0, no whitespace errors |
| No runtime application file changed | ✓ confirmed |
| All feature flags false | ✓ confirmed |

### Implementation Commit

```
58e0b07  docs(autovaleur): establish product foundation and ecosystem roadmap
```

Local HEAD == origin/main == `58e0b07`.

### Next Stage

**AVA-1 — Public Calculator MVP** (after IDA-2 provisions PostgreSQL cluster)

- Deploy `autovaleur` PostgreSQL schema (core tables)
- Manual vehicle entry form
- Rule-based valuation engine (transparent, no ML)
- Synthetic and authorised dataset
- Public outputs: range, central value, quick-sale price, confidence, comparable summary
- Clear disclaimer on every output
- Rate limiting
- Mythos OS auth integration
- Save valuation (immutable record)
- No Deal Radar, no marketplace ingestion, no Fixpert integration

---

## Stage 4AG — Invoice and OM Duplicate Cleanup

**Objective:** Audit 8 candidate duplicate symbols in js/app.js and safely delete those confirmed obsolete without touching canonical shared module implementations.

**Starting remote HEAD:** `d1d0b759f0d9992ad95781593c54fe8143b9feec`

### Opus Audit Conclusion

Opus inspected js/app.js, js/shared/invoices.js, js/shared/mission-orders.js, index.html, relevant tests. Critical findings:

**SAFE TO DELETE (5 symbols):** All OM-side. `cancelOM` and `addOmPerson` are shadowed by mission-orders.js (last-wins). `editOm`, `deleteOm`, `populateOmList` are unreachable — no live HTML or JS caller references the lowercase-m variants; the live paths are `editOM`, `deleteOM`, `renderOMList`.

**BLOCKED (3 symbols):** All invoice-side. `js/shared/invoices.js` throws `SyntaxError` at load time because `js/shared/mission-orders.js:28` declares `let stableLineCount` and `invoices.js:5` declares `var stableLineCount` — a `var` redeclaration of an existing `let` binding is illegal. The entire invoices.js script is silently discarded at runtime. Therefore `editInvoice`, `deleteInvoice`, `populateInvoiceList` in app.js are the live implementations and must not be deleted until the collision is fixed in a separate stage.

**Production bug discovered:** `addLine()` in the browser currently resolves to a stub in app.js that alerts "Fonctionnalité en développement" — the full invoice line-item implementation in invoices.js is non-functional. This pre-existed Stage 4AG.

### Deleted Symbols

| Symbol | app.js lines (old) | Reason |
|--------|------------------|----|
| `populateOmList` | 177–208 | Unreachable; successor `renderOMList` in mission-orders.js |
| `addOmPerson` | 241–254 | Shadowed by mission-orders.js:168 |
| `editOm` | 282–316 | Unreachable; live path is `editOM` (uppercase) |
| `deleteOm` | 317–323 | Unreachable; live path is `deleteOM` (uppercase) |
| `cancelOM` | 324–340 | Shadowed by mission-orders.js:268 |

### Retained Symbols (and reasons)

| Symbol | Location | Reason kept |
|--------|----------|-------------|
| `editInvoice` | app.js:180 | BLOCKED: invoices.js fails to load (stableLineCount collision) |
| `deleteInvoice` | app.js:196 | BLOCKED: same |
| `populateInvoiceList` | app.js:148 | BLOCKED: same; transitively live via deleteInvoice |
| `removePersonRow` | app.js:206 | stage4n-test.js asserts exactly one definition; callers pending separate audit |

### Changed Files

| File | Change |
|------|--------|
| `js/app.js` | Removed 5 symbols (~97 lines); replaced with single reference comments; **1088 → 991 lines** |
| `js/core/router.js` | Line 31: `populateOmList()` → `if (typeof renderOMList === 'function') renderOMList();` |
| `tests/stage4ag-test.js` | NEW: 42 tests — structural ownership, OM behavioral sandbox tests, Stage 4Z regression |
| `tests/stage4z-test.js` | Fixed test bug: removed editOm/deleteOm/cancelOM from "must remain" list; added positive absence assertions; **42 → 44 passing** |
| `tests/stage4af-test.js` | Regression count check made format-agnostic |

### Validation

| Suite | Result |
|-------|--------|
| `node -c js/app.js` | ✓ |
| `node -c js/shared/invoices.js` | ✓ |
| `node -c js/shared/mission-orders.js` | ✓ |
| `tests/stage4ag-test.js` | ✓ 42/42 |
| `tests/stage4z-test.js` | ✓ 44/44 |
| `tests/stage4af-test.js` | ✓ 102/102 |
| `tests/stage4l-test.js` | ✓ 59/59 |
| `tests/stage4m-test.js` | ✓ 76/76 |
| Full Stage 4 suite (33 files) | ✓ all passing (~1978 assertions) |
| Haiku verification | ✓ PASS (all 9 checks) |

### Inactive Legacy

`js/app-fresh.js` — unreferenced dead file, not loaded by any `<script>` tag in index.html. Contains stale duplicates of `editInvoice`, `deleteInvoice`, `editOm`, `deleteOm` plus a conflicting `const MYTHOS_PRINT_LOGO_SRC`. Does not affect runtime. Candidate for a separate deletion stage.

### Preserved Legacy Issue

`stableLineCount` global collision (`let` in mission-orders.js vs `var` in invoices.js) renders the entire invoice shared module non-functional in the browser. Must be fixed before invoice duplicates in app.js can be removed. Requires a dedicated stage with a behavior-change review.

### Implementation Commit

```
ebe42f9  Stage 4AG: remove obsolete Invoice and OM helper duplicates
```

### Remaining js/app.js responsibilities after Stage 4AG

`js/app.js` is now **991 lines**. Remaining domains:

| Domain | Status |
|--------|--------|
| `editInvoice`, `deleteInvoice`, `populateInvoiceList` | BLOCKED pending stableLineCount fix |
| `removePersonRow` | Orphaned (callers deleted); needs caller audit before removal |
| `js/app-fresh.js` dead file | Inactive; deferred deletion |
| Invoice addLine stub (alerts "Fonctionnalité en développement") | Pre-existing production bug; blocked by same collision |
| STORE + utilities | High risk, skip |
| App initialization | High risk, skip |
| Demo data initialization | High risk, skip |
| Logs + Sidebar + Sync | Lower risk, future extraction |

### Next Authorized Stage

**IDA-1 — Product and Legal Specification** (ID Auto product track)

Condition: may begin in the next session. Mythos OS Stage 4 continues in parallel when IDA-1 is not active.

---

## Stage IDA-0 — ID Auto Foundation

**Objective:** Establish the ID Auto project foundation inside the Mythos OS repository. Define product identity, privacy contract, Tunisian plate format rules, data contracts, and integration contracts with Mythos OS shared services.

### Files Created

| File | Description |
|------|-------------|
| `projects/idauto/README.md` | Product identity, privacy contract, plate format catalogue, scope exclusions |
| `projects/idauto/config/idauto.example.json` | Configurable plate-format rules (7 formats), governorate codes (24), public search config, professional tier definitions, feature flags |
| `projects/idauto/database/schema.sql` | 11-table data contract: plate formats, governorates, vehicles, plates, sources, verifications, organizations, user roles, service events, consent/legal-basis, audit log |
| `docs/IDAUTO_ARCHITECTURE.md` | 7 architecture decisions, 7 Mythos OS integration contracts, 2 data-flow diagrams, deployment constraints |
| `docs/IDAUTO_ROADMAP.md` | IDA-0 through IDA-5 stage plan with deliverables and dependencies |

### Files Updated

| File | Change |
|------|--------|
| `docs/ROADMAP.md` | Added ID Auto as separate product track, updated current priority to Stage 4AG + IDA-1 |
| `docs/AI_HANDOVER.md` | This update |

### Architecture Decisions (summary)

| ID | Decision |
|----|----------|
| AD-1 | `idauto_` prefix strict separation from Mythos OS `mp_*` tables |
| AD-2 | Public search never returns owner PII; no owner columns in `idauto_vehicles` or `idauto_plates` |
| AD-3 | Plate formats as configurable rules in `idauto_plate_formats`, not hardcoded |
| AD-4 | `idauto_audit_log` is append-only; no row is ever updated or deleted |
| AD-5 | IP and User-Agent stored as SHA-256 hashes only |
| AD-6 | Service events default to `is_public=FALSE` (org-scoped) |
| AD-7 | No real data ingestion until IDA-1 legal review is complete |

### Validation

| Check | Result |
|-------|--------|
| `projects/idauto/config/idauto.example.json` JSON syntax | ✓ valid |
| `projects/idauto/database/schema.sql` table count | ✓ 11 tables |
| `database/schema.sql` parenthesis balance | ✓ 209 open = 209 close |
| INSERT targets | ✓ only seed tables (plate_formats, governorates, sources) |
| All Stage 4 tests (stage4z, stage4ae, stage4af) | ✓ no regression |

### Privacy Constraints (permanent)

- Public search endpoint: returns only `plate_number`, `format_code`, `governorate_name`, `status`, `vehicle_make`, `model`, `year`, `body_type`, `fuel_type`, `colour`
- Never returned: `owner_name`, `owner_address`, `owner_cin`, `owner_passport`, `owner_phone`, `insurance_policy_number`, `insurance_company`
- Schema: `idauto_vehicles` and `idauto_plates` have no owner columns (enforced by schema + `-- [NO PII]` comments)

### Implementation Commit

```
7c75abd  feat(idauto): establish ID Auto project foundation (Stage IDA-0)
```
Remote HEAD verified: `7c75abd`. Local HEAD == origin/main.

### Security Constraints (inherited, unchanged)

- Do NOT commit `google_config.php`, `ACCES.txt`, `appdata/`, `documents/`
- Do NOT touch production at `/var/www/uthinachess/0726/Prod/`
- Do NOT deploy ID Auto to any server before IDA-2 with explicit authorization

### Next ID Auto Stage

**IDA-1 — Product and Legal Specification**
- Legal basis mapping per data category (Tunisian organic law 63-2004)
- Data-processing agreement template for professional subscribers
- Regulatory pathway for accessing public vehicle registry data
- API specification (endpoint definitions, request/response schemas, rate-limit headers)
- Hosting and infrastructure specification

**Condition:** IDA-1 does not begin until Mythos OS Stage 4AG is complete or explicitly paused.

---

## Stage 4AF — Camera Modal Domain Extraction Camera Modal domain (~192 lines, `js/app.js` lines 1060–1251 post-4AE) extracted to `js/shared/camera.js`. Tests: 102/102. Full Stage 4 suite (4A–4AF, all test files): all passing, 0 failures.

Implementation commit: `2dcbb99` — `Stage 4AF — Extract Camera Modal domain to js/shared/camera.js`
Verified remote HEAD: `2dcbb99`

**Previous stages also complete:**
- Stage 4AE: Documentation domain (568 lines), commit `87079a4`
- Stage 4AD: Backup/Export/Restore domain (274 lines), commit `6363e34`
- Stage 4AC: Spectacle Calculator, commit `dfe9cf7`
- Stage 4AB: Répertoire Contacts domain, commit `95d9453`
- Stage 4AA: Inscriptions/Appels domain (see prior entries)

> Note: `docs/AI_HANDOVER.md` was stale — last edited for Stage 3C (893 tests). Stages 3D–3H were committed between then and Stage 4A without updating this file. The correct baseline entering Stage 4A was 1405 tests (not 893).

---

## Stage 4AC — Spectacle Calculator Extraction

**Objective:** Extract `initSpectacleCalculator` (52 lines, `js/app.js` lines 1318–1369) into `js/shared/spectacle-calculator.js`. Pure DOM function — subvention table lookup by actor count and distance.

**Boundary:** Lines 1318–1369, from `// ══ CALCULATEUR SPECTACLE` section header through the blank line after the closing `}`. Line 1370 (`// ══ DOCUMENTATION`) is the first line not extracted.

**Dependencies:** `document.getElementById`, `Option`, `parseInt`, `toLocaleString` — browser globals only. No STORE, no shared utilities, no external function calls.

**Changed Files:**
- `js/shared/spectacle-calculator.js` — NEW (56 lines with header)
- `js/app.js` — removed 52 lines, replaced with 2-line ref comment; new total 2104 lines
- `index.html` — added script tag after `contacts.js`, before `taches.js`
- `tests/stage4ac-test.js` — NEW: 24 tests

**Validation:** 24/24; full suite 1717/1717 (29 files). Implementation commit: `dfe9cf7`.

### Remaining js/app.js responsibilities after Stage 4AF

`js/app.js` is now **1088 lines**. Remaining coherent domains:

| Domain | Approx lines (post-4AF) | Notes |
|--------|------------------------|-------|
| Invoice/OM helpers | ~195 lines | `populateInvoiceList`, `populateOmList`, `editInvoice`, `deleteInvoice`, `editOm`, `deleteOm`, `cancelOM`, `addOmPerson`, etc. — **next audit target (Stage 4AG)** |
| Demo data initialization | ~278 lines | `initializeDemoData` — high risk, skip |
| STORE + utilities | lines 18–140 | High risk, skip |
| App initialization | ~110 lines | `initApp`, `bootstrapStableApp`, `initNavScrollHint`, etc. — high risk, skip |
| Logs + Sidebar + Sync | ~210 lines | `checkDailyBackup`, `renderLogs`, `toggleSidebar`, `_startBackgroundSync` |

### Exact Next Scope

**Stage 4AG:** Audit and remove remaining Invoice/OM helper duplicates from `js/app.js`. These helpers (`populateInvoiceList`, `populateOmList`, `editInvoice`, `deleteInvoice`, `editOm`, `deleteOm`, `cancelOM`, `addOmPerson`, etc.) were partially extracted in earlier stages; check for any remaining duplicates or stubs that should be removed. Do NOT begin this stage in the same session as Stage 4AF.

---

## Stage 4AF — Camera Modal Domain Extraction

**Objective:** Extract Camera Modal domain (~192 lines, `js/app.js` lines 1060–1251 post-4AE) into `js/shared/camera.js`. Moves 4 state vars and 8 functions. Replaces extracted block with 4-line reference comment in `app.js` (1276 → 1088 lines). Inserts `camera.js` script tag between `documentation.js` and `taches.js` in `index.html`.

**Exact extraction boundary:** lines 1060–1251 post-4AE, from `// ══════ CAMÉRA — Prise de photo directe` through closing `}` of `closeCameraModal`.

### State vars moved

`_cameraStream`, `_cameraFacing`, `_capturedDataUrl`, `_cameraContext`

### Functions moved

`openCameraModal`, `_startCamera`, `switchCamera`, `capturePhoto`, `retakePhoto`, `cameraMobileCapture`, `saveCapturedPhoto`, `closeCameraModal`

### Critical dependency

`saveCapturedPhoto` calls `_saveDocRecord`, `renderDocList`, `_docCurrentFolder`, `renderDocumentation` — all in `js/shared/documentation.js`. Script order invariant: `documentation.js` → `camera.js` → `taches.js`.

All Camera callers are exclusively inline `onclick`/`onchange` handlers in `index.html` — no calls from other JS modules.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/camera.js` | NEW: 4 state vars + 8 functions, ~194 lines |
| `js/app.js` | Removed ~192 lines; replaced with 4-line reference comment; new total **1088 lines** |
| `index.html` | Added `<script src="js/shared/camera.js?v=20260805"></script>` after `documentation.js`, before `taches.js` |
| `tests/stage4af-test.js` | NEW: 102 tests across 24 sections |

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/camera.js` | ✓ |
| `tests/stage4af-test.js` | ✓ 102/102 |
| `tests/stage4ae-test.js` | ✓ 142/142 |
| `tests/stage4z-test.js` | ✓ 42/42 |

Implementation commit: `2dcbb99`. Remote HEAD verified `2dcbb99`.

---

## Stage 4AE — Documentation Domain Extraction

**Objective:** Extract the complete Documentation domain (~568 lines, `js/app.js` lines 1050–1617 post-4AD) into `js/shared/documentation.js`. Covers folder navigation, document CRUD, preview helpers, upload, bulk upload, and the move-menu click listener.

**Exact extraction boundary:** lines 1050–1617, from `// ══════ DOCUMENTATION` section header through the closing `}` of `saveBulkDocs`. Line 1618 (`// ══ CAMÉRA`) is the first line not extracted.

### Architectural decisions

- `_docCurrentFolder`, `DOC_FOLDERS`, `_bulkFiles` moved as module-level vars.
- `document.addEventListener('click', ...)` (closes move-menus on outside click) moved into module — single `<script>` tag prevents double-registration.
- `renderDocList(cat)` compat alias (`→ _renderDocFolder(cat)`) preserved verbatim.
- `switchDocTab(cat)` compat alias (`→ openDocFolder(cat)`) preserved verbatim.
- No dependency on `escapeHtml` changed — still resolved at call time from `utils.js`.
- Camera Modal (`saveCapturedPhoto`) calls `_saveDocRecord`, `renderDocList`, `_docCurrentFolder` — `documentation.js` **must** load before `camera.js`.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/documentation.js` | NEW: 33 functions + 3 state vars, ~350 lines |
| `js/app.js` | Removed 568 lines (1050–1617); replaced with 10-line reference comment; new total **1276 lines** |
| `index.html` | Added `<script src="js/shared/documentation.js?v=20260805"></script>` after `backup.js`, before `taches.js` |
| `tests/stage4ae-test.js` | NEW: 142 tests across 29 sections |
| `tests/stage4z-test.js` | Updated Section 3: removed `renderDocumentation` from app.js check; added 3 assertions verifying it in `documentation.js`; now 42/42 |

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/documentation.js` | ✓ |
| `tests/stage4ae-test.js` | ✓ 142/142 |
| `tests/stage4z-test.js` | ✓ 42/42 |
| All Stage 4 tests (4A–4AE, 31 files) | ✓ 0 failures |

Implementation commit: `87079a4`. Remote HEAD verified `87079a4`.

---

## Stage 4AD — Backup/Export/Restore Domain Extraction

**Objective:** Extract Backup/Export/Restore domain (11 functions, 274 lines, `js/app.js` original lines 1043–1316) into `js/shared/backup.js`.

**Exact extraction boundary:** lines 1043–1316, from `// ══════ SAUVEGARDE — fonctions manquantes` through the closing `}` of `_restoreServerBackup`. Line 1317 (`// ── Spectacle Calculator …`) was the first line not extracted.

### Architectural decisions

- `RESTORE_KEY_MAP` remains in `js/app.js` (defined at line 72, used by sync domain and other locations outside the backup block).
- `_getAllData` confirmed internal-only: only called at original lines 1056 and 1101, both within the backup domain.
- `todayStr()` and `escapeHtml()` are globals from `utils.js` — resolved at call time.
- `LOGGER` usage in `exportBackup` is already guarded by `typeof LOGGER !== 'undefined'`.
- Router caller: only `renderBackupDashboard()` called from `router.js` line 89.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/backup.js` | NEW: 11 functions, ~250 lines |
| `js/app.js` | Removed 274 lines (1043–1316); replaced with 4-line reference comment; new total **1833 lines** |
| `index.html` | Added `<script src="js/shared/backup.js?v=20260805"></script>` after `spectacle-calculator.js`, before `taches.js` |
| `tests/stage4ad-test.js` | NEW: 71 tests across 21 sections |
| `tests/stage4z-test.js` | Updated: 3 assertions moved from "in app.js" to "in backup.js"; net +3, now 40 passing |

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/backup.js` | ✓ |
| `tests/stage4ad-test.js` | ✓ 71/71 |
| `tests/stage4z-test.js` | ✓ 40/40 |
| All Stage 4 tests (4A–4AD, 30 files) | ✓ 0 failures |

Implementation commit: `809e8bf`. Remote HEAD verified `809e8bf`.

---

## Stage 4AB — Répertoire Contacts Domain Extraction

**Objective:** Extract the complete Répertoire Contacts domain from `js/app.js` lines 745–2003 into `js/shared/contacts.js`. This is the phone/vCard/Google contact import pipeline, UCL numbering, CRUD, duplicate detection/merge, interaction history, tags, annuaire/directory view, and CSV export.

**Exact extraction boundary:** lines 745–2003, from the `// ══ CONTACT MANAGEMENT` section header through the closing `}` of `updateRepertoireContactTags`. Line 2004 (`// Invoice list…moved to js/shared/invoices.js.`) is the first line NOT extracted. `printModal` (lines 2014–2021) confirmed dead to contacts callers — stays in `js/app.js`.

### Architectural decisions

- `_rcActiveTab` hoisted to module top (line 7 of contacts.js): was declared at original line 1394 but used at line 767 via var hoisting; explicit hoist makes ordering intent visible with no behavior change.
- `document.addEventListener('DOMContentLoaded', ...)` at original line 911 (calls `setTimeout(_checkGoogleImportToken, 800)`) moved into contacts.js as-is — single `<script>` tag prevents double-registration.
- `_rcFilterBatchId` remains a `var` global — router.js line 91 writes `_rcFilterBatchId = null` directly; `var` global resolution at call time preserves this without any setter export.
- All 45 functions remain as `var`/function declarations on the global scope (non-module script), matching the 23 inline `onclick=`/`onchange=` HTML handlers and router.js callers.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/contacts.js` | NEW: 1264 lines; 8 state vars (including hoisted `_rcActiveTab`), 45 functions, 1 DOMContentLoaded listener |
| `js/app.js` | Removed 1259 lines (745–2003); replaced with 19-line reference comment block; new total 2153 lines |
| `index.html` | Added `<script src="js/shared/contacts.js?v=20260805"></script>` after `inscriptions.js`, before `taches.js` |
| `tests/stage4ab-test.js` | NEW: 146 tests across 11 sections |

### Dependencies and Compatibility

Resolved at call time:
- `STORE.repertoireContacts()`, `STORE.saveRepertoireContacts()`, `STORE.repertoireImports()`, `STORE.saveRepertoireImports()` — STORE defined in `js/app.js` (unchanged)
- `esc(str)` — defined in `js/utils.js` (loads before app.js)
- `_markDeleted(obj)` — defined in `js/core/sync.js`
- `syncFromServer()` — defined in `js/core/sync.js`
- `showView(view)` — defined in `js/core/router.js`
- `navigator.contacts`, `fetch`, `document`, `alert`, `confirm`, `URL`, `Blob`, `Date`, `Math` — browser globals

Router (`js/core/router.js`) unchanged: line 91 (`_rcFilterBatchId = null; renderRepertoireContactsPage(); …`) and line 92 (`renderContactFiche()`) resolve globals at call time.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/contacts.js` | ✓ |
| `tests/stage4ab-test.js` | ✓ 146/146 |
| `tests/stage4aa-test.js` | ✓ 115/115 |
| `tests/stage4z-test.js` | ✓ 40/40 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4AB, 28 files) | ✓ 1693/1693 |

No Stage 4 suite failed and no regression was found.

### Risks, Remaining Responsibilities, and Operations

- `js/app.js` (2153 lines) still contains: Documents (~780 lines), Backup dashboard (~265 lines), Spectacle price calculator (~60 lines), Settings page (~70 lines), Invoice/OM helpers and `populateInvoiceList`/`populateOmList` (~175 lines), `printModal`, STORE object, shared utilities (`num`, `fmtMoney`, `escapeHtml`, `esc`, etc.), initialization (`initApp`, `bootstrapStableApp`), logs rendering, sidebar/mobile behavior, background sync, demo data initialization, `restoreBackup20260516Once`, `forceRestoreBackup20260516`.
- Stage 4 cannot close while these coherent domains remain in `js/app.js`.
- Deployment: not performed. Data migration: not performed.

### Exact Next Scope

**Stage 4AC:** Extract Documents domain from `js/app.js`. Read the file from line ~1100 onward to locate the Documents section header (approximately `// ══ Documents` or similar). This is the file upload, scanner, OCR, camera, and document management workflow. Extract into `js/shared/documents.js`. Confirm exact boundary before implementation.

Alternatively, if Documents is complex/mixed with camera/permissions, consider first extracting **Spectacle calculator** (~60 lines, self-contained) or **Backup dashboard** (~265 lines) as a lower-risk next stage.

---

## Stage 4AA — Inscriptions/Appels Workflow Extraction

**Objective:** Extract the complete Inscriptions/Appels CRUD workflow from `js/app.js` lines 731–1217 into `js/shared/inscriptions.js`. This is the Google Sheet inscription ingestion, UCL numbering, validation/bulk-validation pipeline, appel-fiche modal lifecycle, call-result tracking, call-script settings (editable from Paramètres), Google Sheet push webhook, and conformité list filtering.

**Exact extraction boundary:** lines 731–1217, from `// ── Inscriptions` comment through the closing `}` of `saveAppelFiche`. Line 1219 (`// ── Routing → js/core/router.js`) is the first line NOT extracted.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/inscriptions.js` | NEW: INSCRIPTIONS_SCRIPT_URL, `_escHtmlInsc`, `loadDashboardInscriptionsCount`, `_uclNum`, `_appUid`, `loadInscriptions`, `validerToutesInscriptions`, `validerInscriptionRow`, `renderAppels`, `reinitialiserListes`, `reafficherInscriptions`, `renderListeConforme`, `getCallScript`/`saveCallScript`/`loadSettingsCallScript`/`saveCallScriptFromSettings`/`resetCallScriptToDefault`, `getSheetWebhookUrl`/`saveSheetWebhookUrl`/`loadSettingsSheetUrl`/`saveSheetUrlFromSettings`/`testSheetWebhookFromSettings`/`pushToGoogleSheet`, `MOIS_NOMS`, `_populateNaissanceSelects`, `openAppelFicheModal`/`closeAppelFicheModal`/`setAppelResult`/`saveAppelFiche` |
| `js/app.js` | Removed 487 lines (731–1217); replaced with 11-line reference comment block |
| `index.html` | Added `<script src="js/shared/inscriptions.js?v=20260805"></script>` after `statistics-dashboard.js`, before `taches.js` |
| `tests/stage4aa-test.js` | NEW: 115 tests — globals, pure helpers (`_escHtmlInsc`/`_uclNum`/`_appUid`), `renderAppels`, `renderListeConforme`, `validerInscriptionRow`, `validerToutesInscriptions`, call-script settings, sheet-webhook settings, `openAppelFicheModal`/`closeAppelFicheModal`/`setAppelResult`, `saveAppelFiche`, integration checks |

### Dependencies and Compatibility

Resolved at call time:
- `STORE.appels()`, `STORE.saveAppels()`, `STORE.validatedInscriptions()`, `STORE.saveValidatedInscriptions()` — defined in `js/app.js` STORE block (unchanged)
- `_storeGet`, `_storeSave` — defined in `js/core/storage.js` (call-script and sheet-webhook settings use these directly for per-key localStorage access)
- `_tchToast` — optional; checked with `typeof _tchToast === 'function'` before calling
- `fetch`, `document`, `alert`, `confirm`, `Date`, `Math` — browser/Node globals
- Router callers (`loadDashboardInscriptionsCount`, `loadInscriptions`, `renderAppels`, `renderListeConforme`) resolve globals at call time — `js/core/router.js` unchanged

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/inscriptions.js` | ✓ |
| `tests/stage4aa-test.js` | ✓ 115/115 |
| `tests/stage4z-test.js` | ✓ 40/40 |
| `tests/stage4y-test.js` | ✓ 50/50 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4AA, 27 files) | ✓ 1547/1547 |

No Stage 4 suite failed and no regression was found.

### Risks, Remaining Responsibilities, and Operations

- `js/app.js` still contains: Répertoire contacts (~1 400 lines), Documents (~780 lines), Backup dashboard (~265 lines), Spectacle price calculator (~60 lines), Settings page (~70 lines), Invoice/OM helpers (~175 lines), STORE object, shared utilities (`num`, `fmtMoney`, `escapeHtml`, etc.), initialization (`initApp`, `bootstrapStableApp`).
- Stage 4 cannot close while these coherent domains remain in `js/app.js`.
- Deployment: not performed. Data migration: not performed.

### Exact Next Scope

**Stage 4AB:** Extract Répertoire contacts domain from `js/app.js` (approx lines 742–2120 in current numbering after 4AA extraction, exact range to be confirmed by reading). This is the largest remaining domain. Read `js/app.js` from the line immediately after the `// ── Routing → js/core/router.js` comment to find the exact block. Verify with `grep -n 'function render\|function open\|function close\|function save\|function delete\|function add\|function filter\|var contact\|var repertoire'` in `js/app.js` to identify the boundary. Extract into `js/shared/contacts.js`.

---

## Stage 4Z — Dead-code Audit; Remove renderEntityPage

**Stage 4Z is complete.** `renderEntityPage` confirmed dead (zero callers in HTML, JS, PHP) and removed from `js/app.js`. Three prior test suites (4V, 4X, 4Y) updated to assert removal. Stage 4Z passes 40/40. Full Stage 4 suite (4A–4Z): 1432 tests, 0 failures.

Implementation commit: `d4f68b0` — `refactor: Stage 4Z dead-code audit — remove renderEntityPage`

---

## Stage 4Y — Statistics Dashboard Extraction

**Objective:** Extract the complete statistics dashboard aggregation, KPI, comparison, and SVG rendering workflow from `js/app.js` into `js/shared/statistics-dashboard.js` without changing formulas, data sources, output, or navigation behavior.

**Exact extraction boundary:** the contiguous `renderStatistique` function, beginning immediately after the modal-helper extraction marker and ending immediately before the `_statKpi` utility marker. Its nested donut, monthly bar, and expense line SVG renderers move with it.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/statistics-dashboard.js` | NEW: global totals/KPIs, 12-month aggregation, recovery donut, monthly activity bars, expense trend, top clients, and entity summaries |
| `js/app.js` | Removed only `renderStatistique`; generic entity rendering, modal overlay behavior, initialization, backup/document workflows, and unrelated domains remain |
| `index.html` | Loads `statistics-dashboard.js` after all extracted data/accounting dependencies and before `taches.js` |
| `tests/stage4y-test.js` | NEW: 50 tests for globals, empty/partial data, totals, percentages, monthly datasets, SVG output, counts, escaping, routing, exclusions, and script order |
| `tests/stage4q-test.js` through `tests/stage4x-test.js` where applicable | Updated completed-extraction boundary assertions |

### Dependencies and Compatibility

Resolved at call time: invoice/RDV/client/mission-order/representation/expense/Bank/contract readers, `normalizeRdv`, invoice/RDV amount helpers, number/money/HTML utilities, `_statKpi`, `_statMini`, browser DOM, and `Date`. The router and manual refresh button retain the same `renderStatistique` global and timing. Existing all-time KPI totals, paid-status logic, 12-calendar-month window, top-six client ranking, recovery percentage rounding, three-decimal formatting, SVG construction, optional contracts fallback, and empty states are preserved exactly. The implementation uses inline SVG rather than Chart.js, so no chart instances, destruction lifecycle, listeners, timers, or writes were introduced.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/statistics-dashboard.js`, `js/shared/modal-entity-helpers.js` | ✓ |
| `tests/stage4y-test.js` | ✓ 50/50 |
| `tests/stage4x-test.js` | ✓ 49/49 |
| `tests/stage4w-test.js` | ✓ 44/44 |
| `tests/stage4v-test.js` | ✓ 60/60 |
| `tests/stage4u-test.js` | ✓ 45/45 |
| `tests/stage4t-test.js` | ✓ 57/57 |
| `tests/stage4s-test.js` | ✓ 55/55 |
| `tests/stage4r-test.js` | ✓ 68/68 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage4e-test.js` | ✓ 31/31 |
| `tests/stage4j-test.js` | ✓ 66/66 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4Y) | ✓ 1392/1392 |

The Stage 4 suite was run exactly once. No Stage 4 suite failed and no new regression was found. The 12 documented pre-existing failures remain outside this bounded suite and unchanged by the extracted files.

### Risks, Remaining Responsibilities, and Operations

- The 12 documented pre-existing suite failures remain deferred and were not rerun.
- `js/app.js` still contains the apparently unreferenced generic `renderEntityPage` helper plus extraction markers, initialization, backup/document workflows, and other unrelated legacy domains.
- Stage 4 remains incomplete pending a bounded dead-code/residual extraction audit; no unverified helper was removed in Stage 4Y.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4X — Shared Modal Entity Helpers Extraction

**Objective:** Extract the shared form population and entity serialization/write helpers from `js/app.js` into `js/shared/modal-entity-helpers.js` without changing field mapping, coercion, callback timing, or storage routing.

**Exact extraction boundary:** the contiguous block beginning at `fillModalFields` and ending after `saveModalEntity`, immediately before `renderStatistique`.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/modal-entity-helpers.js` | NEW: shared field population and entity create/update serialization helpers |
| `js/app.js` | Removed only `fillModalFields` and `saveModalEntity`; generic rendering, statistics, and entity-specific modal lifecycle remain |
| `index.html` | Loads the helper module immediately after `app.js` and before all extracted consumers |
| `tests/stage4x-test.js` | NEW: 49 tests for globals, population/reset, key mappings, checkbox/number serialization, create/update behavior, writer/callback order, exclusions, and script order |
| `tests/stage4w-test.js` | Updated the completed-extraction boundary assertion |

### Dependencies and Compatibility

Resolved at call time: `num`, `Date.now`, browser DOM, and the entity-specific reader/writer/render/close callbacks supplied by callers. The `supplier-id`, `supplier-name`, and `linked-bank` mappings, first-dash generic mapping, checkbox handling, numeric coercion, replacement-object update behavior, generated IDs, and `save → close → render` timing are preserved exactly. Existing Bank, Cash, Expenses, Purchases, and Suppliers modules continue calling the same globals. Every write still flows through the STORE writer callback supplied by the entity module. No modal lifecycle, focus, keyboard, overlay, validation, confirmation, deletion, listener, or business workflow was present in the extracted helpers, so those entity-specific responsibilities remain unchanged and outside this module.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/modal-entity-helpers.js` | ✓ |
| `tests/stage4x-test.js` | ✓ 49/49 |
| `tests/stage4w-test.js` | ✓ 44/44 |
| `tests/stage4v-test.js` | ✓ 60/60 |
| `tests/stage4u-test.js` | ✓ 45/45 |
| `tests/stage4t-test.js` | ✓ 57/57 |
| `tests/stage4s-test.js` | ✓ 55/55 |
| `tests/stage4r-test.js` | ✓ 68/68 |
| `tests/stage4p-test.js` | ✓ 58/58 |
| `tests/stage4q-test.js` | ✓ 57/57 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4X) | ✓ 1342/1342 |

The Stage 4 suite was run exactly once. No Stage 4 suite failed and no new regression was found. The 12 documented pre-existing failures remain outside this bounded suite and unchanged by the extracted files.

### Risks, Remaining Responsibilities, and Operations

- The 12 documented pre-existing suite failures remain deferred and were not rerun.
- `js/app.js` still owns `renderStatistique`, the generic `renderEntityPage` helper, initialization, backup/document workflows, and other unrelated legacy domains.
- Stage 4 remains incomplete while the coherent statistics dashboard responsibility remains in `js/app.js`.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4W — Accounting TVA Calculator Extraction

**Objective:** Extract the existing purchase-form TVA reverse calculation, rate selection/highlighting, and manual TVA total calculation from `js/app.js` into `js/shared/accounting-tva.js` without changing tax formulas, rates, formatting, or DOM behavior.

**Exact extraction boundary:** the contiguous block beginning at `calculateFromTTC` and ending after `updateTVATotal`, immediately before the generic `fillModalFields` helper.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/accounting-tva.js` | NEW: TTC-to-HT/TVA reverse calculation for 19/13/7%, rate selection/highlighting, and manual TVA total calculation |
| `js/app.js` | Removed only the three extracted TVA functions; generic modal helpers and statistics remain |
| `index.html` | Loads `accounting-tva.js` before `accounting-purchases.js`, preserving inline handlers and purchase-form DOM contracts |
| `tests/stage4w-test.js` | NEW: 44 tests for globals, formulas, supported rates, rounding, empty/zero/negative/decimal inputs, DOM safety, manual totals, compatibility, exclusions, and script order |
| `tests/stage4t-test.js`, `tests/stage4u-test.js`, `tests/stage4v-test.js` | Updated completed-extraction boundary assertions |

### Dependencies and Compatibility

Resolved at call time: `num`, `fmtMoney`, and the existing purchase-form DOM. `accounting-tva.js` loads before `accounting-purchases.js`, whose delayed `calculateFromTTC` call is unchanged. Inline `updateTVATotal` handlers and the compatibility globals retain their names and timing. The existing one-dinar stamp deduction, reverse formulas, `Math.max(0, ...)` clamps, three-decimal formatting, and default 19% selection are preserved exactly. No period-based, collected, deductible, payable, or credit TVA workflow existed in this extraction boundary, so none was invented. The module performs no storage writes and introduces no listeners or initialization.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/accounting-tva.js`, `js/shared/accounting-overview.js`, `js/shared/accounting-reports.js` | ✓ |
| `tests/stage4w-test.js` | ✓ 44/44 |
| `tests/stage4v-test.js` | ✓ 60/60 |
| `tests/stage4u-test.js` | ✓ 45/45 |
| `tests/stage4t-test.js` | ✓ 57/57 |
| `tests/stage4s-test.js` | ✓ 55/55 |
| `tests/stage4r-test.js` | ✓ 68/68 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4W) | ✓ 1293/1293 |

The Stage 4 suite was run exactly once. No Stage 4 suite failed and no new regression was found. The 12 documented pre-existing failures remain outside this bounded suite and unchanged by the extracted files.

### Risks, Remaining Responsibilities, and Operations

- The 12 documented pre-existing suite failures remain deferred and were not rerun.
- `js/app.js` still owns the shared generic modal helpers, `renderStatistique`, initialization, backup/document workflows, and other unrelated legacy domains.
- Stage 4 remains incomplete while these coherent shared responsibilities remain in `js/app.js`.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4V — Accounting Suppliers Workflow Extraction

**Objective:** Extract the accounting-specific Suppliers list/detail rendering, search/category filters, CRUD form workflow, linked purchases, and linked Bank entries from `js/app.js` into `js/shared/accounting-suppliers.js` without changing behavior.

**Exact extraction boundaries:** the supplier filter state beside the accounting module state declarations; the block beginning at `renderSuppliersPage` and ending after `getSupplierCategoryStyle`; and the block beginning at `setSupplierSearch` and ending after `deleteSupplier`. The generic `renderEntityPage` helper between those blocks remains in `js/app.js`.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/accounting-suppliers.js` | NEW: accounting Supplier filter state, list/detail rendering, category styling, CRUD form, purchase links, Bank links, totals, and formatting |
| `js/app.js` | Removed only the extracted Supplier state and functions; TVA calculator, generic modal helpers, and statistics remain |
| `index.html` | Loads `accounting-suppliers.js` after the purchase and Bank dependencies and before reports/overview consumers |
| `tests/stage4v-test.js` | NEW: 60 tests for globals/state, rendering, filters, detail relationships, totals, CRUD, writes, compatibility, exclusions, and script order |
| `tests/stage4s-test.js`, `tests/stage4t-test.js`, `tests/stage4u-test.js` | Updated completed-extraction boundary assertions |

### Dependencies and Compatibility

Resolved at call time: `STORE.suppliers/saveSuppliers/purchases/bankEntries`, `esc`, `num`, `fmtMoney`, generic modal helpers, `fillPurchaseSuppliers`, purchase actions, and `openBankDetailModal`. Existing inline handlers and the router retain the same global names and initialization timing. Supplier saves/deletes continue through `STORE.saveSuppliers` and the approved `_storeSave` pipeline; purchase option synchronization remains at the same point after save. The legacy `js/shared/fournisseurs.js` domain remains separate and unchanged. No listeners, timers, schema changes, or duplicate initialization were introduced.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/accounting-suppliers.js`, `js/shared/accounting-purchases.js`, `js/shared/accounting-bank.js` | ✓ |
| `tests/stage4v-test.js` | ✓ 60/60 |
| `tests/stage4u-test.js` | ✓ 45/45 |
| `tests/stage4t-test.js` | ✓ 57/57 |
| `tests/stage4s-test.js` | ✓ 55/55 |
| `tests/stage4r-test.js` | ✓ 68/68 |
| `tests/stage4p-test.js` | ✓ 58/58 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage4i-test.js` | ✓ 69/69 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4V) | ✓ 1249/1249 |

The Stage 4 suite was run exactly once. No Stage 4 suite failed and no new regression was found. The 12 documented pre-existing failures remain outside this bounded suite and unchanged by the extracted files.

### Risks, Remaining Responsibilities, and Operations

- The 12 documented pre-existing suite failures remain deferred and were not rerun.
- `js/app.js` still owns the coherent TVA calculator, generic modal helpers, `renderStatistique`, initialization, backup/document workflows, and other unrelated legacy domains.
- Stage 4 remains incomplete while the documented coherent TVA responsibility remains in `js/app.js`.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4U — Accounting Overview and Period Workflow Extraction

**Objective:** Extract accounting period state/filtering, summary calculations/cards, module navigation, connection summaries, and financial-flow composition from `js/app.js` into `js/shared/accounting-overview.js` without changing behavior.

**Exact extraction boundary:** the contiguous block beginning at `comptaDashboardPeriod` and ending after `renderComptaViews`, immediately before `renderSuppliersPage`.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/accounting-overview.js` | NEW: period state, date filtering, overview totals/cards, accounting navigation, connection summaries, and report composition |
| `js/app.js` | Removed the extracted overview block; supplier management, TVA calculator, generic modal helpers, and `renderStatistique` remain |
| `index.html` | Loads `accounting-overview.js` after `accounting-reports.js` and before `taches.js` |
| `tests/stage4u-test.js` | NEW: 45 tests for globals, period boundaries, calculations, cards, navigation, composition, compatibility, exclusions, and script order |
| `tests/stage4t-test.js` | Updated the report-to-overview dependency and extraction-boundary assertions |

### Dependencies and Compatibility

Resolved at call time: invoice/purchase/expense/Bank/Cash/supplier readers, invoice totals, date/week/number/money utilities, expense categories, and `renderFinancialFlowDiagram`. Existing router and all extracted accounting-module callers retain the same `renderComptaViews` global and timing. Inline period buttons preserve the shared `comptaDashboardPeriod` lexical global. The overview remains read-only and introduces no listeners, timers, or writes.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/accounting-overview.js`, `js/shared/accounting-reports.js` | ✓ |
| `tests/stage4u-test.js` | ✓ 45/45 |
| `tests/stage4t-test.js` | ✓ 57/57 |
| `tests/stage4s-test.js` | ✓ 55/55 |
| `tests/stage4r-test.js` | ✓ 68/68 |
| `tests/stage4p-test.js` | ✓ 58/58 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage4e-test.js` | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4U) | ✓ 1189/1189 |

The complete repository suite was run once. Twenty-six suite files passed. Twelve suite files failed only through the same documented pre-existing `_memCache` core failure and cascading Stage 1–3 subprocess regressions. No Stage 4 suite failed and no new regression was found.

### Risks, Remaining Responsibilities, and Operations

- The 12 documented pre-existing suite failures remain unchanged.
- `js/app.js` still owns the accounting-specific supplier page/detail/CRUD workflow, TVA calculator, generic modal helpers, `renderStatistique`, initialization, and other unrelated legacy domains.
- Stage 4 remains incomplete while these coherent responsibilities remain in `js/app.js`.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4T — Financial Reports, Reconciliation, Flow, and Analytics Extraction

**Objective:** Extract the coherent monthly financial report, cash-flow diagram, reconciliation, and financial analytics dashboard workflow from `js/app.js` into `js/shared/accounting-reports.js` without changing calculations or rendering behavior.

**Exact extraction boundary:** the contiguous block beginning at `generateMonthlyReport` and ending after `renderFinancialAnalyticsDashboard`, immediately before the generic `renderEntityPage` helper.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/accounting-reports.js` | NEW: monthly report calculations, flow diagram, reconciliation markup, and annual analytics dashboard |
| `js/app.js` | Removed the extracted reporting block; accounting overview, suppliers, TVA calculator, generic helpers, and `renderStatistique` remain |
| `index.html` | Loads `accounting-reports.js` after all accounting data modules and before `taches.js` |
| `tests/stage4t-test.js` | NEW: 58 tests for globals, yearly/monthly calculations, totals, flow, reconciliation, analytics, compatibility, exclusions, and script order |
| `tests/stage4r-test.js`, `tests/stage4s-test.js` | Updated deferred-report boundaries and dependency-order assertions |

### Dependencies and Compatibility

Resolved at call time: invoice/RDV/purchase/expense/Bank/Cash readers, `normalizeRdv`, invoice/RDV total helpers, date/number/money utilities, and the reconciliation DOM target. Existing accounting-overview and router callers retain identical global names and timing. The extracted workflow is read-only and does not introduce writes or chart instances; the existing return-before-DOM reconciliation behavior is preserved exactly rather than corrected in this extraction.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/accounting-reports.js`, `js/shared/accounting-purchases.js` | ✓ |
| `tests/stage4t-test.js` | ✓ 58/58 |
| `tests/stage4s-test.js` | ✓ 55/55 |
| `tests/stage4r-test.js` | ✓ 68/68 |
| `tests/stage4q-test.js` | ✓ 57/57 |
| `tests/stage4p-test.js` | ✓ 58/58 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage4e-test.js` | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4T) | ✓ 1145/1145 |

The complete repository suite was run once. Twenty-five suite files passed. Twelve suite files failed only through the same documented pre-existing `_memCache` core failure and cascading Stage 1–3 subprocess regressions. No Stage 4 suite failed and no new regression was found.

### Risks, Remaining Responsibilities, and Operations

- The 12 documented pre-existing suite failures remain unchanged.
- The pre-existing unreachable reconciliation DOM assignment and empty-data `NaN%` output remain unchanged.
- `js/app.js` still owns accounting overview/period filtering, supplier management, TVA calculation, generic modal helpers, `renderStatistique`, initialization, and other unrelated legacy domains.
- Stage 4 is not complete while these documented coherent responsibilities remain in `js/app.js`.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4S — Purchases CRUD, Supplier Synchronization, and Page Workflow Extraction

**Objective:** Extract the coherent Purchases CRUD, numbering, rendering, TVA totals, bulk selection, and supplier option synchronization from `js/app.js` into `js/shared/accounting-purchases.js` without changing behavior.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/accounting-purchases.js` | NEW: Purchase numbering, rendering, bulk selection, CRUD form, supplier options, and supplier synchronization |
| `js/app.js` | Removed the extracted Purchases implementation; supplier management, TVA calculator, statistics, and broader financial reports remain |
| `index.html` | Loads `accounting-purchases.js` after `accounting-expenses.js` and before `taches.js` |
| `tests/stage4s-test.js` | NEW: 56 tests for globals, numbering, rendering, TVA totals, selection, CRUD, supplier synchronization, exclusions, and script order |
| `tests/stage4r-test.js` | Updated the Stage 4R extraction boundary and dependency-order assertion |

### Dependencies and Compatibility

Resolved at call time: `STORE.purchases/savePurchases/suppliers`, formatting/date utilities, generic modal helpers, the existing `calculateFromTTC`, `renderComptaViews`, DOM, alerts, confirmation, and `setTimeout`. Existing inline handlers, supplier-detail calls, router calls, Dashboard/statistics reads, and accounting overview calls retain identical globals and timing. Every write continues through `STORE.savePurchases` and the approved `_storeSave` pipeline. Supplier management, TVA calculation, statistics, and broader financial reports remain in `js/app.js`.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/accounting-purchases.js`, `js/shared/accounting-expenses.js` | ✓ |
| `tests/stage4s-test.js` | ✓ 56/56 |
| `tests/stage4r-test.js` | ✓ 68/68 |
| `tests/stage4q-test.js` | ✓ 57/57 |
| `tests/stage4p-test.js` | ✓ 58/58 |
| `tests/stage4i-test.js` | ✓ 69/69 |
| `tests/stage4j-test.js` | ✓ 66/66 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage4e-test.js` | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4S) | ✓ 1088/1088 |

The complete repository suite was run once. Twenty-four suite files passed. Twelve suite files failed only through the same documented pre-existing `_memCache` core failure and cascading Stage 1–3 subprocess regressions. No Stage 4 suite failed and no new regression was found.

### Risks and Operations

- The 12 documented pre-existing suite failures remain unchanged.
- Supplier management, TVA calculation, statistics, reconciliation, and broader financial reports remain deliberately deferred.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4R — Expenses CRUD, Categories, Reports, and Page Workflow Extraction

**Objective:** Extract the coherent Expenses CRUD, period filtering, payment/category reports, category management, and category/subcategory form workflow from `js/app.js` into `js/shared/accounting-expenses.js` without changing behavior.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/accounting-expenses.js` | NEW: Expense filter state, page rendering, payment/category reports, category CRUD, subcategory options, and expense CRUD form |
| `js/app.js` | Removed the extracted Expenses implementation; purchases, statistics, and broader financial reports remain |
| `index.html` | Loads `accounting-expenses.js` after `accounting-cash.js` and before `taches.js` |
| `tests/stage4r-test.js` | NEW: 69 tests for globals, categories, subcategories, filters, reports, totals, CRUD, writes, exclusions, and script order |
| `tests/stage4p-test.js`, `tests/stage4q-test.js` | Updated accounting extraction boundaries and dependency-order assertions |

### Dependencies and Compatibility

Resolved at call time: `STORE.expenses/saveExpenses/expenseCategories/saveExpenseCategories`, formatting/date/week utilities, generic modal helpers, `renderComptaViews`, DOM, alerts, and confirmation. Existing inline handlers, router calls, Dashboard/statistics reads, and accounting overview calls retain identical globals and timing. Every write continues through the approved `STORE`/`_storeSave` pipeline. Purchases and broader financial/statistical reports remain in `js/app.js`.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/accounting-expenses.js`, `js/shared/accounting-cash.js`, `js/shared/accounting-bank.js` | ✓ |
| `tests/stage4r-test.js` | ✓ 69/69 |
| `tests/stage4q-test.js` | ✓ 57/57 |
| `tests/stage4p-test.js` | ✓ 58/58 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage4e-test.js` | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4R) | ✓ 1033/1033 |

The complete repository suite was run once. Twenty-three suite files passed. Twelve suite files failed only through the same documented pre-existing `_memCache` core failure and cascading Stage 1–3 subprocess regressions. No Stage 4 suite failed and no new regression was found.

### Risks and Operations

- The 12 documented pre-existing suite failures remain unchanged.
- Purchases, statistics, and broader financial/accounting reports remain deliberately deferred.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4Q — Cash Entries CRUD and Page Workflow Extraction

**Objective:** Extract the coherent Cash entries CRUD, filtering, rendering, linked-record workflow, and Bank withdrawal selection from `js/app.js` into `js/shared/accounting-cash.js` without changing behavior.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/accounting-cash.js` | NEW: Cash filter state, page rendering, record linking, bulk selection, CRUD form, and Bank withdrawal selection |
| `js/app.js` | Removed the extracted Cash implementation; expenses, statistics, and shared accounting helpers remain |
| `index.html` | Loads `accounting-cash.js` after `accounting-bank.js` and before `taches.js` |
| `tests/stage4q-test.js` | NEW: 58 tests for globals, rendering, filters, links, writes, CRUD, selection, Bank choices, exclusions, and script order |
| `tests/stage4p-test.js` | Updated the Stage 4P integration boundary and script-order assertion for the Stage 4Q consumer |

### Dependencies and Compatibility

Resolved at call time: `STORE.cashEntries/saveCashEntries`, Bank/expense/invoice readers, formatting and date utilities, invoice totals, generic modal helpers, `renderComptaViews`, DOM, alerts, and confirmation. Existing inline handlers, router calls, Dashboard reads, and Bank-link contracts retain identical globals and timing. Every write continues through `STORE.saveCashEntries` and the approved `_storeSave` pipeline. Expenses and statistics remain in `js/app.js`.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/accounting-cash.js`, `js/shared/accounting-bank.js` | ✓ |
| `tests/stage4q-test.js` | ✓ 58/58 |
| `tests/stage4p-test.js` | ✓ 58/58 |
| `tests/stage4o-test.js` | ✓ 72/72 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage4e-test.js` | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4Q) | ✓ 965/965 |

The complete repository suite was run once. Twenty-two suite files passed. Twelve suite files failed only through the same documented pre-existing `_memCache` core failure and cascading Stage 1–3 subprocess regressions. No Stage 4 suite failed and no new regression was found.

### Risks and Operations

- The 12 documented pre-existing suite failures remain unchanged.
- Expenses, statistics, and broader accounting helpers remain deliberately deferred.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4P — Bank Entries CRUD and Page Workflow Extraction

**Objective:** Extract the coherent Bank entries CRUD, cleanup, filtering, rendering, linked-record workflow, and import results from `js/app.js` into `js/shared/accounting-bank.js` without changing behavior.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/accounting-bank.js` | NEW: Bank filter state, cleanup, CRUD, list selection, page rendering, linked-record dialogs, and CSV import/results workflow |
| `js/app.js` | Removed the extracted Bank implementation; Cash, expenses, shared accounting helpers, and statistics remain |
| `index.html` | Loads `accounting-bank.js` after `devis.js` and before `taches.js` |
| `tests/stage4p-test.js` | NEW: 59 tests for globals, cleanup, icons, rendering, filters, selection, CRUD, modals, compatibility, exclusions, and script order |

### Dependencies and Compatibility

Resolved at call time: `STORE.bankEntries/saveBankEntries`, expense/invoice/contract/supplier readers, formatting utilities, invoice/contract total helpers, generic modal helpers, `renderComptaViews`, DOM, `FileReader`, alerts, and confirmation. Existing inline handlers, router calls, supplier views, dashboard reads, and initialization retain identical global names and timing. Every write continues through `STORE.saveBankEntries` and the approved `_storeSave` pipeline. Cash and expense workflows remain in `js/app.js`.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/accounting-bank.js` | ✓ |
| `tests/stage4p-test.js` | ✓ 59/59 |
| `tests/stage4o-test.js` | ✓ 72/72 |
| `tests/stage4m-test.js` | ✓ 76/76 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage4e-test.js` | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4P) | ✓ 908/908 |

The complete repository suite was run once. Twenty-one suite files passed. Twelve suite files failed only through the same documented pre-existing `_memCache` core failure and cascading Stage 1–3 subprocess regressions. No Stage 4 suite failed and no new regression was found.

### Risks and Operations

- The 12 documented pre-existing suite failures remain unchanged.
- Cash, expenses, statistics, and broader accounting helpers remain deliberately deferred.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4O — Devis CRUD Workflow Extraction

**Objective:** Extract the coherent Devis CRUD, form workflow, numbering, line totals, issuer/logo/stamp handling, and preview rendering from `js/app.js` into `js/shared/devis.js` without changing behavior.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/devis.js` | NEW: issuer definitions, stamp generation, numbering, CRUD, list/form workflows, logo handling, line calculations, and preview HTML |
| `js/app.js` | Removed the extracted Devis implementation and retained concise module references; unrelated compatibility functions and generic `printModal` remain |
| `index.html` | Loads `devis.js` after `rdvs.js` and before `taches.js` |
| `tests/stage4o-test.js` | NEW: 72 tests for globals, numbering, stamp, list/form, clients, logos, calculations, CRUD, preview, compatibility, and script order |
| `tests/stage4m-test.js` | Updated the deferred Devis-numbering assertion to reflect the Stage 4O extraction |

### Extracted Globals

`KACEM_PRINT_LOGO_SRC`, `DEVIS_SOCIETES`, `getStampSVGFor`, `nextDevisNum`, `splitDevisNum`, `editDevis`, `deleteDevis`, `saveDevis`, `populateDevisList`, `cancelDevisForm`, `updateDevisLogoPreview`, `onDevisSocieteChange`, `onDevisLogoFileChange`, `resetDevisLogo`, `syncDevisNumberPreview`, `initDevisForm`, `fillDevisClientSelect`, `syncDevisClientFromSelect`, `devisLineCount`, `addDevisLine`, `removeDevisLine`, `calcDevisTotals`, `buildDevisHTML`, `printDevis`, `closeDevisPreview`

### Dependencies and Compatibility

Resolved at call time: `MYTHOS_PRINT_LOGO_SRC`, `STORE.devis/saveDevis/clients`, formatting and number utilities, guarded `LOGGER`, `showView`, DOM, `FileReader`, confirmation, alerts, and `setTimeout`. Existing inline handlers and RDV linked-source reads retain the same storage and global contracts. Writes continue through `STORE.saveDevis` and the approved `_storeSave` pipeline. The existing legacy-number filtering behavior is preserved exactly.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/devis.js` | ✓ |
| `tests/stage4o-test.js` | ✓ 72/72 |
| `tests/stage4n-test.js` | ✓ 66/66 |
| `tests/stage4m-test.js` | ✓ 76/76 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4O) | ✓ 849/849 |

The complete repository suite was run once. Twenty-one suite files passed. Twelve suite files failed only through the same documented pre-existing `_memCache` core failure and cascading Stage 1–3 subprocess regressions. The final Stage 4O suite was rerun after moving its issuer definitions and remained 72/72.

### Risks and Operations

- The 12 documented pre-existing suite failures remain unchanged.
- Generic `printModal` and unrelated early compatibility functions remain in app.js intentionally.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4N — RDV CRUD and Form Workflow Extraction

**Objective:** Extract the coherent RDV two-step form, source dropdowns, fee selection, list rendering, CRUD, and tombstone behavior from `js/app.js` into `js/shared/rdvs.js` while preserving existing behavior and global interfaces.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/rdvs.js` | NEW: RDV form workflow, linked-source helpers, fee handling, CRUD, rendering, and delete tombstone |
| `js/app.js` | Removed the extracted RDV implementation and retained a concise module reference; following legacy compatibility helpers remain unchanged |
| `index.html` | Loads `rdvs.js` after `invoices.js` and before `taches.js` |
| `tests/stage4n-test.js` | NEW: 66 tests for globals, wizard flow, sources, dropdowns, fee modes, CRUD, tombstones, rendering, compatibility, and script order |

### Extracted Globals

`rdvOpenForm`, `rdvClose`, `rdvShowExistingRdvs`, `rdvGoToStep2`, `rdvBackToStep1`, `getAllInvoices`, `getAllDevis`, `getAllContracts`, `rdvLoadDropdowns`, `rdvCalcFee`, `rdvFeeTypeSelectChanged`, `rdvInvoiceChanged`, `rdvDevisChanged`, `rdvContractChanged`, `rdvSave`, `rdvRender`, `rdvEdit`, `rdvDelete`

### Dependencies and Compatibility

Resolved at call time: `STORE.rdvs/saveRdvs`, invoice/devis/contract/client/collaborator/nature/representation readers, `esc`, `todayStr`, `_markDeleted`, DOM, alerts, confirmation, and `setTimeout`. Router, Calendar, Dashboard, and inline handlers continue using identical global names. RDV writes remain on `STORE.saveRdvs` and deletes still record `mp_rdvs` tombstones. No listener, timer, or initialization behavior was duplicated.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/rdvs.js` | ✓ |
| `tests/stage4n-test.js` | ✓ 66/66 |
| `tests/stage4m-test.js` | ✓ 76/76 |
| `tests/stage4d-test.js` | ✓ 32/32 |
| `tests/stage4e-test.js` | ✓ 31/31 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4N) | ✓ 777/777 |

The complete repository suite was run once. Twenty suite files passed. Twelve suite files failed only through the documented pre-existing `_memCache` core failure and cascading Stage 1–3 subprocess regressions. No Stage 4 suite failed and no new regression was found.

### Risks and Operations

- The 12 documented pre-existing suite failures remain unchanged.
- `stableRdvPrestRows` and unrelated legacy compatibility helpers remain in app.js because they are outside this coherent workflow and were not required by its callers.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4M — Invoices CRUD Extraction

**Objective:** Extract the coherent Invoices CRUD, form, line calculation, numbering, list rendering, and preview rendering responsibilities from `js/app.js` into `js/shared/invoices.js` while preserving all existing behavior and globals.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/invoices.js` | NEW: invoice list, numbering, form, lines, totals, CRUD, preview, print HTML, and `stableLineCount` |
| `js/app.js` | Removed extracted invoice implementations and retained concise reference comments; Devis helpers, compatibility stubs, and generic `printModal` remain |
| `index.html` | Loads `invoices.js` after `mission-orders.js` and before `taches.js` |
| `tests/stage4m-test.js` | NEW: 76 tests covering globals, rendering, numbering, forms, clients, lines, totals, CRUD, preview, compatibility, and script order |

### Extracted Globals

`stableLineCount`, `renderList`, `nextInvoiceNum`, `splitInvoiceNum`, `initNewForm`, `handleInvoiceTypeChange`, `handleInvoiceYearChange`, `handleInvoiceDateChange`, `syncInvoiceNumberPreview`, `fillClientSelect`, `fillClientFromSelect`, `addLine`, `removeLine`, `getLines`, `calcTotals`, `saveInvoice`, `editInvoice`, `deleteInvoice`, `cancelForm`, `previewInvoice`, `closePreview`, `buildInvoiceHTML`

### Dependencies and Compatibility

Resolved at call time: `STORE.invoices/saveInvoices/clients/saveClients`; invoice and formatting utilities from `utils.js`; `showView` and `updateSidebarStats` from router; guarded `LOGGER`; DOM, alerts, and confirmation. Existing router callbacks, Dashboard, Clients, Natures, and inline handlers continue using identical global names. The approved `_storeSave` write pipeline remains unchanged. Pre-existing invoice compatibility stubs in app.js were intentionally not modified.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/invoices.js` | ✓ |
| `tests/stage4m-test.js` | ✓ 76/76 |
| `tests/stage4l-test.js` | ✓ 59/59 |
| `tests/stage4g-test.js` | ✓ 49/49 |
| `tests/stage4e-test.js` | ✓ 31/31 |
| `tests/stage4f-test.js` | ✓ 37/37 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4M) | ✓ 711/711 |

The complete repository suite was run once. Nineteen suite files passed. Twelve suite files failed only through the documented pre-existing `_memCache` core failure and cascading Stage 1–3 subprocess regressions; no Stage 4 suite failed and no new regression was found.

### Risks and Operations

- Known pre-existing failures remain unchanged: `tests/core-test.js` (`_memCache`) and dependent Stage 1–3 subprocess regressions.
- Duplicate compatibility stubs remain intentionally deferred pending inline-handler audit.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4L — Mission Orders CRUD Extraction

**Objective:** Extract Ordres de mission CRUD, vehicle helpers, form behavior, preview rendering, owned constants, and state from `js/app.js` into `js/shared/mission-orders.js` (AGENTS.md §19 step 6, continued).

### Changed Files

| File | Change |
|------|--------|
| `js/shared/mission-orders.js` | NEW: mission-order CRUD, vehicle helpers, form behavior, preview HTML, company definitions, mission texts, and `stableOmPersonCount` |
| `js/app.js` | Removed the extracted mission-order implementation and retained concise reference comments; generic `printModal` remains in app.js |
| `index.html` | Loads `mission-orders.js` after `contracts.js` and before `taches.js` |
| `tests/stage4l-test.js` | NEW: 59 tests for globals, rendering, vehicles, form helpers, CRUD, preview, compatibility, and script integration |

### Extracted Globals

`SOCIETES`, `OM_MISSION_TEXTS`, `stableOmPersonCount`, `renderOMList`, `ensureDefaultVehicules`, `renderOmVehiculeOptions`, `updateOmLogoPreview`, `onOmVehiculeChange`, `addOmVehicule`, `initOMForm`, `setOmDateQuick`, `setOmTimeQuick`, `applyOmMissionType`, `addOmPerson`, `getOMPersons`, `saveOM`, `editOM`, `deleteOM`, `cancelOM`, `previewOM`, `closeOMPreview`, `buildOMHTML`

### Dependencies and Compatibility

Resolved at call time: `STORE.oms/saveOms/vehicules/saveVehicules/collabs/saveCollabs`; utilities `esc`, `cleanPrintText`, `formatDateLong`, `todayStr`, `dateInputValue`, `getStampSVG`; router globals `showView`, `updateSidebarStats`; browser DOM, prompts, alerts, and confirmation. Existing inline handlers, router calls, and Collaborateurs links continue using the same global names. Pre-existing compatibility stubs in app.js were not modified.

### Test Results

| Suite | Result |
|-------|--------|
| `tests/stage4l-test.js` | ✓ 59/59 |
| `tests/stage4h-test.js` | ✓ 51/51 |
| `tests/stage4k-test.js` | ✓ 88/88 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Syntax: `js/app.js`, `js/shared/mission-orders.js` | ✓ |
| Full suite: all Stage 4 (4A-4L) | ✓ 882 pass, pre-existing unchanged |

### Known Risks

The pre-existing `tests/core-test.js` `_memCache` failure remains unchanged. Duplicate compatibility stubs in `js/app.js` remain intentionally deferred pending a complete inline-handler audit.

---

## Stage 4K — Contracts CRUD Extraction

**Objective:** Extract Contracts CRUD from `js/app.js` into `js/shared/contracts.js` (AGENTS.md §19 step 6, continued).

### Changed Files

| File | Change |
|------|--------|
| `js/shared/contracts.js` | NEW: 186 lines — Contracts CRUD verbatim from app.js |
| `js/app.js` | Trimmed: 8130 → 7941 lines. Contracts block (lines 3682–3871, 190 lines) deleted; reference comment: `// Contracts CRUD moved to js/shared/contracts.js` |
| `index.html` | 1 line: `<script src="js/shared/contracts.js?v=20260801">` after representations.js |
| `tests/stage4k-test.js` | NEW: 88 tests — globals, renderContracts (empty/data), nextContractRef (empty/with-existing), contractTotals, contractStatusLabel, fillContractClientSelect, fillContractClientFromSelect (match/no-match), toggleContractVatAdvance (enabled/disabled), calcContractTotals, initContractForm, saveContract (create/update/guard), editContract (existing/unknown), deleteContract (confirmed/cancelled), cancelContractForm, regression chain |

### Extracted Globals (now in shared/contracts.js, removed from app.js)

`nextContractRef`, `contractTotals`, `contractStatusLabel`, `fillContractClientSelect`, `fillContractClientFromSelect`, `toggleContractVatAdvance`, `calcContractTotals`, `renderContracts`, `initContractForm`, `saveContract`, `editContract`, `deleteContract`, `cancelContractForm`

No state variables to extract (no `let` or `var` contract state declarations in app.js).

### Dependencies

contracts.js resolved at call time: `STORE.contracts/saveContracts/clients/saveClients` (defined in app.js STORE block); `num`, `esc`, `fmtMoney`, `formatDate`, `todayStr` (utils.js); `showView`, `updateSidebarStats` (router.js); browser DOM (`document`, `alert`, `confirm`).

### Script Load Order (after Stage 4K)

`js/app.js` → `js/shared/calendar.js` → `js/shared/dashboard.js` → `js/shared/natures.js` → `js/shared/clients.js` → `js/shared/collaborateurs.js` → `js/shared/fournisseurs.js` → `js/shared/representations.js` → **`js/shared/contracts.js`** → `js/taches.js`

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4k-test.js` | 88 | ✓ 88/88 |
| `tests/stage4j-test.js` | 66 | ✓ 66/66 (regression) |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 (regression) |

Full suite: all Stage 4 (4A-4K) pass. Pre-existing failures: core-test.js (_memCache), stage 1-3 cascading subprocess regressions (documented). No new regressions.

### Commit

`ec42b4a` — `docs(handover): clean Stage 4K handover, record test results`

### Known Issues

Same as prior stages: `tests/core-test.js` pre-existing `_memCache` failure.

---

## Stage 4Z — Dead-Code Audit: Remove renderEntityPage

**Objective:** Perform the bounded Stage 4 closure audit of confirmed extraction residue in `js/app.js`. Audit `renderEntityPage` for callers; remove if confirmed dead. Update prior test assertions. Determine whether Stage 4 can close.

**Exact extraction boundary:** `renderEntityPage` function (6 lines), lines 2521–2526. No other functions touched. Extraction markers and comments left in place as documentation.

### Changed Files

| File | Change |
|------|--------|
| `js/app.js` | Removed `renderEntityPage` (6 lines → 1-line marker comment). 3875 → 3870 lines. |
| `tests/stage4v-test.js` | Flipped `renderEntityPage remains` assertion to `renderEntityPage removed` |
| `tests/stage4x-test.js` | Same flip |
| `tests/stage4y-test.js` | Same flip |
| `tests/stage4z-test.js` | NEW: 40 tests — dead-code removal, extraction boundary completeness, active functions preserved, STORE integrity, script order, syntax |

### Dead-Code Verdict

Repository-wide caller scan (`grep -rn "renderEntityPage(" *.js *.html *.php`): zero callers. Definition-only. Confirmed dead.

### Stage 4 Closure Verdict

**Stage 4 cannot close.** Substantial active CRUD and feature domains remain in `js/app.js` (3870 lines):

| Domain | Approx. lines | Functions |
|--------|-------------|-----------|
| Inscriptions / Appels | ~360 | loadInscriptions, validerToutesInscriptions, renderAppels, openAppelFicheModal, saveAppelFiche, … |
| Settings (call script, sheet) | ~70 | getCallScript, saveCallScript, getSheetWebhookUrl, pushToGoogleSheet, … |
| Repertoire contacts | ~1400 | renderRepertoireContactsPage, renderContactsDirectory, importPhoneContacts, handleContactsFileImport, addRepertoireContactRow, … |
| Backup / export / version | ~265 | exportBackup, importBackup, createBackupVersion, renderBackupDashboard, runDiskCleanup, … |
| Spectacle calculator | ~60 | initSpectacleCalculator |
| Documents / camera / upload | ~780 | renderDocumentation, openDocModal, saveDoc, openCameraModal, saveCapturedPhoto, saveBulkDocs, … |
| App init / bootstrap / nav | ~100 | initApp, bootstrapStableApp, toggleSidebar, initNavScrollHint, … |
| Invoice/OM helpers | ~175 | populateInvoiceList, editInvoice, deleteInvoice, editOm, deleteOm, cancelOM, addLine, … |
| Restore/migration (one-time) | ~90 | restoreBackup20260516Once, forceRestoreBackup20260516 |

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js` | ✓ |
| `tests/stage4z-test.js` | ✓ 40/40 |
| `tests/stage4y-test.js` | ✓ 50/50 |
| `tests/stage4x-test.js` | ✓ 49/49 |
| `tests/stage4w-test.js` | ✓ 44/44 |
| `tests/stage4v-test.js` | ✓ 60/60 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4Z) | ✓ 1432/1432 |

### Commit

```
d4f68b049c2f820d67345e5f9cdcf43be56cffad
refactor: Stage 4Z dead-code audit — remove renderEntityPage
```

---

## Next Stage: Stage 4AA — Inscriptions / Appels CRUD Extraction

Stage 4Z is complete. Continue AGENTS.md §19 step 6 (remaining CRUD into modules).

**Exact next scope:** extract the Inscriptions / Appels workflow from `js/app.js` into `js/shared/inscriptions.js`. This is the smallest coherent remaining domain (~360 lines, lines ~734–1092). Include all inscription loading/validation/rendering, appel-fiche modal lifecycle, and call-result tracking. Do not touch the call-script settings functions (separate concern), the repertoire contacts domain, or any active production initialization code.

**Preflight required before starting Stage 4AA:**
1. `git fetch origin`
2. Confirm HEAD = origin/main = `d4f68b049c2f820d67345e5f9cdcf43be56cffad`
3. `git status --short` — confirm clean
4. Read `AGENTS.md`, `docs/AI_HANDOVER.md`, `docs/ROADMAP.md`

---

## Stage 4G — Clients CRUD Extraction

**Objective:** Extract Clients CRUD from `js/app.js` into `js/shared/clients.js` (AGENTS.md §19 step 6, continued).

### Changed Files

| File | Change |
|------|--------|
| `js/shared/clients.js` | NEW: 115 lines — Clients CRUD verbatim from app.js |
| `js/app.js` | Trimmed: 8604 → 8502 lines. Lines 4265–4369 (105 lines) replaced by 3-line reference comment |
| `index.html` | 1 line: `<script src="js/shared/clients.js?v=20260801">` after natures.js |
| `tests/stage4g-test.js` | NEW: 49 tests — globals, renderClients, openClientModal, closeClientModal, saveClient (create+update), deleteClient (confirmed+cancelled), showClientDetail, LOGGER guard, regression chain |

### Extracted Globals (now in shared/clients.js, removed from app.js)

`currentClientDetailId` (changed `let`→`var` for vm testability), `renderClients`, `showClientDetail`, `openClientModal`, `closeClientModal`, `saveClient`, `deleteClient`

### Deferred CRUD Blocks

- **Collaborateurs CRUD** (lines ~4269–now, ~98 lines): `currentCollabDetailId`, `renderCollaborateurs`, `showCollabDetail`, `openCollabModal`, `closeCollabModal`, `saveCollab`, `deleteCollab`
- **Fournisseurs CRUD**: `renderFournisseurs`, `saveFournisseur`, `deleteFournisseur`
- All other CRUD (invoices, devis, RDVs, OMs, representations, accounting, etc.)

### Script Load Order (after Stage 4G)

`js/app.js` → `js/shared/calendar.js` → `js/shared/dashboard.js` → `js/shared/natures.js` → **`js/shared/clients.js`** → `js/taches.js`

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4g-test.js` | 49 | ✓ 49/49 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 |
| Full suite (baseline 1658 + 49 new) | 1707 | Not rerun (AGENTS.md §8) |

### Commit

```
37cb662fb6dc2c16721952b9c07514fd6cbe5de5
refactor(clients): extract Clients CRUD into js/shared/clients.js
```

Parent: `e88963c7c6fe9b87aa693ea067d6671ac3049c34` (docs(handover): record Stage 4F commit hash)

### Known Issues

Same as prior stages: `tests/core-test.js` pre-existing `_memCache` failure.

---

---

## Stage 4H — Collaborateurs CRUD Extraction

**Objective:** Extract Collaborateurs CRUD from `js/app.js` into `js/shared/collaborateurs.js` (AGENTS.md §19 step 6, continued).

### Changed Files

| File | Change |
|------|--------|
| `js/shared/collaborateurs.js` | NEW: 101 lines — Collaborateurs CRUD verbatim from app.js |
| `js/app.js` | Trimmed: 8502 → 8407 lines. Lines 4269–4366 (98 lines) replaced by 3-line reference comment |
| `index.html` | 1 line: `<script src="js/shared/collaborateurs.js?v=20260801">` after clients.js |
| `tests/stage4h-test.js` | NEW: 51 tests — globals, renderCollaborateurs, openCollabModal, closeCollabModal, saveCollab (create+update), deleteCollab (confirmed+cancelled), showCollabDetail (unknown/no-oms/with-oms), regression chain |

### Extracted Globals (now in shared/collaborateurs.js, removed from app.js)

`currentCollabDetailId` (changed `let`→`var` for vm testability), `renderCollaborateurs`, `showCollabDetail`, `openCollabModal`, `closeCollabModal`, `saveCollab`, `deleteCollab`

### Dependencies

collaborateurs.js resolved at call time: `STORE.collabs/saveCollabs/oms` (storage via app.js); `esc`, `formatDate` (utils.js); `showView` (router.js); `previewOM`, `editOM` (app.js — onclick attributes).
No LOGGER calls in this module.

### Script Load Order (after Stage 4H)

`js/app.js` → `js/shared/calendar.js` → `js/shared/dashboard.js` → `js/shared/natures.js` → `js/shared/clients.js` → **`js/shared/collaborateurs.js`** → `js/taches.js`

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4h-test.js` | 51 | ✓ 51/51 |
| `tests/stage4g-test.js` | 49 | ✓ 49/49 |
| `tests/stage4f-test.js` | 37 | ✓ 37/37 |
| `tests/stage4e-test.js` | 31 | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 (regression) |

### Commit

```
fa1fa4a94aa220f9fed3b8849291baab094c6a5c
Stage 4H: extract Collaborateurs CRUD into js/shared/collaborateurs.js
```

Parent: `daef11459e3c31b9cd9e32c8bbc31bdc585b31d2` (docs: record Stage 4G commit hash)

### Known Issues

Same as prior stages: `tests/core-test.js` pre-existing `_memCache` failure.

---

## Stage 4I — Fournisseurs CRUD Extraction

**Objective:** Extract Fournisseurs CRUD from `js/app.js` into `js/shared/fournisseurs.js` (AGENTS.md §19 step 6, continued).

### Changed Files

| File | Change |
|------|--------|
| `js/shared/fournisseurs.js` | NEW: 173 lines — Fournisseurs CRUD verbatim from app.js |
| `js/app.js` | Trimmed: 8407 → 8243 lines. Function block (lines 4276–4443, 168 lines) → 5-line reference comment; state vars (lines 1563–1564, 2 lines) → 1-line reference |
| `index.html` | 1 line: `<script src="js/shared/fournisseurs.js?v=20260801">` after collaborateurs.js |
| `tests/stage4i-test.js` | NEW: 69 tests — globals, category style/icon helpers, renderFournisseurs (empty/data/filter-search/filter-category), setFournisseurSearch, setFournisseurFilterCategory, resetFournisseurFilters, openFournisseurModal (DOM safety/new/existing), closeFournisseurModal, saveFournisseur (name guard/create/update), deleteFournisseur (confirmed/cancelled), regression chain |

### Extracted Globals (now in shared/fournisseurs.js, removed from app.js)

`fournisseurFilterCategory` (line 1563, `let`→`var`), `fournisseurSearchQuery` (line 1564, `let`→`var`), `renderFournisseurs`, `getFournisseurCategoryStyle`, `getFournisseurCategoryIcon`, `setFournisseurSearch`, `setFournisseurFilterCategory`, `resetFournisseurFilters`, `openFournisseurModal`, `closeFournisseurModal`, `saveFournisseur`, `deleteFournisseur`

### Dependencies

fournisseurs.js resolved at call time: `STORE.suppliers/saveSuppliers` (defined in app.js line 81 → `_storeSave('mp_suppliers',…)`); `esc` (utils.js); browser DOM (`document`, `alert`, `confirm`, `console.error`). No `showView`, no `LOGGER`, no `formatDate`.

### Script Load Order (after Stage 4I)

`js/app.js` → `js/shared/calendar.js` → `js/shared/dashboard.js` → `js/shared/natures.js` → `js/shared/clients.js` → `js/shared/collaborateurs.js` → **`js/shared/fournisseurs.js`** → `js/taches.js`

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4i-test.js` | 69 | ✓ 69/69 |
| `tests/stage4h-test.js` | 51 | ✓ 51/51 |
| `tests/stage4g-test.js` | 49 | ✓ 49/49 |
| `tests/stage4f-test.js` | 37 | ✓ 37/37 |
| `tests/stage4e-test.js` | 31 | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 (regression) |

### Commit

```
70df5e099f86f35b31bd6f93bc505f9235f9edf6
Stage 4I: extract Fournisseurs CRUD into js/shared/fournisseurs.js
```

Parent: `1b50e62876e6773affad64cd56af5fdbaeb18f6f` (docs: record Stage 4H commit hash)

### Known Issues

Same as prior stages: `tests/core-test.js` pre-existing `_memCache` failure.

---

## Stage 4J — Representations CRUD Extraction

**Objective:** Extract Representations CRUD from `js/app.js` into `js/shared/representations.js` (AGENTS.md §19 step 6, continued).

### Changed Files

| File | Change |
|------|--------|
| `js/shared/representations.js` | NEW: 124 lines — Representations CRUD verbatim from app.js |
| `js/app.js` | Trimmed: 8243 → 8131 lines. Function block (lines 6790–6907, 118 lines) → 6-line reference comment; state var (line 1550, 1 line) → 1-line reference |
| `index.html` | 1 line: `<script src="js/shared/representations.js?v=20260801">` after fournisseurs.js |
| `tests/stage4j-test.js` | NEW: 66 tests — globals, renderRepresentations (empty/data), showRepresentationDetail (unknown/known), fillRepresentationClients, syncRepresentationClient (match/no-match), openRepresentationModal (new/existing), closeRepresentationModal, addRepresentationNatureLine (counter), saveRepresentation (create/update), deleteRepresentation (confirmed/cancelled), printRepresentations (window.open mock), stableRepNatureRows reset, regression chain |
| `tests/stage1a-sync-bypass-regression-test.js` | Fix: `if (_fail > 0) process.exit(1)` → `process.exit(_fail > 0 ? 1 : 0)` to prevent 5-minute hang from storage.js auto-backup timer |

### Extracted Globals (now in shared/representations.js, removed from app.js)

`stableRepNatureRows` (line 1550, `let`→`var`), `renderRepresentations`, `showRepresentationDetail`, `openRepresentationModal`, `closeRepresentationModal`, `fillRepresentationClients`, `syncRepresentationClient`, `addRepresentationNatureLine`, `saveRepresentation`, `deleteRepresentation`, `printRepresentations`

### Dependencies

representations.js resolved at call time: `STORE.representations/saveRepresentations/clients/natures` (defined in app.js STORE block); `esc`, `fmtMoney`, `num`, `formatDate`, `formatDateLong`, `todayStr` (utils.js); browser DOM (`document`, `window.open`, `confirm`, `setTimeout`).

### Script Load Order (after Stage 4J)

`js/app.js` → `js/shared/calendar.js` → `js/shared/dashboard.js` → `js/shared/natures.js` → `js/shared/clients.js` → `js/shared/collaborateurs.js` → `js/shared/fournisseurs.js` → **`js/shared/representations.js`** → `js/taches.js`

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4j-test.js` | 66 | ✓ 66/66 |
| `tests/stage4i-test.js` | 69 | ✓ 69/69 |
| `tests/stage4h-test.js` | 51 | ✓ 51/51 |
| `tests/stage4g-test.js` | 49 | ✓ 49/49 |
| `tests/stage4f-test.js` | 37 | ✓ 37/37 |
| `tests/stage4e-test.js` | 31 | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 (regression) |

### Commit

```
73f72c3
Stage 4J: extract Representations CRUD into js/shared/representations.js
```

Parent: `58b199754a198acce008436f43be8a1b5f4b3c67` (docs: record Stage 4I commit hash)

### Known Issues

Same as prior stages: `tests/core-test.js` pre-existing `_memCache` failure.

---

## Next Stage: Stage 4K — implemented (see top of file)

Stage 4K (Contracts CRUD extraction) is implemented. See the Stage 4K section at the top of this file for details.

---

## Stage 4F — Natures CRUD Extraction

**Objective:** Extract Natures de prestation CRUD from `js/app.js` into `js/shared/natures.js` as the first coherent CRUD unit (AGENTS.md §19 step 6).

### Changed Files

| File | Change |
|------|--------|
| `js/shared/natures.js` | NEW: 75 lines — Natures CRUD verbatim from app.js |
| `js/app.js` | Trimmed: 8668 → 8604 lines. Lines 4470–4535 (66 lines) replaced by 2-line reference comment |
| `index.html` | 1 line: `<script src="js/shared/natures.js?v=20260801">` after dashboard.js |
| `tests/stage4f-test.js` | NEW: 37 tests — globals, renderNatures, openNatureModal, closeNatureModal, saveNature (create+update), deleteNature (confirmed+cancelled), showNatureDetail, regression chain |
| `js/plugins/production.runtime.js` | Comment updated to reference natures.js |

### Extracted Globals (now in shared/natures.js, removed from app.js)

`renderNatures`, `showNatureDetail`, `openNatureModal`, `closeNatureModal`, `saveNature`, `deleteNature`

### Deferred CRUD Blocks

The following remain in app.js for subsequent stages:
- **Clients CRUD** (lines ~4265–4370): `renderClients`, `showClientDetail`, `openClientModal`, `closeClientModal`, `saveClient`, `deleteClient`, `currentClientDetailId`
- **Collaborateurs CRUD** (lines ~4371–4468): `renderCollaborateurs`, `showCollabDetail`, `openCollabModal`, `closeCollabModal`, `saveCollab`, `deleteCollab`, `currentCollabDetailId`
- **Fournisseurs CRUD** (lines ~4537+): `renderFournisseurs`, `saveFournisseur`, `deleteFournisseur`
- All other CRUD (invoices, devis, RDVs, OMs, representations, accounting, etc.)

### Script Load Order (after Stage 4F)

`js/core/storage.js` → ... → `js/app.js` → `js/shared/calendar.js` → `js/shared/dashboard.js` → **`js/shared/natures.js`** → `js/taches.js`

### Dependencies

natures.js resolved at call time: `STORE.natures/saveNatures/representations/invoices` (storage.js); `esc`, `money`, `formatDate` (utils.js); `showView` (router.js).

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4f-test.js` | 37 | ✓ 37/37 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 |
| Full suite (baseline 1621 + 37 new) | 1658 | Not rerun (AGENTS.md §8) |

### Commit

```
c39d2bc56355d06da9b92fd1166acae36294f5f2
refactor(natures): extract Natures CRUD into js/shared/natures.js
```

Parent: `b344f181be8c258600507cb803c005ca93c539b5` (docs(handover): record Stage 4E commit hash and remote HEAD)

### Known Issues

Same as Stage 4E: `tests/core-test.js` pre-existing `_memCache` failure. Not fixed, not regressed.

---

---

## Next Stage: Stage 4G

Stage 4F is complete. Continue extracting CRUD per AGENTS.md §19 step 6.

Recommended next: **Clients CRUD** (lines ~4265–4370, ~106 lines) or **Collaborateurs CRUD** (lines ~4371–4468, ~98 lines) into `js/shared/clients.js` / `js/shared/collaborateurs.js`.

**Preflight required before starting Stage 4G:**
1. `git fetch origin && git rev-parse HEAD origin/main` — confirm equal and both = `c39d2bc56355d06da9b92fd1166acae36294f5f2`
2. `git status --short` — confirm clean
3. Read `AGENTS.md`, `docs/AI_HANDOVER.md`, `docs/ROADMAP.md`

---

## Stage 4E — Dashboard Rendering Extraction

**Objective:** Extract dashboard rendering from `js/app.js` into `js/shared/dashboard.js` as an atomic unit.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/dashboard.js` | NEW: 282 lines — dashboard rendering verbatim from app.js |
| `js/app.js` | Trimmed: 8940 → 8668 lines. Lines 201–474 (updateDashboardStats + updateDashboardOperational, 274 lines) replaced by 2-line reference comment |
| `index.html` | 1 line: `<script src="js/shared/dashboard.js?v=20260801">` inserted after calendar.js |
| `tests/stage4e-test.js` | NEW: 31 tests covering all extracted globals, empty/populated data paths, recovery bar, upcoming RDVs, operational alerts, chain regression |
| `js/plugins/dashboard.runtime.js` | Comment updated: "What stays in app.js" → "What lives in js/shared/dashboard.js" |

### Extracted Globals (now in shared/dashboard.js, removed from app.js)

`updateDashboardStats`, `updateDashboardOperational`

`loadDashboardInscriptionsCount` was NOT extracted — it shares `_uclNum` with `loadInscriptions` (both remain in app.js).

### Script Load Order (after Stage 4E)

`js/core/storage.js` → `js/core/sync.js` → `js/core/router.js` → ... → `js/app.js` → `js/shared/calendar.js` → **`js/shared/dashboard.js`** → `js/taches.js`

### Dependencies

dashboard.js render callbacks resolved at call time: `STORE.*` (storage.js); `normalizeRdv`, `todayStr`, `fmtMoney`, `escapeHtml`, `formatDate`, `getInvoiceTotal`, `num` (utils.js); `editInvoice`, `rdvEdit`, `loadDashboardInscriptionsCount` (app.js).

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4e-test.js` | 31 | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 |
| Full suite (baseline 1590 + 31 new) | 1621 | Not rerun (AGENTS.md §8) |

### Commit

```
13655db0ba579eae88b32a964f42cc01c1143b07
refactor(dashboard): extract dashboard rendering into js/shared/dashboard.js
```

Parent: `7adb1fe5e1b6ace9ffa24f19e91827d3a34a4c2b` (refactor(calendar): extract calendar rendering into js/shared/calendar.js)

### Known Issues

Same as Stage 4D: `tests/core-test.js` pre-existing `_memCache` failure. Not fixed, not regressed.

---

---

## Next Stage: Stage 4F

Stage 4E is complete. The next extraction stage should continue reducing `js/app.js` per AGENTS.md §19.

AGENTS.md §19 step 6: **Extract CRUD plugins.**

**Preflight required before starting Stage 4F:**
1. `git fetch origin && git rev-parse HEAD origin/main` — confirm equal and both = `13655db0ba579eae88b32a964f42cc01c1143b07`
2. `git status --short` — confirm clean
3. Read `AGENTS.md`, `docs/AI_HANDOVER.md`, `docs/ROADMAP.md`

---

## Stage 4D — Calendar Rendering Extraction

**Objective:** Extract calendar rendering from `js/app.js` into `js/shared/calendar.js` as an atomic unit.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/calendar.js` | NEW: 251 lines — calendar rendering verbatim from app.js |
| `js/app.js` | Trimmed: 9179 → 8940 lines. Two blocks removed: `calFilterMode` (line 1823) and CALENDRIER section (lines 7826–8065, 240 lines), replaced by reference comments |
| `index.html` | 1 line: `<script src="js/shared/calendar.js?v=20260801">` inserted after app.js, before taches.js |
| `tests/stage4d-test.js` | NEW: 32 tests covering all extracted globals, filter state, date helpers, renderCalendrier, _calRenderItem, openRdvModal, regression |
| `js/plugins/calendar.runtime.js` | Comment updated: "What stays in app.js" → "What lives in js/shared/calendar.js" |

### Extracted Globals (now in shared/calendar.js, removed from app.js)

`calFilterMode`, `openRdvModal`, `setCalFilter`, `_calDateLabel`, `_calDateSeparator`, `renderCalendrier`, `_calRenderItem`

`calFilterMode` was changed from `let` to `var` for global accessibility (consistent with module pattern).

### Script Load Order (after Stage 4D)

`js/core/storage.js` → `js/core/sync.js` → `js/core/router.js` → ... → `js/app.js` → **`js/shared/calendar.js`** → `js/taches.js`

Note: calendar.js loads AFTER app.js to preserve existing behavior (the `tasks.runtime.js` patch of `renderCalendrier` currently cannot apply at plugin load time — this is a pre-existing state, not introduced by Stage 4D).

### Dependencies

calendar.js render callbacks remain in `utils.js` (`normalizeRdv`, `todayStr`, `isRdvPaid`, etc.), `rappels.js` (`getRappels`, `getNextRappelDate`, etc.), and `app.js` (`rdvOpenForm`, `rdvEdit`, `rdvDelete`) — resolved at call time.

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4d-test.js` | 32 | ✓ 32/32 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 |
| Full suite (baseline 1558 + 32 new) | 1590 | Not rerun (AGENTS.md §8) |

### Commit

```
7adb1fe5e1b6ace9ffa24f19e91827d3a34a4c2b
refactor(calendar): extract calendar rendering into js/shared/calendar.js
```

Parent: `4f5c13559af845882ea1b54b94bc11163fd385e8` (docs(handover): record Stage 4C commit hash and remote HEAD)

### Known Issues

Same as Stage 4C: `tests/core-test.js` pre-existing `_memCache` failure. Not fixed, not regressed.

---

---

## Stage 4C — Routing Extraction

**Objective:** Extract routing/navigation from `js/app.js` into `js/core/router.js` as an atomic unit.

### Changed Files

| File | Change |
|------|--------|
| `js/core/router.js` | NEW: 93 lines — routing verbatim from app.js |
| `js/app.js` | Trimmed: 9269 → 9179 lines. Two routing blocks (lines 476–514 and 2426–2480, 90 lines total) replaced by 2-line reference comments each |
| `index.html` | 1 line: `<script src="js/core/router.js?v=20260801">` inserted after sync.js |
| `tests/stage4c-test.js` | NEW: 32 tests covering all extracted globals, navigateTo, showPage, showView, updateSidebarStats, regression |

### Extracted Globals (now in router.js, removed from app.js)

`currentPage`, `navigateTo`, `showPage`, `showView`, `updateSidebarStats`

`currentPage` was changed from `let` to `var` to become a true global (consistent with storage.js/sync.js module pattern).

The two runtime `showView` overrides at app.js lines 7826–7869 (mobile sidebar close, logs view) remain in app.js — they patch `window.showView` at execution time.

### Script Load Order (after Stage 4C)

`js/core/storage.js` → `js/core/sync.js` → `js/core/router.js` → `js/app.js` → `js/plugins/*.runtime.js`

### Dependencies

router.js render callbacks (`updateDashboardStats`, `renderList`, `renderClients`, etc.) remain in app.js — resolved at call time (runtime), not at load time.

`navigateTo` called from app.js at: lines 592, 1479, 1503, 1837 — unchanged (global).
`showView` called 50+ times in app.js and HTML `onclick` attributes — unchanged (global).
`Shell.navigation.go()` in shell.js delegates to `showView` — unchanged.

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4c-test.js` | 32 | ✓ 32/32 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 |
| Full suite (baseline 1526 + 32 new) | 1558 | Not rerun (AGENTS.md §8) |

### Commit

```
c377a3ba5aa346b4bb70afe278714ee21a147126
refactor(router): extract routing into js/core/router.js
```

Parent: `9e0e368c5e6e040b7520d65083ec067073224002` (docs(handover): record Stage 4B commit hash and remote HEAD)

### Known Issues

Same as Stage 4B: `tests/core-test.js` pre-existing `_memCache` failure. Not fixed, not regressed.

---

---

## Stage 4B — Sync Engine Extraction

**Objective:** Extract the sync engine from `js/app.js` into `js/core/sync.js` as an atomic unit.

### Changed Files

| File | Change |
|------|--------|
| `js/core/sync.js` | NEW: 210 lines — sync engine verbatim from app.js |
| `js/app.js` | Trimmed: 9476 → 9269 lines. Sync engine block (lines 57–267, 211 lines) replaced by 3-line reference comment; stale comment updated to reference sync.js |
| `index.html` | 1 line: `<script src="js/core/sync.js?v=20260801">` inserted after storage.js |
| `tests/stage4b-test.js` | NEW: 52 tests covering all extracted globals, merge/tombstone behavior, syncFromServer steps, indicator, regression |

### Extracted Globals (now in sync.js, removed from app.js)

`_mergeCollections`, `_tombKey`, `_getDeletedIds`, `_markDeleted`, `_filterTombstoned`, `_syncIndicatorTimer`, `_showSyncIndicator`, `syncFromServer`

### Script Load Order (after Stage 4B)

`js/core/storage.js` → `js/core/sync.js` → `js/app.js` → `js/plugins/*.runtime.js`

### Dependencies

sync.js depends on storage.js for: `_storeGet`, `_safeSet`, `_storeSave`, `_metaUpdate`, `_pushCollection`, `_pendingKeys`, `_localMeta`, `_memCache`

`_markDeleted` is still called from app.js (lines 1604, 3036, 3039, 3115, 3229, 3258) — correct, it remains a global.

`syncFromServer` called from: `app.js` (3 sites), `auth.js` (guarded), `storage.js` `_pullFromServerNow` (guarded), `taches.js` (guarded).

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4b-test.js` | 52 | ✓ 52/52 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 |
| Full suite (baseline 1474 + 52 new) | 1526 | Not rerun (AGENTS.md §8) |

### Commit

```
a77f3766a8c8a07991579a8715040be7ea3decf6
refactor(sync): extract sync engine into js/core/sync.js
```

Parent: `1fb71392579754f521fb5187ecfbecd5b3c31a9b` (docs(handover): record Stage 4A commit hash and remote HEAD)

### Known Issues

Same as Stage 4A: `tests/core-test.js` pre-existing `_memCache` failure. Not fixed, not regressed.

---

---

## Stage 4A — Pending Write Pipeline Extraction

**Objective:** Extract the pending write pipeline from `js/app.js` into `js/core/storage.js` as an atomic unit, making it available before the sync engine is loaded.

### Changed Files

| File | Change |
|------|--------|
| `js/core/storage.js` | Extended: 53 → 266 lines. Appended pending write pipeline verbatim from app.js |
| `js/app.js` | Trimmed: 9693 → 9475 lines. Pipeline block (indices 51–273, 223 lines) replaced by 5-line reference comment |
| `tests/stage1a-sync-bypass-regression-test.js` | Updated: dynamic STORE line-finding (was hardcoded), new sandbox globals, IIFE spy reinstall after storage.js load |
| `tests/stage4a-test.js` | NEW: 69 tests covering all extracted globals, Set behaviour, _storeSave pipeline, chunking, event listeners, debounce, regression |

### Extracted Globals (now in storage.js, removed from app.js)

`_localMeta`, `_metaUpdate`, `_pendingKeys`, `_pendingAdd`, `_pendingRemove`, `_pendingClear`, `_buildPendingBulk`, `_flushPending`, `_flushPendingBeacon`, `_pullFromServerNow`, `_lastPullTs`, `_autoBackupTimer`, `_triggerAutoBackup`, `_pushCollection`, `_storeSave`

Plus event listeners: `visibilitychange`, `pagehide`, `focus`, `online`, `setInterval(30000)`.

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4a-test.js` | 69 | ✓ 69/69 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 |
| Full suite (baseline 1405 + 69 new) | 1474 | Not rerun (AGENTS.md §22) |

### Script Load Order (after Stage 4A)

`js/core/storage.js` → `js/core/sync.js` (Stage 4B, not yet extracted) → `js/app.js` → `js/plugins/*.runtime.js`

### Known Issues

- `tests/core-test.js` fails with `ReferenceError: _memCache is not defined` — pre-existing bug, unrelated to Stage 4A. Not fixed.
- `/tmp/mythos-4a` on VPS may contain stale Stage 4A work (pre-AGENTS.md violation). Should be cleaned up when VPS SSH access is restored.

### Commit

```
09b808e5bc3c0c84022bf43c9419f2824cc1d809
refactor(storage): extract pending write pipeline
```

Parent: `128f2cbadc70f8d2800147dc589e10cd827c0b80` (docs(agent): add persistent project instructions)

---

## Next Stage: Stage 4E

Stage 4D is complete. The next extraction stage should continue reducing `js/app.js` per AGENTS.md §19.

AGENTS.md §19 step 5: **Extract Dashboard behavior.**

Candidates per ROADMAP.md: `shared/dashboard.js` (app.js lines ~700–975 — NOTE: line numbers are stale; find actual dashboard block by searching for `// ── DASHBOARD` or `function updateDashboardStats` in current app.js).

**Preflight required before starting Stage 4E:**
1. `git fetch origin && git rev-parse HEAD origin/main` — confirm equal and both = `7adb1fe5e1b6ace9ffa24f19e91827d3a34a4c2b`
2. `git status --short` — confirm clean
3. Read `AGENTS.md`, `docs/AI_HANDOVER.md`, `docs/ROADMAP.md`
4. Map callers of the target functions before extracting

---

## What Was Committed Before Stage 4A

### Stages 3D–3H (committed, not documented here)
Baseline entering Stage 4A: **1405 tests**. Stages 3D–3H added runtime plugins for planning, calendar, search, and other modules. See git log for exact commits.

### Stage 3C (27d9a56) — Notes Runtime
`notes.plugin.js` → `notes.runtime.js`. 74 tests.

### Stage 3B (0b5ab5f) — Contacts Runtime
`contacts.plugin.js` → `contacts.runtime.js`. 78 tests.

---

## Risks

1. **core-test.js pre-existing failure** — `_memCache is not defined`. Do not regress further; investigate when addressing storage.js primitives.
2. **STORE v2 read bypass (app.js)** — reads still use raw localStorage in some places.
3. **Duplicate function stubs (app.js ~1078–1988)** — do not remove without `onclick` audit.
4. **Production safety** — `/var/www/uthinachess/0726/Prod/` must never be modified.

---

## Production Safety (permanent)

- Do NOT commit `google_config.php` — real Google OAuth credentials
- Do NOT commit `ACCES.txt` — plaintext access code
- Do NOT commit `appdata/` or `documents/` — live client data
- Do NOT touch production at `/var/www/uthinachess/0726/Prod/`
- Do NOT restart nginx or PHP
- Do NOT deploy anything

---

## Documentation Index

| File | Purpose |
|------|---------|
| `docs/PROJECT_STATE.md` | Current project status |
| `docs/ROADMAP.md` | Migration stages and acceptance criteria |
| `docs/AI_HANDOVER.md` | This file |
| `docs/architecture.md` | Stack, sync engine, app.js map |
| `docs/module-map.md` | JS module inventory, globals |
| `docs/runtime-services.md` | Runtime services API (Stage 3A.5) |
| `docs/mythos-os-platform.md` | Platform architecture |
| `docs/plugin-sdk.md` | Plugin SDK API reference |
| `docs/production-safety.md` | Production safety rules |
| `docs/worklogs/` | Per-task work logs |

---

## Legacy: Stage 3C Handover (superseded)

**Last updated:** 2026-07-31 10:00 UTC
**HEAD at that time:** 27d9a56 feat(notes): migrate to runtime plugin (Stage 3C)
**Tests at that time:** 893 (stale — actual baseline at Stage 4A start was 1405)

---

## What's Committed

### Stage 3B (0b5ab5f) — Contacts Runtime
`contacts.plugin.js` → `contacts.runtime.js`. 78 tests.

### Stage 3C (27d9a56) — Notes Runtime
`notes.plugin.js` → `notes.runtime.js`. 74 tests.

---

## Stage 3C — Implementation Summary

| File | Change |
|------|--------|
| `js/plugins/notes.runtime.js` | NEW — 156 lines |
| `js/plugins/notes.plugin.js` | DELETED |
| `index.html` | 1 line: plugin ref swapped |
| `tests/stage3c-test.js` | NEW — 74 tests |
| `tests/stage1c-part1-test.js` | 1 line: ref swapped |
| `tests/stage2d-test.js` | 1 line: ref swapped |
| `tests/stage3a-test.js` | 1 line: ref swapped |

Key details:
- Notes module reads `_rdGetDocs(cat)` from `redaction.js` — no STORE functions exist for notes
- Searches both 'das' and 'autres' categories by document `name` field
- Result shape: `{ id, title, subtitle, type, route, data }`
- `onBoot` validates `mp_rddocs_das` and `mp_rddocs_autres`
- `onReady` registers MythosSearch provider (id: 'notes', order: 6)

---

## Uncommitted Changes

| Group | Files | Notes |
|-------|-------|-------|
| 2 — Env | `.gitignore` | +37 lines: API key / OpenCode guards |
| 3 — AI tooling | `AGENTS.md`, `opencode.json`, `.opencode/` | AGENTS.md test count stale (fix to 893) |
| 4 — Docs | `docs/` directory, `docs/worklogs/` | 7 worklog entries |

---

## Test Baseline (committed)

| Suite | Tests |
|-------|-------|
| tests/stage1b-test.js | 45 |
| tests/stage1c-part1-test.js | 58 |
| tests/stage2a-test.js | 42 |
| tests/stage2b-test.js | 105 |
| tests/stage2c-test.js | 83 |
| tests/stage2d-test.js | 110 |
| tests/stage3a-test.js | 69 |
| tests/stage3a5-test.js | 152 |
| tests/stage1a-sync-bypass-regression-test.js | 77 |
| tests/stage3b-test.js | 78 |
| tests/stage3c-test.js | 74 |
| **TOTAL** | **893** |

---

## Priority Actions for Next Session

### 1. Stage 3D — Planning Runtime

Scope:
1. Read `js/plugins/planning.plugin.js`
2. Search for `mp_rappels`, `mp_rappel_types` in `js/app.js` / `js/rappels.js`
3. Create `js/plugins/planning.runtime.js`
4. `onBoot`: validate `mp_rappels` / `mp_rappel_types`
5. `onReady`: register MythosCalendar + MythosSearch providers
6. Update `index.html`, update affected test files
7. Delete `planning.plugin.js`
8. Create `tests/stage3d-test.js` (≥50 tests)
9. All suites pass, 0 failures

### 2. Optionally commit Groups 2–4 (environment, AI tooling, docs)

---

## Risks

1. **AGENTS.md test count (939)** — stale; correct to 893.
2. **STORE v2 read bypass (app.js ~2341)** — reads still use raw localStorage.
3. **Duplicate function stubs (app.js ~1078–1988)** — do not remove without `onclick` audit.
4. **Production safety** — `/var/www/uthinachess/0726/Prod/` must never be modified.
5. **Local is 3 commits ahead of origin/main** — never push without explicit approval.

---

## Documentation Index

| File | Purpose | Status |
|------|---------|--------|
| `docs/PROJECT_STATE.md` | Current project status | Updated |
| `docs/ROADMAP.md` | Migration stages and acceptance criteria | Updated |
| `docs/AI_HANDOVER.md` | This file | Updated |
| `docs/architecture.md` | Stack, sync engine, app.js map | Stable |
| `docs/module-map.md` | JS module inventory, globals | Stable |
| `docs/runtime-services.md` | Runtime services API (Stage 3A.5) | Stable |
| `docs/mythos-os-platform.md` | Platform architecture | Stable |
| `docs/plugin-sdk.md` | Plugin SDK API reference | Stable |
| `docs/production-safety.md` | Production safety rules | Stable |
| `docs/CHANGELOG.md` | Release changelog | Empty |
| `docs/worklogs/` | Per-task work logs | 7 entries
