# STATUS — Mythos Trading Agent

Format per mission §24. Updated at the end of every phase.

---

**CURRENT PHASE:** PHASE 12 — stress testing (complete)

**CURRENT TASK:** PHASE 13 — Champion / Challenger

**LAST VERIFIED COMMIT:** `5659377a` (PHASE 11, verified on `origin/mythos/trading-platform`)

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

### PHASE 4 — strategy engine
| Area | Delivered | File(s) |
|---|---|---|
| Strategy interface | declares indicators, warmup, parameter search space and preferred regimes; **cannot express a position size**; a signal with inverted levels is refused where it was produced | `src/strategy/base.js` |
| Shared helpers | `need()` (null-safe indicator reads), ATR and structural stops, crossings | `src/strategy/helpers.js` |
| Registry | one strategy per mission §4 family, enforced | `src/strategy/registry.js` |
| Portfolio | indicator deduplication, per-run state bags, regime affects ORDER not whether a strategy is asked, optional signal cooldown | `src/strategy/portfolio.js` |
| Candidate | every mission §4 field; costs in **pips** (size-independent); `breakevenWinRate` as the honest headline and `winProbabilitySource` recorded | `src/strategy/candidate.js` |
| 14 families | trend-following, mtf-trend, pullback, breakout, breakout-retest, volatility-expansion, market-structure, support-resistance, liquidity-sweep, momentum, price-action, mean-reversion, range-trading, session-opening-range | `src/strategy/families/` |

**Signal counts over 3000 EURUSD M15 fixture bars** (every strategy fires; a
silent strategy is dead code, and a test fails if one appears):
trend-following 22 · mtf-trend 660 · pullback 30 · breakout 181 ·
breakout-retest 59 · volatility-expansion 248 · market-structure 304 ·
support-resistance 180 · liquidity-sweep 179 · momentum 594 · price-action 404 ·
mean-reversion 8 · range-trading 906 · session-opening-range 30.

**Observation for the Research Agent:** the state-based strategies (range-trading,
mtf-trend) fire on every bar their condition holds, so 906 signals represent
roughly thirty episodes rather than 906 opportunities. `strategy.signalCooldownBars`
exists for that, defaults to **0 (off)** because suppression loses evidence, and
counts every signal it removes.

### PHASE 5 — market regime engine
Scores all six regimes from normalised features and takes the highest, with
hysteresis (a regime persists until a dwell elapses AND a challenger clears it by
a margin) because the regime is recorded on every candidate and a label that
flips per bar would make per-regime statistics measure noise.

**Measured against the generator's published ground truth** (17,328 classified
bars, three seeds): overall accuracy **40.7 %** vs a 16.7 % chance baseline.
Recall — RANGE 55 %, LOW_VOLATILITY 54 %, HIGH_VOLATILITY 34 %, TREND 28 %,
BREAKOUT 19 %, **UNSTABLE 7 %**. The weak classes are asserted at their honest
values in `tests/regime-test.js`; a test demanding a number the system does not
achieve would simply be deleted by whoever hit it next.

**Three findings this measurement produced, all recorded rather than papered over:**
1. **The generator's `UNSTABLE` was a bug.** It multiplied its drift by zero, so
   it was literally `HIGH_VOLATILITY` with a smaller multiplier — the two classes
   were indistinguishable because they were the same process. Fixed to reverse
   its drift every 6 bars. `HIGH_VOLATILITY` was also raised to 2.6× so it is
   genuinely the loudest regime, which at 2.2× it measurably was not.
2. **`flipRate` discriminates nothing** (0.49–0.54 for every regime). It is still
   computed and recorded as evidence, and carries zero weight in the score — a
   test asserts that changing it changes no score. Shipping it as an input would
   have been a confident-looking zero.
3. **The volatility labels are relative, not absolute.** A percentile has no
   notion of absolute calm: over a series with no regime change, a uniformly
   violent stretch reads `LOW_VOLATILITY` about a quarter of the time. An
   expansion gate was considered and rejected with the reason recorded. Written
   up in COMPLIANCE §3.7 and asserted directly in the tests.

A whipsaw discount on `RANGE` was tried and **removed**: it lifted UNSTABLE
recall 7 % → 11 % and cost RANGE 55 % → 44 %, dropping overall accuracy to
37.4 %. The number is kept in the source so the next person to have the idea sees
it instead of re-running it.

### PHASE 6 — Jev decision gate
A gate inside the Trading Agent, not a second agent (mission §6). It returns
`{score, confidence, decision, reasonCodes, riskFlags}` and has no authority: the
verdict object carries no size, no execution instruction, and nothing that could
overrule anything downstream — a test asserts those fields are absent.

