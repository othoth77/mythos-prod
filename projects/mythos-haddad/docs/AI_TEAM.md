# Mythos Haddad V2.1 — AI Team foundation

> **Status: see the gate record at the end of this file.** Branch
> `mythos-haddad/v2-1-ai-team-foundation`. Companion to
> [MYTHOS_HADDAD_V2_MASTER_PLAN.md](MYTHOS_HADDAD_V2_MASTER_PLAN.md) §11 (V2.1).

## What V2.1 is, in one paragraph

V1 shipped an **AI worker**: one local model, one task at a time, supervised by
code. V2.1 makes that worker a **member of a team the existing orchestration
core can see**: the local Qwen is a registered agent in `config/agents.json`,
probed for availability like every other agent, selected by capability by the
existing registry and router, and refused as a reviewer of sensitive work by the
existing review policy. On top of that, a **role table** (`config/roles.json`)
maps the closed bridge action set to the shape a task takes — task type,
required capabilities, the trust-attested skill pack injected into the prompt,
and a one-line brief the Haddad runner adds under its tool grant. No runtime, no
process, no model, no scheduler, no registry, no skill system was added.

## The reuse audit that decided the design

| Needed for an AI team | Found (unchanged unless stated) | Decision |
|---|---|---|
| Agent identity, capabilities, availability, cost/risk ranking | `core/agent-registry.js` (`registerAgent`, probed `healthCheck`, `selectCandidates`) | **REUSE** — one new entry in `config/agents.json`, one probe branch (`haddad-agent` → provider `probe()`), `local` cost tier added to the rank table |
| Model/provider choice with quota/fallback rules | `core/provider-router.js` + `config/router.json` | **REUSE** untouched — proven in tests to route coding → `haddad-qwen` and to `wait_for_quota` when exhausted |
| Reviewer eligibility, author ≠ reviewer, sensitive scope | `core/validation.js` (`reviewScopeOf`, `reviewerEligible`, `adversarialReview`) | **REUSE** untouched — `haddad-qwen` declares `review_scope: ["standard"]` and is refused for sensitive work by the existing code |
| Execution profiles / tool grants | `lib/policy.js` (`repo-read`, `repo-test`, `repo-write`) | **REUSE** untouched — a role's profile is *derived* from its action, never stored |
| Action → profile / delivery | `bridge/action-resolution.js` (`PROFILE_BY_ACTION`, `DELIVERY_BY_ACTION`) | **REUSE** untouched — `lib/roles.js` refuses a role that restates a profile (test C18) |
| Role-shaped instructions | `lib/skills.js` + `config/skills.json` + `config/skill-trust.json` (attested packs `generic`, `testing`, `github-review`, `frontend`, `security-audit`) | **REUSE** — the role selects the *category*; the executor's existing selection and trust gate do the rest. **No new skill file**: the trust ledger binds attestations to bytes scanned by SkillSpector/Gitleaks/SkillEvaluator, which are not installed on this host, so a new `debugging.md`/`research.md` would be UNTRUSTED and never injected. Debugger and researcher therefore run under `generic` plus their brief. |
| Task ownership, state, result, evidence, timeout, retry, budget, audit | `executor.js` + `lib/state.js` + `lib/work-validation.js` + `lib/quota.js` | **REUSE** untouched — the task record gained two nullable audit fields (`role`, `role_reason`) |
| Task dependencies | bridge dependency grammar + `core/dag.js` | **REUSE**, exercised in V2.2 |
| Resource limits | `lib/resource-guard.js` (RAM) | **REUSE**; the GPU signal is V2.3 |
| The worker itself | `providers/haddad-agent.js` | **ADAPT** — role brief in the system prompt, registry probe, and the context-window accounting found necessary by the live run (below) |

**Built, and the whole of it:** `config/roles.json` (six entries), `lib/roles.js`
(validation + deterministic resolution, ~170 lines), the evidence runner
`projects/mythos-haddad/bin/haddad-role-e2e.js`, and one test file.

## Roles

