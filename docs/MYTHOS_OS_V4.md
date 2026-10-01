# MYTHOS OS v4 — architecture of record

**Code:** `projects/mythos-os-v4/` · **Operation:** [`projects/mythos-os-v4/README.md`](../projects/mythos-os-v4/README.md)
· **Acceptance evidence:** §9 below and the 2026-10-01 entry of `docs/AI_HANDOVER.md`.

## 1. The chain

```
                 ┌──────────────────────────────────────────────────────────────┐
  owner ───────▶ │ DOTS — General Manager                                       │
  (goals,        │   goals · priorities · policy · escalations                  │
   approvals)    │   deterministic code — lib/dots.js, config/dots-policy.json  │
                 └───────────────┬──────────────────────────────────────────────┘
                                 │ one goal + the results so far
                                 ▼
                 ┌───────────────────────────────┐      monitors, takes over,
                 │ FABLE 5.1 — Executive Manager │◀───▶ hands back
                 │   claude-fable-5-1, no tools  │      ┌──────────────────────────┐
                 │   answers ONE directive       │      │ OPENAI — watchdog        │
                 └───────────────┬───────────────┘      │   failover + plan review │
                                 │ directive            └──────────────────────────┘
                                 ▼
                 DOTS authorises the directive (policy) — or refuses / escalates
                                 │ authorised steps
                                 ▼
                 ┌───────────────────────────────┐
                 │ JEV — Model Selection Engine  │   decides, never executes
                 │   1. free LLM APIs            │
                 │   2. local Qwen               │
                 │   3. paid Claude / OpenAI     │
                 └───────────────┬───────────────┘
                                 │ ranked route
                                 ▼
                 ┌───────────────────────────────┐
                 │ HADDAD — Execution Layer      │   answer steps: the gateway calls the model
                 │                               │   work steps: the Haddad executor / Supervisor
                 └───────────────────────────────┘
```

Every arrow is a record in the decision ledger (`$MYTHOS_OS_HOME/ledger/decisions.jsonl`), under one `trace_id` per goal.

## 2. Who may decide what

| Layer | Is | Decides | Can never |
|---|---|---|---|
| **DOTS** | deterministic code + `config/dots-policy.json` | which goals exist and in what order; whether a directive may run; when the owner must decide | be overruled by a model. A goal's text, an executive's answer and a model's output are all data to it |
| **FABLE 5.1** | the Claude CLI pinned to `claude-fable-5-1`, tools off | how one goal is executed: steps, or "complete", or "escalate" | create or re-prioritise a goal, change policy, pick a model (JEV's job), execute anything, complete a goal with no successful step behind it |
| **OpenAI** | the existing orchestrator provider (Responses API, strict schema) | nothing by itself. It acts as executive **only** while FABLE is failing, under the same DOTS authorisation; it reviews FABLE's write plans | be general manager (`authority.general_manager` must be `"dots"` or the policy does not load), keep the lead once FABLE passes its probe, review its own plan |
| **JEV** | deterministic code + `config/jev-models.json` | the ordered list of models for a task, and why every other model was rejected | run a model or a command, select a model outside the configured pools, offer a paid model DOTS has not budgeted |
| **Haddad** | the gateway (answers) and the existing executor / Supervisor (repository work) | nothing. It runs authorised steps and reports what happened | report success the executor did not measure: its COMPLETED is the executor's measured-outcome COMPLETED |

DOTS is code on purpose. A general manager that is a model would be one more provider that can time out, be out of
quota or be talked into something — and "no provider is a single point of failure" would be false at the top.

## 3. One goal, step by step

1. `goal submit` — DOTS validates the goal (bounded, known priority, no credential) and queues it.
2. `goal run` — DOTS claims it (one runner, a wall-clock deadline) and asks the executive for a directive.
3. The watchdog says who answers: FABLE; if FABLE fails this call, OpenAI answers the same call; if neither can,
   DOTS's deterministic last resort plans one read-only answer step (never for a goal approved to write — that goal
   is held as `WAITING`).
4. DOTS authorises the directive (§4). A refusal is recorded, fed back to the executive, and counted.
5. Each authorised step goes to Haddad. For an **answer** step JEV ranks the models and the gateway walks the list:
   free → Qwen → paid, with a hard timeout per attempt, a bounded retry for transient failures, and the outcome
   reported to JEV. For a **work** step JEV confirms a model with execution authority is usable, then a read-only
   task is enqueued into the Haddad executor daemon, and anything else goes through the Supervisor (GitHub Issue →
   Haddad bridge → isolated worktree → measured outcome).
