# Mythos Trading Control Center — final record

| | |
|---|---|
| Project | `projects/mythos-trading-control-center/` |
| Branch | `mythos/trading-control-center` (based on `mythos/trading-platform@82b1ce0c`) |
| Target | `https://trading.mythosprod.xyz` |
| Modes | **BACKTEST** and **PAPER**. LIVE does not exist in this build. |
| Date | 2026-10-01 |

This document is the complete record: what was built, how it is secured, how
it was tested, how it is deployed, and what it does not do. Section 13 states
what is **not** done. Nothing in it should be read as a claim about trading
performance: every figure the platform shows comes from synthetic or fixture
data and validates mechanics only.

---

## 1. What it is

A control and observation surface over the existing Mythos Trading Agent
(`projects/mythos-trading-agent/`, 40K+ lines, 572 tests). The agent was **not
rebuilt and not modified**: it is byte-identical to `82b1ce0c`, which a test
checks by hash and by `git diff` on every run.

The Control Center lets an operator configure the agent inside declared
ranges, run backtests, run paper sessions on a replay feed, read every trade
and every decision with its full chain, read the Analysis and Research
agents' reports, run experiments, manage the champion/challenger record, run
the test suites, and read the activity timeline, the audit chain and the
system state.

It cannot place an order. It has no venue connection, no broker client, no
credential for one, and opens no outbound network connection.

## 2. Architecture

```
browser ── HTTPS ──> nginx (trading.mythosprod.xyz) ── loopback ──> server/server.js :8210
                                                                         │
     web/ (vanilla JS, no framework, no build step needed)               ├── auth.js      users, scrypt, sessions, CSRF
                                                                         ├── audit.js     append-only hash chain
                                                                         ├── api.js       the one route table
                                                                         ├── platform.js  composition + read models
                                                                         │     ├── control.js   config, strategies, trading switch, mode
                                                                         │     ├── runs.js ──fork──> jobs/run-job.js   (backtests, experiments)
                                                                         │     ├── paper.js     paper / demo control room, SSE
                                                                         │     ├── research.js  journalled champion/challenger registry
                                                                         │     ├── testing.js ──spawn──> node --test   (one file at a time)
                                                                         │     └── views.js     read models over a run's store
                                                                         └── agent.js     THE ONLY file that requires the Trading Agent
                                                                                │
                                                              projects/mythos-trading-agent/src/  (unmodified)
```

Decisions that shape everything else:

- **A sibling project, not a patch.** The agent's own `NO_NETWORK_CLIENT`
  health check scans its `src/`; an HTTP server placed there would break the
  agent's safety check. The Control Center lives beside the agent and reaches
  it through one boundary file.
- **Zero runtime dependencies.** Node ≥ 22, the standard library, nothing to
  install, nothing to audit in `node_modules`.
- **The Risk Engine stays the last writer of size.** No route, form or field
  carries a position size. `risk.maxPositionSizeLots` is a limit handed to the
  Risk Engine, not a size.
- **The mode is raised by the agent's own controller only.** The Control
  Center submits the owner's approval record; the agent verifies it. A
  configuration change produces a new fingerprint and therefore a new
  controller in BACKTEST. A restart is always BACKTEST.
- **NO DATA is a value.** A view with no source returns
  `{available:false, reason}` and the interface shows *NO DATA* with the
  reason — never a zero, never an empty table that reads as "nothing happened".
- **Every result names its source and its label** — SYNTHETIC, HISTORICAL or
  PAPER. HISTORICAL is listed as unavailable: this build has no market-data
  access.

## 3. Phases

| # | Phase | Commit | What it delivered |
|---|---|---|---|
| 1 | REST API + security | `41b477eb` | server, auth, audit chain, route table, control, runs, paper, research, testing, views |
| 2 | Frontend foundation | `ef1376ea` | shell, router, components on the approved Mythos design tokens, login, build |
| 3 | Dashboard | `19bce18b` | status, account, performance, regime, Jev, risk, recovery, health — NO DATA when there is none |
| 4 | Control Center | `7b70480d` + `16aabca4` | configuration with preview/diff/loosening confirmation, strategies, trading switch, PAPER approval |
| 5 | Paper / Demo | `6d00a222` | start / pause / resume / stop / reset / speed, live event stream, two-arm DEMO |
| 6 | Backtest Center | `3d5c77b4` | every input the mission names, runs as isolated jobs, reproducibility check |
| 7 | Trade + Candidate explorers | `c2221813` | filtered, paged, requested vs approved size on every trade |
| 8 | Decision Explorer | `e91469be` | the eleven-stage chain Market → … → Analysis, stopping where the pipeline stopped |
| 9 | Strategies, Jev, Risk, Recovery | `0e312a4c` | per-strategy statistics with sample sizes, bands, limits, clamps, blocks, ladder |
| 10 | Analysis | `1c436c9d` | the Analysis Agent's report; INSUFFICIENT DATA beside thin groups; caveats first |
| 11 | Research + Champion/Challenger | `35fa95c9` | observation → hypothesis → proposal → experiment → challenger → champion record |
| 12 | Testing Center | `b09c7fd5` | eleven categories, run all / category / one test, failures never hidden |
| 13 | Activity + Audit + System | `aaf54886` | two-clock timeline, audit chain view and verification, components, health, deployment |
| 14 | Integration + security + LIVE audit | `9150942f` | whole-surface integration and the critical LIVE audit |
| 15 | Production deployment | `9c1ce48f` | unit, vhost, release script, smoke test, runbook — see §11 and §13 for what was executed |

