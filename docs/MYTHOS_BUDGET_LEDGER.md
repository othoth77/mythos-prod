# Mythos cumulative budget ledger

**Stage:** MYTHOS CUMULATIVE BUDGET LEDGER (Phase 2 hardening) · **Date:** 2026-08-16
**Code:** `projects/mythos-ai-executor/core/budget.js` · **Config:** `config/budgets.json`
**Suite:** `tests/mythos-budget-ledger-test.js` (80/80, mocks only, no real money)

## Why it exists

The first production Core mission found the gap itself: the policy engine
enforced a **per-request** spend threshold but kept no cumulative total, so N
separate requests of the limit each would all pass. This ledger closes that.

```text
REQUEST → policy (per-request threshold)
        → ledger (cumulative remaining)      ← stricter boundary wins
        → RESERVE
        → execute
        → SETTLE actual  |  RELEASE on failure
```

## Scope hierarchy (Phase 2 finalization)

```text
REQUEST      a single spend may never exceed request_limit
   ↓
MISSION      one mission's cumulative spend may never exceed mission_limit
   ↓
PROJECT/DAY  the project's cumulative spend in its period ≤ daily_limit
   ↓
POLICY       the policy engine's own class rules and per-request threshold
```

A request must pass **every** applicable boundary, checked strictest-first, and
**no lower scope may widen a higher one** — a mission may declare a *smaller*
limit than its project's configuration but never a larger one. If the MISSION
scope refuses after the project/day hold was taken, that hold is **rolled back**
immediately (with a reason-carrying release event), so a refused request leaves
nothing behind. Mission ledgers are keyed by mission id, which makes them
independent of provider, agent, task, retry, worktree and process.

Sandbox limits deliberately differ (request 5 < mission 8 < day 10) so each
boundary is observable on its own.

## Reservation leases and crash recovery

Every reservation is held under a **lease**: a persisted expiry plus the
identity of the holder. This closes the last hardening risk — budget held by a
crashed process used to stay held until some later attempt happened to
supersede it.

| Field | Meaning |
|---|---|
| `holder_id` | `host:pid:process-start-ticks` — start-ticks make it immune to PID reuse |
| `lease_expires_at` | Persisted expiry (never a memory-only timer) |
| `attempt_id`, `created_at`, `updated_at`, `heartbeats` | Provenance of the hold |

**Lease states.** `ACTIVE` and `EXPIRED` are derived from the persisted clock;
`RELEASED`, `SETTLED` and `RECOVERED` are persisted facts.

**Heartbeat.** A long-running task renews its own lease in place: idempotent,
persisted, holder-checked, and it explicitly never moves money — so a healthy
slow task is never recovered from underneath.

**Recovery** happens only when the lease has expired **and** the holder is
provably gone:

| Holder probe | Result |
|---|---|
| alive | never recovered — a live holder is never stolen from |
| **zombie** (exited, unreaped) | treated as gone — `/proc` still lists it and `kill(pid,0)` still succeeds, so a naive check would hold its budget hostage |
| pid reused (start-ticks differ) | original holder is gone → recoverable |
| unknown (another host) | fail-safe: not recovered until a much longer grace elapses |

Recovery is atomic under the ledger lock and idempotent: a second sweep
recovers nothing, a heartbeat afterwards is rejected, settling a recovered
reservation is **refused** (the hold was already returned, so settling would
spend money the ledger re-offered), and releasing one is a safe no-op. Eight
racing recoverers recover an entry exactly once.

**Scheduler integration** rides the existing lifecycle — a sweep at mission
start and a heartbeat interval per running spend task. There is no second
scheduler and no manual recovery verb; `budget reservations` and
`GET /budget/<project>/reservations` are read-only views.

## Model

| Field | Meaning |
|---|---|
| project / scope / period_key | Budget identity. Scope `DAY` (implemented) and `PROJECT`; `MISSION`/`REQUEST` reserved for later. |
| currency / timezone / limit | From committed config. A project **absent** from config has NO budget — spending authority is granted explicitly, never by default. |
| reserved / spent / remaining | `remaining = limit − reserved − spent`, rounded to cents. |
| entries | Keyed by a stable reservation id: `RESERVED → SETTLED | RELEASED`. |

Shipped limits: `mythos-prod` **0** (the orchestration project performs no paid
external actions) and `budget-sandbox` **10 USD/day** for proofs, with no
payment method and only mock/sandbox tools reachable under `MONEY_SPEND`.

