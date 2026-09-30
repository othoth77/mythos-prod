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
npm test          # node --test tests/*-test.js — no install step, zero dependencies
```

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
| `config/` | `default.json` (defaults) and `instruments.json` (contract specs) |
| `docs/` | architecture, compliance register, validation gates, ADRs |
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