Each phase was tested, committed and pushed before the next began.

## 4. Routes

Sixteen application routes, each a built page:

`/dashboard` · `/control` · `/paper` · `/backtest` · `/trades` · `/candidates` ·
`/decisions` · `/strategies` · `/jev` · `/risk` · `/recovery` · `/analysis` ·
`/research` · `/testing` · `/activity` · `/system`

plus `/login`. `/` redirects to `/dashboard`; every application route without
a session redirects to `/login`.

## 5. API

The full reference is `projects/mythos-trading-control-center/docs/API.md`.
One route table (`server/api.js`) declares, for every route, its role, its
rate-limit bucket, its body shape and its audit action.

- **Reads** (VIEWER): status, dashboard, config (+history, +mode requirements),
  strategies, candidates, decisions (+chain), trades (+detail), jev, risk,
  recovery, paper (+events, +SSE stream), backtest (+options, +run), analysis,
  research, testing (+run), activity, audit (+verify), system, jobs.
- **Mutations**: configuration (OWNER; `confirm: "CONFIRM"` when a protection
  is loosened), preview (OPERATOR, changes nothing), strategies (OWNER),
  trading switch (disable: OPERATOR; enable: OWNER + `confirm: "ENABLE"`),
  mode (BACKTEST: OPERATOR; PAPER: OWNER + approval record), paper controls
  (OPERATOR; reset needs `confirm: "RESET"`), backtest and experiment
  (OPERATOR), challengers and evidence (OPERATOR), promote / seed / rollback
  (OWNER, typed confirmation), test runs (OPERATOR).
- **The mutation pipeline**, in this order, for every mutation: authenticate →
  CSRF and origin → rate limit → authorize → validate → execute → audit →
  `{ok, result, audit:{seq, hash, ts}}`. A refusal is audited too.
- **What does not exist**: any route that places, sizes, modifies or cancels an
  order; any route or value that selects LIVE; any field that carries a size.

## 6. Components (frontend)

Vanilla JavaScript under one namespace (`window.TCC`), DOM built with `el()`
— no `innerHTML` anywhere, no framework, no bundler. `bin/build.js` produces a
deterministic, fingerprinted `dist/`; the unbuilt `web/` is servable as is.

| File | Contents |
|---|---|
| `core.js` | DOM helpers, formatters, API client, modal, confirm (reason + typed word), toast, History-API router |
| `ui.js` | badges, cards, KPI tiles, tables, pager, key-value lists, bars, tabs, fields, the NO DATA / empty / error / skeleton states |
| `charts.js` | SVG line and bar charts |
| `explore.js` | run picker, filter bar, paged list |
| `app.js` | shell, navigation, status bar (polls `/api/status`), theme, sign-out |
| `pages/*.js` | one file per page or page group (12 files, 16 routes) |

Design: the canonical Mythos tokens (`assets/brand/tokens/tokens.css`, copied
byte-identical and checked by a test), IBM Plex Sans / Mono and Archivo
Expanded self-hosted, dark default with a light theme, radius tokens only, no
colour literal, no spinner or infinite animation, links never gold, 44 px hit
areas, reduced-motion respected. No visual identity was invented.

## 7. Security