A role is `(action, task_type, capabilities_required, skill_category, brief[, match])`.
The **action decides**; a `match` role is chosen for its action only when its
pattern matches the task instruction (tried in file order); otherwise the
action's single default role. Nothing an Issue or an API caller writes can name
a role: `executor.createTask` derives it after the envelope validates and a
caller-supplied `role` field is ignored (test D10).

| Role | Action | Profile (derived) | Delivery | task_type | Skill pack injected | May write? |
|---|---|---|---|---|---|---|
| coder | implement | repo-write | commit | coding | generic | yes |
| debugger | implement + `bug/debug/failing/broken/regression/crash/root cause` | repo-write | commit | coding | generic | yes |
| documenter | document | repo-write | commit | documentation | generic | yes |
| tester | test | repo-test | report | testing | **testing** | **no** (no `write_file` offered) |
| reviewer | review | repo-read | report | review | **github-review** | **no** |
| researcher | investigate | repo-read | report | research | generic | **no** |

Before V2.1 every bridge action fell through to `generic`
(`unknown_task_category_fallback_generic:implement` in every V1 task record);
the role table is what finally connects the M-12 skill packs to the bridge's
action vocabulary — on the VPS too, since the mapping is provider-agnostic.

**What a role is not.** It grants nothing: the profile, the tool grant, the
sandbox and the delivery come from the action exactly as before (test D9: a
role cannot loosen `ACTION_PROFILE_MISMATCH`). The brief is one bounded line
(≤ 240 chars, no newline, no fence, no heading, no braces — test C21–C23) and
names no tool the grant did not offer (test E11). A malformed table darkens the
whole role layer and every task behaves exactly as in V1 (test C26).

## Live chain, measured on Haddad (2026-09-22, real probe, no fixtures)

Reproduce it: **`node projects/mythos-haddad/bin/haddad-team-chain.js`**
(add `--json` for the machine form). It is read-only, creates no task, and
prints what the real registry, router, review policy, role table, skill
registry and provider grant answer on the host it runs on.

```
AGENTS (availability is probed, never assumed)
  claude-code         available    ok    authority=true  risk=high   cost=subscription
  haddad-qwen         available    ok    authority=true  risk=medium cost=local
  free-llm-pool / gemini-advisor / omniroute-advisory   UNAVAILABLE

SELECTION   coding|testing|review|research  → haddad-qwen, claude-code
ROUTING     coding|testing|review|research  → route haddad-qwen (authority true)

REVIEW eligibility
  standard, another author  → performed=true  reviewer=haddad-qwen
  SENSITIVE, another author → performed=false reviewer_not_trusted_for_sensitive (haddad-qwen refused)
  its own work              → performed=true  reviewer=claude-code  (author excluded)
```

`haddad-qwen` ranks ahead of `claude-code` everywhere above on the registry's
**existing** order — available first, then lower risk, then cheaper tier —
not because anything names it. The third review line is the one to read
twice: the local worker's own work is still reviewed, by somebody else.

| Role | Action | Profile | Delivery | Skill pack (trust) | Tools offered | May write |
|---|---|---|---|---|---|---|
| coder | implement | repo-write | commit | generic v1.0.0 (ACCEPT) | read_file, list_files, write_file, run_command | yes |
| debugger | implement | repo-write | commit | generic v1.0.0 (ACCEPT) | read_file, list_files, write_file, run_command | yes |
| documenter | document | repo-write | commit | generic v1.0.0 (ACCEPT) | read_file, list_files, write_file, run_command | yes |
| tester | test | repo-test | report | **testing** v1.0.0 (ACCEPT) | read_file, list_files, run_command | **no** |
| reviewer | review | repo-read | report | **github-review** v1.0.0 (ACCEPT) | read_file, list_files, run_command | **no** |
| researcher | investigate | repo-read | report | generic v1.0.0 (ACCEPT) | read_file, list_files, run_command | **no** |

`run_command` under `repo-read` can start exactly `node --version` — the
runner's own program ceiling is `node`/`npm` and the profile's non-prefix
rule permits nothing else, so a reviewer is offered the tool and can do
nothing with it beyond that. Reproduce with the chain check recorded in the
handover entry.

