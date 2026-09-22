# Mythos Haddad — status

**V0: COMPLETE — verified 2026-09-21 (issue #328). Delivered: PR #330 merged into `main` as `670b4268`; issues #328 and #329 closed.**

**HAD-2 (first local AI runtime, V1): COMPLETE — verified 2026-09-21.** llama.cpp on the Vulkan backend,
one pinned Qwen2.5-7B-Instruct-Q4_K_M model, OpenAI-compatible endpoint on `127.0.0.1:8600`, systemd user
service. Full detail, measurements and rollback: [docs/AI_RUNTIME.md](docs/AI_RUNTIME.md).

| HAD-2 item | State | Evidence |
|---|---|---|
| Vulkan backend installed | DONE | `llama.cpp-tools`/`libggml0-backend-vulkan` 0.9.11-1 (Ubuntu 26.04 universe), unpacked to a user prefix — no root, no source build |
| GPU acceleration verified | DONE | `llama-cli --list-devices` → `Vulkan0: NVIDIA GeForce GTX 1660 SUPER`; 29/29 model layers offloaded to GPU |
| Model selected + installed | DONE | Qwen2.5-7B-Instruct-Q4_K_M, official Qwen org, sha256-pinned, 4.36 GiB, fits 6 GB VRAM with headroom |
| Real inference test | DONE | Three chat-completion requests through the OpenAI-compatible endpoint, all factually correct |
| VRAM/RAM measured | DONE | VRAM 4696 MiB (runtime's own accounting — the OS-level Vulkan budget query is unreliable on this driver, documented); RAM ~430–505 MiB steady-state RSS |
| Performance measured | DONE | ~20–25 tok/s generation once warm, ~19–81 tok/s prompt processing |
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

**HAD-4 (tool runner + supervised execution): COMPLETE — proven live 2026-09-22.** Qwen writes and runs
inside a per-command bwrap sandbox; `lib/work-validation.js` re-runs every declared check itself and
measures the workspace; a bounded repair loop (3 executions, compact briefs, per-execution turn/tool
budgets, 1,536 tokens per turn) hands Qwen its measured failures, with a diagnosis-only Sonnet
escalation on the last round. Real E2E gh-issue-379: attempt FAIL → repair FAIL → repair + diagnosis →
both checks PASS by the validator → COMPLETED → review gate → `haddad:human-approval`. Fake success caught
live (#373, #376, #378), exhaustion → HUMAN_APPROVAL with the trace (#376), crash recovery (#381),
dependency wait while an independent task runs (#380/#381). Detail: [docs/GITHUB_WORKER.md](docs/GITHUB_WORKER.md),
`docs/MYTHOS_REVIEW_POLICY.md`.

## Next action

HAD-3 (Haddad MCP), per the V1 order in `docs/MYTHOS_HADDAD_V1_SCOPE.md` — expose health/GPU/runtime/knowledge
as read-only MCP tools over SSH-stdio. Before that: add the Windows client's SSH key and set
`PasswordAuthentication no` (still pending from V0).
