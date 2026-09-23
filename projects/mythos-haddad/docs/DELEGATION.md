# Mythos Haddad V2.2 — FABLE delegation

> Companion to [AI_TEAM.md](AI_TEAM.md) (V2.1) and
> [MYTHOS_HADDAD_V2_MASTER_PLAN.md](MYTHOS_HADDAD_V2_MASTER_PLAN.md) §11 (V2.2).

## What changed, in one sentence

Which provider runs a task stopped being a configuration read and became a
**routed decision** — role → capability → agent → provider — taken by
machinery that already existed, with the bridge's allow-list unchanged as a
fail-closed floor.

## The seam

Before V2.2 the bridge chose its provider with one expression:

```js
EXEC_WORKER_PROVIDER || WORKER_PROVIDER || (task.lane ? 'delegate' : 'claude-code')
```

That is the same provider for every task, whatever the task is. V2.1 had
already made the registry able to answer *which agent should do this*, and
the router able to answer *which one may*, but nothing asked them. V2.2 asks.

`bridge/provider-selection.js` is the whole of the connection, and it
contains no routing logic of its own. It translates in three steps:

| step | asks | owned by |
|---|---|---|
| role | what does this task need? | `lib/roles.js` (V2.1) |
| router | which agent should do it? | `core/provider-router.js` |
| registry | which provider does that agent run on? | `core/agent-registry.js` |

## The floor, which is the point

A routed provider outside the bridge's allow-list is **refused, never
substituted**. On Haddad `EXEC_WORKER_PROVIDER_ALLOWED` is exactly
`['haddad-agent']`, so:

```
runtime UP    → router picks haddad-qwen  → haddad-agent → ROUTE
runtime DOWN  → router picks claude-code  → not permitted → DEFER
```

That second line is the property worth having. When the local model is
unavailable the router legitimately prefers `claude-code` — it is available
and it has execution authority — and the floor refuses it. The task stays
PENDING and the next tick asks again. **Substituting a permitted provider
for a refused one is how a routing layer becomes a silent widening of
authority**, so the adapter does not do it, and the test that proves it runs
every bridge action against a down runtime and asserts none of them yields
Claude.

`defer` is deliberately not `blocked`: nothing is wrong with the task, and a
blocker is never retried automatically.

## Scope, deliberately narrow

Routing runs **only** on a bridge instance that is explicitly an execution
worker (`MYTHOS_BRIDGE_EXEC_PROVIDER` set — today, Haddad). Everywhere else
the pre-V2.2 expression is used character-for-character, so the production
VPS path is untouched.

An explicit operator pin is a decision already taken, and a router that
overrides one is not delegating, it is overruling. The `mock` pin the suites
use and the advisory `MYTHOS_BRIDGE_WORKER_PROVIDER` pin are both honoured
as written. Getting this wrong was the first thing the bridge suites caught:
14 and 23 failures, because routing had overridden the mock pin.

## Two corrections to the master plan, both measured

> **RATIFIED BY THE OWNER 2026-09-23.** Both corrections below are accepted as the V2.2 record.
> `MYTHOS_CORE_ENABLED` stays `false`. The master plan's V2.2 exit-gate items are ticked as
> re-scoped, and its §11 matrix row (which read `Core enabled | V2.2 | YES`) is corrected to
> `no` for every phase. Worth knowing why that mattered: an audit on 2026-09-23 read the stale
> matrix row, searched the master plan and `STATUS.md` for a re-scope, did not search THIS
> file, and reported a skipped gate that had never been skipped. The finding was withdrawn.
> A phase's decisions live in the phase's own document — which is the first place to look, and
> was the last.

The plan's §11 V2.2 text does not survive reading the code, and both
corrections are recorded here rather than quietly worked around.

**1. Routing does not require `MYTHOS_CORE_ENABLED=true`.** Measured:
`provider-router.js`, `agent-registry.js`, `reputation.js` and
`validation.js` contain **zero** `coreEnabled()` references. Only
`core/core-wiring.js` gates, and what it gates is the HTTP goal API, whose
intake is a closed two-entry `MISSION_KINDS` table (`repo-analysis`,
`policy-probe`) — neither can express a bridge coding task. Flipping the flag
buys the mission/campaign path, not routing, and should be justified on that
separately. **The flag stays `false` and V2.2 does not touch it.**