## The agent

`config/agents.json` → `haddad-qwen`: provider `haddad-agent`, execution
authority **true** (it genuinely executes tools), `review_scope: ["standard"]`
**only**, risk `medium`, cost tier `local`, latency `slow`. Availability is
**probed**: enable marker + runtime key (the V1 stat-only contract) **and** the
local llama-server answering `GET /health` (public endpoint, no key on the wire,
bounded `curl` subprocess like the `claude --version` probe). On the VPS the
marker is absent, so the probe short-circuits false before any request and
`haddad-qwen` can never be selected there — the same inertness V1 relied on.

Consequences already enforced by existing code, now proven by tests:

- selected by capability for coding/testing; ranked **ahead of `claude-code`**
  on the registry's own risk/cost order when both are available (nothing
  hard-codes either);
- `wait_for_quota` when exhausted — never a silent substitution;
- refused as reviewer of sensitive work (`reviewer_not_trusted_for_sensitive`),
  and never a reviewer of its own work (author exclusion).

## What the live runs found, and what each one changed

Six roles were run against the real runtime, twice: once on the V2.1 code as
first written (round 1), then again after the findings below were fixed
(round 2). Every one of these is a defect the tests as written could not have
found, because each needed a real 7B model driving a real sandbox.

| # | Found by | The defect | The fix | Pinned by |
|---|---|---|---|---|
| 1 | researcher, round 1 (83 s, `PROVIDER_FAILED`) | One 9 KB read plus two listings sent a **9,710-token** request into an **8,192-token** runtime: HTTP 400, the whole attempt lost. No single result was too large; they accumulated, and the runner had no model of the window at all. | A prompt budget derived from the window, a per-call payload cap, and compaction. | D1, D2 |
| 2 | tester, round 1 (385 s, `PROVIDER_FAILED`) | Compaction that elides only **tool results** is not compaction: after twelve turns with every result already elided the conversation still needed ~6,700 tokens, because the **assistant turns** — and a `write_file` call's arguments carry a whole file — had never been touched. | Elide whole **exchanges** (the assistant message's arguments and the tool results that answer it, together, ids preserved), oldest first, never the newest. | D3, D4, D6, D7 |
| 3 | coder, round 1 (`HUMAN_APPROVAL`, scope violation) | `write_file` with a path ending in a separator (`lib/`) silently created a zero-byte regular **file** named `lib` — `path.resolve` drops the trailing separator. Every later write under `lib/` then failed with "parent is not a real directory", and the stray file was an out-of-scope change that cost a correct fix its delivery. | Refused, naming what to send instead. The runner creates no directories, which was already its stance; it just was not enforced. | tool-runner E1, E2 |
| 4 | debugger, round 1 (`HUMAN_APPROVAL`, scope violation) | The model wrote the **correct** fix, then wrote its report to `.mythos_report.json` instead of saying it. An out-of-scope file, so validated work was refused delivery over a misunderstood channel. | One sentence in the system prompt: the report is a message, never a file. | ai-team E12 |
| 5 | coder, round 1 (turn cap) | `node greet.test.js` run six times in a row, green every time, until the turns were gone. An identical call returning an identical result tells the model nothing. | The repeat is named in the result — same result, plus a note. No permission changes and nothing is hidden. | D8, D9 |
| 6b | documenter + debugger, round 2; coder, round 1 | A bare file name is written at the workspace **root**, beside the file the task named. Correct work, rejected for a sibling — and the model is told only at the end. | `write_file` answers the declared scope at the write, through work-validation's own `withinScope`. Feedback, not a boundary: C1/C5 were rewritten to prove the validator still catches what a **script** writes. | C1, C1b, C1c, C5 |
| 8 | tester, after fix 7 (`CONTEXT_EXHAUSTED`) | Eliding an exchange leaves a **stub**, and a stub is not free. With every exchange already elided the floor was still system + task + **N stubs** + the newest exchange, and N grows with the run: eleven elided exchanges needed ~6,371 tokens against a 6,272 budget and the attempt died **99 tokens** over. The floor was not a floor. | Once there is nothing left to elide, the oldest already-elided exchanges are **dropped outright** — assistant turn and its results together, so the sequence stays valid — until the request fits. The floor is now system + task + newest exchange, whatever N was. | D10 |
| 7 | tester, final run (`HUMAN_APPROVAL`) | **The most valuable failure of the stage.** A read-only tester ran both suites correctly, wrote nothing, and then reported commit `7a186fc1a7b0` and two changed files. It had made neither. The validator refused all three attempts — *"result claims commit 7a186fc1a7b0 but no repository is in scope"* and *"the report claims 2 changed file(s) but the workspace is byte-identical"* — and the model never withdrew the claim, even after an L2 diagnosis. Nothing had told it that a commit was not a thing this task could produce. | The task's **delivery** is now stated in the system prompt as the fact it is, exactly like the tool list: a `report` task is told there is no commit to make and none to mention. | ai-team E13 |
| 6 | tester, round 2 (`HUMAN_APPROVAL`) | With the window fixed the tester ran cleanly, wrote nothing, found the seeded failing test — and reported **`blocked`**, because a role that may not fix anything reads "a test fails" as an obstacle. For a TESTER the failure *is* the deliverable. | One clause in the role's brief: *a failing test is your result, not a blocker*. The brief is where a role's contract with the model belongs. | ai-team E0 |

