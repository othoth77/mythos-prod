# Validation gates — Mythos Trading Agent

The owner approves progression between lifecycle stages (owner approval §3, §4).
This document is the human-readable side of `src/mode/gates.js`; the machine
checks the same list.

```
BACKTEST  --[10 gates]-->  PAPER  --[20 gates]-->  LIVE
   ^                         |                       |
   +-------------------------+-----------------------+
            downgrades need no approval from anyone
```

## How an approval is presented

A mode upgrade requires an approval record passed to
`modeController.transition({ to, principal, approval })`. Anything less is
refused, and the refusal is logged with a machine-readable reason.

```js
{
  id: 'approval-2026-10-15-paper',
  fromMode: 'BACKTEST',
  toMode: 'PAPER',
  ownerApproval: true,
  approvedBy: { kind: 'OWNER', id: 'owner:<identifier>' },
  // must contain this sentence EXACTLY:
  statement: 'I approve the Mythos Trading Agent transition BACKTEST -> PAPER',
  approvedAt: '2026-10-15T09:00:00.000Z',
  configFingerprint: '<cfg.fingerprint.hash of the running config>',
  commit: '<the commit being approved>',
  gatesPassed: [ /* every gate below */ ],
  gateEvidence: { GATE_NAME: 'where the evidence lives, in words' }
}
```

Rules the controller enforces:

- **`OWNER` principal only.** An `AGENT` principal is refused before any other
  check, even holding a perfect record.
- **Single use.** A record cannot be replayed after a downgrade.
- **Bound.** The record names the config fingerprint and commit it approves. An
  approval of one system is not an approval of a later one.
- **Evidenced.** Every required gate needs a non-trivial `gateEvidence` string.
  "Gate passed" as a bare claim is refused.

## Gates: BACKTEST → PAPER

| Gate | What must be true | Evidence to cite |
|---|---|---|
| `UNIT_TESTS_PASS` | `npm test` passes on the approved commit | test counts + commit SHA |
| `BACKTEST_REPRODUCIBLE` | Re-running a recorded backtest from its config fingerprint and dataset version reproduces its store digest | two run digests, equal |
| `COST_MODEL_APPLIED` | Every reported figure is net of spread, commission, slippage and swap | a backtest report showing gross, costs and net separately |
| `RISK_LIMITS_ENFORCED` | Each hard limit provably binds | the risk test suite, naming each limit |
| `RECOVERY_CAPPED` | Recovery cannot exceed `maxRecoveryLevel`, max position size or max account risk | the recovery test suite incl. the clamping rate |
| `ONE_TRADE_ONLY` | At most one account-level position open at any simulated instant, over a multi-asset run | the one-trade invariant test + a multi-asset run |
| `AUDIT_TRAIL_COMPLETE` | Every candidate, gate decision, trade and block is persisted with reason codes | store table counts from a full run |
| `OUT_OF_SAMPLE_TESTED` | Results hold on data never used for selection | in-sample vs out-of-sample metrics |
| `DRAWDOWN_WITHIN_LIMIT` | Observed max drawdown inside `risk.maxDrawdownPct` on every segment | per-segment drawdown table |
| `LOSING_STREAK_WITHIN_LIMIT` | Observed max consecutive losses inside `risk.maxConsecutiveLosses` | the streak distribution |

## Gates: PAPER → LIVE

All of the above, plus:

| Gate | What must be true |
|---|---|
| `WALK_FORWARD_TESTED` | Rolling in-sample/out-of-sample folds completed, per-fold results recorded |
| `MONTE_CARLO_SURVIVED` | Trade-order randomisation keeps drawdown and streaks inside limits at the agreed confidence level |
| `STRESS_SUITE_SURVIVED` | Spread expansion, slippage expansion, execution delay, parameter perturbation and data-gap stress all completed within limits |
| `POSITIVE_NET_EXPECTANCY` | Net expectancy per trade positive after costs, with the sample size stated |
| `PAPER_FORWARD_TESTED` | A paper run of the agreed duration completed and was compared against the backtest expectation |
| `CHAMPION_PROMOTION_RECORDED` | The configuration has a promotion record with its comparison evidence |
| `OWNER_CAPITAL_DECISION` | The owner has stated the capital at risk in writing |
| `VENUE_COSTS_VERIFIED` | **Not satisfiable from this repository.** Cost figures replaced with a named venue's published schedule |
| `LIVE_ADAPTER_IMPLEMENTED` | **Not satisfiable in this build.** The live adapter is a stub that always refuses |
| `EXTERNAL_LEGAL_REVIEW` | **Not satisfiable from this repository.** Independent legal/regulatory review |

Plus `acknowledgedCapitalAtRisk: true` on the record itself.

### Why unsatisfiable gates are listed rather than omitted

An absent requirement is one nobody argues about. A listed, unsatisfiable one
makes the block explicit, auditable, and impossible to satisfy by accident — an
honest approval attempt fails with the exact message
`gates not satisfied: VENUE_COSTS_VERIFIED, LIVE_ADAPTER_IMPLEMENTED, EXTERNAL_LEGAL_REVIEW`,
which names precisely what is still missing.

## Checking where you stand

```js
const controller = require('./src/mode/mode-controller').create({ /* ... */ });
controller.dryRun('PAPER', candidateApprovalOrNull);
// → { ok, upgrade, problems: [...], requiredGates: [...], unsatisfiableGates: [...] }
```

`dryRun` changes nothing and may be called by an agent. `transition` may not.
