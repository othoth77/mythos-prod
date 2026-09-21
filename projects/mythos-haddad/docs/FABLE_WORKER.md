# Mythos Haddad — Qwen as a FABLE local worker

**Status: working and verified on `haddad`, 2026-09-21.** FABLE can hand a task to the local
Qwen runtime, read the result, review it, and issue a correction — with no new orchestration,
queue, executor, model catalog or memory system.

## The loop

```
FABLE (orchestrator — a Claude session on haddad)
  │  writes a task: instruction + acceptance criteria
  ▼
bin/haddad-task.js ──▶ lib/haddad-runtime.js ──▶ free-llm/adapter.js  (reused, unmodified)
  │                                                      │
  │                                             127.0.0.1:8600/v1
  │                                                      ▼
  │                                        HAD-2 runtime → Qwen2.5-7B-Instruct Q4_K_M
  ▼
result JSON  { ok, text, attempt, model, usage, duration_ms }
  │
  ▼
FABLE REVIEWS  ── accepted ──▶ done
  │
  └─ rejected ──▶ re-send with attempt+1 and `findings:[…]`
                  → rendered as "## REPAIR REQUIRED (attempt N)" in the worker's prompt
                  → loop, until FABLE accepts or gives up
```

FABLE stays the manager throughout. The worker answers; it never decides whether its own answer
was good enough, and it never retries itself. Both of those are FABLE's call — which is what keeps
the orchestrator in charge and the worker replaceable.

## Usage

```bash
# 1. send a task
echo '{"instruction":"Explain what a GPU is."}' | node projects/mythos-haddad/bin/haddad-task.js

# 2. with acceptance criteria FABLE will review against
echo '{"instruction":"List the primary colors.",
       "acceptance_criteria":["exactly three comma-separated words","no explanation"]}' \
  | node projects/mythos-haddad/bin/haddad-task.js

# 3. FABLE rejected it — send a correction
echo '{"instruction":"Explain what a GPU is.","attempt":2,
       "findings":["Answer was far too long; one sentence of at most 12 words",
                   "Do not use bullet points or headings"]}' \
  | node projects/mythos-haddad/bin/haddad-task.js
```

**Request**: `instruction` (required, ≤6000 chars) · `acceptance_criteria[]` · `attempt` ·
`findings[]` · `system` · `model` · `timeout_ms` (default 120 s, max 600 s).
Every wait is bounded, including the wait for stdin: if a caller opens the pipe and never closes
it, the command answers `{"reason":"DEADLINE"}` and exits 2 rather than hanging
(`HADDAD_TASK_STDIN_DEADLINE_MS`, default 15 s).
**Response** (one JSON line): `{ok, text?, reason?, detail?, attempt, model?, usage?, duration_ms, timed_out}`.
**Exit codes**: `0` whenever a JSON answer was written (`ok` true *or* false), `2` for bad input —
the same contract as the existing `free-llm-complete.js`.

Failure reasons are named and fail closed, never invented: `BAD_REQUEST`, `RUNTIME_UNCONFIGURED`
(no API key — names the setup script), `RUNTIME_UNAVAILABLE` (nothing serving — names the
`systemctl` command), `RUNTIME_ERROR`, `TIMEOUT`.

## What was reused, and why

This phase is almost entirely wiring. Everything below already existed and was used as-is:

| Reused | From | Why not rebuild |
|---|---|---|
| **HTTP client** | `projects/mythos-ai-executor/free-llm/adapter.js`, required unmodified | Its own header says it takes `{baseUrl, apiKey, model}` **per call**, so a local server needs no catalog entry. It already handles bounded timeouts, normalization and never echoing a key. Verified end-to-end against Haddad's runtime before any code was written. |
| **Result shape** | the executor's provider-outcome contract | `adapter.js` already returns `{exit_code, timed_out, parsed, usage, …}` — the exact shape `executor.js` consumes. Defining a second shape would have created a translation layer for nothing. |
| **Success oracle** | `executor.js:680` — `parsed && parsed.is_error === false && !timed_out && exit_code === 0` | Restated as one expression (`runtime.ok()`) so a result judged "ok" here is judged "ok" by the executor too. A looser local definition would drift. |
| **Repair-feedback format** | `core/orchestrator.js:122-135` | The `## REPAIR REQUIRED (attempt N)` block is the executor's own convention, with the comment recording that blind retries were found to "converge only by luck". Matching it means a task moved onto the executor later needs no reformatting. |
| **Review verdict shape** | `core/validation.js` — `{verdict, findings}` | FABLE's review output is already in the shape that module's `review_fn` hook expects, so wiring it in later is a drop-in rather than a rewrite. |
| **Reviewer ≠ author** | `core/validation.js:176-191` | An existing structural invariant. Honored here by construction: FABLE reviews, Qwen answers. A local 7B model is the last thing that should grade its own homework. |
| **One-shot CLI shape** | `free-llm/bin/free-llm-complete.js` | Same JSON-in/one-JSON-line-out contract, same exit-code semantics, same size bounds — an existing precedent for "a consumer outside this Node process", which is exactly what a FABLE session is. |
| **Runtime, model, service, API key** | HAD-2 (`docs/AI_RUNTIME.md`) | Unchanged. |