### The context budget, in numbers

The window is a property of the runtime deployment (`--ctx-size` in the
runtime unit), so `HADDAD_AGENT_CONTEXT_TOKENS` names it and the default is
that unit's value. Everything else is derived:

| | tokens |
|---|---|
| runtime window | 8,192 |
| reserved for the answer (`MAX_TOKENS_PER_TURN`) | 1,536 |
| margin for the estimate | 384 |
| **prompt budget** | **6,272** |
| one tool result, at most a third of it | 2,090 (≈ 6,270 chars of JSON) |

The chars-per-token ratio is deliberately below what the model does, measured
against the live runtime on 2026-09-22: a task prompt 3.75, a JS source file
3.86, a tool-result JSON 3.25. The estimate uses **3**, so it errs toward
refusing a request that would have fit rather than sending one that cannot —
and the runtime's own `usage.prompt_tokens` re-anchors it after every answer,
so the ratio only has to cover what was appended since. When nothing more can
be dropped the run stops with `HADDAD_AGENT_CONTEXT_EXHAUSTED`, and the
message distinguishes a task prompt that never fit from a conversation that
grew, because those need different answers from a reader.

### A flake is not a regression, and saying which is the work

The branch sweep surfaced one suite failing that was clean on the baseline:
`hub-dashboard-test.js`, 49/1. It is not a regression, and the argument is
dependency-based rather than hopeful. That suite reads only
`sites/mythosprod.xyz/{assets/dashboard.js, assets/dashboard.css,
assets/tokens.css, index.html, health.json}` — **zero** overlap with this
branch's 22 files — and its assertions are wall-clock boundaries
(`tierAt(16)`, `tierAt(60)`, `tierAt(61)`, a reason matched against
`/30 min/`), which is the shape of a test that fails when a minute ticks
between building a fixture and asserting on it. It passed 9 consecutive runs
in isolation, including six under twelve CPU burners.

### Two stage guards had to be told about V2.1, not switched off

`mythos-haddad-fable-worker-test.js` and `mythos-haddad-runtime-test.js`
each carry a scope guard from an earlier stage: *a Haddad branch may not
modify the executor*, with an allow-list naming exactly the files that
stage's purpose required. V2.1's purpose is to register the worker as an
agent, so four executor files are legitimately in its diff and both guards
fired. They were extended the way HAD-4 extended them — by **naming each
file and why**, never by widening a pattern — and the runtime suite's
meta-test, which pins that the allow-list is per-file and not per-directory,
keeps that property with examples that are still refused (`config/model-policy.json`,
`core/scheduler.js`). A guard that is switched off to let a stage through
stops being a guard; a guard that names what it now permits is still one.

