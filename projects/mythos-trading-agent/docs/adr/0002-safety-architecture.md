# ADR-0002 — Safety architecture: mode, authority and the recovery ladder

- **Status:** Accepted
- **Date:** 2026-09-30
- **Mission reference:** §7, §8, §22 · Owner approval §3, §4, §5, §10

## Context

The mission asks for a recovery scheme where each loss triples the next position
size (0.01 → 0.03 → 0.09 → 0.27 → 0.81 …) and the owner's clarification narrows
it sharply:

> Recovery ×3 may be implemented **ONLY** as a capped, fully risk-controlled,
> opt-in option. It must never override the Risk Engine or the maximum-loss limits.

Separately: initial capital is $100, live execution must stay disabled, and the
agent must never move the system between lifecycle stages by itself.

An unbounded ×3 ladder on $100 is not a strategy, it is a countdown. Starting at
0.01 lots on EURUSD with a 15-pip stop, the ladder's cumulative loss reaches the
whole account at about level 4, and level 5 requires more margin than the account
contains. Any design that lets the ladder "just work" is wrong.

## Decision

Four structural rules, each enforced in code and covered by tests.

### 1. The Risk Engine is the last writer of position size

Recovery does not *set* size. It *requests* one. The pipeline is:

```
recovery.requestedLots  →  riskEngine.assess(...)  →  ALLOW | CLAMP | BLOCK
                                                       ↓
                                       the approved size, or no trade
```

`RiskVerdict.CLAMP` exists precisely so the common case is visible: the ladder
asked for 0.09, the account may risk $2, the approved size is 0.01. There is no
API by which a caller can obtain a size larger than the Risk Engine's verdict —
the executor takes `approvedLots` and nothing else, and a component that tries to
pass its own size is met with `RiskAuthorityViolation`.

### 2. Recovery is opt-in and capped twice

`recovery.enabled` defaults to `false` in `config/default.json`. When enabled,
`recovery.maxRecoveryLevel` caps the ladder (default 3 → 0.01/0.03/0.09), and the
config schema refuses any value above 8 regardless. Reaching the cap is not an
escalation — it is an abandon: the ladder resets and the accumulated loss is
recorded as a realised loss rather than carried into a larger bet.

This is two independent caps (level cap, then Risk Engine clamp) on purpose. The
level cap can be misconfigured; the Risk Engine clamp cannot be, because it is
derived from account equity and the hard limits rather than from the ladder.

### 3. Mode is an enum with an owner-approval gate, not a flag

`BACKTEST | PAPER | LIVE`, default `BACKTEST`, and three separate locks stand
between the platform and a live order:

1. `config/schema.js` refuses to parse a configuration whose mode is `LIVE`. The
   file-editing route does not exist.
2. `src/mode/mode-controller.js` raises the mode only for an `OWNER` principal
   presenting a single-use approval record bound to this config fingerprint and
   commit, with per-gate written evidence. An `AGENT` principal is refused before
   any other check.
3. `src/execution/live-adapter.js` refuses every call regardless of mode. So even
   a correctly approved `LIVE` mode still cannot place an order in this build.

Downgrades toward `BACKTEST` need no approval from anyone. A safety mechanism
that requires paperwork to make things safer gets bypassed exactly when it
matters.

### 4. Every refusal is a record, not a silence

`NO_TRADE` is a first-class decision (mission §3) carrying the stage that
produced it and its reason codes. A blocked trade, a clamped size and a Jev
rejection are all persisted, because §17's questions ("why did it reject it?",
"why did risk engine block it?") are queries over records.

## Consequences

- At $100 with a 2 % per-trade cap ($2) and a 0.01-lot minimum, **many
  legitimate signals are simply untradable** — on EURUSD the stop must be ≤ 20
  pips for the minimum size to fit the budget. The platform's correct answer is
  `NO_TRADE` with reason `SIZE_BELOW_MINIMUM`, and the rate at which that fires
  is a headline metric, not an error. See `docs/COMPLIANCE_AND_RISK.md`.
- Recovery, when enabled at this account size, will be clamped to the minimum lot
  almost immediately. The tests assert this rather than treating it as a defect:
  the ladder is allowed to exist and forbidden to matter more than the limits.
- Backtests of recovery-enabled configurations measure a *clamped* ladder. Any
  research conclusion about recovery must state the clamping rate, or it is
  describing a system that was never run.

## Alternatives rejected

- **A recovery engine that sizes directly, with the Risk Engine as a later
  check.** Rejected: it makes the unsafe size reachable in memory and relies on
  every call site remembering to check. Authority has to be structural.
- **A boolean `liveEnabled` flag.** Rejected: two states for a three-state
  problem, and a flag is exactly the thing an autonomous agent can flip.
- **Dropping recovery entirely.** Rejected: the owner asked for it as a capped,
  opt-in option. Refusing to build a requested feature is not our call; building
  it so that it cannot cause the harm is.