**New code is two small files** — `lib/haddad-runtime.js` (the binding, ~190 lines including its
rationale) and `bin/haddad-task.js` (a thin CLI front, ~60 lines) — plus tests and this document.

## What was deliberately NOT built

- **No queue.** Two already exist (`lib/state.js`, `core/`), one running in production.
- **No orchestrator, scheduler or state machine.** FABLE is the orchestrator; that is the point.
- **No review engine.** `core/validation.js` already implements validate → reject → retry-with-findings →
  attempt budget → escalation, end to end. The only thing it lacks is an LLM judge (`review_fn`), and
  in this phase FABLE *is* the judge, in-session.
- **No model catalog entry.** `free-llm/{catalog,endpoints}.json` are untouched — `catalog.json` is
  regenerated from an upstream README on a daily timer, so a hand-added local provider would be
  silently dropped at the next sync. The adapter needs no catalog entry anyway.
- **No new memory system**, no Jev, no Compact.
- **No second model.** Qwen2.5-7B-Instruct Q4_K_M remains the only one installed.

## Security model (unchanged from HAD-2)

- The runtime still binds `127.0.0.1:8600` only — verified: the socket is on `127.0.0.1`, and the
  tailnet address refuses connections. Nothing here opens a port or widens exposure.
- The API key is read from `~/.config/mythos-haddad/runtime.key` (0600) and never appears in
  stdout, in an error message, or in a result object — asserted by the test suite against a real
  secret value.
- **The worker has no execution authority.** It cannot run a command, touch the repository, or
  reach the network. Its system prompt tells it so explicitly, and it is told not to claim it ran
  or edited anything. This matches `openai-compat.js:11-15`: *"Never give a normal chat model
  arbitrary shell access merely because it can generate code."*
- Nothing under `projects/mythos-ai-executor/` is modified — enforced by a test that inspects the
  branch diff.

## Using the executor's own loop later (zero new provider code)

When an executor instance eventually runs on `haddad` (HAD-6 in the V1 scope — today the executor
is VPS-only and cannot reach this loopback endpoint), the local runtime needs **no new provider
module**. The existing `providers/openai-compat.js` already points anywhere via environment:

```bash
MYTHOS_ADVISORY_BASE_URL=http://127.0.0.1:8600/v1
MYTHOS_ADVISORY_MODEL=<the id from GET /v1/models>
MYTHOS_ADVISORY_KEY_FILE=<a 0600 file containing MYTHOS_ADVISORY_API_KEY=…>
```

This was **verified on this machine**, unmodified: `available()` → `true`, `version()` →
`openai-compat/1`, `executionAuthority` → `false`, and a real completion returned
`exit_code: 0, is_error: false` — Qwen even emitted the `mythos_report` block the executor's
`handleSuccess` looks for. Registering it as a named agent afterwards is one entry in
`config/agents.json` (`execution_authority: false`, `capabilities: ["review", …]`) plus one line in
the `PROVIDERS` map and the `provider` enum in `schemas/task.schema.json`.

Deliberately **not done in this phase**: that agent entry would activate on the production VPS
executor, where `127.0.0.1:8600` does not exist. It belongs with the stage that puts an executor on
`haddad`, not before it.

## Verified on `haddad` (2026-09-21)

| Check | Result |
|---|---|
| Task → result | `"The Vulkan API provides a low-level interface…"` — `ok: true`, 2.3 s, 32 completion tokens |
| Acceptance criteria honored | `"List the primary colors"` + two criteria → `Red, Blue, Yellow` |
| **Correction measurably works** | Same task, then rejected with two findings → answer went from **103 words to 13** (`"A GPU is a specialized processor for rendering graphics and parallel computing tasks."`) |
| Fail-closed paths | missing key → `RUNTIME_UNCONFIGURED`; wrong port → `RUNTIME_UNAVAILABLE`; bad JSON → exit 2 |
| Key safety | the live key never appears in any output |
| Tests | `node tests/mythos-haddad-fable-worker-test.js` → **14/0**, of which **3 are live** against the real endpoint (they SKIP loudly, never silently pass, on a host with no runtime). Mutation-checked: breaking the repair format or loosening the success oracle both fail the suite. |

## Known limits

- FABLE's review is **in-session judgement**, not a recorded artifact. Nothing persists the verdict
  or the attempt history — for this phase that is deliberate (no new memory system). When results
  need to be durable, that is the executor's task store, reached via the path above.
- No attempt budget is enforced in code. FABLE decides when to stop; `core/validation.js`'s
  `max_attempts` (default 3) is the convention to adopt when this moves onto the executor.
- The live tests depend on a real model's behaviour, so they are evidence rather than a strict
  regression guard; the deterministic guarantee that findings reach the worker is the offline test
  that inspects the outgoing request body.
- Single-flight: the runtime serves one request at a time on a 6 GB GPU. Concurrent callers queue
  inside llama-server. A VRAM admission lock is HAD-5, not this stage.