### The stray-sibling failure, and the change it earned

Three independent round-2 runs produced correct-or-near-correct work and lost
it to a file the model created beside the real one: the documenter wrote the
right `NOTES.md` **and** a stray one at the workspace root; the debugger wrote
its fix to a root `pct.js`, so the real one was never fixed; round 1's coder
created a file called `lib`. In every case the model learned about it only at
the end, from a rejected attempt, and in none of them did it recover inside
the three-execution budget.

`write_file` now answers the task's **declared** scope at the moment of the
write, using work-validation's own `withinScope` so the tool and the
validator cannot disagree about what "in scope" means, and saying nothing at
all when the task declared no file scope (a prose-only constraint declares
none — C1c).

**This is feedback, not a boundary, and the tests now say so explicitly.**
The V1 lesson stands: a tool-layer refusal is not a boundary whenever the
tool surface includes "run code". So C1 and C5 were rewritten to drive their
out-of-scope write through a **script** — the task declares the helper in
scope, the helper is written legitimately, and what it *does* is out of scope
— which proves the thing that actually matters: the validator, measuring the
workspace out of band, catches a write that never passed through a tool at
all. C1b pins the immediate refusal and that the check file is untouched by
it. The rewrite made both suites stricter than they were before the change.

It was also written once, reverted when it made C1/C5 pass for the wrong
reason, and only put back after the third live run made the case. A change
that makes a demo pass while blunting a boundary test is not worth having;
the same change with the boundary test strengthened is.

### A run can fail for reasons that are not the code, and saying which is the work

Round 3 lost three roles in a row to `PROVIDER_FAILED` with **zero tool
calls** — the local runtime never answered — and round 4's first role timed
out the same way. Neither was the code, and neither was what I first wrote
down.

The actual cause, found by a peer session and credited here because it
changes what the numbers mean: after a reboot, llama-server came up logging
`ggml_vulkan: No devices found` and ran **entirely on CPU** for the whole of
its 22:14–22:40 instance. `/dev/dri/renderD128` only receives its logind seat
ACL about eighty seconds after the unit starts, and the unit orders itself
only `After=network.target`, so it loses the GPU permanently and silently.
Same prompt, same host: CPU-only took over 180 s and returned nothing; on the
GPU instance that replaced it, 2.9 s. **Health passes 16/16 either way** —
`gpu_test` is a standalone Vulkan probe in its own process and `ai_runtime`
only proves the endpoint answers, so neither asserts that the loaded model
offloaded anything. That gap, and the unit ordering, are being fixed
separately; they are not V2.1's.

What V2.1 keeps from it is the evidence runner's retry: production retries a
transient failure and resumes a `WAITING_RETRY` task, and the runner now does
the same, twice with a 20 s pause, because a single blip otherwise records a
sound run as FAILED.

Two earlier readings of mine are withdrawn rather than restated. An
llama-server RSS of 4.3 GB against a documented ~2.1 GB steady state is **not**
evidence of growth: cgroup `memory.peak` counts reclaimable page cache and the
GGUF is mmap'd, so most of that is file-backed model pages, and the prompt
cache never exceeded ~117 MiB of its 8 GiB limit. And "a 2,048-token prompt
took 3m47s" was measured under a load average of 18 with eight interactive
sessions open, on one instance, and cannot be cleanly attributed to any single
cause. Both came out of this record.

The operational rule that survives: **do not run the regression sweep and a
live E2E at the same time**, and keep concurrency at one against a runtime
that advertises four slots.

### The one thing this stage proves best

A read-only role invented a commit hash and a changed-file list, and the
system refused it three times and stopped for a human rather than record a
delivery that never happened. No part of that depended on the model being
honest, on the prompt being right, or on anyone reading the report: the
validator re-ran the declared checks itself and compared the workspace
against a snapshot taken before the attempt started. That is the whole
argument for supervising a small model instead of trusting one, and it is
the reason the V2.1 evidence table below reports a BLOCKED row as a success
of the system rather than a failure of it.