| Control | Implementation |
|---|---|
| Authentication | users file (mode 0600, refused otherwise) of scrypt records; sessions 8 h absolute / 60 min idle; a fresh session id at sign-in; identical failure for unknown user and wrong password |
| Session cookie | `tcc_session`: HttpOnly, Secure, SameSite=Strict, invisible to script |
| CSRF | per-session token in `X-TCC-CSRF` on every mutation; another session's token is refused |
| Origin | state-changing requests accepted from the configured public origin only; no CORS header is ever sent |
| Authorization | VIEWER < OPERATOR < OWNER, declared per route, checked **before** validation |
| Validation | closed-key schemas — an unknown field is a 400; `__proto__` / `constructor` / `prototype` keys rejected at parse; 64 KB body limit |
| Rate limits | separate buckets for reads, writes, heavy jobs and sign-in, per user; sign-in throttled per client + user |
| Headers | CSP `default-src 'self'` with no inline script or style, HSTS, frame DENY, nosniff, no-referrer, COOP/CORP same-origin, noindex |
| Static files | a whitelist; no dotfiles, nothing outside the interface directory |
| Errors | a generic 500 with a request id; no message, path or stack leaves the server |
| Audit | append-only JSON lines, each entry carrying the hash of the one before; accepted **and** refused actions; verified from the first entry on demand and at start-up |
| Secrets | none in the repository, the unit or the frontend; the smoke test scans every asset a page loads |
| Processes | backtests run as forked jobs with an empty environment; tests run with a throwaway HOME and none of the server's environment |

## 8. Tests

| Suite | Tests | Subject |
|---|---|---|
| `unit-test.js` | 43 | modules in isolation |
| `api-test.js` | 25 | every read route, NO DATA, contexts |
| `control-test.js` | 29 | configuration, preview, strategies, trading switch, mode, persistence |
| `security-test.js` | 38 | the table in §7, route by route |
| `live-lock-test.js` | 21 | §12 |
| `web-test.js` | 23 | static rules of the interface, the build |
| `paper-test.js` | 20 | the paper control room, equivalence with the backtest |
| `backtest-test.js` | 19 | the Backtest Center |
| `decision-test.js` | 11 | the decision chain |
| `risk-recovery-test.js` | 15 | risk and recovery views |
| `jev-test.js` | 11 | Jev views and bands |
| `property-test.js` | 6 | randomised limits, junk bodies, range enforcement |
| `research-test.js` | 14 | experiment, challenger, evidence, gate, DEMO, journal replay |
| `testing-test.js` | 13 | the Testing Center against suites that pass, fail, skip, crash, hang, are missing |
| `activity-system-test.js` | 13 | timeline, audit chain, system, tamper detection |
| `integration-test.js` | 11 | whole-surface integration and the LIVE audit |
| `e2e-test.js` | 12 | one operator journey over HTTP |
| `deploy-test.js` | 6 | the unit, the vhost, the release script, the smoke test |
| `e2e-browser-test.js` | 58 | the real interface in a real headless browser |
| **Control Center** | **388** | `cd projects/mythos-trading-control-center && npm test` |
| **Trading Agent** | **572** | `cd projects/mythos-trading-agent && npm test` — unchanged, re-run at Phase 14 |

Result at `9c1ce48f`: **Control Center 388 pass, 0 fail, 0 skipped. Trading
Agent 572 pass, 0 fail.** Nothing is mocked: every suite starts the real
server against the real agent with a throwaway state directory.

## 9. End-to-end

- `e2e-test.js`: sign in → nothing to show → configure → backtest → a trade
  and its eleven-stage decision chain → analysis and research → owner-approved
  PAPER → a paper session on the real timer, archived → kill switch → LIVE
  refused → the audit chain holds the journey in order → restart.
- `e2e-browser-test.js`: 58 tests through a zero-dependency CDP driver and a
  headless Chrome — every page, every form, every confirmation dialog, with
  two assertions made on every page visited: no script error or CSP violation
  occurred, and no number was shown where there was no data. Without a browser
  these tests are reported as **skipped**, never as passed.

## 10. Paper and backtest

- **Backtest**: assets, timeframe, bars, seed, capital, Jev, risk, recovery
  and cost inputs; runs as an isolated job, one at a time; a second run of the
  same configuration is made and its store digest compared (reproducibility);
  the 13 health checks, the Analysis report and the Research report are stored
  with the run. Retention: the last 20 runs.
- **Paper**: the agent's own paper session on a **replay feed of synthetic or
  fixture bars**; requires PAPER mode, which requires the owner's approval
  record bound to the running configuration fingerprint and commit. Start,
  pause, resume, stop, reset, speed; a live event stream; halts by itself if
  the mode or the configuration changes underneath it. Every record is marked
  as paper and no order is sent anywhere.
- **Demo**: a paper session with two arms — the running configuration and a
  registered challenger — on the same feed, whose comparison can be attached
  to the challenger as evidence.

## 11. Deployment

Artifacts, in `projects/mythos-trading-control-center/deploy/` (runbook:
`deploy/README.md`):