- **Auditable by construction.** All six scoring components come back with their
  value, weight and raw input, and a test recomputes the score from them — so
  "why did Jev reject it?" is answerable from the stored record.
- **Score and confidence are separate gates.** The score says how good the setup
  looks; the confidence says how much the inputs are worth. A high score resting
  on an uncertain regime and a strategy with no track record fails the confidence
  gate. Collapsing them would let a confident-sounding number rest on nothing.
- **Hard flags cannot be outscored.** Negative net reward, spread above the
  configured multiple, a stop outside bounds, or reward/risk below the minimum
  force REJECT even at a threshold of zero.
- **The threshold is configuration.** The band (70-79 / 80-89 / 90-94 / 95-100)
  is recorded on rejected candidates too, because that is where the
  counterfactual mission §6 wants studied actually lives.
- **Absent history never flatters.** An unknown strategy gets a neutral 0.5, a
  `NO_STRATEGY_HISTORY` flag and reduced confidence; a sample below `minSample`
  is discarded rather than used with a caveat nobody reads; and a losing record
  subtracts exactly as much as a winning one adds.
- Some checks are duplicated with the Risk Engine deliberately. Jev's copy
  explains a rejection in research terms; the Risk Engine's copy is
  authoritative, and if they disagree the Risk Engine wins (ADR-0002).

### PHASE 7 — Risk Engine · PHASE 8 — Recovery ×3 engine
Delivered together because recovery is only meaningful against the clamp that
bounds it.

**Risk Engine** (`src/risk/engine.js`) is the last writer of position size.
Three verdicts — `ALLOW`, `CLAMP`, `BLOCK` — with `CLAMP` a distinct verdict
rather than a silent adjustment, because "the ladder asked for 0.09 and got 0.01"
is the most important fact about how recovery behaves at this account size.
Checks are split between `preTradeGate()` (emergency stop, max drawdown, daily
loss, losing streak — reasons the account may not trade at all) and `assess()`
(spread, stop bounds, reward/risk, expectancy, recovery level, and sizing),
because "the account is hurt" and "this trade is wrong" are different findings.
The risk budget is the **smallest** of the per-trade cap, the remaining daily-loss
headroom and the remaining drawdown headroom. Every check records its observed
value, its limit and whether it bound. The emergency stop is sticky and there is
no API to clear it.

**Recovery ×3** (`src/recovery/engine.js`) returns `requestedLots` and nothing
else — there is no function in it that yields a size a caller could act on, and a
test asserts `approvedLots`/`setLots`/`forceSize`/`override` are all absent. Off
by default. Three independent caps: `enabled`, `maxRecoveryLevel` (reaching it
**abandons** the ladder and realises the accumulated loss rather than escalating),
and the Risk Engine clamp, which cannot be misconfigured because it derives from
equity rather than from the ladder. State is per asset. The required take-profit
to recover the accumulated loss is computed at the **approved** size, so the
clamp makes recovery harder rather than easier — and when the target cannot reach
it, the answer is NO TRADE rather than a bigger position.

**The owner's constraint is proven, not described.** Two property tests over
randomised equity, stop distance, instrument, caps and requested size:
- 600 sizing cases — the approved size never exceeds the request, the position
  cap, the instrument maximum, or the risk budget, and is always a tradable size;
- 400 ladder walks (>1,000 rungs) through the real Risk Engine — the same holds at
  every rung, with both the clamp and the block paths exercised.

Asserted concretely for the owner's account: at $100 with a 2 % cap and a 20-pip
stop, the ladder requests 0.01 / 0.03 / 0.09 and is approved 0.01 / 0.01 / 0.01
with verdicts ALLOW / CLAMP / CLAMP.

### PHASE 9 — Trading Agent (Agent 1)
The whole mission §3 pipeline wired end to end into the single `decide()` the
engine calls, plus the per-asset trading schedule. The agent owns the ORDER of the
stages and the recording of every verdict; it owns none of the judgements.

`wire()` returns all five engine hooks, because each omitted hook degrades the
system **silently**: no `onRunStart` means no audit trail, no `onSeriesReady` means
no indicators, no `onBar` means no kill switch while a position is open, no
`onTradeClosed` means recovery never learns. None of them produces an error.

**Two real defects were found by running the pipeline, not by reading it:**

1. **The agent was writing to a store the engine never published.** The agent held
   a store passed at construction while the engine created its own. Runs produced
   trades normally and every candidate, Jev verdict and risk assessment went into a
   store nobody read — a complete, silent loss of the audit trail. Fixed with the
   `onRunStart` lifecycle hook, which binds the agent (and the risk and recovery
   engines) to the run's own store.