### What a delivering run actually looks like on a 7B model

Worth stating plainly, because the gate table's `COMPLETED` hides it. Two of
the three delivering roles reached a correct result the *untidy* way: the
coder took 37 tool calls, two repair rounds and an L2 diagnosis, rewriting
the same file a dozen times; the documenter took 36 and two repairs. Neither
emitted a readable final report, so the validator synthesized one from the
measured evidence — every declared check passing by its own run — rather than
failing verified work. The debugger, on the same code and the same runtime,
took 7 calls, no repairs and no escalation.

That spread is the point of the supervision, not a defect in it: the loop is
what turns an unreliable worker into a delivery, and every one of those
outcomes was decided by measurement rather than by the model's own account of
itself.

### A failed run now carries the same evidence a successful one does

`report.json` gained `evidence`: the validator's verdicts (per attempt), the
tool trace with every refusal and its reason, the repair count, the
compaction count, whether a diagnosis was requested, and the duration. It is
written on the **failure** path too — round 1's `FAILED` tester produced an
evidence file with a null trace and nothing to diagnose from, which is
exactly when a reader needs it most. `null` for every provider that measures
nothing.

## Two tools, both read-only about the system they describe

`node projects/mythos-haddad/bin/haddad-team-chain.js` prints what the live
registry, router, review policy, role table, skill registry and provider
grant answer on the host it runs on — the reproducible form of the chain
table above. It creates no task, and the one scratch directory it needs is
removed on exit. `--json` for the machine form.

`node projects/mythos-haddad/bin/haddad-role-e2e.js [role …]` runs one real
task per role through the **existing** executor (`createTask` → `runTask` →
`haddad-agent` → bwrap → validator → `deliverValidatedWork`) against the real
runtime, in an isolated executor home (`HADDAD_E2E_HOME`, default
`~/mythos-ai-executor-haddad-e2e`) and an isolated git worktree per role with
its fixture committed, and writes `evidence/<role>.json`: status, validation
verdict, tool trace, `git status` of the workspace before/after, files changed
against the base commit, duration, whether a diagnosis was requested. It
schedules nothing and bypasses no gate; it builds the envelope exactly as the
bridge does. The production path (Issue → bridge → worker) is unchanged and is
re-verified after merge.

Fixture design matters, and round 1 proved it: the DOCUMENTER's declared check
was `node sum.test.js`, which passes whether or not the documentation was ever
written — so the model reported `blocked`, wrote nothing, and its check still
passed. An acceptance criterion that does not measure the deliverable is not
an acceptance criterion. It is now `node notes.check.js`, a file that reads
`NOTES.md` and fails unless it documents the function, its parameter and the
exact test command.

Two authoring rules came out of these runs, and they belong next to V1's
(*acceptance criteria must be files the sandbox can run; `node -e` is refused
by design*):

- **Name every path in full, every time.** A bare file name invites a 7B
  model to write it at the workspace root: round 2's documenter wrote correct
  content to the right file **and** a stray `NOTES.md` beside it, and lost
  the delivery to the scope guard.
- **Say what must not be created.** "Change no .js file" does not say "create
  no other file", and the difference is a rejected attempt.

## What V2.1 deliberately does not do

Stated so the next stage does not assume it inherited more than it did.

- **The registry is not yet in the live execution path.** The bridge still
  picks the provider from `EXEC_WORKER_PROVIDER`; `provider-router.route()`
  is proven to choose `haddad-qwen` by capability, but nothing routes through
  it yet. That wiring is V2.2, and the seam is one line in
  `bridge/github-bridge.js`.
- **`MYTHOS_CORE_ENABLED` stays `false`.** V2.1 needed none of it, and the
  plan's own text that routing requires it does not survive reading the code:
  `provider-router`, `agent-registry`, `reputation` and `validation` carry no
  `coreEnabled()` check. Turning the core on buys the mission/campaign path
  and should be justified on that, separately.