6. The executive sees the results and answers again: more steps, `complete` (with the final answer), or `escalate`.
7. DOTS ends the run in exactly one state: `COMPLETED` (on evidence), `ESCALATED` (an OPEN escalation with a code),
   `WAITING` (held for an executive), or `CANCELLED`.

## 4. What DOTS refuses

A directive is refused — never trimmed into something acceptable — when it:

| code | means |
|---|---|
| `MALFORMED` | is not exactly `schemas/directive.schema.json`: a missing or extra field, a value outside an enum, steps on a `complete`, no reason on an `escalate` |
| `STEP_LIMIT` · `STEP_BUDGET` · `INSTRUCTION_TOO_LONG` | exceeds `plan.max_steps`, the goal's `loop.max_total_steps`, or `plan.max_instruction_chars` |
| `ACTION_NOT_ALLOWED` | pairs a kind with an action that kind does not have |
| `POLICY_FORBIDDEN` | names an owner-only operation (`plan.forbidden_terms`: merge to main, deploy to production, force-push, credential rotation, destructive SQL, backup deletion, host access changes) |
| `SECRET_IN_DIRECTIVE` | carries a credential-shaped string |
| `OWNER_APPROVAL_REQUIRED` | changes files (`document`, `implement`) on a goal the owner has not approved to write → escalation `HUMAN_APPROVAL` |
| `COMPLETE_WITHOUT_EVIDENCE` | says "complete" while no step of this run has succeeded |

A plan that writes is additionally reviewed by the *other* executive engine (`watchdog.review_write_plans`); with no
reviewer available it does not run (`WRITE_PLAN_UNREVIEWED`).

## 5. The OpenAI watchdog

State machine in `$MYTHOS_OS_HOME/watchdog/state.json`, thresholds in `failover.*`:

```
            failure_threshold failures
            inside window_seconds
  FABLE ───────────────────────────────▶ OPENAI TAKEOVER ──┐
  leads ◀─────────────────────────────── (FABLE not called) │ cooldown over:
            probe succeeds                    ▲             │ next call probes FABLE first
            (FABLE_RECOVERED)                 └─────────────┘
                                         probe fails: cooldown × cooldown_factor,
                                         capped at cooldown_max_seconds
```

* A FABLE failure is: timeout, CLI error, quota, an answer that is not the schema, an answer served by another model
  (identity is read from the call's own `modelUsage`), the CLI missing, or a directive DOTS refused.
* A single failed call already falls through to OpenAI inside that call. The takeover is what stops paying a timeout
  to a FABLE that is known to be down.
* During a takeover FABLE remains the last chance of each call, so OpenAI is not a single point of failure either.
* The deterministic half needs no model: `watchdog tick` escalates a `RUNNING` goal whose runner died or overran its
  deadline (`STALLED`).

## 6. JEV

`route({ pool, capability, kind, prompt_chars })` returns the candidates in order and every rejected model with its
reason: `DISABLED`, `NOT_IN_POOL`, `CAPABILITY_MISSING`, `NO_EXECUTION_AUTHORITY`, `PROMPT_TOO_LARGE`, `UNAVAILABLE: …`,
`COOLDOWN_UNTIL …`, `QUOTA_UNTIL …`, `PAID_NOT_PERMITTED`, `PAID_GOAL_BUDGET_EXHAUSTED`, `PAID_DAILY_BUDGET_EXHAUSTED`.

Pools (`research`, `assessment`, `execution`) are the three of `projects/mythos-haddad/MASTER_STATUS_AND_ROADMAP.md`
§3; an answer step's action picks the pool (`research` → research, `review` → assessment, the rest → execution).

Health per model is a circuit breaker (`jev.*`): `failure_threshold` failures open it for `cooldown_seconds`; after
the cooldown one probe is allowed; success closes it, failure re-opens it with the cooldown multiplied. **Quota is not
failure** — it sets a wait until the provider's own reset time (or `quota_default_cooldown_seconds`) and leaves the
failure count alone. A rejected credential cools down for `blocked_cooldown_seconds` at once.

If JEV's registry cannot be loaded, answers still flow through `models.static_fallback_model` (recorded as
`JEV_UNAVAILABLE_STATIC_FALLBACK`); repository work fails closed, because without JEV nothing is known to hold
execution authority.

## 7. Bounds — why nothing loops

