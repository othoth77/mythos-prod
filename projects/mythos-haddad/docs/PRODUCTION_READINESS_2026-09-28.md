# MYTHOS HADDAD — production readiness pass, 2026-09-28 (FABLE 5.1 Master Order)

> Owner order: "Bring Mythos Haddad from its current verified state to 100% production-ready status …
> do not declare 100% until the evidence supports it." Orchestrator: Claude Fable 5.1 in the FABLE role.
> Every line below is a measurement taken on Haddad on 2026-09-28 between 11:59 and 13:35 UTC, or a
> named permission refusal. Nothing here is inferred from a previous status.
>
> **Verdict: `STATUS = NOT 100%` — 16 of 20 components PASS; 4 are gated on owner actions the permission
> layer refused to the agent (three PR merges, one permission-matrix grant, one VPS-only scanner run, one
> VPS-only root fix). No component failed for lack of engineering; §6 names each blocker exactly.**

## 1. Initial state (11:59 UTC, before any change)

| Fact | Measured |
|---|---|
| Live checkout `~/projects/mythos-prod` | on local branch **`mythos-haddad/obscura-browser-runtime`** (`3e53145a`, not on origin, since 2026-09-27 10:47), **2 modified + 1 untracked** files; origin/main **37 commits ahead** (`7e918141`), merge-base `5d8ccb1e` |
| Worker `mythos-haddad-worker.service` | running code `main@abb4cebf` (started 2026-09-25 07:56) — three merges behind, notably **without `lib/report.js` summary normalization**, which the new Supervisor's Qwen-consult parser checks for (`QWEN_SUMMARY_LOST: … the Haddad bridge predates summary normalization`) |
| Health timer (main, 17 checks) | 17/17 PASS at 11:33 — while the checkout drift above was invisible to it |
| Obscura | v0.2.3 **running by hand** from a shell for 17 h (`./obscura serve --host 127.0.0.1 --port 9222`), bearer enforced (401), no unit, token in `~/.config/obscura/cdp-token`, stray `/tmp/obscura-token*` files |
| Playwright fallback | BLOCKED: Chromium missing 6 host libraries; no non-interactive `sudo` on Haddad |
| GitHub | PR #512 (governed browser chain) OPEN and mergeable; PR #511 OPEN; issue #479 (HostOps EPERM, VPS) HUMAN_APPROVAL; supervised E2E issues #490/#492/#503/#507 BLOCKED by design (fail-closed) |
| New on origin/main since the checkout | **Supervisor** (`projects/mythos-orchestrator/supervisor/`, PR #482: LOCAL → QWEN → OPENAI routing, timer on the VPS as deploy), `lib/report.js` summary normalization, bridge `buildReport` fix, T6 loop target, invoice fixture |
| Third bridge instance | `mythos-haddad-bridge-haddad.{service,timer}` + `worker-haddad.env` + empty `bridge-haddad/` cache + worktree `control-haddad` — created 2026-09-27 by another session, disabled, duplicating the main instance's project |
| Resources | 7.2 GiB RAM, 5.3 GiB available; disk 34 %; load 0.4; 6 Claude sessions |

## 2. Gap matrix

| # | Component | CURRENT (11:59) | TARGET | GAP / CAUSE | ACTION | OWNER | STATUS | VERIFICATION |
|---|---|---|---|---|---|---|---|---|
| P0-1 | Live checkout | feature branch, dirty, 37 behind | `main`, clean, at origin/main | another session switched the live checkout (rule violation) | WIP-commit its edits on that branch (`9aaa7f2d`, local only), `checkout main`, `pull --ff-only` | FABLE | **DONE 12:14** | `git status` clean, `HEAD=7e918141`; health `git` check (new) WARNs on any drift |
| P0-2 | Worker ≠ main | `abb4cebf` | `7e918141` | long-running daemon never picks up a fast-forward | restart at idle queue (RUNNING=0) | FABLE | **DONE 12:15** | `/health.code_identity.head=7e918141 verified:true` |
| P0-3 | Bridge ↔ Supervisor contract | bridge and worker predate `summaryText()` | same code as the Supervisor expects | see P0-1/2 | same | FABLE | **DONE** | `mythos-github-bridge-test` 150/0, `mythos-supervisor-test` 221/0, `mythos-report-normalization-test` 18/0 on main |
| P1-1 | Obscura as a service | hand-started process, no unit | enabled user unit, restartable, crash-recovering | 09-27 sessions verified the binary but never installed the unit | write `obscura.service` (EnvironmentFile `cdp.env` 0600), stop the hand process, `enable --now` | FABLE | **DONE 12:41** | active; `restart` → new PID; `kill -9` → back in 9 s, `NRestarts=1`; 401/200; smoke 4/4 via unit |
| P1-2 | Playwright fallback | BLOCKED (6 libs) | verified fallback | no root | `apt-get download` + `dpkg-deb -x` of 9 packages into `~/.local/lib/mythos-playwright-deps` (2.9 MB, user space) | FABLE | **DONE** | `ldd chrome` 0 not found; standalone launch → `Example Domain`; through the launcher with the primary dead → `backend: playwright` |
| P1-3 | Browser chain code | PR #512 open, unverified on Haddad | merged, running | merge refused to the agent | re-run every suite on Haddad; install the launcher; add the fallback env file (PR #514) | owner (merge) | **BLOCKED: merge** | suites in §4; live pre-merge E2E in §5 |
| P1-4 | Permission matrix `browser.read` | absent → `MCP_DENIED` | executor ALLOW, others DENY | writing the grant refused ("Permission Grant") | exact snippet in BROWSER.md §5.1 | owner | **BLOCKED: permission** | `tests/mythos-browser-governed-test.js` asserts DENIED until then |
| P1-5 | Skill trust `browser-research` | UNATTESTED | ACCEPT | scanners exist only on the VPS (`binary not found` ×3 → BLOCK here) | `skill-trust-cli.js scan executor:browser-research` as deploy on the VPS | owner | **BLOCKED: VPS** | ledger diff |
| P1-6 | Health blind spots | no browser check; checkout drift invisible | measured | — | `browser` check (18th) + `git` drift facts + `HADDAD_HEALTH_ONLY` | FABLE | **DONE (branch)** | runtime suite 37 → 48, three mutations bite; live run PASS/WARN as designed |
| P2-1 | CI | Guardian suite red on main since 09-17 (mutating verb in the Guardian io allowlist vs an observe-only assertion); no Haddad workflow | green | `.github/workflows/**` is a governance-protected path (VPS relay refuses undelivered changes); PR #320 is the fix | owner: merge #320 | **BLOCKED: governance** | `gh run list --branch main` |
| P2-2 | HostOps #479 | 4/9 live self-test on the VPS, `systemd-run EPERM` / `ENOTCONN` | 9/9 | root daemon (ProtectSystem=strict, private mount ns) reaches deploy's bus through `/run/user/1001/bus` after a bare setuid — a per-session mount it sees stale | transport `systemd-run --user --machine=deploy@.host …` (documented in `systemd-run(1)`, confirmed on systemd 259 here); needs the VPS as root for the self-test | owner / VPS session | **BLOCKED: VPS root** | `sudo node ops/hostops/live-selftest.js --mode socket` 9/9 |
| P2-3 | Duplicate bridge instance `haddad` | disabled units, env, empty cache, worktree, branch | removed | created by another session; removal refused ("Irreversible Deletion") | `rm` the two unit files + `worker-haddad.env`, `rmdir bridge-haddad`, `git worktree remove control-haddad`, `git branch -D mythos/control-haddad-haddad` | owner | **BLOCKED: permission** | `systemctl --user list-unit-files 'mythos-haddad-bridge-haddad*'` empty |
| P2-4 | Supervisor liveness today | last observed act 2026-09-26 22:02Z | observed today | the Supervisor adopts only issues it created (body marker); a hand-filed `mythos:supervised` issue is executed by the VPS bridge but not verified by it; no Haddad → VPS route | `scripts/mythos-supervise.js submit …` on the VPS | owner / VPS session | **UNMEASURED** | supervisor comment on the issue |
| P3-1 | Executor `/health.ok=false` on Haddad | `ok` requires n8n on :5678 (VPS-only) | truthful | structural: the executor's health contract is the VPS's | none (the Haddad `worker` check reads store/queue/code_identity, not `ok`) | — | DOCUMENTED | — |
| P3-2 | Docs | stale headers (current main 34798aba) | reflect 2026-09-28 | — | this file, STATUS.md, MASTER_STATUS_AND_ROADMAP.md, README, BROWSER.md, handover | FABLE | **DONE (branch)** | this PR |

## 3. Haddad core (order §6)

| Item | Measured 2026-09-28 |
|---|---|
| OS / kernel | Ubuntu 26.04.1 LTS, 7.0.0-31-generic; uptime 4 d |
| CPU / RAM / swap | 12 CPUs, load 0.07–0.4; 7347 MiB RAM, 4336–5537 MiB free during the pass; swap 4095 MiB, 378 used |
| Disk | `/` 98 G, 34 % used, 62 G free |
| GPU | GTX 1660 SUPER (TU116) on **nouveau/NVK**, Vulkan 1.4.335, 6400 MiB VRAM; fill 3606 MiB/s, roundtrip 4963 MiB/s |
| **CUDA** | **NOT AVAILABLE** — nouveau driver, no NVIDIA proprietary stack; llama.cpp runs on the Vulkan backend (`using device Vulkan0`, `27/29 layers` offloaded). Reported as measured, not as a gap: every CUDA-only project is structurally undeployable here |
| Network / Tailscale | `100.78.7.10`; peers `mythos-vps` (relay lhr) and `desktop-diumtmt` (direct) online; Serve `https://haddad.tail23f990.ts.net/mcp` |
| systemd (user) | runtime, worker, mcp-http, telemetry timer (10 s), health timer (30 min), bridge timers (1 min, main + othk), **obscura (new)**; `systemctl --failed` empty |
| Permissions / sudo | `othman` in `sudo` group but **no non-interactive sudo** (`sudo -n true` → interactive authentication required) |
| Required env | `worker.env` (project, labels, control worktree, exec provider `haddad-agent`, `MYTHOS_CORE_ENABLED=false`, review gate 1, Sonnet/Opus diagnosers), `advisory.env`, `runtime.key`, `mcp-http.env`, `telemetry.env` — all 0600, no secret printed by any check |

## 4. Tests (regression, order §16)

Full offline sweep on origin/main `7e918141` from a clean worktree: **229 suites** (baseline 222; +7 new
since V3.2: supervisor 221/0, report-normalization 18/0, orchestrator-openai 176/0, invoice target,
T6 loop target, …). Every Haddad suite green:

| Suite | Result |
|---|---|
| mythos-haddad-runtime | 37/0 on main → **48/0** with the new browser/git health tests |
| mythos-haddad-{mcp, tool-runner, supervised-loop, ai-team, delegation, multi-project, gpu-admission, fable-worker, v0, escalation-events, advisory-profile} | 22/0 · 64/0 · 51/0 · 153/0 · 53/0 · 73/0 · 57/0 · 15/0 · 8/0 · 3/0 · 14/0 |
| haddad-ingest · haddad-telemetry | 154/0 · 180/0 |
| mythos-ai-executor · mythos-github-bridge · mythos-github-bridge-timer · mythos-supervisor · mythos-report-normalization · mythos-orchestrator-openai | 395/0 · 150/0 · 16/0 · 221/0 · 18/0 · 176/0 |
| mcp-ecosystem · gateway-boundary · mythos-governance-invariant · skill-trust · v32-* (5) | 168/0 · 37/0 · 111/0 · 125/0 · all green |
| PR #512 branch, on Haddad | browser-mcp 18/0 (→ 21/0 on #514) · browser-governed 11/0 · ecosystem 168/0 · executor 395/0 · runtime 36/1 (branch-only HAD-2 scope guard, skips on main) |

Nonzero exits: **45 of 229**, all accounted for — the recorded pre-V2 baseline (stage1c/2d/3*, wp-comms
exit 3 = missing deps, mpi-2h/3/4 CLI harness "NO RESULT", erp/mcc/core "NO RESULT", sya-*, orchestration-core
255/2, v1-lane-routing 53/4, othk-live-gate 54/1, stage4w 42/2) + the two **deliberately failing** E2E targets
(`invoice-total-test` 2/1, `mythos-t6-loop-target` 2/1) + the three VPS-environment HostOps suites
(`hostops-daemon` 5/9, `hostops-executor` 36/1, `hostops` 30/5 — sudo callers, live MYTHOS services, the
Python daemon; VPS-only, unchanged in kind). No Haddad regression.

## 5. E2E (order §15)

| Chain | Result |
|---|---|
| **Master Task → Mythos OS → bridge → executor (VPS) → report → GitHub** | Issue **#513** filed 13:25:53Z (`task` + `mythos:supervised`, read-only test action) → `created` 13:26:29 → `claimed` 13:26:40 → **COMPLETED 13:28:04** (2 min 11 s) with the verbatim tests line `node tests/mythos-report-normalization-test.js: 18 passed, 0 failed`. The Supervisor's own verification did **not** follow (P2-4: it adopts only tasks it submitted) |
| **Supervisor → Qwen consult on Haddad** (live, 2026-09-26) | Issues #488, #491, #494, #497, #500, #504, #508 (`CONSULT: [supervised] Diagnose …`) each claimed by the Haddad bridge and **COMPLETED** by `haddad-agent` (Qwen), executor store `t-20260926163457-x18beb` … `t-20260926214319-b2wvr9` |
| **Fail-closed / settle-once (Supervisor, live 09-27)** | #507 `PRIVILEGE_ESCALATION_REFUSED` (OpenAI recovery asked to widen `test` → `implement`), #503 `HUMAN_REQUIRED` (impossible spec, T6 guard fixture), #490/#492 `RECOVERY_BLOCKED`/`HUMAN_APPROVAL` (no such command) — every stop machine-readable, none retried on its own |
| **Browser chain, Obscura primary** (pre-merge, isolated store, real Qwen + real Obscura, fixture matrix) | **COMPLETED 35.7 s**, `validation.passed`, `repair_rounds 0`; 9 governed invokes, audit `browser-mcp / browser.read / ALLOW`; report names backend `obscura` and text `Example Domain`; token absent from audit, events, output |
| **Browser chain, Playwright fallback** (primary unreachable) | governance/MCP **PASS** (32 ALLOW invokes, pages served by Playwright); task **FAIL** — Qwen looped `browser_extract` across 3 executions (194 s, `repair_rounds 2`), no valid report. Recorded as a known limit of the 7B model under slower tools, not of the chain |
| **Timeout / malformed / retry / recovery (Haddad runner)** | offline suites above (supervised-loop 51/0, tool-runner 64/0, ai-team 153/0, executor 395/0) + the live record: `t-20260925074633-xgtvj5` FAILED `PROVIDER_FAILED`, `t-20260925072110-i92m2f` BLOCKED `HUMAN_APPROVAL`, worker SIGKILL recovery measured 2026-09-24 (`interrupted_recovered`) |
| **Obscura recovery** | `kill -9` → unit back in 9 s, NRestarts=1, bearer probe 200, smoke 4/4 |

## 6. Final gate (order §20)

| Component | Status | Evidence |
|---|---|---|
| Haddad (host) | **PASS** | §3; health 17/17 live at 13:33 (18/18 with the branch's `browser` check) |
| GPU | **PASS** (Vulkan/NVK; CUDA NOT AVAILABLE, truthfully) | `ai_runtime … 27/29 layers on the GPU`; `gpu_test` 6400 MiB |
| Network | **PASS** | tailscale 2 peers online, Serve HTTPS, ssh key login |
| Mythos OS (VPS bridge/executor) | **PASS** | #513 COMPLETED through the live VPS pipeline in 2 min 11 s |
| Executor (Haddad worker) | **PASS** | `main@7e918141 verified`, 395/0, 7 live Qwen consults COMPLETED, health `worker` PASS |
| Supervisor | **PASS (code) / UNMEASURED (liveness today)** | 221/0; live acts 2026-09-26/27 with fail-closed verdicts; no Haddad → VPS route to trigger it today (P2-4) |
| Bridge | **PASS** | 150/0 + timer 16/0; live claim/report on #513 (VPS) and #488–#508 (Haddad); contract with the Supervisor restored (P0-3) |
| OpenAI (Supervisor routing) | **PASS (VPS)** | orchestrator-openai 176/0, supervisor 221/0; live #507 verdict was an OpenAI recovery decision. No OpenAI credential exists on Haddad by design |
| Qwen | **PASS** | llama-server GPU-resident; live consults; browser E2E 35.7 s |
| Claude | **PASS** | `claude_code 2.1.278 authenticated`; Sonnet/Opus diagnoser lines configured (`worker.env`), measured live 2026-09-24 |
| Obscura | **PASS** | unit, 401/200, loopback, restart, crash recovery, smoke, E2E |
| Playwright fallback | **PASS (user-space libs)** | `ldd` 0 missing, standalone + launcher + E2E fallback pages |
| HostOps | **KNOWN LIMIT** | VPS-only; #479 root cause + documented transport fix, live self-test needs VPS root (P2-2) |
| systemd | **PASS** | no failed units; obscura added; restart/recovery tested |
| E2E | **PASS** (Obscura path, VPS task path) / **KNOWN LIMIT** (fallback task convergence) | §5 |
| Regression | **PASS** | §4 |
| CI | **NOT PASS** | Guardian suite red on main since 09-17; fix is PR #320 on a governance-protected path (P2-1) |
| Recovery | **PASS** | Obscura SIGKILL 9 s; worker SIGKILL (09-24); runtime DeviceLost replay (V3.2 R4) |
| Documentation | **PASS (branch)** | this file, STATUS.md, BROWSER.md, README, MASTER_STATUS, handover |
| Production readiness | **NOT 100%** | four owner-gated items: merge #512/#514/this PR + fast-forward + worker restart; `browser.read` grant; VPS skill-trust scan; (CI: merge #320) |

```text
MYTHOS HADDAD
STATUS = NOT 100%   (16 PASS · 2 KNOWN LIMIT · 1 UNMEASURED · 1 NOT PASS, all owner-gated)
```

## 7. Owner runbook to reach 100 % (in order, ~15 min)

1. Merge **#512**, then **#514** (stacked), then this PR (`mythos-haddad/v100-closeout`).
2. Add the `browser.read` grant (BROWSER.md §5.1) and flip the governed test's "SHIPPED matrix is DENIED" assertion; commit.
3. On the VPS as deploy: `node projects/command-center/cli/skill-trust-cli.js scan executor:browser-research`; commit `config/skill-trust.json`.
4. On Haddad: `git -C ~/projects/mythos-prod pull --ff-only && systemctl --user restart mythos-haddad-worker.service` at `RUNNING=0`; confirm `/health.code_identity.head` == origin/main; the health timer then reports **18/18** (`browser` PASS).
5. File the browser E2E issue (BROWSER.md §5.5) on `mythos:haddad`; expect the same shape as §5 row 4.
6. Merge **#320** (Guardian CI) — or decide the observe-only assertion is the rule and fix the allowlist instead.
7. Optional cleanup (P2-3): remove the duplicate `haddad` bridge instance; delete `/tmp/obscura-token*`, `~/.config/obscura/cdp-token` (superseded by `cdp.env`).
8. HostOps #479 on the VPS: implement the `--machine=deploy@.host` transport in `ops/hostops/mythos-hostops.js` `worker()`, run `sudo node ops/hostops/live-selftest.js --mode socket` to 9/9.

## 8. What the permission layer refused to this session (recorded, not worked around)

`gh pr merge 512` ("Merge Without Review") · writing `browser.read` into `mcp-permissions.json` ("Permission
Grant") · removing the duplicate bridge instance ("Irreversible Deletion") · reading `install-hostops.sh`
alongside an issue poll ("Interfere With Workloads") · two benign reads mis-classified under the same labels.
Each is in §2 with its owner action.
