# Compliance and risk register — Mythos Trading Agent

> **This document makes no claim of regulatory compliance.** Everything below is
> a technical statement about what the code does. Items marked
> **[EXTERNAL REVIEW REQUIRED]** cannot be resolved from this repository by
> anyone, including the owner, without independent professional advice.
>
> **This system has not been shown to be profitable, and nothing in this
> repository should be read as claiming that it is.** It is research and
> backtesting infrastructure. Backtested results are not evidence of future
> returns.

Last updated: 2026-09-30 · Applies to: `projects/mythos-trading-agent/`

---

## 1. Current operating state

| Property | Value | Enforced by |
|---|---|---|
| Execution mode | `BACKTEST` | `config/default.json`, `src/mode/mode-controller.js` |
| Can configuration select `LIVE`? | **No** — the schema rejects it | `src/config/schema.js` |
| Can an agent raise the mode? | **No** — `OWNER` principal only | `src/mode/mode-controller.js` |
| Can an approved `LIVE` mode place an order? | **No** — the adapter refuses | `src/execution/live-adapter.js` |
| Real money at risk | **None.** No venue connectivity, no credentials, no network trading calls exist in this project | absence of any HTTP client in `src/` |
| Market data | Deterministic synthetic + committed fixtures | `src/data/` |

## 2. Items requiring external legal / regulatory review

**[EXTERNAL REVIEW REQUIRED — LEGAL]**

1. **Licensing / authorisation to operate.** Whether running an automated
   trading system for one's own account requires registration, and under which
   regulator, depends on jurisdiction, account structure and whether any third
   party's money is ever involved. Not determinable here.
2. **Retail leverage and product restrictions.** Rolling spot FX and gold CFDs
   are restricted or prohibited for retail clients in several jurisdictions, and
   leverage caps differ by regulator. The platform's contract specifications
   assume a retail CFD account that may not be lawfully available.
3. **Record-keeping and tax reporting.** The store is designed for auditability
   but has not been checked against any statutory retention or reporting format.
4. **Marketing / performance representation.** If any backtested figure this
   platform produces is ever shown to another person, presentation rules
   (hypothetical-performance disclaimers and similar) may apply.
5. **Venue terms of service.** Automated order placement is contractually
   restricted by some brokers. Any future live adapter must be checked against
   the specific venue's agreement.

**[EXTERNAL REVIEW REQUIRED — COMMERCIAL]**

6. **Cost figures.** Every spread, commission, swap and slippage number in
   `config/instruments.json` is a *documented estimate* typical of a retail
   account, not a quote from a named venue. They are the single largest source of
   optimism in any result this platform produces and must be replaced with a real
   venue's published schedule before paper results mean anything. Tracked as the
   `VENUE_COSTS_VERIFIED` gate.
7. **Open-source licences.** No third-party runtime code is vendored (ADR-0001),
   so there is no inbound licence obligation today. Adopting NautilusTrader
   (LGPL-3.0) or Freqtrade (GPL-3.0) later would create one.

## 3. Technical risks that are known and accepted

### 3.1 The $100 account cannot express most risk budgets

At $100 with a 2 % per-trade cap ($2), and a 0.01-lot minimum:

| Instrument | Risk of 0.01 lots per pip | Largest stop that fits $2 |
|---|---|---|
| EURUSD, GBPUSD, AUDUSD | $0.10 | 20 pips |
| USDJPY @ 150 | ≈ $0.067 | ≈ 30 pips |
| XAUUSD | $0.01 per $0.01 move | $2.00 of price |

**Consequence:** any signal with a wider stop is untradable, and the platform
returns `NO_TRADE` with reason `SIZE_BELOW_MINIMUM`. This is correct behaviour
and it is also a severe selection effect — the account can only ever take
tight-stop trades, which are the ones most exposed to spread and slippage. The
rate of `SIZE_BELOW_MINIMUM` must be reported alongside every backtest.

### 3.2 Recovery ×3 is nearly always clamped at this account size

Enabled recovery requests 0.01 → 0.03 → 0.09. On a $100 account the Risk Engine
clamps levels 2 and 3 back to (or near) the minimum lot. Research on recovery
must therefore report the clamping rate; a conclusion drawn from the *requested*
ladder describes a system that never ran. See ADR-0002.

### 3.3 Bar resolution hides intrabar reality

The engine replays OHLCV bars. When one bar's range contains both the stop and
the target, their order is unknowable from OHLC alone. The default
`backtest.allowIntrabarStopAndTarget = "STOP_FIRST"` takes the pessimistic
branch. Even so:

- gaps and spikes inside a bar are invisible;
- stop fills assume the stop price is reachable at the stop price plus modelled
  slippage — a gap through the stop is modelled only at bar open;
- no order-book or partial-fill modelling exists.

### 3.4 Synthetic data is not the market

This build has no market-data access. Strategy behaviour is exercised against
seeded synthetic series and small committed fixtures. **Synthetic data can
validate mechanics; it cannot validate edge.** Any statement about profitability
derived from synthetic data is meaningless and must not be made.

### 3.5 Session and DST handling is an approximation

All time handling is UTC. Session windows are declared in UTC hours, so the
London/New York session boundaries drift by one hour across daylight-saving
transitions. Accepted for research; must be revisited before paper trading on
session-sensitive strategies.

### 3.6 Weekend and holiday handling

The forex weekend is modelled as Friday 21:00 UTC → Sunday 21:00 UTC. Public
holidays, early closes and illiquid rollover periods are **not** modelled.

### 3.7 Overfitting

The platform makes it cheap to search many strategies × parameters × Jev
thresholds × regimes. That is exactly the machinery that manufactures false
positives. Mitigations built in: out-of-sample and walk-forward segmentation,
Monte Carlo and perturbation stress, and a champion/challenger gate that refuses
promotion on a single profitable period. None of these eliminate the risk.

### 3.8 Single-process, single-machine

No high availability, no failover, no reconnection logic — appropriate for
backtest and paper research, and insufficient for live execution.

## 4. Security posture

- No credentials, API keys or secrets exist in this project, and none may be
  added. The logger redacts secret-shaped field names defensively
  (`src/core/logger.js`).
- No network client of any kind is present in `src/`.
- The store writes only to a directory a caller passes explicitly; constructing
  a store touches no filesystem path.
- No production Mythos service is read or modified by this project.

## 5. What would have to be true before paper trading

Tracked as machine-checkable gates in `src/mode/gates.js`; see
`docs/VALIDATION_GATES.md` for the evidence each one requires.

## 6. What would have to be true before live trading

All of §5, plus the unsatisfiable-in-this-build gates
(`LIVE_ADAPTER_IMPLEMENTED`, `EXTERNAL_LEGAL_REVIEW`, `VENUE_COSTS_VERIFIED`),
an explicit owner acknowledgement of capital at risk, and a decision the owner
makes — never the agent.