## Guarantees, and how each is proven

| Guarantee | Mechanism | Proof |
|---|---|---|
| Two parallel tasks cannot overspend | Reserve-then-settle under an `O_EXCL` lock | **12 real concurrent processes** against one 10 USD budget: exactly 10 allowed, 2 denied, `reserved + spent ≤ limit` throughout |
| Atomicity survives a crashed holder | Stale locks broken **only when the holder is provably dead**; age decides only when the pid is unreadable | Live-holder probe: an aged lock held by a live process is *not* stolen — the request fails closed |
| Settlement is idempotent | Stable ids; `SETTLED` returns a replay acknowledgement | Duplicate settle counts once; duplicate release is a no-op; a settled spend never un-spends; a released hold never settles |
| Restart creates no free budget | Ledger is on disk; totals recomputed from entries | Fresh process reads identical spent/reserved/remaining; an unsettled hold still holds |
| Provider switching cannot bypass | Identity is project + period; provider/agent/tool are labels | Claude reserves 5 of 5 → Gemini denied → OpenAI denied → retry denied |
| Unknown cost never becomes zero | Amount must be finite with basis `known`\|`estimated` | `NaN` and unknown basis both refused |
| Daily boundary is deterministic | `Intl` with an explicit IANA zone | Paris vs Tokyo differ for the same instant; boundary flips at local midnight; a DST spring-forward stays in one budget day |
| Stricter boundary wins | Policy consults per-request **and** ledger | A per-request-legal 5 USD is denied when only 3 USD remains |
| Broken ledger fails closed | Structured refusal, never a throw into control flow | A throwing ledger cancels the task; no execution, no crash |
| Budget ≠ quota | Separate modules; nothing conflates them | Provider quota availability never grants spend authority |

## Integration

The existing policy engine gained a ledger dependency (no second policy
system): `MONEY_SPEND` evaluates the per-request threshold **and** cumulative
remaining. The scheduler reserves before dispatch, settles the **actual** cost
reported by the runner on success, and releases the hold on failure — and a
previous attempt's leaked hold is released before the gate, so a crash cannot
strand budget for the rest of the period. A task's own hold is excluded when
its tools are granted, so it cannot block itself.

Events (durable, no secrets): `BUDGET_CHECKED`, `BUDGET_RESERVED`,
`BUDGET_RELEASED`, `BUDGET_SETTLED`, `BUDGET_DENIED`,
`BUDGET_APPROVAL_REQUIRED`, `BUDGET_PERIOD_RESET`. Approval records carry
requested amount, limit, spent, reserved, remaining, period, mission, task and
agent.

## Inspection (read-only by design)

```bash
mythos-ai-executor budget status budget-sandbox
mythos-ai-executor budget history budget-sandbox
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8130/budget/budget-sandbox
```

There is deliberately **no mutation verb or route**: limits change only through
a reviewed commit to `config/budgets.json`.

## Independent review

Three reviewers via OmniRoute (Gemini 3.6 Flash, GPT-4o, DeepSeek Chat), no
Fable 5 quota. DeepSeek: `overspend_possible: false`. Five findings verified
and fixed (live-holder lock race; leaked reservation after a crash; unevidenced
`known` cost-basis upgrade; ledger exceptions reaching mission control flow;
thin approval records). Two rejected with evidence: replaying a *released*
reservation id stays denied by design (a retry takes a new attempt id), and
wall-clock dependence is inherent to any time-based period — the timezone is
explicit and boundary-tested. Findings and fixes are recorded in the stage
entry of `docs/AI_HANDOVER.md`.

## Live safe proof (no real money)

Sandbox namespace, mock spending surface only:
Mission A requests 6 → **allow** (remaining 4) · Mission B requests 6 → **deny**
· settle A at actual 5 → spent 5, remaining 5 · a new 5 → **allow** · a 6 →
**deny**. Final: limit 10, spent 5, remaining 5, entry history exposed through
the read-only endpoints.

## Residual risks

- `MISSION` and `REQUEST` scopes are modelled but not enforced; only
  `DAY` (and `PROJECT` period keys) are implemented.
- Cost is declared by the runner; no provider billing API is wired, so
  `known` means "the runner reported a figure", not "the provider invoiced it".
- Lock waiting is bounded at 5 s: under pathological contention a spend fails
  closed rather than queueing.
- The ledger measures money only. Provider quota remains a separate concept and
  is deliberately not unified.