| File | Role |
|---|---|
| `mythos-trading-control-center.user.service` | user unit for `deploy`: loopback `:8210`, production mode, public origin pinned, state and users outside the release, state directory the only writable path, memory capped |
| `nginx-trading.mythosprod.xyz.conf` | pre-TLS vhost; certbot owns the 443 block; the event stream is unbuffered |
| `release.sh` | exports one **pushed** commit, refuses one whose agent differs from the audited base, builds, runs **both suites from the export**, then switches `current`; rolls back by itself on a failed smoke test |
| `smoke.sh` | read-only verification of a running instance, anonymous and signed-in |

Host facts verified read-only on 2026-10-01: `trading.mythosprod.xyz` resolves
to this VPS (51.68.226.211); no vhost and no certificate exist for it yet (the
name currently falls through to the default server); port 8210 is free;
`deploy` has linger enabled; certbot is installed.

**Deployment status: see §13.**

## 12. LIVE safety

LIVE is impossible in this build, and the Control Center adds no way around
any of the agent's three locks (schema cannot parse `mode: LIVE`; the mode
controller refuses it; the live adapter refuses every call).

What the tests establish, on every run:

- **Source**: the agent's 14 safety-critical files match pinned SHA-256
  hashes; nothing under the agent differs from `82b1ce0c`; this project never
  imports or constructs the live adapter; the server contains no outbound
  network client; the browser code talks only to its own origin.
- **Routes**: no route names execution, an order, a broker or LIVE; no body
  schema accepts a size-like field; every mutation route refuses a smuggled
  `mode`, `lots`, `adapter`, `venue`, `bypassRisk`, `force`… from the OWNER.
- **Mode**: LIVE is refused by name (`403 LIVE_NOT_AVAILABLE`) for every role,
  with or without a complete approval record, in every spelling; the approval
  for PAPER is refused for another fingerprint, another commit, a missing
  gate, thin evidence, an operator, a reused record, and after any
  configuration change; a restart is always BACKTEST.
- **Stores**: in every store the platform produced (backtest, paper, both DEMO
  arms), every trade has a Jev ENTER at or above the threshold, a Risk Engine
  verdict that is not BLOCK, exactly the approved size, a level inside the
  recovery cap, and never a second open position.
- **Research**: a proposal can only remove strategies or change validated
  configuration keys; a promotion changes the champion *record* and never the
  running configuration; a forged journal line cannot create a champion.
- **Process**: the server process connected to nothing but its own clients;
  running the platform changed no byte of the agent's tree.

No LIVE protection was changed at any point of this work.

## 13. Status, limitations and what is not done

**Not done**

- **The production deployment has not been executed.** The service is not
  installed, the vhost is not in place and no certificate has been issued, so
  `https://trading.mythosprod.xyz` does not serve the Control Center. The
  authorization given for this work covered the dedicated worktree, its tests,
  commits and pushes; installing a service and changing the shared nginx
  configuration of a production host is a step beyond that, and it waits for
  the owner's explicit confirmation. Everything it needs is written, tested
  and rehearsed (§11); the steps are in `deploy/README.md`.
- Consequently HTTPS, the certificate, the public smoke test and the
  production users file are **not verified in production**.

**Limitations**

- All data is synthetic or fixture. Nothing here is a statement about edge or
  profitability, and the health check for data provenance is permanently WARN.
- The paper feed is a replay of stored bars, not a market connection.
- No experiment on the fixture data earned a promotion; the accepted
  promote/rollback path is exercised by one test that inserts passing evidence
  itself, and says so in its name.
- One job at a time; 20 runs and 30 test runs are kept; activity reads the
  most recent 2,000 audit entries.
- Sessions are in memory: a restart signs everyone out.
- The agent's own CLI command `node bin/mtx.js stress` fails when re-merging a
  serialised configuration that carries derived keys. This is a pre-existing
  defect in the agent, outside this work's scope and not fixed (the agent is
  untouched); the Control Center's experiment job strips those keys itself.

**Corrections on the record**

- Commit `7b70480d` (Phase 4) was pushed with one intermittently failing
  browser test while its message said all passed. The cause was a real defect
  (the Control Center redrew over unsaved edits); it was fixed in `16aabca4`,
  and since then the commit helper refuses to commit unless the whole suite
  passes.
- Commit `b09c7fd5` (Phase 12) says 351 tests; the suite had 350, all passing.

## 14. Health

`GET /api/health` is the public liveness probe. `GET /api/system` reports the
ten components, the thirteen health checks (four evaluated against the running
configuration, nine against the latest completed backtest — UNKNOWN when there
is none, and UNKNOWN is never a pass), version, commit, uptime, memory,
persistence, deployment, and the audit chain's integrity at start-up.