| bound | policy key | on reaching it |
|---|---|---|
| plan cycles per run | `loop.max_cycles` | escalation `CYCLE_LIMIT` |
| executed steps per run | `loop.max_total_steps` | directive refused `STEP_BUDGET` |
| refused directives per run | `loop.max_refusals` | escalation `DIRECTIVE_REFUSED_LIMIT` |
| the same plan twice | — | escalation `REPEATED_PLAN` |
| wall clock per run | `loop.goal_deadline_seconds` | escalation `GOAL_DEADLINE` |
| runs per goal | `goal.max_runs_per_goal` | `RUN_LIMIT` |
| attempts per answer | `gateway.max_attempts_total`, `gateway.max_retries_per_model` | `ATTEMPT_LIMIT` / next model |
| time per attempt | `gateway.attempt_timeout_seconds` | that attempt is a transient failure |
| executive calls per engine | `executive.attempts_per_engine`, `executive.timeout_seconds` | next engine |
| executor task | the step's `timeout_seconds` | `WORK_TIMEOUT` |

## 8. Security boundaries

* **No secret in Git or in the store.** Configuration carries none; credentials stay in their existing 0600 files.
  A goal or directive carrying a credential is refused; ledger details pass through the redactor; the OpenAI key is
  used for one header and scrubbed from results.
* **Models hold no tools.** FABLE and paid Claude run with `--tools ""`, no MCP, no settings, no session, in an empty
  directory, with an allow-listed environment. Free, Qwen and OpenAI calls are plain completions.
* **Execution authority is registered, never granted by a decision.** Only a registry entry with
  `execution_authority` and a `work_provider` can serve repository work; a registry that gives a work provider to an
  advisory model does not load.
