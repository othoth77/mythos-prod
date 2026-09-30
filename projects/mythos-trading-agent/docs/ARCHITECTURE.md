# Architecture — Mythos Trading Agent

> Operating state: **`BACKTEST`**. No venue connectivity, no credentials, no network
> client. Nothing here has been shown to be profitable and no claim of regulatory
> compliance is made — see [`COMPLIANCE_AND_RISK.md`](COMPLIANCE_AND_RISK.md).

Companion documents: [ADR-0001](adr/0001-execution-engine-selection.md) (why a
Node.js engine), [ADR-0002](adr/0002-safety-architecture.md) (the safety model),
[VALIDATION_GATES.md](VALIDATION_GATES.md) (how a stage progresses),
[`../STATUS.md`](../STATUS.md) (current phase and test status).

---

## 1. The pipeline

Mission §3, wired end to end in `src/agents/trading-agent.js`:

```
                 ┌──────────────────────────────────────────────┐
  MARKET DATA ──▶│ src/data/  source · feed · series · resample  │
                 └───────────────────┬──────────────────────────┘
                                     │ a view pinned to bar i, backward-only
                                     ▼
              REGIME ENGINE   src/regime/engine.js
                 six regimes, scored + hysteresis, on EVERY bar
                                     │
                                     ▼
            STRATEGY PORTFOLIO   src/strategy/
                14 families · regime affects ORDER, not whether asked
                                     │
                                     ▼
                 CANDIDATES   src/strategy/candidate.js
                    costs in PIPS · breakevenWinRate
                                     │
                    ┌────────────────┴────────────────┐
                    ▼                                 │  each stage can answer
              COST FILTER   (target inside cost?)     │  NO_TRADE, and every
                    │                                 │  NO_TRADE is recorded
                    ▼                                 │  with its stage and
              JEV GATE   src/jev/gate.js              │  reason codes
                    │   score + confidence, both gate │
                    ▼                                 │
          RECOVERY requests a size   src/recovery/    │
                    │                                 │
                    ▼                                 │
       ★ RISK ENGINE decides the size   src/risk/     │
          ALLOW · CLAMP · BLOCK — final authority      │
                    │                                 │
                    ▼                                 │
        ONE TRADE ONLY   src/account/one-trade-…      │
          FREE → RESERVED → OCCUPIED → FREE           │
                    │                                 │
                    ▼                                 │
              EXECUTION   src/execution/              │
        backtest · paper · LIVE (refuses always)      │
                    │                                 │
                    ▼                                 ▼
                 RESULT  ──────────▶  DATABASE   src/db/store.js
                                      24 append-only tables
```

**The direction of authority is one-way.** A strategy proposes a direction and
levels and cannot express a size. Recovery *requests* a size. The Risk Engine
*decides* it, and the executor uses `approvedLots` and nothing else. Jev can reject
but never approve past the Risk Engine.

## 2. Module map

| Layer | Module | Responsibility |
|---|---|---|
| **core** | `core/enums.js` | every branched-on value, with `assertEnum` at boundaries |
| | `core/money.js` | half-away-from-zero rounding; lot steps always floor **down** |
| | `core/instrument.js` | pip ⇄ price ⇄ lots ⇄ account currency, incl. INVERSE quotes |
| | `core/rng.js` | seeded mulberry32; `Math.random` appears nowhere |
| | `core/hash.js` | canonical, key-order-independent config fingerprints |
| | `core/ids.js` | counter-based ids, so reruns produce identical stores |
| | `core/clock.js` | UTC only; timeframes, FX weekend, session windows |
| | `core/logger.js` | structured records, injected clock, secret redaction |
| | `core/errors.js` | typed errors; refusals carry `refusal: true` |
| **config** | `config/schema.js` | closed key set, range-checked limits, **cannot express LIVE** |
| | `config/index.js` | deep merge → validate → freeze → fingerprint |
| **mode** | `mode/mode-controller.js` | the only path between modes; owner-approval gated |
| | `mode/gates.js` | the machine-readable progression requirements |
| **data** | `data/source.js` | data-source interface (ADR-0001 adoption seam) |
| | `data/feed.js` | incremental feed for paper; deliberately poorer than an array |
| | `data/series.js` | the look-ahead-proof view |
| | `data/resample.js` | multi-timeframe; never returns a bar still forming |
| | `data/synthetic-source.js` | seeded regime-switching generator + ground truth |
| | `data/fixture-source.js` | content-hashed committed fixtures |
| | `indicators/index.js` | 17 causal indicators |
| **decision** | `regime/engine.js` | six regimes, scored, with hysteresis |
| | `strategy/` | interface, registry, portfolio, candidate, 14 families |
| | `jev/gate.js` | score, confidence, decision, reason codes, risk flags |
| | `cost/model.js` | spread, commission, slippage, swap |
| | `risk/engine.js` | **final authority on size and on trading at all** |
| | `recovery/engine.js` | opt-in ×3 ladder that can only *request* |
| | `schedule/asset-schedule.js` | per-asset trading windows |
| **execution** | `execution/adapter.js` | the interface (adoption seam) |
| | `execution/backtest-adapter.js` | fills; gaps fill at the **open** |
| | `execution/paper-adapter.js` | PAPER only; marks both clocks |
| | `execution/live-adapter.js` | **refuses every call** |
| **running** | `account/account.js` | balance, equity, drawdown, streaks, daily buckets |
| | `account/one-trade-controller.js` | the global single-position slot |
| | `backtest/engine.js` | batch bar-replay loop |
| | `backtest/metrics.js` | gross/costs/net, streak family, drawdown |
| | `backtest/walk-forward.js` | in/out-of-sample and rolling folds |
| | `paper/session.js` | incremental loop, proven equal to the engine |
| **research** | `agents/trading-agent.js` | Agent 1 — the pipeline |
| | `agents/analysis-agent.js` | Agent 2 — read-only reporting |
| | `agents/research-agent.js` | Agent 3 — proposes, never applies |
| | `stress/monte-carlo.js` | reorder, bootstrap, block bootstrap, streak arithmetic |
| | `stress/suite.js` | the §15 scenarios and the survival verdict |
| | `champion/registry.js` | promotion gate with bound, multi-segment evidence |
| **ops** | `observability/health.js` | the machine-checkable form of the gates |
| | `db/store.js`, `db/schema.js` | append-only audit trail, 24 tables |