2. **`MAX_CONSECUTIVE_LOSSES` deadlocked the system.** As a permanent block,
   hitting the limit stopped all trading, so no win could occur, so the streak
   never reset: 2,573 of 2,692 risk blocks in one run were this one condition,
   frozen for the rest of the run. It is now a circuit breaker with a cooling-off
   period (`risk.consecutiveLossCooldownHours`, default 12) that clears the current
   streak but not the historical maximum. COMPLIANCE §3.9.

**Measured funnel** (3,000 EURUSD M15 fixture bars, default config, Jev 45, after
the Phase 10 regime-timing fix below):

| Capital | Bars classified | Decisions requested | Candidates | Cost-rej | Jev-rej | Trades | Net P&L | Max DD |
|---|---|---|---|---|---|---|---|---|
| $100 | 2,800 | 375 | 494 | 54 | 48 | 45 | −$18.19 | 20.1 % → stopped |
| $5,000 | 2,800 | 677 | 723 | 97 | 117 | 188 | −$56.49 | 1.35 % |
| $100,000 | 2,800 | 677 | 723 | 97 | 117 | 188 | −$56.49 | 0.07 % |

Two things worth reading off that table. **Decisions are requested on only 13–24 %
of bars** — a single-position account spends most of its time unable to act, and
conflating "bars seen" with "chances taken" would overstate the system's reach
(the two are separate counters for that reason). And the $5,000 and $100,000 runs
are **identical**, because `maxPositionSizeLots` binds before the risk budget does
at either size.

On the $100 account most risk assessments are blocked for size
(`SIZE_BELOW_MINIMUM`) — the constraint in COMPLIANCE §3.1, now measured rather
than predicted.

**Both runs lost money, and that is the expected result of this build.** The
strategies are deliberately untuned, the data is synthetic and contains no real
edge, and every cost is charged. What the runs demonstrate is that the mechanics
work. COMPLIANCE §3.10 records the figures; no profitability claim is made.

### PHASE 10 — Analysis Agent (Agent 2)
Read-only by construction: it takes a store and returns a report, holds no config
it could mutate and no handle on the Risk Engine or the Jev gate, and a test
asserts no setter of any kind exists (mission §12 forbids it from changing
production rules). Analysing a store leaves its digest unchanged.

Sections: decision funnel (by stage, with top reason codes), per strategy /
symbol / direction / exit reason, regime distribution and the strategy×regime
cross-tab, Jev score distribution and per-band performance, cost decomposition,
losing-streak distribution with the worst run's composition, drawdown episodes,
risk verdicts with the limits that actually bound, and recovery behaviour.

**The discipline that makes it useful rather than decorative:**
- every group carries its sample size and is marked `sufficient: false` below the
  threshold — a four-trade win rate is a number, not evidence;
- **drawdown is not reported per subset.** The "drawdown of the 90-94 Jev band" is
  not a quantity: those trades were interleaved with others, and extracting them
  invents an equity curve that never existed. Streaks *are* reported per group,
  because they preserve order within the subset;
- `interpretJevBands()` reports the *direction* of the relationship mission §6 asks
  about and refuses to conclude below two sufficient bands — it never recommends a
  threshold, which is the Research Agent's proposal and the owner's decision;
- the caveats are computed from the report, so a small or losing run reads
  differently from a large or winning one;
- the Jev section reports which components actually *discriminate* — a component
  with no spread across a run contributed a constant and decided nothing, which is
  worth knowing before tuning its weight.

**A third real defect surfaced here.** The regime was being classified inside
`decide()`, which the engine only calls while the trade slot is free. So the regime
was computed on a subset of bars that depended on trading activity: its hysteresis
dwell counted wrongly, and the label became a function of whether a position
happened to be open — a coupling between position state and market reading that
would quietly corrupt every per-regime statistic. Classification moved to the
per-bar hook, which the engine now also runs **before** decisions rather than
after, so the Risk Engine's kill switch blocks the same bar instead of the next
one. Regime rows went from ~1,300 (activity-dependent) to 2,800 (every bar).

### PHASE 11 — Research Agent (Agent 3) + walk-forward segmentation

**Walk-forward** (`src/backtest/walk-forward.js`) enforces the rules that make an
out-of-sample claim mean anything: out-of-sample comes strictly **after**
in-sample in time (a random split of a time series leaks the future through
continuity), folds advance by the out-of-sample length so their fresh windows never
overlap — `assertNoOverlap()` refuses otherwise, because overlap counts the same
bars as evidence twice — and each segment warms its indicators up *inside* itself
rather than borrowing history the previous segment was tuned on. The aggregate's
headline is **degradation** (out-of-sample expectancy ÷ in-sample), which is null
rather than misleading when in-sample was not profitable, and the worst streak
across folds is reported rather than the average, because averaging hides the fold
that would have ended the account.

