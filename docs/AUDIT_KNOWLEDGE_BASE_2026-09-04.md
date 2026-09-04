# MYTHOS — Audit Knowledge Base (baseline 2026-09-04)

Compact, verified baseline produced by the 2026-09-04 master backlog audit (Fable 5.1, ~700k tokens).
**Read this before any broad audit.** Everything here was checked against Git (`git merge-base --is-ancestor`),
GitHub (PR/Issue state, control reports on `mythos/control`) and the live host (read-only), on 2026-09-04
between 17:30 and 20:00 UTC. Labels used: **VERIFIED** (evidence seen), **NOT VERIFIED** (claimed, not
re-checked), **BLOCKED** (cannot proceed, cause named), **OWNER ACTION** (only the owner/operator can do it),
**HUMAN MERGE REQUIRED**.

## A. Executive state

- `origin/main` = **`b6d4c6b`** (PR #159 merged 19:46 UTC). VERIFIED. Before that: `b7b1382` (PRs #163, #166), `5b995e9` (PR #154).
- Every task Issue #95–#161 is one of: in `main`, superseded, or waiting on an owner action listed in §I. **No implementation work is missing** except the small follow-ups in §I.4. VERIFIED.
- Production Executor checkout `/home/deploy/projects/mythos-prod` still runs **`5b995e9`** — behind `main`. BLOCKED on the owner fast-forward (§I.1).
- Open PRs from this work: **#168** (docs, reconciliation table) — HUMAN MERGE REQUIRED. PR #108 is superseded (close). Eleven old `claude/*` PRs (#68–#93) are outside the MYTHOS backlog.

## B. Architecture state (EXEC-ARCH-0, merged in #159)

- One execution architecture: GitHub Issue → Bridge → OTHMODE → Claude Code headless (`providers/claude-code.js`, only execution authority) → task worktree `mythos/gh/<id>` → tests → commit → governed relay (`mythos-git-push.timer`, every 5 min, fast-forward only, governance-verified) → PR → Human Merge → `main`. VERIFIED.
- Dagu is the maintenance scheduler only: `ops/dagu/maintenance/{git-sync-main,drift-check,worktree-gc,executor-restart}.yaml` over `ops/dagu/bin/*`. **Dagu is NOT installed as a service** (PoC binary at `/home/deploy/dagu-poc/bin`). OWNER ACTION per `ops/dagu/README.md`.
- Executor restart (`executor-restart.yaml`): Resource Guard → no RUNNING task → drift says restart required → Dagu approval gate → **`approval-verify`** (`ops/dagu/bin/mythos-restart-approval verify <ap-…> --consume`) → `systemctl --user restart mythos-ai-executor.service` → drift verify. The verify step exits 0 only for an existing executor policy-engine approval with `action_class hostops:executor.restart`, `subject_id` = checkout HEAD, status GRANTED, human decider, ≤ 24 h old, never consumed; `--consume` makes it single-use. Fake/missing/mismatched/reused/revoked/expired refs are rejected (exit 3); unmeasurable HEAD or absent store fails closed (exit 1). VERIFIED (`tests/dagu-maintenance-test.js` 31/0 as deploy). Trust boundary: the record lives in the deploy-owned executor store, not the root-signed `/var/lib/mythos/governance` approvals; a compromised `deploy` account is out of scope.
- Autopilot (PR #158, `mythos/autopilot-20260904`) is **superseded** by EXEC-ARCH-0; never enabled. Do not rebuild.
- Executor reports `code_identity` in `GET /health` (checkout, HEAD, branch, pid, start time) so `mythos-drift-check` can say `EXECUTOR_RESTART_REQUIRED` from a measurement. VERIFIED in code; the running daemon predates it (see §C).

## C. Production state (host `vps-4722f0a9`, read-only observations)

| Component | State | Label |
|---|---|---|
| Executor `mythos-ai-executor.service` (deploy user) | active since 2026-09-04 12:46 UTC, PID 3631021, runs from the checkout at `5b995e9`. Bridge logs `RUNTIME_STALE_CHECKOUT` every tick since `main` moved. Not restarted by any agent. | VERIFIED; restart = OWNER/governance action |
| Skill Trust Gate (SKILL-TRUST-0, PR #154) | **ACTIVE**: owner deployed + restarted 12:44–12:46 UTC; `GET /api/othmode/trust` → 200, policy 1.0.0, 31/31 skills ACCEPT; no `MYTHOS_SKILL_TRUST=off` anywhere (env key names inspected only). Re-verified by task `gh-issue-156-r2`. | VERIFIED |
| Resource Guard (PR #105) | ACTIVE inside the executor daemon; real transitions today (WARNING/CRITICAL/recover), `dispatch_deferred reason=resource_pressure` events; thresholds untouched. Gap: no sample is taken while a task is RUNNING (daemon busy); alerts go to ntfy `notify.sh` (send failed today), **not** WhatsApp. | VERIFIED |
| Session Guard (PR #145 + lifecycle clock f78c496) | `mythos-session-guard.timer` (system) active since 09-03 20:47, 5-min cadence, **observe mode** (marker `/var/lib/mythos-session-guard/session-guard.enabled` absent), 0 kills ever, thousands of vetoes. Installed copy = PR #145 version, not f78c496. Guard unit OOM-killed 12× on 09-04 (`MemoryMax=192M`). | VERIFIED; enable/reinstall = OWNER ACTION |
| GitHub Bridge | `mythos-github-bridge.timer` active, ~1-minute cadence (67 s observed), oneshot runs from the checkout each tick; Action Resolution Engine live (`Action source: explicit_current_issue` on every task since PR #119/#120). | VERIFIED |
| HostOps READ boundary (PRs #127/#131/#150/#151) | `mythos-hostops.socket` active, `/run/mythos-hostops/hostops.sock` root:mythos-hostops, executor in group 1003 with `NoNewPrivs=1`, installed helper == repo; live READ calls audited (`hostops-mtlv9tgk-d31e02`, `hostops-mtlx0zuw-284786`). Residue: `/etc/sudoers.d/61-deploy-hostops` still on host though removed from the repo; `mythos-hostops.service` writes nothing to the journal. | VERIFIED; residue = OWNER ACTION |
| Status Center (PR #143) | Code in `main`; **served copy stale**: live `health.json` = REVIEW-2026-08-26-005, repo = REVIEW-2026-09-03-001. Publish = `sudo bash scripts/deploy-status-center.sh`. No timer schedules `bin/review.js` (scope item never built). | VERIFIED; publish = OWNER ACTION |
| Governed relay `mythos-git-push.timer` | active, 5-min cadence; pushes `main` (ff only) and `refs/heads/mythos/*` (ff only, governance-verified). Refuses `main` while the checkout is behind origin (expected). DENIES an old mission branch `mythos/m-msy4a8iz-f2673d/tk-msy4a8j0-f1b3c5` (2026-08-18, protected `agents.json`/`agent-registry.js`, no approval) every run — pre-existing noise. | VERIFIED |
| Host resources | 7.7 GiB RAM, swap ~3–4 GiB used, load spikes to 60+ under concurrent Claude sessions; run test suites one at a time with `timeout`. | VERIFIED |

## D. GitHub / PR state

| PR | Content | State |
|---|---|---|
| #159 | EXEC-ARCH-0 + #161 approval_ref verification (`7e0278b`, `425fe52`) + worktree-GC pid fix (`30f5bb4`) + merge of `b7b1382` (`75f8832`) | **MERGED** `b6d4c6b` 2026-09-04 19:46 UTC. VERIFIED |
| #168 | `mythos/backlog-reconcile-20260904`: eight relay-delivered handover branches merged (156, 156-r2, 157, 148, 138, 139, 141-r3, 146), master reconciliation table, Autopilot line in `docs/MYTHOS_SIMPLE_EXPLANATIONS.md`; refreshed with `b6d4c6b` as `1a95f5b` | OPEN, docs only. HUMAN MERGE REQUIRED |
| #108 | original WhatsApp notify layer `b37491f` | superseded by #124/#152/#163 (every file in `main` with a superset). OWNER ACTION: close |
| #158 | Autopilot | CLOSED, superseded by #159 |
| #163, #166, #154, #152, #151, #150, #149, #145, #143, #137, #135, #131, #127, #124, #120, #119, #113, #105, #104, #102, #98 | merged lineage of the whole backlog | VERIFIED merged |

## E. Task (Issue) state — one line each

✅ = work in `main` / proven; ⚪ = superseded; 🟠 = owner action; 🔴 = blocker.

- ✅ #161 approval_ref gap — merged in #159. ✅ #160 simple explanations — PR #166 (`bb6cec1`). ✅ #157 relay diagnosis — relay was healthy. ✅ #155/#156 Skill Trust activation — ACTIVE (owner), verified by 156-r2.
- ✅ HostOps #128/#130/#132/#142/#148/#136 — all in `main`, live READ path proven. ⚪ #129/#133 — rejected by the adapter, superseded by #130/#136.
- ✅ WhatsApp code #111/#123/#125/#147 (+ WA-PROVIDER-2 `3ac4644`) — in `main`; Evolution API stays the default adapter; WAHA NOWEB/GOWS and wa-evolution are candidates only. ⚪ #109/#110/#97 — superseded. 🟠 #126/#141/#146 — deployment never possible (see §F).
- ✅ #144 session guard — code merged, observe mode live. ✅ #138/#139/#103 rerun — fixed by PR #104. ✅ #112/#114/#115/#116/#117/#118/#121/#153 action routing — PRs #113/#119/#120; labels `human-approval` on #117 and `blocked` on #115 are stale.
- ✅ #101/#107/#100 — guard, 1-min timer, model policy all live. 🟠 #106 — activation happened; owes only the closure record (every executor attempt is sandbox-blocked). 🟡 #99 WhatsApp alert channel for the guard — not built.
- ✅ #140 code (PR #143); ⚪ #95 superseded by #140; 🟠 publish owed.
- 🔴 #164 WhatsApp activation — bridge cannot claim (§H.1). #162 — BLOCKED HUMAN_APPROVAL (auto-profile run); #162-r2 was CLAIMED/QUEUED. #167 — owner's fresh Skill-Trust verification task, claimed by the executor as Fable 5.1 `implement/repo-write` (task `t-20260904191409-oto4m0`), RUNNING at audit end. **#167 is not complete just because Skill Trust was audited ACTIVE** — its own evidence/report is required, and it must not run concurrently with #162.

## F. WhatsApp state (exact)

- Code: complete in `main` (notify layer, resilience, provider independence, idempotent ledger, task_id 64 fix). Tests: notify 131/0, resilience 95/0 on `5b995e9` (101 once the checkout has `3ac4644`). VERIFIED.
- Production: **no gateway container or unit exists** (only a never-started `evolution-inspect` container from a 09-03 inspection); **no `MYTHOS_BRIDGE_WHATSAPP_*` variable** (ENABLED/PROVIDER/BASE_URL/INSTANCE/API_KEY/TO) is set anywhere; **no designated test recipient**; no notify ledger directory (0 notifications ever attempted). VERIFIED.
- Consequences: any activation/smoke-test task stops at "missing configuration". Evolution's own 2 GB RAM minimum is not met on this host; measuring WAHA-NOWEB/GOWS vs wa-evolution under `--memory` is an owner decision. QR pairing is a human step. OWNER ACTION.
- Rules that held throughout: no real message sent, no credential created, no second gateway.

## G. Tests and evidence (as run 2026-09-04, deploy user, one suite at a time)

| Suite | Result | Note |
|---|---|---|
| tests/dagu-maintenance-test.js | 31/0 | after the GC fix; 30/1 before with a 5-digit child pid |
| bridge-action-resolution | 88/0 | |
| model-selection-policy | 81/0 | |
| resource-guard | 91/0 | fails only with `MYTHOS_RESOURCE_GUARD=off` exported (expected) |
| session-guard | 277/0 | |
| mythos-github-bridge-timer | 16/0 | |
| mythos-bridge-push-guard | 23/0 | |
| mythos-bridge-whatsapp-notify | 131/0 | loopback server only |
| mythos-bridge-whatsapp-resilience | 95/0 | 101 expected at `3ac4644`+ |
| mythos-hostops-test | 38/1 (+2 skip) | #15 fails whenever guard level ≠ NORMAL — environmental, pre-existing |
| stc-1-status-center | 80/1 | untracked host-local `projects/idauto/` (node_modules only) — host-local, not a code gap |
| skill-trust / othmode-2 / othmode-3 / mcp-ecosystem / executor | 130/0, 147/0, 94/0, 168/0, 390/0 | from task 156-r2 report — NOT re-run by the audit (NOT VERIFIED here) |

Known pre-existing failures (do not attribute to new work): DOM-dependent suites under Node 22; stage4w highlight assertions; hostops #15 under guard pressure; Dagu suite tests that run git in a deploy-owned worktree as root ("dubious ownership") — always run as `deploy`.

## H. Known blockers

1. **#164 cannot be claimed**: `TASK_SCHEMA_INVALID root.required_tests[0]: string longer than maxLength 300` (the Acceptance paragraph); `**Action: implementation**` and `**Model: Fable 5.1**` inside bold are not parsed (the bridge wants plain `Action: implement` / `Model: Fable 5.1` lines). Fix = edit the Issue body. Even then it stops at §F.
2. **Production checkout behind `main`** (`5b995e9` vs `b6d4c6b`): only the owner / `sudo mythos-deploy deploy othmode` fast-forwards it; agents must not (`git` on the checkout is the deployment).
3. **Executor restart**: needs the checkout synced, Dagu installed as a service, and a GRANTED `hostops:executor.restart` approval (`ops/dagu/bin/mythos-restart-approval request/grant`). Until then, record `EXECUTOR_RESTART_REQUIRED`, do not restart.
4. **Governance approval files** written by `mythos-governance-approve` are root:root; the relay ignores them until `chgrp mythos-gov` (operator step).
5. Executor task sandbox forbids `systemctl`, `journalctl`, `sudo` — production activation/verification tasks routed through the bridge end in HUMAN_APPROVAL by design.

## I. Required next actions

1. OWNER: merge PR #168; close PR #108; close Issues marked ✅/⚪ in §E (and #161, #157, #155, #156 once #168 documents them); fix labels on #115/#117.
2. OWNER: fast-forward the production checkout to `main`; then the governed Executor restart (§H.3) — the running daemon predates `code_identity`, `approval-verify`, WA-PROVIDER-2 tests and the GC fix.
3. OWNER: install Dagu as a deploy-user service (`ops/dagu/README.md`); create owner markers only when intended (`~deploy/mythos-ai-executor/maintenance/{sync,worktrees}.enabled`).
4. Small follow-up tasks (optional): Resource Guard → WhatsApp alert channel (#99 scope); guard sampling while a task is RUNNING; schedule the Status Center review engine; raise the session-guard unit `MemoryMax`; remove `/etc/sudoers.d/61-deploy-hostops`; decide the fate of the denied 2026-08-18 mission branch.
5. OWNER: Status Center publish; session-guard reinstall + enable decision; WhatsApp gateway/config/recipient provisioning, then #164.
6. #167: let the bridge run finish; verify with its own report before closing; never concurrently with #162.

## J. Safety rules (discovered or reconfirmed)

- The production checkout IS the deployment (services ExecStart from it). Never `reset --hard`, `checkout .`, `clean`, or `git add .` there; never fast-forward it as an agent.
- One git action per shell call when working as `deploy` from a root session (`sudo -u deploy git …`); compound sudo+git commands are refused by the permission layer. Edit deploy-owned files in place (python `r+`/truncate) to keep ownership; root-owned files break the relay.
- Run suites as `deploy`, one at a time, with `timeout`; the host swaps heavily.
- Never treat the Dagu IN_USE test as flaky: it exposed a real GC bug (pid padding). If a GC/worktree test fails, suspect the code.
- Never send a WhatsApp message in tests; the notify suites use loopback servers only.
- Bridge-executed tasks: `Action:`/`Model:` must be plain lines; `required_tests` strings ≤ 300 chars.
- Approvals: Dagu's own step approval is NOT authorization; only a verified MYTHOS approval record is.

## K. DO NOT RE-AUDIT

Do not re-run a repository-wide audit for Issues ≤ #167. Start from §A–§I. Re-verify only what a task needs: `git rev-parse origin/main`, the PR/Issue you touch, and the single runtime fact you depend on (`GET /health` of the executor, `git -C /home/deploy/projects/mythos-prod rev-parse HEAD`). The master table with per-Issue SHAs is in `docs/AI_HANDOVER.md` (BACKLOG-RECONCILE-0 and AUDIT KNOWLEDGE BASE sections). If a fact here contradicts GitHub, GitHub wins — update this file in the same PR.
