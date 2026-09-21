# Mythos Haddad — V1 Scope

**Stage:** HAD-1 … HAD-6 (V1)
**Status:** Scope proposal — **nothing implemented**. No V1 code exists.
**Date:** 2026-09-21
**Predecessor:** V0 complete and merged (#330, #331; `670b4268`, `b3d91328`). See `projects/mythos-haddad/README.md` and `STATUS.md`.
**Machine:** `haddad` — Ryzen 5 1600 (6c/12t), 8 GB RAM, GTX 1660 SUPER 6 GB VRAM, Ubuntu 26.04 / kernel 7.0, Tailscale-only (`100.78.7.10`).

---

## 1. What V1 is

V0 proved the machine. **V1 makes it useful without making it authoritative.**

V1 gives Haddad: grounded memory it can read and propose into, a read-only surface other Mythos components can query, a local model that actually runs on the GPU, and an advisory agent that uses all three — under the existing Mythos safety model, with no new frameworks.

**V1 is explicitly NOT:** execution authority for the local model, canonical knowledge writes, a second task queue, multi-GPU or multi-model orchestration, fine-tuning, a public endpoint, or a replacement for any VPS service.

### 1.1 The governing finding

Five parallel investigations of the codebase produced one dominant result:

> **Almost every "component" in the V1 priority list already exists in this repository.** V1 is overwhelmingly *wiring and exposure*, not engine-building.

Concretely, of the six requested components, **one must genuinely be built** (AI Runtime — nothing in the repo does local inference), **four are integrations of existing, tested systems**, and **one must not be built at all** (Task Queue — two working queues already run in production).

This is the `search-first` skill's SEARCH → REUSE → ADAPT → CONNECT → **BUILD LAST** order applied honestly. Where this document says "build", it states what was searched and why nothing fit.

---

## 2. Verified baseline

Everything in this section was verified against the working tree at `b3d91328` or measured on `haddad` on 2026-09-21. Claims that were *not* verified are marked.

### 2.1 Hardware envelope (measured)

| | |
|---|---|
| VRAM | **6144 MiB** (`nouveau` DRM log; Vulkan heap reports 6400 MiB) |
| RAM | 7.2 GiB total, ~5 GiB available, 4 GiB swap |
| Disk | 84 GiB free on `/` |
| GPU stack | `nouveau` + GSP 570.144, **Vulkan 1.4.335 via Mesa NVK**, no CUDA |
| Render node | `/dev/dri/renderD128`, `root:render 0660`, user has rw |

**Consequence:** the practical local-model ceiling is a **7–8B model at Q4_K_M (~4.5–5 GB)** fully GPU-resident, leaving ~1 GB VRAM for the KV cache. Anything larger spills to system RAM across a 6 c CPU and an HDD, which is not a production posture. V1 targets one model at a time.

### 2.2 AI runtime feasibility (verified by apt resolution; nothing installed)

Ubuntu 26.04 ships a packaged llama.cpp **and a separately packaged Vulkan backend**:

```
llama.cpp-tools           8681+dfsg-1
libllama0                 8681+dfsg-1
libggml0                  0.9.11-1
libggml0-backend-vulkan   0.9.11-1   Depends: libvulkan1 (>= 1.2.131.2)
```

`apt-get install -s --no-install-recommends llama.cpp-tools libggml0-backend-vulkan` resolves cleanly. ggml loads backends dynamically, and the Vulkan backend depends on exactly the `libvulkan1` stack V0 verified.

**No source build is required for GPU inference.** This removes the largest anticipated V1 risk.

### 2.3 Topology (measured from `haddad`)

| Fact | Consequence |
|---|---|
| `haddad` → VPS `51.68.226.211:22` — **TCP reachable** | An outbound path exists |
| VPS is **not** a tailnet node | No private path today |
| `haddad` has no known-hosts entry and no working credential for the VPS | **No usable link today** |
| OTHKM HTTP facade binds `127.0.0.1:8150` on the VPS | Not reachable from `haddad` even with SSH, without a tunnel |
| Executor HTTP binds `127.0.0.1:8130` on the VPS | Same |

**This is the single most consequential constraint in V1.** Any Haddad → VPS data path is an **owner-gated prerequisite**: either add the VPS to the tailnet, or register a Haddad key on the VPS. V1 is therefore designed to be **fully useful with no VPS link at all**, and the one component that genuinely needs the link (Task Queue join) is deferred behind it.

### 2.4 Existing systems V1 reuses

| System | Location | State | What V1 takes |
|---|---|---|---|
| OTHKM knowledge engine | `projects/oth-knowledge/` | ~5500 lines, zero-dep, 25 test suites, live on VPS | Record model, append-only store, provenance, 6-tier trust, hybrid search, `propose` gate |
| MCP server pattern | `projects/oth-mcp/server.js` | 390 lines, stdio JSON-RPC, 8 read-only tools | Structure, tool shape, SSH-stdio transport, invariant test |
| Executor queue | `projects/mythos-ai-executor/lib/state.js` | **Running in production**, 8 states, priority-FIFO | Joined, not rebuilt |
| Orchestration Core | `projects/mythos-ai-executor/core/` | ~7000 lines, DAG scheduler, `MYTHOS_CORE_ENABLED` default true | Joined, not rebuilt |
| Provider contract | `projects/mythos-ai-executor/providers/` + `config/agents.json` | 6 providers, `{available, version, run, executionAuthority}` | Haddad registers as one more |
| OpenAI-compat adapter | `free-llm/adapter.js` | Generic, spec **per call** | Reused verbatim for local inference |
| Multi-host relay | `ops/lifecycle/mythos-pc-agent.js` | Working Windows-PC precedent | Transport pattern for HAD-6 |
| hostops allowlist | `ops/hostops/` + `ops/dagu-poc/hostops-allowlist.json` | READ verbs installed on VPS | Policy pattern for GPU Manager |
| Guardian observe-only | `ops/guardian/` | Running, CI-enforced | Posture pattern for GPU Manager |
| V0 base | `projects/mythos-haddad/` | 13/13 health, 8/0 tests | Extended, not replaced |

### 2.5 Two safety invariants V1 must not break

These were verified verbatim in source and constrain the design more than anything else.

**(a) The free-LLM layer is advisory-only, permanently.**

`providers/free-llm-pool.js:84` → `executionAuthority: false`; `config/agents.json` carries `execution_authority` explicitly per agent (one `true`, three `false`).

**(b) Fallback never changes security authority.** `core/provider-router.js:16-21`, verbatim:

```
// Fallback never silently increases (or changes) security authority:
// an execution task can only fall back to another execution-authority
// agent, and by default it cannot fall back at all.
```

**Consequence for V1:** registering Haddad's local model as a *free-LLM provider* would quietly grant it execution authority through an advisory path. V1 therefore registers Haddad as **its own agent with `execution_authority: false`**. Granting execution authority to a 7B local model is a separate, explicit, owner-gated decision — **out of V1 scope**.

### 2.6 A required step that is easy to miss

`projects/status-center/lib/engine.js` flags any `projects/*` directory not claimed by a project's `directories[]`. Computed against the current tree:

```
project dirs: 25   claimed: 24   UNCLAIMED: ['projects/mythos-haddad']
PROJECT-MYTHOS-HADDAD exists in registry.json: False
```

The next `review.js` run will surface `projects/mythos-haddad` as a NEW_DISCOVERY. **Registering `PROJECT-MYTHOS-HADDAD` in `projects/status-center/data/registry.json` is a required V1 step, not optional** — and per `status-sync`, the Status Center is written only by its own engine or a curated registry commit.

---

### 2.7 Verification of this proposal

Every checkable claim in this document was asserted against the working tree at `b3d91328` and against `haddad` itself on 2026-09-21 — **43 checks, 43 passed**:

- all 25 named reuse targets exist at the stated paths;
- `free-llm-pool` declares `executionAuthority: false`; `provider-router` carries the no-authority-change fallback rule; every `agents.json` entry declares `execution_authority`;
- `adapter.chatCompletion(spec, prompt, opts)` has the stated signature and enforces `FREE_LLM_KEY_UNAVAILABLE`; `openai-compat` is `baseUrl`-parameterized;
- `oth-mcp/server.js` contains no mutating HTTP verb;
- OTHKM enforces `OTHK_STORE_INREPO` and `OTHK_STORE_UNREADABLE`; `propose` takes a staging store; `claim` requires `asserted_by`; the trust model caps at `model-output`;
- the executor queue and the core DAG scheduler both exist (justifying "do not build a third");
- `projects/mythos-haddad` is the **only** unclaimed project directory and `PROJECT-MYTHOS-HADDAD` is absent;
- the V0 model/runtime dirs are reserved and empty; `/dev/dri/renderD128` is present and group-accessible;
- **the V0 test suite still passes (8/0).**

The verification was a one-off scoping check and is deliberately **not** committed — V1 ships no code until its stages are authorised. Re-deriving it is a few minutes' work from the file references above.

---

## 3. V1 architecture

```
                         ┌─────────────────── haddad (on-prem, tailnet only) ───────────────────┐
                         │                                                                      │
  other Mythos       ssh │  ┌────────────────┐   read-only    ┌──────────────────────────────┐  │
  components / Claude ───┼─▶│  Haddad MCP    │───────────────▶│ health · GPU · runtime state │  │
  (stdio, no new port)   │  │  (HAD-3)       │                │ local OTHKM (read)           │  │
                         │  └────────────────┘                └──────────────────────────────┘  │
                         │                                                                      │
                         │  ┌────────────────┐    HTTP 127.0.0.1  ┌─────────────────────────┐   │
                         │  │ Agent Core     │───────────────────▶│ AI Runtime (HAD-2)      │   │
                         │  │ (HAD-4)        │  OpenAI-compatible │ llama-server + Vulkan   │   │
                         │  │ advisory only  │                    │ GTX 1660 S · 6 GB VRAM  │   │
                         │  └───────┬────────┘                    └───────────┬─────────────┘   │
                         │          │ propose (model-output tier)             │ single VRAM slot │
                         │          ▼                                         ▼                  │
                         │  ┌────────────────┐                    ┌─────────────────────────┐   │
                         │  │ OTHKM local    │                    │ GPU Manager (HAD-5)     │   │
                         │  │ (HAD-1)        │                    │ admission + observe     │   │
                         │  │ canonical-ro   │                    └─────────────────────────┘   │
                         │  │ + staging-rw   │                                                  │
                         │  └────────────────┘                                                  │
                         └──────────────────────────────────┬───────────────────────────────────┘
                                                            │ OWNER-GATED (no link today)
                                                            ▼
                                              VPS executor queue :8130  (HAD-6, deferred)
```

Four properties hold by construction:

1. **Nothing in V1 requires the VPS.** HAD-1…HAD-5 are fully local and fully testable on `haddad` alone.
2. **Nothing in V1 has execution authority.** The local model advises; it never mutates a repository, a production system, or canonical knowledge.
3. **Nothing in V1 opens a port.** The MCP surface is SSH-stdio over the tailnet; inference binds loopback only.
4. **Every mutation path is behind an enable marker**, per the repo-wide `touch`/`rm` convention.

---

## 4. Components

Each component below gives: purpose · existing resource to reuse · minimal implementation · dependencies · security · tests.

---

### HAD-1 — OTHKM integration *(requested priority 1)*

**Purpose.** Give Haddad grounded, provenance-carrying memory it can read, and a safe path for the local model to *propose* new knowledge without ever writing canonical truth.

**Existing resource to reuse.** Effectively all of it. `projects/oth-knowledge/` is a zero-dependency engine with 25 test suites:

- `lib/knowledge-service.js` — read-only service (`openService`); write methods are *deliberately absent* from the surface.
- `lib/propose.js:35` — `proposeMemory(stagingStore, canonicalStore, candidate, …)`, documented as *"The ONLY write an AI is allowed: propose a candidate into a STAGING store. It never touches canonical truth."*
- `lib/promotion-gate.js` — caps the proposer's trust tier so an AI cannot self-declare first-party truth.
- `lib/model.js:82-83` — a **fact** carries confidence; a **claim** must name `asserted_by`. LLM output is a claim, structurally.
- `lib/store.js` — append-only JSONL, `assertNotInRepo()`, `OTHK_STORE_UNREADABLE` (unreadable ≠ empty).
- `lib/search.js` — BM25 + vector + hybrid RRF, Unicode-aware tokenizer.

**Minimal implementation.**

1. Provision a Haddad-local store root outside Git: `~/.local/share/mythos-haddad/knowledge/` (canonical-local) and `.../knowledge-staging/` (staging), `0700`.
2. `projects/mythos-haddad/bin/haddad-knowledge.js` — a thin CLI wrapper over `openService()` for read (`search`, `get`, `provenance`) and over `proposeMemory()` for the agent's propose path. It adds **no** engine logic.
3. Namespace all Haddad-origin records to `projects/haddad` (the namespace field already exists and is isolation-enforced in `search.passesFilters`).
4. Proposals are capped at tier `model-output` — the existing default in `othmode-memory.js`, not a new rule.
5. Promotion stays an **operator** action via the existing `othk-cli` promote path. No automated promotion in V1.

**Explicitly deferred:** reconciling the Haddad-local store with the VPS canonical store at `/home/deploy/othk-store`. That store is single-writer by design and unreachable from `haddad` today (§2.3). V1 treats Haddad's store as its own namespace; **whether the two are one truth or two stores that reconcile is the single genuine architectural decision V1 leaves open** — and it should be answered in V2, with the link in place.

**Dependencies.** None. Zero-dep library, local files. Independent of every other component.

**Security.**
- Store outside Git — enforced by `assertNotInRepo()`, which throws `OTHK_STORE_INREPO`.
- `0700` dirs / `0600` files (`store.js`), matching the repo-wide convention.
- The ingest secret gate (`ingest.js:68-93`) refuses credential shapes and records **only the pattern name** — never the matching text.
- The model can only ever produce *claims* in a *staging* store at the *lowest* trust tier. Three independent barriers between an LLM and canonical truth.
- **Backup gate (binding).** Per the MPI-D5 precedent (`docs/MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md:262,274`) and `AGENTS.md:283` — *"A backup is valid only after restoration is tested."* Haddad is off-VPS, so `ops/backup`'s root-side `docker exec` pipeline does not reach it. **V1 ships with real-knowledge ingestion disabled** (`HADDAD_KNOWLEDGE_INGEST_ENABLED=NO`, synthetic fixtures only) until a verified, restore-tested off-host destination exists for Haddad. Reuse `projects/infrastructure/ops/offhost-backup.js` + `adapters/s3-compatible.js` — new destination, existing tooling.

**Tests.** `tests/mythos-haddad-knowledge-test.js`, offline, temp store roots (never the real one — the free-llm suites once contaminated production reputation state by omitting exactly this):
- a proposal never lands in the canonical store;
- a proposal above `model-output` tier is refused;
- LLM text enters as a `claim` carrying `asserted_by`, never as a `fact`;
- namespace isolation holds for `projects/haddad`;
- an unreadable store raises `OTHK_STORE_UNREADABLE` rather than reading empty;
- the store root is refused if it resolves inside the repo.

---

### HAD-2 — AI Runtime *(requested priority 3 — recommended second; see §5)*

**Purpose.** Run one quantized model on the GPU, exposed as an OpenAI-compatible endpoint on loopback. This is the one component with no existing implementation to reuse.

**Existing resource to reuse.** Search-first result: a repo-wide grep for `ollama|llama.cpp|vllm|localai|gguf|lm-studio` returns **two hits, both aspirational prose** in Haddad's own V0 docs. Nothing in Mythos does local inference. But the *client* side is fully reusable:

- `free-llm/adapter.js:85-114` — `chatCompletion(spec, prompt, opts)` where `spec = {baseUrl, apiKey, model}` **per call**. Its header states the contract was *"generalised to take {baseUrl, apiKey, model} PER CALL"*. It is therefore **catalog-independent**: a local server needs no registry entry to be callable.
- `providers/openai-compat.js:86` — already reads `opts.baseUrl || task.base_url || DEFAULT_BASE_URL`, i.e. already parameterized.
- V0's `bin/gpu-vulkan-test.py` and `haddad-health.js` — extended, not replaced.

So the build is confined to **process supervision and model management**; the HTTP client is reuse.

**Minimal implementation.**

1. Owner step (root, one line): `apt install --no-install-recommends llama.cpp-tools libggml0-backend-vulkan`.
2. One GGUF model in `~/.local/share/mythos-haddad/models/` (already reserved by V0, currently empty). V1 pins **one** model — a 7–8B Q4_K_M — by filename and SHA-256.
3. `systemd/mythos-haddad-runtime.service` — a **user** unit, `Type=simple`, running `llama-server` with:
   - `--host 127.0.0.1` (never `0.0.0.0`),
   - `--api-key` from `~/.config/mythos-haddad/runtime.env` (mode 600). This is **required**, not optional: `adapter.js:92-94` returns `FREE_LLM_KEY_UNAVAILABLE` for a keyless spec, so a token satisfies the existing contract with **zero code change**.
   - `-ngl` sized to keep the model resident in 6 GB VRAM.
4. Extend `haddad-health.js` with a `runtime` check: process up, `/v1/models` answers, the served model matches the pinned SHA.

**Dependencies.** GPU stack verified in V0 (done). Nothing else.

**Security.**
- **Loopback binding is the real control** — the repo's own stated rule (`mythos-command-center.user.service:19-22`: *"The binding is the real control"*). Never publicly bound; not even tailnet-bound in V1.
- Token in `~/.config/mythos-haddad/runtime.env`, `0600`, `EnvironmentFile=`, never echoed. Absent ⇒ the runtime reports `NOT_CONFIGURED` and does not start.
- **`PrivateDevices=yes` must NOT be set** on this unit — it hides `/dev/dri/renderD128` and the GPU silently disappears. This is a real, documented trap in this repo's unit conventions.
- **`MemoryDenyWriteExecute` must NOT be set** — incompatible with JIT/W^X, and it fails only under load.
- As a **user** unit it must not set `ProtectKernelTunables`, `ProtectKernelModules`, `ProtectControlGroups`, `ProtectClock` or `RestrictNamespaces` — each implies a capability-bounding-set change an unprivileged user manager may not make, and the unit then never spawns (`status=218/CAPABILITIES`). This is documented from a real on-host failure in `ops/guardian/systemd/mythos-guardian.service:34-40` and cost `ssangyong-storefront.service` 2830 restarts.
- `MemoryMax` + `OOMScoreAdjust` so inference is never the reason the machine is short of memory. Given 8 GB total on a machine that also hosts Claude Code sessions, this is not optional.
- Model files are treated as untrusted input: pinned by SHA-256, verified before load.

**Tests.** `tests/mythos-haddad-runtime-test.js` — offline, no model required (asserts unit/config invariants); plus an on-host runtime check in `haddad-health.js`:
- the unit binds loopback only (asserted against the unit file text);
- the unit sets no user-scope-fatal directive and does not set `PrivateDevices`/`MemoryDenyWriteExecute`;
- a keyless spec is refused by the adapter (mutation-proof the token requirement);
- health reports `NOT_CONFIGURED`, not a crash, when the token or model is absent;
- an on-host smoke test: a completion returns text and the GPU actually served it.

---

### HAD-3 — Haddad MCP *(requested priority 2 — recommended third; see §5)*

**Purpose.** Let other Mythos components and Claude sessions read Haddad's state — health, GPU, runtime, local knowledge — through the protocol the estate already speaks. Read-only.

**Existing resource to reuse.** `projects/oth-mcp/server.js` is a 390-line, dependency-free stdio JSON-RPC 2.0 server, and it is the house pattern. V1 mirrors it rather than inventing:

- Tool shape — every tool declares `owner`, and the server appends `' [owner: X]'` to each description (`server.js:345`).
- `upstreamGet` as the **only** upstream function: *"No other verb exists in this file — a write cannot be added by accident."*
- Per-upstream token from env; `UPSTREAM_UNCONFIGURED` rather than guessing.
- Bounded everything — 15 s timeout, 512 KiB response cap.
- Error codes as `UPPER_SNAKE` strings.
- The **SSH-stdio launcher** (`README.md:108-131`): the client runs `ssh haddad /path/haddad-mcp-stdio.sh`. The launcher sources a `0600` env file because a non-interactive SSH shell skips `~/.bashrc`.

The SDK decision is also inherited: hand-rolled, with the documented revisit condition *"HTTP/SSE transport, OAuth, or resource subscriptions"*. V1 triggers none of these.

**Minimal implementation.** `projects/mythos-haddad/mcp/server.js` + `haddad-mcp-stdio.sh` launcher, exposing **read-only** tools:

| Tool | Owner | Source |
|---|---|---|
| `haddad_health` | Mythos Haddad | `~/.local/state/mythos-haddad/health-latest.json` |
| `haddad_gpu` | Mythos Haddad | `gpu-vulkan-test.py` report + VRAM state |
| `haddad_runtime` | Mythos Haddad | runtime liveness, pinned model id |
| `haddad_knowledge_search` | OTH Knowledge (local) | HAD-1 local store, read-only |

**Transport: SSH-stdio over Tailscale. No new port, no new listener, no firewall change** — which keeps V0's strictest guarantee (`README.md:49`: *"Do not forward port 22 on the router and do not open it in any cloud/edge firewall"*) intact by construction.

**Dependencies.** HAD-1 (for the knowledge tool) and HAD-2 (for the runtime tool). It can technically ship earlier against V0 health alone, but would then be rewritten — see §5.

**Security.**
- Read-only by construction, mirroring the oth-mcp structure: one read-only accessor, no mutating verb anywhere in the file.
- No authority of its own; it reports state it does not own.
- Reachable only by someone who can already SSH to `haddad` — the MCP surface adds **no** new access.
- Reports `UNCONFIGURED` for an absent subsystem rather than inventing a value.
- Never emits the runtime token, a file path outside the state dir, or raw model output.

**Tests.** `tests/mythos-haddad-mcp-test.js`, modelled on `tests/othk-6-mcp-server-test.js` §W — the "load-bearing" test that greps its own source:
- no tool name implies a write;
- no mutating HTTP verb or write syscall appears in the server source;
- every tool declares an owner;
- a `tools/call` changes no file outside the state directory;
- an absent upstream yields `UNCONFIGURED`, never a fabricated answer.

**Note a real gap:** no MCP suite currently runs in CI (only `guardian-suite.yml`, path-filtered, and the manual `vps-final-gate.yml`). HAD-3 should add a path filter for `projects/mythos-haddad/**` — but `.github/workflows/**` is a governance-protected path, so that change needs the owner's explicit approval.

---

### HAD-4 — Agent Core *(requested priority 4)*

**Purpose.** Let Haddad's local model answer Mythos-shaped tasks — analysis, review, summarization, second opinion — as a registered, **advisory** agent, grounded in HAD-1 knowledge.

**Existing resource to reuse.** The provider/agent contract, which already has four implementations:

- `config/agents.json` — one entry per agent: `{provider, capabilities, task_types, model, execution_authority, risk_level, cost, latency}`.
- `providers/*.js` — contract `{available, version, run, executionAuthority}`.
- `executor.js:50-58` — a one-line `PROVIDERS` map registration.
- `core/agent-registry.js` — cost-tier ranking where `free` already outranks `subscription`/`metered`, which a local model naturally wins.
- `core/reputation.js`, `lib/quota.js` — existing ranking and outcome classification.

The precedent is explicit: `free-llm-pool` was added as **one config entry + one adapter + one `PROVIDERS` line**. HAD-4 is the same shape.

**Minimal implementation.**

1. `projects/mythos-ai-executor/providers/haddad-local.js` — thin adapter pointing at HAD-2's loopback endpoint, reusing the existing OpenAI-compatible request/response handling.
2. `config/agents.json` entry:
   - `execution_authority: false` — **mandatory** (§2.5),
   - `task_types`: `research`, `review`, `analysis`, `planning`, `summarization` only,
   - `risk_level: low`, `cost.tier: free`.
3. One line in the `executor.js` `PROVIDERS` map.
4. `available()` returns false when the runtime is down, so the executor routes elsewhere rather than failing.

**Not done in V1:** registering Haddad in the *free-LLM* pool. That pool is advisory-only by design and its `catalog.json` is fully regenerated from an upstream README on a daily timer — a hand-added local provider would be **silently dropped** at the next sync. Adding a local provider there properly needs a fourth catalog source merged in `registry.js`; that is real work for no V1 benefit, since the agent registry is the correct home for an execution-capable component anyway.

**Dependencies.** HAD-2 (a model to call) and HAD-1 (knowledge to ground answers). **This is why HAD-2 must precede it.**

**Security.**
- `execution_authority: false`, and `core/provider-router.js` guarantees an execution task can never fall back onto it.
- No repository write path, no shell, no `child_process` — it turns a prompt into text.
- Prompts are secret-scanned before dispatch, reusing `lib/redact.js` (the repo's single redaction implementation — never a second one).
- Model output is untrusted input: it is a *claim* if it reaches knowledge, and it is never executed, never eval'd, never written to a config.
- Bounded: per-attempt timeout, overall deadline, prompt-size caps — mirroring `free-llm-complete.js`'s limits (6000/3000 chars, 64 KiB stdin).

**Tests.** `tests/mythos-haddad-agent-test.js`, offline with an injected transport (the house convention):
- the agent's registry entry has `execution_authority: false` — a mutation test flipping it must fail the suite;
- an execution-class task never routes to this agent;
- `available()` is false when the runtime is down, and the executor degrades rather than errors;
- prompts carrying secret-shaped content are refused before dispatch;
- output never reaches a write path.

---

### HAD-5 — GPU Manager *(requested priority 6 — recommended fifth)*

**Purpose.** Stop two workloads from trying to occupy 6 GB of VRAM at once, and make GPU state observable. On this hardware, VRAM exhaustion is the realistic failure mode.

**Existing resource to reuse.**
- `lib/resource-guard.js` — the executor's existing **admission-control** concept: check pressure, defer rather than start. V1 applies the same shape to VRAM.
- `ops/guardian/` — the observe-only posture, enforced at three layers (code allowlist, `ReadWritePaths` sandbox, and a CI grep gate).
- `ops/dagu-poc/hostops-allowlist.json` — the policy shape if a mutating verb is ever added: classes `READ` (no approval) / `WRITE` / `RESTART` (governance) / `DEPLOY` (owner) / `DESTRUCTIVE` (never), with **anchored regexes in the policy file** and a **code ceiling below the policy ceiling**.
- V0's `gpu-vulkan-test.py` — already reads device and heap state.

**Minimal implementation.** Deliberately small:

1. A **single-slot VRAM lock** under `~/.local/state/mythos-haddad/` — one GPU consumer at a time. A second claimant waits or is refused; it never preempts.
2. A read-only `gpu-status` reporter (device, VRAM total/used, current holder, AER error count) feeding `haddad-health.js` and the `haddad_gpu` MCP tool.
3. **Observe-only in V1.** No model load/unload, no process kill, no reset. Following Guardian's rule: *"'Guardian may clear a cache' and 'Guardian may do so unattended at 4am' are never the same checkbox."*

**Deferred to V2:** any mutating verb (load/unload/restart-runtime). When it comes, it uses the hostops class model and an enable marker — not a new approval system.

**Dependencies.** HAD-2 (there must be a GPU consumer worth managing). Building this before a real workload exists would be guessing at the failure modes.

**Security.**
- No privileged operation: the render node is group-accessible, so no root, no sudo, no capability.
- Observe-only enforced *from outside the code* via `ReadWritePaths` — the Guardian lesson that a sandbox boundary beats a convention.
- The lock is advisory within Haddad; it is not a security boundary and the document should not pretend otherwise.
- If a mutating verb is ever added: anchored argument patterns, a code ceiling below the policy ceiling, fail-closed audit (a success whose audit cannot be written is withheld).

**Tests.** `tests/mythos-haddad-gpu-test.js`:
- two concurrent claims never both succeed;
- a stale lock from a dead process is reclaimed (PID liveness, the `effectiveStatus`/`orphaned` pattern);
- the reporter performs no write outside the state dir — asserted by recording write primitives, as `tests/guardian-test.js` §10 does;
- a CI-style grep asserting no remediation primitive (`child_process`, `process.kill`, `unlinkSync`, …) appears in the module.

---

### HAD-6 — Task Queue *(requested priority 5 — recommended last, and mostly NOT built)*

**Purpose as requested:** give Haddad a task queue.

**Finding: do not build one.** Two queues already exist and one is running in production:

| System | What it is | State |
|---|---|---|
| `mythos-ai-executor/lib/state.js` | Persistent queue, 8 states + transition table, priority-then-FIFO, retry backoff, `WAITING_FOR_QUOTA` as a first-class non-failure, 15 s daemon, pid lock, resource-guard admission | **Running in production** |
| `mythos-ai-executor/core/` | Goals → missions → **task DAG**: pure Kahn topological sort, cycle detection, failure propagation, bounded worker pool, per-task git worktree isolation, budget leases, approval gates | Implemented, wired, `MYTHOS_CORE_ENABLED` default true, 257/0 tests |

Building a third queue would violate `AGENTS.md` scope control and the `search-first` order outright. `projects/automation/`'s 24-table queue schema is likewise **reference only — never deployed**; it should not be resurrected for this.

**The real V1 question is therefore: how does Haddad join the existing queue?**

**Existing resource to reuse.** The multi-host relay already exists and was built for exactly this shape: `lib/lifecycle/runtime-pc.js` + `ops/lifecycle/mythos-pc-agent.js` relays a *second machine* to the VPS executor over bearer + HMAC, with heartbeats and an outbox for inbound requests. Its safety stance is the right one and should be preserved verbatim:

> *"a close request is advice to another machine, not a command with authority there."*

Haddad is a better fit for that pattern than the Windows PC it was written for.

**Minimal implementation.** Register Haddad as an agent (HAD-4 already does this) and relay via the existing PC-agent pattern. **No new queue, no new scheduler, no new state machine.**

**Dependencies — and the blocker.** This is the one component that **requires the VPS link**, which does not exist today (§2.3). It is therefore **deferred behind an owner decision**:

> **Owner action required:** either add the VPS to the tailnet, or register a Haddad key on the VPS. Until then HAD-6 cannot start — and HAD-1…HAD-5 do not need it.

**Security.** Bearer + HMAC as in the existing relay; Haddad honours inbound requests only under its **own** local policy; the relayed agent keeps `execution_authority: false`; no inbound listener on Haddad.

**Tests.** Deferred with the component. When it lands, it extends `tests/mythos-lifecycle-test.js`'s existing relay coverage rather than starting a new suite.

---

## 5. Order of implementation

**Requested priority:** OTHKM → MCP → AI Runtime → Agent Core → Task Queue → GPU Manager.

**Recommended order**, which respects that priority except where a dependency or a blocker forbids it:

| # | Stage | Component | Why here | Depends on |
|---|---|---|---|---|
| 1 | **HAD-1** | OTHKM integration | Requested first **and** dependency-free. No reason to move it. | — |
| 2 | **HAD-2** | AI Runtime | **Moved up from 3.** Both Agent Core and GPU Manager depend on it, and it carries the only genuine build risk — retire it early. Now verified low-risk (§2.2). | — |
| 3 | **HAD-3** | Haddad MCP | **Moved down from 2.** Built once against a stable surface (health + GPU + runtime + knowledge) instead of twice. Building it at #2 means rewriting it at #4. | HAD-1, HAD-2 |
| 4 | **HAD-4** | Agent Core | Needs a model to call and knowledge to ground. | HAD-2, HAD-1 |
| 5 | **HAD-5** | GPU Manager | Needs a real workload; its failure modes are otherwise guesswork. | HAD-2 |
| 6 | **HAD-6** | Task Queue join | **Owner-gated** on the VPS link. Mostly not built. | Owner action, HAD-4 |

**Two deviations from the requested order, both deliberate:**

1. **AI Runtime and MCP swap.** MCP's value is exposing state; at priority 2 there is almost nothing to expose beyond V0 health, so it would be rewritten after the runtime lands. One deviation, one rewrite avoided.
2. **Task Queue is descoped to "join, not build"** and moved last because it is the only component with an external blocker.

`docs/ROADMAP.md` carries the operating rule **"One Major Implementation Stage at a Time"** — new runtime code, new services, migrations and live data all qualify. Every stage above is a major stage. They are sequential, and each is complete only when committed, pushed, remote-verified and recorded in `docs/AI_HANDOVER.md`.

---

## 6. Cross-cutting requirements

These apply to every stage and are drawn from existing repo rules, not invented here.

1. **Status Center registration (HAD-1, required).** Add `PROJECT-MYTHOS-HADDAD` to `projects/status-center/data/registry.json` with `directories: ["projects/mythos-haddad"]`. Without it, the next review surfaces Haddad as an unclassified NEW_DISCOVERY (§2.6). Use the fixed vocabularies; never a percentage without `basis: CALCULATED`.
2. **Monitoring must not be silent.** Extend `haddad-health.js` per stage. Haddad is tailnet-only, so a Status Center HTTP probe cannot reach it — health state must travel via the MCP surface or the HAD-6 relay, or be explicitly recorded as `NOT_MONITORED` with a disposition.
3. **Secrets.** `~/.config/mythos-haddad/<name>.env`, mode `0600`, `EnvironmentFile=`, outside Git, never echoed. Absent ⇒ `NOT_CONFIGURED`, never invented.
4. **Enable markers** for anything that mutates: `touch` to enable, `rm` for instant rollback.
5. **systemd**, per the repo's hard-won rules: user units under `othman`; never `PrivateDevices` on the GPU unit; never `MemoryDenyWriteExecute` for a JIT runtime; never the capability-implying `Protect*`/`RestrictNamespaces` directives in user scope; `MemoryMax` + `OOMScoreAdjust` on every support unit; `Documentation=` on every unit; install/rollback in a sibling README.
6. **No new ports, no public exposure.** Loopback or SSH-stdio only. V0's firewall and port-forwarding guarantees must survive V1 intact.
7. **Tests offline and hermetic**, with injected transports and isolated state dirs. Never write to a production store — the free-llm suites once contaminated production reputation state by exactly that omission.
8. **CI.** No workflow currently covers `projects/mythos-haddad/**`. Adding one touches the governance-protected `.github/workflows/**` and needs explicit owner approval. Until then, verification is a fresh clone plus the test suites, as V0 did.
9. **Delivery discipline** (`AGENTS.md` §15, §17, §18): never deploy from an uncommitted worktree; confirm env vars without printing values; commit, push, verify remote HEAD, and record the stage in `docs/AI_HANDOVER.md`.

---

## 7. Risks and open decisions

| # | Item | Assessment |
|---|---|---|
| R1 | **VPS link absent** | Blocks HAD-6 only. HAD-1…HAD-5 designed to need nothing from the VPS. **Owner decision:** tailnet vs. registered key. |
| R2 | **Knowledge store reconciliation** | The one genuine architectural question V1 leaves open: is Haddad's store a namespace of one truth, or a second store that reconciles? Deferred to V2, with the link in place. |
| R3 | **Off-host backup for Haddad** | `ops/backup` does not reach an off-VPS machine. Real-knowledge ingestion stays disabled until a restore-tested destination exists (MPI-D5 precedent). Existing tooling, new destination. |
| R4 | **8 GB RAM contention** | Inference plus Claude Code sessions on one 8 GB machine. Mitigated by `MemoryMax`/`OOMScoreAdjust` and the single-slot VRAM lock; the 2026-09-01 VPS OOM incident is the cautionary precedent. |
| R5 | **Model quality at 7–8B Q4** | A 7B model is a capable summarizer and a poor reasoner. `execution_authority: false` is the structural answer: its output is advice and a `model-output`-tier claim, never truth and never an action. |
| R6 | **CUDA** | Out of scope. Switching to the proprietary driver replaces the stack V0 verified, for a capability V1 does not need — Vulkan already works. Owner decision, V2 at the earliest. |
| R7 | **PCIe AER errors** | Known, correctable, accepted in V0. HAD-5 surfaces the count so a trend becomes visible rather than escalating silently. |
| R8 | **No CI coverage** | Governance-protected path; needs owner approval. Fresh-clone verification meanwhile. |

---

## 8. Acceptance

V1 is complete when, on `haddad`, verified from a fresh clone:

- [ ] `PROJECT-MYTHOS-HADDAD` is registered in the Status Center registry.
- [ ] A local OTHKM store answers searches; the agent can propose only into staging, only at `model-output` tier.
- [ ] `llama-server` runs on the GPU, loopback-bound, token-protected, model pinned by SHA-256.
- [ ] The Haddad MCP server answers `tools/list` and every read-only tool over SSH-stdio, with no new port open.
- [ ] Haddad is a registered agent with `execution_authority: false`, and an execution task provably cannot route to it.
- [ ] A single-slot VRAM lock prevents concurrent GPU claims; GPU state is observable.
- [ ] `haddad-health.js` covers every V1 subsystem and still ends `RESULT: PASS`.
- [ ] Every stage's tests pass offline; no test touches a production store.
- [ ] Each stage is committed, pushed, remote-verified and recorded in `docs/AI_HANDOVER.md`.
- [ ] HAD-6 is either done or explicitly recorded as owner-blocked with the exact next action.

**V1 does not claim completion while any component exists only in a worktree, a branch, or a conversation.**

---

## 9. Next action

Owner decisions needed before HAD-1 starts:

1. **Approve this scope** (or amend the order in §5).
2. **R1 — VPS link:** tailnet, or a registered Haddad key? Determines whether HAD-6 is reachable in V1 at all.
3. **R3 — backup destination** for Haddad's knowledge store. Until answered, HAD-1 ships with real ingestion disabled.
4. **Model choice** for HAD-2 — a 7–8B Q4_K_M instruct model, pinned by SHA-256.

Then HAD-1 begins, one stage at a time.
