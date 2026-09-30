# Mythos Trading Agent

Research, backtesting and paper-trading platform for the Mythos Trading Agent.

> **Operating state: `BACKTEST`.** No venue connectivity exists in this project,
> no credentials exist, and the live execution adapter refuses every call. This
> is research infrastructure. **Nothing here has been shown to be profitable,
> and no claim of regulatory compliance is made** — see
> [`docs/COMPLIANCE_AND_RISK.md`](docs/COMPLIANCE_AND_RISK.md).

## What this is

A modular, deterministic, event-driven platform that turns market data into
auditable trading decisions:

```
MARKET DATA → REGIME ENGINE → STRATEGY PORTFOLIO → CANDIDATES
   → JEV GATE → COST FILTER → RISK ENGINE → RECOVERY ENGINE
   → ONE-TRADE-ONLY → EXECUTION → RESULT → DATABASE
```

`NO_TRADE` is a first-class decision at every stage, recorded with the stage and
the reason codes that produced it.

## Quick start

```bash
cd projects/mythos-trading-agent
npm test                              # 572 tests, no install step, zero dependencies

node bin/mtx.js status                # mode, risk limits, recovery ladder, promotion gates
node bin/mtx.js health                # 13 health checks against a fresh backtest
node bin/mtx.js backtest --bars 3000  # one backtest, with its full pipeline funnel
node bin/mtx.js walkforward           # rolling in-sample / out-of-sample folds
node bin/mtx.js analyse               # the Analysis Agent's report
node bin/mtx.js research              # hypotheses, each with its falsification criterion
node bin/mtx.js stress                # the mission §15 stress suite
node bin/mtx.js help                  # options: --symbols --bars --capital --jev --recovery --json
```

The CLI has **no `--mode` flag**: the mode changes only through an owner-approval
record, and a command-line flag must not substitute for one. It cannot promote a
champion, and it places no order.

## Layout

| Path | Contents |
|---|---|
| `src/core/` | enums, money/size arithmetic, seeded RNG, canonical hashing, ids, UTC clock, logging, instrument + P&L model |
| `src/config/` | closed-key configuration schema and loader |
| `src/mode/` | execution-mode controller and the validation gates between stages |
| `src/db/` | append-only record store and its table schema |
| `src/data/` | data-source interface, synthetic generator, fixtures, resampling |
| `src/indicators/` | indicator primitives |
| `src/regime/` | market regime classification |
| `src/strategy/` | strategy interface, registry and the strategy families |
| `src/jev/` | the Jev decision gate |
| `src/cost/` | spread / commission / slippage / swap model |
| `src/risk/` | Risk Engine — final authority on size and on whether to trade |
| `src/recovery/` | per-asset recovery ×3 ladder (opt-in, capped) |
| `src/account/` | account state and the global one-trade-only controller |
| `src/execution/` | execution adapters (backtest, paper, and a LIVE stub that refuses) |
| `src/backtest/` | engine, walk-forward, metrics |
| `src/stress/` | Monte Carlo and perturbation stress |
| `src/agents/` | Trading, Analysis and Research agents |
| `src/champion/` | champion / challenger registry and promotion gates |
| `src/observability/` | health checks, metrics, audit helpers |
| `src/paper/` | incremental paper-trading session (PAPER mode only) |
| `config/` | `default.json` (defaults) and `instruments.json` (contract specs) |
| `bin/` | `mtx.js` (CLI) and `make-fixtures.js` (regenerates the committed fixtures) |
| `docs/` | [architecture](docs/ARCHITECTURE.md), [compliance register](docs/COMPLIANCE_AND_RISK.md), [validation gates](docs/VALIDATION_GATES.md), ADRs |
| `tests/` | `node --test` suites |

## Safety model in one paragraph

Mode is a three-valued enum defaulting to `BACKTEST`. Configuration cannot
select `LIVE` — the schema rejects it. Raising the mode requires an `OWNER`
principal presenting a single-use approval record bound to the running config
fingerprint and commit, with written evidence per gate; an `AGENT` principal is
refused unconditionally. Downgrades toward `BACKTEST` need no approval from
anyone. The Risk Engine is the last writer of position size, so the recovery ×3
ladder can only ever *request* a size — and it is opt-in, capped by
`maxRecoveryLevel`, and clamped again by the account's hard limits. Details:
[ADR-0002](docs/adr/0002-safety-architecture.md).

## Status

[`STATUS.md`](STATUS.md) carries the current phase, test results, known risks
and the next task.
