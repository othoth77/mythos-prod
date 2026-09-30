# STATUS — Mythos Trading Agent

Format per mission §24. Updated at the end of every phase.

---

**CURRENT PHASE:** PHASE 3 — backtesting foundation (complete)

**CURRENT TASK:** PHASE 4 — strategy engine

**LAST VERIFIED COMMIT:** `439cea27` (PHASE 2, verified on `origin/mythos/trading-platform`)

---

## COMPLETED

### PHASE 0 — repository and environment audit
Done by the predecessor task `t-20260930120308-fjw22c`; its open questions were
answered by the owner-approval block in this task's envelope. Not repeated.

### PHASE 1 — architecture and interfaces
| Area | Delivered | File(s) |
|---|---|---|
| Decision record: execution engine | Node.js modular engine; the six §2 frameworks evaluated and rejected for this environment, with adoption seams named | `docs/adr/0001-execution-engine-selection.md` |
| Decision record: safety architecture | Risk Engine as last writer of size; recovery capped twice; three independent locks on LIVE | `docs/adr/0002-safety-architecture.md` |
| Enumerations | Mode/Regime/Direction/RiskVerdict/… with `assertEnum` at every boundary | `src/core/enums.js` |
| Money and size arithmetic | half-away-from-zero rounding, lot-step floor (always down) | `src/core/money.js` |
| Seeded RNG | mulberry32 + fork-by-tag; `Math.random` appears nowhere | `src/core/rng.js` |
| Canonical hashing | key-order-independent config fingerprints | `src/core/hash.js` |
| Deterministic ids | counter-based, so reruns produce identical stores | `src/core/ids.js` |
| Time | UTC-only; timeframe flooring, FX weekend, session windows | `src/core/clock.js` |
| Structured logging | injected clock, memory sink by default, secret redaction | `src/core/logger.js` |
| Instrument model | pip/lot/account-currency conversion incl. INVERSE quotes | `src/core/instrument.js`, `config/instruments.json` |
| Configuration | closed-key schema, range-checked limits, deep freeze, fingerprint | `src/config/`, `config/default.json` |
| Mode controller | owner-approval-gated upgrades, free downgrades, single-use records | `src/mode/mode-controller.js`, `src/mode/gates.js` |
| Persistence | append-only JSONL store, 24 tables, digest, sealing | `src/db/schema.js`, `src/db/store.js` |
| Compliance register | external-review items, known technical risks | `docs/COMPLIANCE_AND_RISK.md` |

### PHASE 2 — data layer
| Area | Delivered | File(s) |
|---|---|---|
| Bar model | strict validation: ordering, duplicates, grid alignment, gap reporting | `src/data/bar.js` |
| Look-ahead-proof view | strategies get a view pinned to bar *i*, backward offsets only; a negative offset throws `LOOK-AHEAD`, missing history returns `null` | `src/data/series.js` |
| Indicator library | 17 indicators, all causal; SMA/EMA/stdev/ROC/linreg/Bollinger/TR/ATR/RSI/ADX/Donchian/swings/vol-ratio/efficiency-ratio | `src/indicators/index.js` |
| Multi-timeframe | `resample()` drops a forming bucket; `alignCompleted()` never returns the higher bar that contains the current one | `src/data/resample.js` |
| Data-source interface | ADR-0001 adoption seam; `datasetVersion` mandatory; `guarded()` validates and caches | `src/data/source.js` |
| Synthetic generator | regime-switching GBM, seeded, calendar-aware, publishes its own regime ground truth | `src/data/synthetic-source.js` |
| Committed fixtures | 4 symbols × 3000 M15 bars, content-hashed so a hand edit is detected | `src/data/fixture-source.js`, `fixtures/`, `bin/make-fixtures.js` |

**The test that matters most in this phase** is the generic causality check: every
indicator is computed over the full series and over seven prefixes, and the value
at the cut must be identical. It walks a registry, so an indicator added later is
covered automatically, and a second test fails if the registry stops covering the
module's exports.