**2. "`wait_for_quota` observed live when the runtime is down" is
unreachable.** `route()` answers `wait_for_quota` only when
`opts.quota_state[agent].exhausted` is set, and **no production code builds
that map** — the `quota_state` in `executor.js` is the executor's own
per-task record, a different thing. A down runtime makes the probe false, the
registry filters the agent out, and the answer is `no_provider`. The gate
item is therefore restated as what actually happens and what the code now
guarantees: **defer on no permitted provider**. The `wait_for_quota` branch
is still handled rather than assumed away, and its test drives it through an
injected quota state.

## The decision is a record

Every claimed task carries its routing decision on the attempt:

```json
{
  "routed": true,
  "role": "debugger",
  "role_reason": "action:implement+match:debugger",
  "task_type": "coding",
  "capabilities_required": ["debugging", "repo_modification"],
  "router_action": "route",
  "router_agent": "haddad-qwen",
  "allowed": ["haddad-agent"],
  "provider": "haddad-agent",
  "authority": true,
  "why": "routed by capability from the agent registry"
}
```

"Why did this task go to this provider?" is answerable from the record rather
than by re-deriving it from configuration that may since have changed. A
deferred task logs the same decision with the reason it could not be used.

## What routing does NOT touch

The execution profile still comes from the action, server-side, through
`bridge/action-resolution.js`. **Routing chooses WHO; the action still chooses
WHAT.** The adapter never reads or writes `execution_profile`, and a test
asserts the decision carries none of its own for any of the five actions.
`ACTION_PROFILE_MISMATCH` is unchanged and still fires.

## Evidence

The E2E fixture (`projects/mythos-haddad/lib/e2e22/ratio.js` and its test,
deliberately broken) is **not** merged, following the V1 convention: a live
E2E needs the broken fixture on the bridge's base ref, and it is removed
afterwards rather than left on `main` where nothing references it. It exists
in this branch's history and in the run's evidence.

Real Issue [#401](https://github.com/othoth77/mythos-prod/issues/401),
intaken on an isolated label (`mythos:haddad-v22`) with its own control
directory and executor home so the production bridge could not collide with
it: classified `implement`, resolved to the **debugger** role by its
instruction text, routed to `haddad-qwen`, mapped to `haddad-agent`, checked
against the floor, claimed with the decision above recorded on the attempt.

Live routing on the host, all five bridge actions, real probes:

```
implement   route  haddad-agent  role=coder       routed:haddad-qwen/haddad-agent
test        route  haddad-agent  role=tester      routed:haddad-qwen/haddad-agent
review      route  haddad-agent  role=reviewer    routed:haddad-qwen/haddad-agent
investigate route  haddad-agent  role=researcher  routed:haddad-qwen/haddad-agent
document    route  haddad-agent  role=documenter  routed:haddad-qwen/haddad-agent
```

`tests/mythos-haddad-delegation-test.js` — 53 assertions, every probe
injected so the decision is what is tested, never the host.

## A defect this E2E exposed, which is NOT V2.2's and is not fixed here

The routed task COMPLETED with the validator passing, and **delivered
nothing**, while the correct fix sat in its workspace. The sequence, from its
own `events.log` (two `provider_launch` entries):

1. Attempt 1 wrote the corrected `ratio.js`, then died on `socket hang up`
   when the runtime restarted underneath it. Correctly classified transient,
   parked `WAITING_RETRY`.
2. Attempt 2 resumed **in the same workspace**, where the fix already was.
   It read the file, ran the check, saw it pass, and truthfully reported that
   no change was needed.
3. The validator agreed — `node …/ratio.test.js` passes — but its evidence
   said `changed: {created: [], modified: [], deleted: []}`, because the
   snapshot is taken at **attempt** start and the work predates it.
   `deliverValidatedWork` requires changed files, so it committed nothing.

The workspace differs from its base commit by exactly the fix
(`1 file changed, 1 insertion(+), 1 deletion(-)`) and the test passes. So
validated work exists, was never delivered, and the Issue would have been
reported completed with no commit and no problem recorded.

**This is pre-existing delivery behaviour, not something V2.2 introduced** —
the snapshot is taken in the provider's `run()` and the retry path is
untouched by this change. It is the same *class* as the bug HAD-4's merge
audit fixed with `DELIVERY_FAILED`: work the validator accepted that quietly
fails to land. Any transient blip during any phase's E2E can produce it, so
it undermines evidence generally, not just here.

It is deliberately **not** fixed in this PR. Changing what delivery measures
against — the attempt's snapshot versus the worktree's base commit — is a
change to the proven HAD-4 loop and deserves review on its own merits, the
way `lib/quota.js`'s transient classifier was split out of #384 into #385
rather than riding along. It is the next change after this one.
