# ADR-0001 — Primary execution / backtesting architecture

- **Status:** Accepted
- **Date:** 2026-09-30
- **Deciders:** lead autonomous engineering agent, under the owner approval recorded in the task envelope
- **Supersedes:** nothing
- **Mission reference:** §2 ("Select ONE primary execution/backtesting architecture", "Do NOT reinvent mature infrastructure")

## Context

Mission §2 names six mature open-source projects and asks for one of them to be
the primary architecture rather than a blend:

| Project | Language / runtime | Licence | What it would give us |
|---|---|---|---|
| NautilusTrader | Python + Rust/Cython core | LGPL-3.0 | Event-driven backtester with a nanosecond clock, order/position model, live adapters |
| Microsoft Qlib | Python | MIT | ML research pipeline, factor/alpha workflow, dataset management |
| QuantConnect LEAN | C# (.NET) | Apache-2.0 | Full engine, brokerage adapters, large data catalogue |
| Freqtrade / FreqAI | Python | GPL-3.0 | Crypto-first bot with hyperopt and an ML layer |
| VectorBT | Python (NumPy) | Apache-2.0 (open core; pro is commercial) | Very fast vectorised parameter sweeps |
| Hummingbot | Python | Apache-2.0 | Market-making / execution connectors for crypto venues |

The hard constraint on this decision is the **execution environment of this
build**, set by the operator in the task envelope:

> Tools: Read/Grep/Glob/Write/Edit, git, node, npm, npx, ls, rg, mkdir, cat, diff, wc.
> **Python is NOT available:** implement in Node.js using the repo's existing patterns and
> `node --test` tests. Prefer zero/minimal npm dependencies; document any added. The OSS
> frameworks in §2 are Python/C#: evaluate them in an ADR and record the decision; do not vendor them.

There is also no network access to trading APIs and no market-data credentials,
so the parts of those frameworks that are hardest to replace — their venue
adapters and data catalogues — are unusable in this environment regardless of
language.

## Decision

**Build the primary engine in Node.js as a modular, event-driven bar-replay
backtester inside `projects/mythos-trading-agent/`, with every externally
replaceable concern behind a narrow interface.** Do not vendor, wrap, or depend
on any of the six frameworks in this build.

Concretely, the interfaces that exist so a framework can be adopted later
without rewriting the platform:

| Interface | File | What a future adoption would replace |
|---|---|---|
| Data source | `src/data/source.js` | A Qlib/LEAN dataset provider, or a venue history API |
| Execution adapter | `src/execution/adapter.js` | A NautilusTrader or LEAN execution client, or a broker API |
| Backtest engine | `src/backtest/engine.js` | A NautilusTrader `BacktestEngine` behind the same `run(...)` contract |
| Strategy | `src/strategy/base.js` | A strategy written against another framework's API, adapted |
| Cost model | `src/cost/model.js` | A venue's real fee schedule |

The decision framework of the `search-first` skill (SEARCH → REUSE → ADAPT →
CONNECT → BUILD LAST) applies, and the honest verdict here is **BUILD, with the
adoption seams designed in** — not because nothing suitable exists, but because
nothing suitable is *runnable in this environment*, which is a different and
much narrower claim.

## Why not each alternative

**NautilusTrader** is the closest architectural match to what mission §3
describes: an event-driven engine with a proper order/position/account model and
the same backtest-then-live code path. It is the framework this platform should
be measured against, and ADR-0003 should revisit adopting it the moment a Python
runtime is available. It is rejected *here only* because it cannot execute in
this environment.

**QuantConnect LEAN** is C#/.NET, which is as unavailable as Python, and it is
the heaviest of the six to operate for a $100 research account.

**Microsoft Qlib** solves a different problem — ML alpha research over equity
cross-sections. It has no order/position/recovery/one-trade-only model, so it
would be an addition to the platform rather than the platform.

**Freqtrade / FreqAI** is crypto-exchange shaped: its data, fee and position
models assume spot/futures crypto venues, while the mission's initial universe is
FX plus gold, where spread, swap and contract-size semantics differ. Its GPL-3.0
licence would also propagate to the whole platform, which is a decision for the
owner and not for an autonomous build.

**VectorBT** is excellent at the parameter-sweep part of mission §10 and nothing
else we need: it is vectorised, which is precisely what makes a path-dependent
recovery ladder and a global one-trade-only lock awkward to express, since each
trade's size depends on the realised outcome of the previous one.

**Hummingbot** is a market-making execution framework for crypto venues. Wrong
strategy class, wrong asset class, and its value is in the connectors we cannot
reach.

## Consequences

**Accepted costs.**
- We own the correctness of the engine. That is the real price of this decision,
  and it is paid in tests: the bar-replay semantics, intrabar stop/target
  ambiguity, cost application and look-ahead prevention each need their own
  adversarial suite rather than a framework's reputation.
- No live venue connectivity exists, and none can be added in this environment.
  This is consistent with the lifecycle the owner set (backtest → paper →
  controlled live) and with the LIVE adapter being a stub that refuses.
- We forgo tick-level and order-book simulation. Bars are the resolution.

**Benefits taken.**
- Zero runtime dependencies. Nothing to audit, pin, or CVE-track; `npm test`
  needs no install.
- Native fit with Mythos OS: same language, same `node --test` convention, same
  repository, same JSON-lines-and-manifest storage idiom, no new service (owner
  approval §7).
- The path-dependent parts of the mission — recovery ×3 state per asset, a
  global one-trade lock, a Risk Engine with final authority — are natural in an
  event loop and unnatural in a vectorised engine.

**Explicitly deferred to a later ADR.**
- Adopting NautilusTrader as the execution/backtest core once Python is
  available, with this platform's Risk/Recovery/Jev layers retained on top.
- Using VectorBT for wide parameter sweeps and feeding survivors back into this
  engine for path-dependent validation.

## Honest statement of limits

This ADR records an environment-constrained decision, not a claim that a
hand-built Node engine is better than NautilusTrader. It is not. The mitigation
is the interface boundary above plus the test suite, and the adoption question
must be re-opened — not quietly forgotten — when the constraint lifts.