## 3. The five things this architecture is built to prevent

### 3.1 Look-ahead

A strategy never receives the bar array. It receives a **view pinned to bar i**
whose entire API is offsets *backward*: `view.bar(-1)` throws with the word
LOOK-AHEAD. Asking for more history than exists returns `null` — a different case,
because one is always a bug and the other is normal warmup.

Indicators are precomputed over the whole array for speed, which is only sound
because every one is **causal**. That is proven mechanically rather than reviewed:
each indicator is computed over the full series and over seven prefixes, and the
value at the cut must be identical. The same test covers every strategy.

Two traps are handled explicitly rather than avoided:
- **Swing pivots** are published at bar `j + right`, the bar on which they became
  knowable — not at bar `j`, where a backtest would "recognise" tops a live system
  could not.
- **Multi-timeframe** alignment returns the last higher bar that had *closed* by the
  base bar's close, never the one forming around it.

### 3.2 A size nobody approved

`ALLOW | CLAMP | BLOCK`. `CLAMP` is a distinct verdict rather than a silent
adjustment, because "the ladder asked for 0.09 and got 0.01" is the most important
fact about how recovery behaves on a $100 account. Two property tests over
randomised inputs (600 sizing cases, 400 ladder walks ≈ 1,000 rungs) assert the
approved size never exceeds the request, the position cap, the instrument maximum or
the risk budget.

### 3.3 Reaching live execution

Three independent locks, and this build ships only the first two satisfiable:

1. `config/schema.js` **cannot parse** a configuration whose mode is `LIVE`.
2. `mode/mode-controller.js` raises the mode only for an `OWNER` principal with a
   single-use approval record bound to the running config fingerprint *and* commit,
   carrying written evidence per gate. An `AGENT` is refused before any other check.
3. `execution/live-adapter.js` **refuses every call**, and `health.js` verifies that
   by calling it rather than reading a flag.

Downgrades toward `BACKTEST` need no approval from anyone.

### 3.4 An unreproducible or unauditable result

Counter-based ids, seeded RNG everywhere, canonical config fingerprints and an
append-only store whose **digest equality between two runs is the reproducibility
check**. Frozen rows; no update or delete on a table handle; a sealed run cannot
grow a row after its metrics were computed.

### 3.5 A claim the evidence does not support

- Costs are **explicit money deductions**, never hidden in a fill price, so
  gross/costs/net are three columns rather than an inference.
- Every analysis group carries its **sample size** and is marked insufficient below
  a threshold. Drawdown is **not** reported per subset, because the drawdown of
  interleaved trades is not a quantity that existed.
- Every hypothesis states what would **refute** it, before the test runs.
- `compare()` refuses to look at in-sample improvement alone and rejects expectancy
  bought with deeper drawdown or a longer losing streak.
- Promotion requires evidence **bound to the config hash** and spanning **at least
  two data segments** — the mechanical form of "never promote on one profitable
  period".
- Health checks return **`UNKNOWN`, not `OK`**, when they have nothing to evaluate.

## 4. Extension points (ADR-0001)

| To replace | Implement | Notes |
|---|---|---|
| Market data | `data/source.js` (batch) or `data/feed.js` (incremental) | `datasetVersion` is mandatory |
| Execution | `execution/adapter.js` | must not resize an order — that is a second authority |
| Backtest engine | `backtest/engine.js`'s `run()` contract | a NautilusTrader core would slot in here |
| Strategy | `strategy/base.js` | declares indicators, warmup, parameter space |
| Cost model | `cost/model.js` | replace the estimates with a venue's schedule |
| Jev model | `jev/gate.js` (`config.jev.model`) | the verdict shape is the contract |

## 5. Data flow of one decision

```
tick/bar ─▶ ingest ─▶ [1] fill pending entry (if due)   ← one-bar delay, always
                      [2] evaluate exits                 ← gaps fill at the open
                      [3] mark to market (net of costs)  ← drawdown can fire while open
                      [4] onBar: regime + risk monitor   ← BEFORE decisions
                      [5] decide (only if the slot is free)
```

Steps 1–2 before 3–5 is what keeps a closing position from coexisting with a new
one. Step 4 before 5 is what lets the kill switch block the *same* bar. The paper
session mirrors this order exactly, and a test asserts it produces identical trades
to the batch engine — including on multi-asset runs, where the universe ordering
decides which of two simultaneous candidates wins.

## 6. What is deliberately absent

- **No network client anywhere in `src/`**, verified by a scan in both the test
  suite and the health report. No file is exempt from that scan.
- **No secrets**, and the logger redacts secret-shaped field names defensively.
- **No tick or order-book simulation.** Bars are the resolution.
- **No live venue adapter.** See §3.3.
- **No external database or service** (owner approval §7): the store is JSON lines
  plus a manifest, in the repository's own idiom.
- **Zero runtime dependencies.** `npm test` needs no install.
