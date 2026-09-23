# Mythos Haddad — status

**V0: COMPLETE — verified 2026-09-21 (issue #328). Delivered: PR #330 merged into `main` as `670b4268`; issues #328 and #329 closed.**

**HAD-2 (first local AI runtime, V1): COMPLETE — verified 2026-09-21.** llama.cpp on the Vulkan backend,
one pinned Qwen2.5-7B-Instruct-Q4_K_M model, OpenAI-compatible endpoint on `127.0.0.1:8600`, systemd user
service. Full detail, measurements and rollback: [docs/AI_RUNTIME.md](docs/AI_RUNTIME.md).

| HAD-2 item | State | Evidence |
|---|---|---|
| Vulkan backend installed | DONE | `llama.cpp-tools`/`libggml0-backend-vulkan` 0.9.11-1 (Ubuntu 26.04 universe), unpacked to a user prefix — no root, no source build |
| GPU acceleration verified | DONE | `llama-cli --list-devices` → `Vulkan0: NVIDIA GeForce GTX 1660 SUPER`; 29/29 layers offloaded at the original `--ctx-size 4096`. **At the current 8192 it is 27/29** — `auto` keeps two layers and 32 MiB of KV in host RAM to stay under the ceiling (see AI_RUNTIME.md § Measurements) |
| Model selected + installed | DONE | Qwen2.5-7B-Instruct-Q4_K_M, official Qwen org, sha256-pinned, 4.36 GiB, fits 6 GB VRAM with headroom |
| Real inference test | DONE | Three chat-completion requests through the OpenAI-compatible endpoint, all factually correct |
| VRAM/RAM measured | DONE | At 4096: VRAM 4696 MiB, RSS ~430–505 MiB. **At the current 8192: VRAM 4920 MiB of 6400, RSS ~2.1 GiB** — higher by design, because two layers and part of the KV cache are deliberately in host RAM. (The OS-level Vulkan budget query is unreliable on this driver; the runtime's own accounting is the figure to trust.) |
| Performance measured | DONE | At 4096: ~20–25 tok/s generation once warm. **At 8192: 17–33 tok/s generation** (17.0 on a sustained 80-token answer), 21–35 tok/s prompt — the two CPU layers cost ~15–30 % on a long answer |
| OpenAI-compatible API exposed | DONE | `http://127.0.0.1:8600/v1`, loopback only, API-key required |
| Free-LLM catalog untouched | DONE | `git diff` confined to `projects/mythos-haddad/` and `docs/` |
| Not wired to production orchestration | DONE | No file under `mythos-ai-executor/{core,lib,providers,config}` changed — that is HAD-4, later |
| One model only | DONE | `haddad-model-install.sh` names exactly one |
| Tests, V0 still healthy | DONE | `tests/mythos-haddad-runtime-test.js` 8/8; `tests/mythos-haddad-v0-test.js` still 8/8; `haddad-health.js` 14/14 PASS |

**HAD-2b (Qwen as a FABLE local worker): COMPLETE — verified 2026-09-21.** FABLE sends a task to the
local runtime, reads the result, reviews it, and issues a correction with findings if it is inadequate.
Detail and the full reuse rationale: [docs/FABLE_WORKER.md](docs/FABLE_WORKER.md).

| HAD-2b item | State | Evidence |
|---|---|---|
| FABLE sends a task | DONE | `bin/haddad-task.js`, one JSON object in / one JSON line out |
| FABLE receives the result | DONE | `{ok, text, attempt, model, usage, duration_ms}`; live: 2.3 s, correct answer |
| FABLE reviews before completing | DONE | FABLE judges in-session; the worker never reviews itself (reviewer-is-not-author, `core/validation.js:176-191`) |
| Correction / retry works | DONE | Findings re-sent as the executor's own `## REPAIR REQUIRED (attempt N)` block; answer went from **103 words to 13** |
| Reuses existing infrastructure | DONE | `free-llm/adapter.js` required unmodified; executor success oracle, repair format and verdict shape all adopted, not restated |
| Nothing new built | DONE | No queue, orchestrator, executor, catalog or memory system; `free-llm/{catalog,endpoints}.json` untouched |
| Executor path needs no new provider | DONE | Existing `providers/openai-compat.js` verified against Haddad via env config alone — `available()` true, real completion `exit_code: 0` |
| Security model preserved | DONE | Still loopback-only on `127.0.0.1:8600`; key never in output; worker has no execution authority |
| Tests | DONE | `tests/mythos-haddad-fable-worker-test.js` 11/0, mutation-checked; HAD-2 8/0 and V0 8/0 unchanged |

| V0 acceptance item | State | Evidence (2026-09-21, on `haddad`) |
|---|---|---|
| Reachable remotely | DONE | Tailscale `Running`, `100.78.7.10`; sshd log: login from the Windows peer `100.112.129.59` over Tailscale at 00:41 UTC (#329, closed) |
| SSH works | DONE | `ssh haddad`, `ssh othman@100.78.7.10`, `ssh othman@haddad.<tailnet>.ts.net` all pass with `BatchMode=yes`; port 22; host key checking on |
| Tailscale works | DONE | 1.102.4, peer `DESKTOP-DIUMTMT` online, direct path, ping 1 ms |
| Git works | DONE | 2.53.0, `ls-remote origin` OK |
| Node/npm work | DONE | Node 22.22.1, npm 9.2.0 |
| Claude Code authenticated and launches | DONE | 2.1.278 installed in `~/.local` (was `npx`-only), `claude auth status` → logged in, `claude -p` → `HADDAD-OK` |
| GPU detected + basic GPU test | DONE | GTX 1660 SUPER (TU116), `nouveau` + GSP 570.144, Vulkan 1.4.335 via NVK, 6 GB VRAM; 64 MiB GPU fill + host→VRAM→host round trip verified byte for byte (~3.4 / ~4.8 GiB/s) |
| Runtime dependencies | DONE | Python 3.14.4, libvulkan1, mesa-vulkan-drivers, render node access, `~/.local/share/mythos-haddad/{models,runtime}` |
| Structure / documentation | DONE | `projects/mythos-haddad/` — README (setup, operation, recovery, verification) |
| Health checks + logs | DONE | `haddad-health.js` 13/13 PASS; systemd user timer every 30 min, linger on; logs in `~/.local/state/mythos-haddad/logs/` |
| Reproducible verification | DONE | README → Verification; `tests/mythos-haddad-v0-test.js` 8/8; re-verified from a fresh clone of the pushed branch |
| Committed / pushed | DONE | branch `mythos-haddad/v0-base-server`, PR #330; remote HEAD checked against the local commit |

## Fixes made while completing V0

- `ssh haddad` failed with `Host key verification failed`: the machine's own names were missing from
  `known_hosts`. Entries added from the local host key file (not over the network); now part of `haddad-setup.sh`.
- `github.com` host keys added to `known_hosts` from GitHub's published key list (`api.github.com/meta`).
- Claude Code only existed as a running `npx` process; installed persistently so `claude` survives the session.
- Lingering enabled for `othman` so the health timer runs without a login session.

No root was used; no sshd, firewall, router or driver change was made.

## Known limits

See README → Known limits: no CUDA on the open driver stack (V1 decision), 8 GB RAM / HDD, correctable PCIe AER
errors from the GPU, sshd still accepts passwords, no SMART / fan sensors without extra packages.

## Fixes / workarounds made while completing HAD-2

- No root was available for `apt install`; the four `.deb` packages were fetched with
  `apt-get download` (no root, same GPG-verified archive) and unpacked into a user prefix.
- ggml's backend-plugin loader hardcodes one root-owned absolute path and its only override loads
  a single file, not enough for CPU + Vulkan together. A ~15-line loader shim (`src/backend-loader-shim.c`)
  closes that gap by calling ggml's own public `ggml_backend_load()` twice; it contains no
  llama.cpp/ggml code. Full account, including the three unprivileged approaches tried first and
  why each failed, is in `docs/AI_RUNTIME.md`.
- A `SystemCallFilter=~@privileged @resources` negation in the first draft of the systemd unit
  killed the Vulkan driver with SIGSYS; removed, documented in the unit's own header.

No root was used to run anything in this stage; no system file outside the user's home was created or modified.

**HAD-3 (GitHub worker): infrastructure COMPLETE and verified; one owner decision outstanding.**
The existing bridge + executor run on Haddad as `othman`, fully isolated from the VPS (label
`mythos:haddad`, prefix `haddad:`, control branch `mythos/control-haddad`, own executor home),
driving the local Qwen. Real Issue #335 was claimed, executed and reported unattended. The
`ACTION_PROFILE_MISMATCH` conflict between the two preflight gates is resolved with an
owner-approved, fail-closed exemption for providers that have no tool surface at all; Qwen gained
no execution authority. Real E2E: Issue #338 → `haddad:completed`. Detail:
[docs/GITHUB_WORKER.md](docs/GITHUB_WORKER.md).

**HAD-3 (Haddad MCP): COMPLETE — verified 2026-09-22 (PR #366).** The VPS OTH MCP (`projects/oth-mcp/server.js`,
stdio, read-only) runs on Haddad over SSH-stdio with Haddad's configuration: the executor tools read Haddad's
own executor (`127.0.0.1:8130`, bearer by reference from the executor's own 0600 file); OTHMODE/Status tools
read the public estate models; **`haddad_health`** — the one Haddad-native tool the V1 scope asked for (health,
GPU, AI runtime + model, worker, MCP) — is a 66-line env-gated read of `health-latest.json` inside the shared
server, absent on the VPS (still 8 tools). Knowledge tools stay fail-closed until HAD-1. No port, no unit, no
root, no secret in git. Health gained `worker` and `mcp` checks (16/0/0). Real E2E: Claude Code over
`ssh othman@100.78.7.10` → `execution_status` + `haddad_health` + `system_health` → every value matched the
sources directly. Tests 17/0 (new), 58/0 + 168/0 + 37/0 (shared MCP suites), full regression green.
Detail: [docs/HADDAD_MCP.md](docs/HADDAD_MCP.md).

**HAD-4 (tool runner + supervised execution): COMPLETE — proven live 2026-09-22.** Qwen writes and runs
inside a per-command bwrap sandbox; `lib/work-validation.js` re-runs every declared check itself and
measures the workspace; a bounded repair loop (3 executions, compact briefs, per-execution turn/tool
budgets, 1,536 tokens per turn) hands Qwen its measured failures, with a diagnosis-only Sonnet
escalation on the last round. Real E2E gh-issue-379: attempt FAIL → repair FAIL → repair + diagnosis →
both checks PASS by the validator → COMPLETED → review gate → `haddad:human-approval`. Fake success caught
live (#373, #376, #378), exhaustion → HUMAN_APPROVAL with the trace (#376), crash recovery (#381),
dependency wait while an independent task runs (#380/#381). Detail: [docs/GITHUB_WORKER.md](docs/GITHUB_WORKER.md),
`docs/MYTHOS_REVIEW_POLICY.md`.

## V1 merged — 2026-09-22

HAD-2/HAD-2b/HAD-3/HAD-4 and their dependencies are on `main`: #365 `ae95857f`, #384 `6f8ed330`,
#368 `10c8847d`, #385 `1d1fc4dd`, #366 `5a3b92ca`. The host checkout tracks `main` again.

A post-merge probe found and closed one real sandbox escape: a script the model writes and runs
with the permitted `node <file>` could set `core.hooksPath` in the workspace's `.git`, invisible to
the validator, and the executor's later commit — outside the sandbox, where `--no-verify` does not
stop `post-commit` — would have run it as the host user. `.git` is now mounted read-only inside the
sandbox and delivery pins `core.hooksPath=/dev/null`. Detail: [docs/GITHUB_WORKER.md](docs/GITHUB_WORKER.md).

## MYTHOS HADDAD live console — 2026-09-22

**VPS half: COMPLETE, DEPLOYED, PRODUCTION-VERIFIED. Node half: BUILT and REVIEWED, NOT YET RUNNING — owner approval outstanding.**

Haddad is now a node the Status Center can show, not only a machine you can SSH to.
`https://status.mythosprod.xyz/` gains an **MYTHOS AI nodes** card and
`https://status.mythosprod.xyz/haddad/` is the live console. Design, thresholds, measured
cost and the two traps found on the way: [docs/TELEMETRY.md](docs/TELEMETRY.md).

**The node pushes; the VPS never connects to it.** The Status Center's STC-2 monitor cannot
poll Haddad — the VPS has no Tailscale and no VPS→Haddad SSH credential, and creating one
is the deferred owner decision recorded below. Haddad→VPS HTTPS works (verified on the node,
`/health` → 200). So Haddad signs a telemetry envelope with an Ed25519 key it generated
itself and POSTs it every 10 s. Haddad opens no port, publishes no endpoint and needs no
inbound rule, and this feature does not depend on that pending decision at all.

| Item | State | Evidence (2026-09-22) |
|---|---|---|
| Ingest receiver deployed | **DONE / VERIFIED** | `mythos-haddad-ingest.service` active, `127.0.0.1:8190`, `systemd-analyze security` **2.9 OK** |
| nginx path | **DONE / VERIFIED** | `POST /ingest` → 401 unsigned, `GET /ingest` → 403, `/haddad/` → 200, all over public TLS |
| Console + card deployed | **DONE / VERIFIED** | rendered in real headless Chrome; every section shows real values or N/A |
| Signed ingest, end to end | **DONE / VERIFIED** | the real agent → the real public endpoint → `HTTP 202`, snapshot + history + transitions written |
| Offline detection | **DONE / VERIFIED** | beats stopped: DEGRADED at 36 s, **OFFLINE at 51 s** (threshold 45 s), transitions recorded |
| Recovery | **DONE / VERIFIED** | one beat → back to its real state in < 1 s, **no manual action in the Status Center** |
| Frozen-file honesty | **DONE / VERIFIED** | with the receiver stopped, the browser recomputes from `received_at` and says it overrode |
| Refusals | **DONE / VERIFIED** | bad key, unknown node, replay, skew, oversize, broken registry — all refused; suite drives each |
| No secret can be published | **DONE / VERIFIED** | `sanitize()` is an allow-list; the suite pushes real secret-shaped fields through the whole path |
| Measured cost | **DONE / MEASURED** | **0.32 CPU-s per beat** (~0.15 s of it Node startup), 68 MB peak and nothing resident, ~2.4 KB on the wire, ~3.2 % of one core, 11.9 MB history/node/month |
| Tests | **DONE** | `haddad-ingest-test.js` 126/0, `haddad-telemetry-test.js` 127/0 |
| **Haddad actually beating** | **NOT DONE — owner gate** | the node session is under an explicit hold from the owner (no new tooling, no standing outward configuration). Until it runs, the card honestly shows no node. |
| **Is a public page right for this?** | **OPEN — owner decision** | the console is TLS + noindex but **not authenticated**. It publishes structured task identity (issue, project, action, profile, model, status) and an event stream. That is the class of thing `data/current.json` already publishes, and the three free-text fields were removed rather than published — but gating the page is the owner's call, not ours. |

Found by review on the real host **before any beat was sent**, and fixed: the agent read
`MYTHOS_EXECUTOR_HOME` from `executor.env`, which on Haddad holds only the token. The home
lives in `worker.env`. The effect was not an error — the task view was silently empty and
rendered exactly like a healthy idle node. See TELEMETRY.md §10.

## MYTHOS HADDAD V2.1 — AI TEAM FOUNDATION

**V2.1 (AI TEAM FOUNDATION): <!--V21-VERDICT-->.** V1 shipped an AI *worker* — one local
model, one task at a time, supervised by code. V2.1 makes that worker a member of a team the
existing orchestration core can see, and gives it roles. It is a CONNECT stage: the agent
registry, provider router, review policy, execution profiles, action→profile table, skill
registry and trust ledger all already existed and are reused. Full record, including every
finding from the live runs: [docs/AI_TEAM.md](docs/AI_TEAM.md).

| V2.1 item | State | Evidence |
|---|---|---|
| `haddad-qwen` in the agent registry | DONE | `config/agents.json` +13 lines; availability **probed** (enable marker + runtime key + llama-server answering `/health`), so on the VPS it is unavailable and unselectable |
| Selected by capability, not hardcoded | DONE | live on this host: `selectCandidates` returns it ahead of `claude-code` for coding and testing on the registry's own risk-then-cost order; `provider-router.route()` routes to it with `authority: true` |
| Refused as reviewer of sensitive work | DONE | live: `reviewer_not_trusted_for_sensitive`, `haddad-qwen` named in the refusal; the existing `core/validation.js` does it, unmodified |
| Six roles, config not code | DONE | `config/roles.json` + `lib/roles.js`; the execution profile is **derived** from the action and a role that names one is refused |
| Role selects the trust-attested skill pack | DONE | tester → `testing`, reviewer → `github-review`, rest → `generic`, each `ACCEPT` in the ledger. No new skill file: none could be attested on this host |
| Read-only roles cannot write | DONE | `repo-read`/`repo-test` grant no `write_file`, so the tool is absent from the model's vocabulary; measured as zero workspace writes in the live runs |
| Context window accounted for | DONE | prompt budget 6,272 of 8,192, per-call payload cap, oldest-first exchange compaction, `HADDAD_AGENT_CONTEXT_EXHAUSTED` — after a live run died on a 9,710-token request |
| A failed run carries its evidence | DONE | `report.json` gained `evidence` (validator verdicts, tool trace with refusals, repair and compaction counts), written on the failure path too |
| Six real Qwen E2Es | **DONE** — all six COMPLETED, validator PASS, three delivered commits, three wrote nothing | `bin/haddad-role-e2e.js`, real runtime, isolated executor home, one git worktree per role |
| No duplicate subsystem | DONE | asserted structurally (ai-team H1–H8), not claimed |
| Security boundary | RE-PROBED | tool-runner 64/0 on the final tree: real `sandboxArgv`, real `bwrap`, U1/U2/U2b/U3 and the escape probes |


## MYTHOS HADDAD V2.2 — FABLE DELEGATION

**Which provider runs a task is now a routed decision, not a configuration read.**
`bridge/provider-selection.js` connects V2.1's roles to the existing `core/provider-router.js`
and `core/agent-registry.js`: role → capability → agent → provider. It adds no routing logic of
its own. Detail: [docs/DELEGATION.md](docs/DELEGATION.md).

| V2.2 item | State | Evidence |
|---|---|---|
| Routing replaces the hardcoded provider | DONE | one expression at the bridge's seam becomes a decision; the pre-V2.2 expression survives as the pin |
| Scoped to execution-worker instances | DONE | routing runs only when `MYTHOS_BRIDGE_EXEC_PROVIDER` is set; the VPS path is character-for-character unchanged, and an explicit `mock`/advisory pin is honoured, not overruled |
| **Routing cannot widen authority** | DONE | runtime down → router prefers `claude-code` → the floor refuses it → **defer**, never substitute. Asserted for all five bridge actions |
| A deferred task is deferred, not blocked | DONE | nothing is wrong with the task and a blocker is never retried; it stays PENDING and the next tick asks again |
| The decision is auditable | DONE | the full decision (role, task_type, capabilities, router answer, allow-list, why) is persisted on the attempt |
| Action → profile invariant untouched | DONE | routing chooses WHO; the action still chooses WHAT. The adapter never reads or writes `execution_profile` |
| Real Issue routed end to end | DONE | [#401](https://github.com/othoth77/mythos-prod/issues/401) on an isolated label: classified `implement` → **debugger** role → `haddad-qwen` → `haddad-agent`, decision recorded, Qwen's fix verified passing |
| `MYTHOS_CORE_ENABLED` | UNCHANGED (`false`) | measured: the four routing modules contain zero `coreEnabled()` checks, so routing never needed it — the plan's text is corrected in the doc |
| Tests | DONE | `tests/mythos-haddad-delegation-test.js` 53/0, every probe injected |

**Found by this stage's E2E and deliberately not fixed here:** a task retried after a transient
failure can complete with the validator passing and deliver **nothing**, because the workspace
snapshot is per-attempt and the previous attempt's work predates it. Same class as the bug
`DELIVERY_FAILED` was added for. It is the next change, on its own.

## MYTHOS HADDAD V2.3 — RESOURCE AWARENESS (the GPU half)

**The resource guard can now answer "is there room on the GPU?".** Before this it measured
`MemAvailable`, PSI and `oom_kill` and knew nothing about the GPU, so it would admit a second
task on RAM alone while the inference runtime had none. Detail and every measured number:
[docs/RESOURCE.md](docs/RESOURCE.md).

| V2.3 item | State | Evidence |
|---|---|---|
| A GPU signal exists | DONE | `lib/gpu-slots.js` reads llama-server's own `/slots`; returns **null** when it cannot answer honestly |
| It does not use the OS VRAM query | DONE | that reader answers `vram_used_mib: 0.0` with a 3,883 MiB model resident — unreliable on NVK, and a confidently wrong number is worse than a missing one |
| Capacity is budgeted against the SHARED pool | DONE | `kv_unified=true` means four slots share ONE 8192-token pool; capacity is `min(slots, floor(pool / task_ceiling))`, not the slot count |
| **MAX_PARALLEL derived from measurement** | DONE | live: 1, 2 and 3 concurrent requests at real task-prompt size all succeeded (1,264 tokens each, +12 % wall clock at n=3). Capacity is still **1**, budgeted against the ~6,400-token ceiling a repair round reaches, because a task's size is not knowable at admission and `/slots` reports occupancy but not KV tokens |
| Admission consults it, and the executor **asks** | DONE | `admission(status, {needs_gpu})` — default false, so every existing call site is unchanged — plus `guardGate(status, task)`, which asks the GPU question when the task's provider is the local Qwen runner. A rule nobody passes is dormant, which is what the first version of this change was |
| Memory pressure still wins | DONE | `CRITICAL` denies GPU work regardless of room |
| An unreadable signal admits | DONE | absent is not zero; telemetry we cannot read must never hold the queue shut |
| Tests | DONE | `tests/mythos-haddad-gpu-admission-test.js` 24/0, every reading injected |

**NOT done in V2.3, stated rather than left to be discovered:** `MYTHOS_MAX_PARALLEL` is
unchanged at 1 (the measurement says there is nothing to raise); non-GPU work is **not** yet
overlapped with GPU work — that is a scheduler change and the signal here is its prerequisite;
and no second full supervised task has been run end to end, only concurrent inference at
task-prompt size.

## MYTHOS HADDAD V2.3 — the scheduler half

**GPU work is serialised by a lease held around a model TURN, so everything that is not
inference overlaps freely.** Before this, `gpu_in_flight` counted RUNNING tasks — and a task is
running for its whole life, including validation, the declared checks, the snapshot and the
delivery commit, none of which touch the card. Detail: [docs/RESOURCE.md](docs/RESOURCE.md).

| Item | State | Evidence |
|---|---|---|
| The lease exists and is per-turn | DONE | acquired immediately before the model call, released the moment it answers, and on the throw path too |
| **It serialises, it does not merely count** | DONE | the first version recorded without enforcing: a live two-task run observed **2** concurrent leases. The turn now waits — `acquireWhenFree()` |
| Waiting is bounded three ways | DONE | the task's own deadline · a TTL so a dead holder cannot wedge the card · re-entry is not a second claim, so a repair round cannot deadlock on itself |
| A task that never gets the card fails loudly | DONE | `HADDAD_AGENT_GPU_BUSY`, named, not silent |
| The gate counts leases, not running tasks | DONE | `gpu_in_flight = gpuSlots.heldCount()` |
| **Measured live** | DONE | two supervised tasks, real runtime: max concurrent leases **1**, one recorded a `gpu_wait`, wall clock **148 s vs 232 s serial — 36 % saved** |
| Tests | DONE | `tests/mythos-haddad-gpu-admission-test.js` **57/0**, including five contention tests |

**Still not done:** `MYTHOS_MAX_PARALLEL` is 1 on this host — the mechanism now makes raising it
safe, but the number itself is an operational change to `worker.env` that should follow a
measurement of full supervised tasks in production. Grants are unordered; under sustained
contention a turn could wait while later arrivals are served, and fixing that means building the
queue this deliberately is not.

## MYTHOS HADDAD V2.6 — unattended continuous operation

**Five of six gate items closed by measurement.** Detail: [docs/UNATTENDED.md](docs/UNATTENDED.md).

| V2.6 gate item | State | Evidence |
|---|---|---|
| multi-task run, unattended, zero autonomous merges | DONE | Issues #410/#411 on the production label, claimed and completed by the live bridge and worker with no intervention; one recovered a transient on its own; both `report` delivery, no commit, `main` untouched |
| every stop-for-human is machine-readable | DONE | **16/16** BLOCKED tasks in the live store carry a blocker code (`HUMAN_APPROVAL` 9, `NO_STRUCTURED_REPORT` 5, `ACTION_PROFILE_MISMATCH` 2) |
| `unattended.classify()` never grants | DONE | property test over the whole table, **136 assertions**, mutation-checked: one injected `APPROVE` turns 136/0 into 135/3 |
| a governance/destructive attempt is denied, run continues | DONE | 8 destructive reasons, **0 granted**; `terminal_for_capability: false` so the capability is not written off |
| Claude spend per completed task measured | DONE | **0.36** calls/task across 22 tasks, against a structural bound of ≤1 (L2 fires only on the last repair round) |
| STD-1 / STD-2 / STD-3 | DONE | 213-suite sweep 0 new 0 changed · no new subsystem (the bridge timer is the loop; no campaign runner wired) · security suites green |

**NOT done:** no autonomous merge, push or PR — delivery still commits locally and never pushes,
and merge stays human-gated. `core/campaign-runner.js` remains unwired on the Haddad path
deliberately: the bridge timer is the loop, and adding a second one would be the duplicate
subsystem this project forbids.

## Next action

**Restart `mythos-haddad-worker.service` once.** It is long-running and still holds pre-merge code;
until then the merged classifier and the `.git` boundary are on disk but not in the running process.
The bridge is a per-tick process and already runs merged code.

Re-run `haddad-mcp-setup.sh` with `HADDAD_MCP_REPO=$HOME/projects/mythos-prod` so the launcher
and the health timer run from the merged checkout. Then HAD-1 (local OTHKM store) to configure the knowledge
tools. Owner decision, deferred: registering Haddad in the VPS estate MCP registry (needs a VPS→Haddad SSH
credential). Still pending from V0: add the Windows client's SSH key and set `PasswordAuthentication no`.