**The Research Agent proposes and can do nothing else.** `propose()` returns an
inert plain object; the agent never loads, writes or applies a configuration, and a
test asserts no apply/write/promote/setConfig method exists (mission §12: "Never
modify LIVE rules directly").

Every hypothesis carries four things and is **refused** without them: the
measured observation with its sample size, the claim in one sentence, a config
override so the claim is testable mechanically, and — the part that matters — the
result that would **refute** it, stated before the test runs. A claim whose author
has not said what would change their mind reads as confirmed whatever happens.

`compare()` is deliberately hard to pass:
- it **refuses to run** without out-of-sample results on both sides;
- it names `IMPROVES_IN_SAMPLE_ONLY` as the signature of a fitted change;
- it rejects expectancy bought with deeper drawdown **or a longer losing streak** —
  mission §10 makes streak behaviour a primary objective, not a tiebreak;
- it requires a walk-forward result (mission §13: never promote on one profitable
  period) and a passed stress suite;
- it distinguishes **REJECT** (refuted — do not retry) from **INCONCLUSIVE**
  (untested — do retry), because the two call for opposite next actions;
- approval is `APPROVE_AS_CHALLENGER` and the note says so: not the champion, not
  in PAPER, not live.

The regime hypothesis deliberately proposes a *filter* rather than a regime ban,
because banning a regime would destroy the evidence needed to revisit the question,
and its falsification criterion names the classification error it inherits.

### PHASE 12 — stress testing
Two families, and the difference decides what a result is worth. **Trade-level**
(Monte Carlo reorder, bootstrap, block bootstrap, streak arithmetic) reuses the
trades a run produced — cheap, and limited to "what if these trades had arrived
differently". **Re-run** scenarios (spread ×3, slippage ×3, +3 bars of execution
delay, adverse parameter perturbation, 5 % data gaps, forced adverse regime,
pessimistic intrabar policy) replay the whole pipeline with something made worse —
the only kind that can say whether the *strategy* survives, because the strategy
reacts, the Risk Engine intervenes and the recovery ladder responds to the new
sequence.

**Every re-run scenario is strictly adverse, never favourable.** Parameters are
perturbed in one direction only; a two-sided perturbation would let a
configuration pass on its favourable half. A test asserts each override moves the
wrong way for the system.

**What the Monte Carlo module refuses to do, and says why:**
- **It refuses to reorder trades taken above base recovery level.** Their sizes
  depended on the order they arrived in, so reordering them would produce
  percentiles for a system that never existed. The refusal names the re-run
  scenarios as the alternative.
- Every result carries its caveats. Reordering **understates** streaks, because it
  breaks the regime clustering that produces real losing runs; the plain bootstrap
  destroys clustering entirely and is the most optimistic of the three; the
  **block bootstrap preserves it** and is the one whose streak and drawdown
  percentiles should be believed. A test asserts the block method finds longer tail
  streaks than the plain one on clustered data.
- Reordered paths assume the Risk Engine never intervened, so they bound how deep
  the hole could get while being optimistic about the outcome. Stated in the result.

`streakStress()` answers the question a $100 account most needs and no percentile
makes obvious: **how many consecutive losses can this account absorb** before the
drawdown limit breaks, at the observed average loss and at the worst.

`survived` is a **conjunction** — one blown scenario fails the suite, because in
live trading the scenarios are not alternatives. And a suite that skipped scenarios
reports a `coverageWarning`, so `survived: true` cannot be read as coverage it does
not have.

## IN PROGRESS

PHASE 13 — Champion / Challenger: the promotion gate that refuses on a single
profitable period.

## BLOCKED

Nothing blocked. Two constraints are permanent for this build and are recorded
rather than treated as blockers:

- **No market data and no network.** Strategy behaviour is exercised on seeded
  synthetic series and fixtures. This validates mechanics, never edge.
- **No Python.** The §2 frameworks cannot run here; see ADR-0001.

## NEXT TASK

PHASE 13 — Champion / Challenger, then PHASE 14 — paper trading.

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
| `tests/strategy-test.js` | 43 | pass |
| `tests/regime-test.js` | 19 | pass |
| `tests/jev-test.js` | 33 | pass |
| `tests/risk-recovery-test.js` | 42 | pass |
| `tests/trading-agent-test.js` | 29 | pass |
| `tests/analysis-agent-test.js` | 28 | pass |
| `tests/research-agent-test.js` | 39 | pass |
| `tests/stress-test.js` | 29 | pass |
| **Total (`npm test`)** | **497** | **497 pass, 0 fail** |

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
5. **Regime labels carry ~59 % classification error** against known ground truth,
   and `UNSTABLE` is barely detected at all. Any per-regime performance
   conclusion inherits that error and must state it (COMPLIANCE §3.7).

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