- **`review_fn` is still unwired.** `core/validation.js` reads
  `opts.review_fn` and nothing in production supplies one, so the bridge's
  review gate stops for a human by design. V2.1 proves only *who may review*,
  not that anything reviews.
- **Concurrency is still one.** `MYTHOS_MAX_PARALLEL=1`, and the resource
  guard still has no GPU or VRAM signal. That is V2.3, and the runtime
  advertising four slots is not permission to use them.
- **No second model, no new skill file, no network in the sandbox.**

## V2.1 gate record

The gate is the master plan's §11 V2.1 EXIT, plus the three standing items.
Each line says how it was established, not that it was.

| Gate item | State | How |
|---|---|---|
| `haddad-qwen` registered, **probed**, selected by capability for coding/testing | MET | live chain check on this host: discovered `available=true` from the real probe (marker + key + `GET /health` 200); `selectCandidates` returns it first for coding and testing, ahead of `claude-code`, on the registry's own risk-then-cost order |
| `haddad-qwen` **rejected** for sensitive review by the existing policy | MET | live: `adversarialReview(..., {sensitive:true})` → `reviewer_not_trusted_for_sensitive`, with `haddad-qwen` named in `refused_candidates`; standard scope performs with it as reviewer |
| roles defined in config; each maps to an **existing** profile; no new runtime | MET | six roles; live chain shows each → an existing `lib/policy.js` profile with the grant that profile already had; ai-team C3–C7 assert the profile equals `PROFILE_BY_ACTION[action]` and that the config cannot state one |
| skill packs injected and trust-gated | MET | live: tester → `testing` v1.0.0, reviewer → `github-review` v1.0.0, the rest → `generic` v1.0.0, each `ACCEPT` in the trust ledger; no new skill file was written (none could be attested on this host) |
| a real Qwen E2E per role, each with measured evidence | MET | `haddad-role-e2e.js`, real runtime, isolated executor home, one git worktree per role, evidence written per role |
| TESTER / REVIEWER / RESEARCHER produce **zero** workspace writes | MET | measured by `git status --porcelain` before and after, not by the report. For `reviewer` and `researcher` this is the *only* mechanical guarantee: they declare no acceptance check, so `mechanically_verified` is `false` and their PASS means nothing disqualified the attempt — see the note under the table |
| **STD-2** no duplicate architecture | MET | ai-team H1–H8 read `lib/roles.js` and fail if it gains a dependency beyond `fs`/`path`/the existing action table, declares a profile table, starts a process, timer or listener, or if a role carries a privilege-shaped field; `haddad-qwen` appears in no source file, only in config |
| **STD-3** security boundary unchanged or re-probed | MET | `mythos-haddad-tool-runner-test.js` 64/0 on the final tree, running the real `sandboxArgv` against the real `bwrap` on this host: U1 (unit carries no mount namespace), U2 and U2b (`.git` read-only, directory and worktree shapes), U3 (delivery pins `core.hooksPath`), plus the escape probes. One tool behaviour changed (`write_file` refuses a directory-shaped path) and is covered by E1/E2 |
| **STD-1** no regression | MET | 210-suite baseline at `dd2c2ffe` vs 211 on the branch: **0 new, 0 changed**, 43 non-clean on both and byte-identical. Detail below |

### The six roles, measured

| Role | Status | Report | Validator | Time | Tool calls | Repairs | Workspace writes | Delivered | Files committed | L2 diagnosis | Compactions |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `coder` | COMPLETED | completed | **PASS** | 257 s | 36 | 2 | none | yes | `projects/mythos-haddad/lib/e2e/greet.js` | yes | 0 |
| `debugger` | COMPLETED | completed | **PASS** | 99 s | 7 | 0 | none | yes | `projects/mythos-haddad/lib/e2e/pct.js` | no | 0 |
| `documenter` | COMPLETED | completed | **PASS** | 326 s | 36 | 2 | none | yes | `projects/mythos-haddad/lib/e2e/NOTES.md` | yes | 0 |
| `tester` | COMPLETED | completed | **PASS** | 109 s | 6 | 0 | none | no | - | no | 0 |
| `reviewer` | COMPLETED | completed | **PASS** | 45 s | 5 | 0 | none | no | - | no | 0 |
| `researcher` | COMPLETED | completed | **PASS** | 67 s | 3 | 0 | none | no | - | no | 0 |