### PHASE 3 — backtesting foundation
| Area | Delivered | File(s) |
|---|---|---|
| Cost model | spread (session + volatility widening, bounded by the instrument's stated max), slippage (never favourable; stops slip 1.6×), commission both sides, swap as a signed cost, rollover counting | `src/cost/model.js` |
| Account | drawdown on mark-to-market equity, daily loss buckets, streak tracking where a breakeven breaks no streak | `src/account/account.js` |
| One-trade-only | three-state slot (FREE → RESERVED → OCCUPIED); a pending entry occupies it; every illegal transition throws; invariant verifiable | `src/account/one-trade-controller.js` |
| Execution adapters | interface as an ADR-0001 seam; backtest adapter with gap fills and the intrabar policy; **LIVE adapter refuses every call** | `src/execution/` |
| Backtest engine | one-bar execution delay, exits before entries, per-bar mark-to-market, emergency stop that cancels a pending entry, full audit trail | `src/backtest/engine.js` |
| Metrics | gross/costs/net never conflated; streak family as first-class output; P(k consecutive losses) measured, not inferred from win-rate^k | `src/backtest/metrics.js` |

**Decisions recorded in code:** costs are explicit money deductions rather than
hidden in fill prices, so "did costs eat the edge?" is a column sum (the
trigger-timing approximation this buys is documented in the cost model's header
and in COMPLIANCE §3.3). A bar that gaps through a stop fills at the **open**,
not the stop. A bar containing both stop and target is ambiguous from OHLC
alone; the default is `STOP_FIRST` and a test proves `TARGET_FIRST` is the
flattering branch, so the size of that ambiguity can be measured.

## IN PROGRESS

PHASE 4 — strategy engine: the strategy interface, the registry, and the
fourteen strategy families named in mission §4.

## BLOCKED

Nothing blocked. Two constraints are permanent for this build and are recorded
rather than treated as blockers:

- **No market data and no network.** Strategy behaviour is exercised on seeded
  synthetic series and fixtures. This validates mechanics, never edge.
- **No Python.** The §2 frameworks cannot run here; see ADR-0001.

## NEXT TASK

PHASE 4 — strategy engine, then PHASE 5 — regime engine.

## TEST STATUS

| Suite | Tests | Result |
|---|---|---|
| `tests/core-primitives-test.js` | 34 | pass |
| `tests/config-test.js` | 16 | pass |
| `tests/mode-controller-test.js` | 26 | pass |
| `tests/store-test.js` | 17 | pass |
| `tests/indicators-test.js` | 21 | pass |
| `tests/data-layer-test.js` | 38 | pass |
| `tests/execution-and-costs-test.js` | 52 | pass |
| `tests/backtest-engine-test.js` | 31 | pass |
| **Total (`npm test`)** | **235** | **235 pass, 0 fail** |

Run: `cd projects/mythos-trading-agent && npm test`

## KNOWN RISKS

1. **Cost estimates are not a venue's numbers.** The largest source of optimism
   in any future result. Gate: `VENUE_COSTS_VERIFIED`.
2. **A $100 account cannot express most risk budgets** — stops beyond ~20 pips
   on EURUSD make the minimum lot exceed the per-trade cap, so `NO_TRADE` is the
   common correct answer. The rate of that must be reported with every backtest.
3. **Synthetic data cannot demonstrate edge.** No profitability claim is
   possible from this build.
4. **Overfitting risk grows with the search space** the later phases add.

## DECISIONS

- ADR-0001 — Node.js engine, no framework vendored, adoption seams named.
- ADR-0002 — Risk Engine has final authority; recovery ×3 opt-in and capped
  twice; three independent locks on LIVE.
- Storage is a file-backed append-only JSONL store in the repository's existing
  idiom — no new database or service (owner approval §7).
- Zero runtime npm dependencies.

## GIT

- Branch: `mythos/trading-platform` (worktree
  `/home/deploy/mythos-ai-executor/worktrees/trading-platform`)
- Base: `origin/main` @ `6425ac4c`
- The `LAST VERIFIED COMMIT` line at the top of this file is updated to the
  pushed SHA once each phase is on the remote.
