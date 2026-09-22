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

## Next action

**Restart `mythos-haddad-worker.service` once.** It is long-running and still holds pre-merge code;
until then the merged classifier and the `.git` boundary are on disk but not in the running process.
The bridge is a per-tick process and already runs merged code.

Re-run `haddad-mcp-setup.sh` with `HADDAD_MCP_REPO=$HOME/projects/mythos-prod` so the launcher
and the health timer run from the merged checkout. Then HAD-1 (local OTHKM store) to configure the knowledge
tools. Owner decision, deferred: registering Haddad in the VPS estate MCP registry (needs a VPS→Haddad SSH
credential). Still pending from V0: add the Windows client's SSH key and set `PasswordAuthentication no`.