Every row is measured, not reported: `Workspace writes` is `git status --porcelain`
of the task's own worktree before and after, `Files committed` is `git diff --name-only`
against the base commit, and `Validator` is `lib/work-validation.js` re-running each
declared acceptance check itself inside the same sandbox the worker used.

**`PASS` does not mean the same thing in every row, and the difference matters.**
`coder`, `debugger`, `documenter` and `tester` each declared an acceptance check, so
their PASS means the validator re-ran that file and it passed — `mechanically_verified:
true` in the evidence. `reviewer` and `researcher` declared **none**, because there is
no mechanical check of whether a review's findings or a research answer are *right*;
their evidence carries `mechanically_verified: false` and `checks_run: []`, and their
PASS means only that nothing disqualified the attempt. What is genuinely measured for
those two is the thing that can be: **zero workspace writes**, from the snapshot. A
report-only role is trusted for its read-only behaviour, never for its conclusions, and
this table should not be read as saying otherwise.

Read the three delivering rows together with the two that took 36 tool calls and two
repair rounds each: the same code, the same runtime and the same model produced a
7-call first-attempt delivery and a 36-call struggle, and the supervision is what
makes both end in a correct commit. The `coder` and `documenter` never produced a
readable final report at all — the validator synthesized one from the evidence,
because every declared check passed by its own run, rather than failing verified work.

**The tester's earlier run is the one worth keeping** (`evidence/tester-fabricated-commit.json`):
before the delivery contract was stated in the prompt, it ran both suites correctly,
wrote nothing, and reported commit `7a186fc1a7b0` with two changed files. It had made
neither. The validator refused all three attempts and stopped for a human. Its final
run, with the contract stated, reports the truth instead: *"The test sum.test.js
failed with an assertion error, while greet.test.js passed."* — which is exactly what
the fixtures are.

### Regression

Full suite sweep, both trees, path-normalised per suite, run **sequentially**
(a sweep and a live E2E at the same time is what destroyed an earlier round):

| | suites | non-clean |
|---|---|---|
| baseline `origin/main@dd2c2ffe` | 210 | 43 |
| this branch | 211 | 43 |

**0 new failures. 0 changed. 1 suite added** (`mythos-haddad-ai-team-test.js`,
153 assertions). The 43 non-clean suites are byte-identical to the baseline
and are the long-standing set — ERP and SYA (`Cannot find module 'pg'`), MPI,
hostops, `stage*` (`document.addEventListener is not a function`), the WP
comms family, `core-test`, `mythos-v1-lane-routing`, and
`mythos-orchestration-core` (2 VPS-only delivery-relay checks). None is
Haddad's and none is touched by this branch.

Both sweeps were re-run from scratch after rebasing onto `dd2c2ffe`: the
earlier pair was taken at `0068a523`, and a moved base makes the comparison
meaningless. The earlier pair is kept beside them rather than quietly
replaced.

### Resource

Measured after the runs, not asserted:

| | |
|---|---|
| orphan `bwrap` sandboxes | **0** |
| `llama-server` instances | **1** (27/29 layers on the GPU) |
| leaked E2E worktrees / branches | **0** — see below |
| concurrency | 1 throughout, against a runtime advertising 4 slots |
| host at close | 1.98 GB MemAvailable, load 0.69 |

The worktree number is a fix, not a pass. The evidence runner registered one
git worktree per role and removed none: six worktrees and eight branches had
accumulated by the end of the stage. That is a worktree leak, it is on the V2
gate list by name, and the harness now removes each role's worktree and
branch once its evidence is written (`HADDAD_E2E_KEEP=1` to keep them). The
evidence itself is unaffected — `evidence/<role>.json` records the base and
delivered SHAs and the files changed, which is what the gate reads.