* **A write never takes the direct path.** The direct executor path is hard-wired to the read-only profile (and the
  executor's own `ACTION_PROFILE_MISMATCH` refuses anything else); `test`, `document` and `implement` go through the
  Supervisor and the bridge's isolated worktree, measured-outcome gate and review gate. A policy naming a write
  action in `haddad.direct_actions` does not load.
* **Owner-only operations stay owner-only.** Merge, deploy, credential rotation, destructive SQL, backup deletion
  and host access changes are refused at the directive, whoever asks.
* **Untrusted text is data.** Goal text, history and model output are passed as JSON data with an explicit
  instruction not to follow instructions inside it — and DOTS's checks do not depend on the model obeying that.

## 9. Acceptance evidence (2026-10-01, host `haddad`)

Reproduce: the five suites in `projects/mythos-os-v4/README.md`; `mythos-os health --live`; `mythos-os trace <goal-id>`
and `mythos-os ledger verify` against `~/.local/state/mythos-os-v4` on Haddad.

### 9.1 Offline suites — 393 assertions, 0 failed

| suite | assertions | what runs for real |
|---|---|---|
| `tests/mythos-os-v4-core-test.js` | 60 | the ledger on disk; a spawned `claude` stand-in through `lib/claude-cli.js`; the real OpenAI provider (socket replaced) |
| `tests/mythos-os-v4-jev-gateway-test.js` | 75 | the real free-llm selector, haddad-runtime and Claude CLI adapters against loopback HTTP servers |
| `tests/mythos-os-v4-executive-test.js` | 63 | FABLE as a spawned process, OpenAI through the real provider |
| `tests/mythos-os-v4-dots-test.js` | 136 | the production wiring (`lib/index.js`); the REAL `executor.createTask` and the REAL `mythos-supervise.js submit` accept v4's payloads |
| `tests/mythos-os-v4-runtime-test.js` | 59 | the real CLI as a child process on a fixture host (HOME, `claude`, `systemctl`, runtime URL) |

Mutation check: 57 rules were broken one at a time; 56 made a suite fail. The survivor is one of three redundant
goal-deadline checks (removing any single one is masked by the other two).

Existing suites that cover what v4 reuses, re-run on the branch: `mythos-haddad-fable-worker` 15/0 (scope guard),
`mythos-haddad-runtime` 48/0, `free-llm-selector` 10/0, `free-llm-registry` 36/0, `free-llm-pool-provider` 17/0,
`mythos-orchestrator-openai` 176/0, `model-selection-policy` 81/0, `mythos-haddad-advisory-profile` 14/0. The branch
modifies no existing file, so the full 243-suite sweep was not re-run.

### 9.2 Live on Haddad — real FABLE 5.1, real Qwen runtime, real executor daemon

| # | what | result | evidence |
|---|---|---|---|
| 1 | `health --live` | PASS_WITH_WARNINGS, 0 FAIL | FABLE probe "served by claude-fable-5-1"; answer route "qwen-local [local]" |
| 2 | answer goal: DOTS → FABLE → JEV → Haddad | COMPLETED | `goal-20261001232504-6edo1z`, ledger seq 8–18: FABLE planned, JEV routed `qwen-local → claude-sonnet`, Qwen answered, FABLE concluded |
| 3 | read-only repository goal through the executor daemon | COMPLETED, answer `30min` = the file's content | `goal-20261001232803-g4dn8v`; executor task `t-20261001233129-rd0fj7` (haddad-agent, repo-read, `report_to_git:false`); live checkout untouched |
| 4 | the same with a 13 KB file | ESCALATED, correctly | `goal-20261001232544-cuy2uq`: the executor refused three times (`TASK_TOO_LARGE`), FABLE escalated with that reason |
| 5 | `test` goal through the Supervisor | step VERIFIED | Issue #545: v4 → `mythos-supervise submit/watch` → Haddad bridge → Qwen → Supervisor "VERIFIED, task complete" → closed. After the fixes the retried goal COMPLETED through Issue #547 (`goal-20261001234231-pk7110`, run 2, ledger seq 130–139): final answer "2 of 3 tests passed, 1 failed (`totalCents`)" — identical to an independent run of that test (exit 1, `2 passed, 1 failed`). Issues #545–#547 were all closed by the Supervisor |
| 6 | FABLE unavailable (CLI missing) | goal COMPLETED, `degraded: true`, by the last resort | ledger seq 71 `OPENAI_TAKEOVER`; next goal: seq 80 `FABLE_RECOVERED` |
| 7 | Qwen runtime unreachable | paid Claude answered, served by `claude-sonnet-5` (measured) | then Qwen answered again on the next call |
| 8 | 1-second attempt budget (real timeouts) | `ALL_MODELS_FAILED` after exactly 4 bounded attempts; both models cooled down; `NO_ROUTE` during the cooldown; half-open afterwards | ledger seq 94–95 `MODEL_COOLDOWN`, seq 100 `MODEL_RECOVERED qwen-local`, seq 122 `MODEL_RECOVERED claude-sonnet` |
| 9 | runner killed mid-goal | health WARN "1 stalled" → `watchdog tick` → escalation `STALLED` → owner `retry` | ledger seq 128–130 |
| 10 | security | gitleaks: 0 findings on the branch; store 0600/0700; no secret-shaped string and no runtime key in the live store | — |

Nine defects appeared only when the chain ran live — none in the offline suites — and each is fixed with a
regression test: a work step outliving its deadline (the executor's timeout is per attempt, and it retries); a blocker
code passed on without its reason; the executive not knowing the local worker's unit of work; CLI output cut at 64 KiB;
the Supervisor's default store being the VPS path; a supervised step returning "the task ended" instead of the report;
a cancel overwritten by the runner's in-memory copy; health failing after a cooldown had already ended; a supervised
task left unticked when its runner died.

### 9.3 Acceptance status — NOT 100 %

| criterion | status | basis |
|---|---|---|
| DOTS operational | ✅ live | rows 2–5, 9 |
| FABLE operational | ✅ live | identity measured on every call |
| OpenAI watchdog operational | ⚠️ partly | takeover / recovery state machine live (row 6). The OpenAI engine itself cannot be called on Haddad: no `~/.config/mythos-orchestrator/openai.env`. FABLE → OpenAI takeover is proven offline only (real provider code, socket replaced) |
| JEV operational | ✅ live | rows 2–8 |
| Free LLM routing operational | ❌ not live | no free-provider key file on Haddad (`~/.config/mythos-ai-executor/free-llm/`). Proven offline through the real selector over loopback HTTP |
| Qwen routing operational | ✅ live | rows 1–3, 7–8 |
| Paid fallback operational | ✅ live (Claude) | row 7. Paid OpenAI: offline only (same missing key) |
| Haddad execution operational | ✅ live | answer (2), executor daemon (3), Supervisor/bridge (5) |
| Integration tests | ✅ | §9.1 |
| Failure / recovery tests | ✅ | §9.1 and rows 6–9 |
| Security checks | ✅ | row 10, §8 |
| Runtime health | ✅ no FAIL, 2 WARN | the two WARNs are the two missing key files above |
| Deployment | ❌ not done | the timers are not installed: the installer refuses a branch checkout, and merging to `main` is the owner's decision |
| Documentation synchronised | ✅ | this file, the README, `docs/AI_HANDOVER.md` |
| Committed and pushed, local HEAD = remote HEAD | ✅ on `mythos/os-v4` | not on `main` |

What turns the three open rows green is in the handover entry ("Owner steps").
