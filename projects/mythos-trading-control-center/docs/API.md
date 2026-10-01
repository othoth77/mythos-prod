# Trading Control Center — API reference

Base path `/api`. JSON in, JSON out. Same-origin only: no CORS header is ever
sent. The route table in [`server/api.js`](../server/api.js) is the single
source of truth; this file describes it.

## Envelope

```jsonc
// success
{ "ok": true, "result": { … }, "audit": { "seq": 12, "hash": "…", "ts": "…" } }   // audit only on mutations
// failure
{ "ok": false, "error": { "code": "CONFIG_INVALID", "message": "…", "problems": [ … ] }, "requestId": "…" }
```

| Status | Meaning |
|---|---|
| 400 | malformed or invalid request; `problems` lists every defect |
| 401 | no session |
| 403 | wrong role, bad CSRF token, foreign origin, or a designed refusal (LIVE, mode, promotion) |
| 404 | no such route or resource |
| 409 | conflicting state, or `CONFIRMATION_REQUIRED` |
| 413 / 414 / 415 | body too large (64 KB) / URI too long / not `application/json` |
| 429 | rate limited; `Retry-After` is set |
| 500 | unexpected; generic message and an `errorId`, detail in the journal only |

## Authentication

| Route | |
|---|---|
| `POST /api/auth/login` `{user, password}` | sets the `tcc_session` cookie (HttpOnly, SameSite=Strict, Secure); returns `{user, csrf}` |
| `GET /api/auth/session` | `{authenticated, user, csrf, can}` |
| `POST /api/auth/logout` | destroys the session |

Every non-GET request must send the session's CSRF token in `X-TCC-CSRF`.
Sessions last 8 h absolute and 60 min idle, and do not survive a restart.

## The mutation contract

Enforced in `server/server.js` around every non-GET route, in this order:

```
authenticate → CSRF + origin → rate limit → authorize → validate → execute → audit → deterministic result
```

Every attempt is audited — accepted, refused or failed — with actor, role,
timestamp, old value, new value, reason, both config fingerprints and the commit.

## Reads (role `VIEWER`)

| Route | Returns |
|---|---|
| `GET /api/health` | **public** liveness; adds mode and health summary when signed in |
| `GET /api/status` | mode, trading switch, fingerprint, commit, paper state, active job |
| `GET /api/dashboard` | every dashboard value, each `{available:false, reason}` when it has no source |
| `GET /api/config` | configuration, fingerprint, assets, strategies, editable keys and their ranges |
| `GET /api/config/history` | every configuration change, and the mode events |
| `GET /api/config/mode` | mode, and exactly what a BACKTEST→PAPER approval must contain |
| `GET /api/strategies` | the 14 families with per-strategy statistics and sample sizes |
| `GET /api/candidates` | candidates with their final decision and recorded reason codes |
| `GET /api/decisions` | decision rows; `GET /api/decisions/:candidateId` is the full 11-stage chain |
| `GET /api/trades` | trades with requested vs approved size, costs, R; `GET /api/trades/:tradeId` |
| `GET /api/jev` | verdicts, the 70–79 / 80–89 / 90–94 / 95–100 bands, reasons |
| `GET /api/risk` | limits, verdicts, binding limits, clamps, blocks, exposure |
| `GET /api/recovery` | per-asset ladder state, requested vs approved size |
| `GET /api/paper` | control-room state; `GET /api/paper/events?since=` ; `GET /api/paper/stream` (SSE) |
| `GET /api/backtest` | runs; `GET /api/backtest/options`; `GET /api/backtest/:runId` |
| `GET /api/analysis` | the Analysis Agent's report |
| `GET /api/research` | the Research Agent's report, the champion registry, experiments |
| `GET /api/testing` | categories, latest results, runs; `GET /api/testing/runs/:runId` |
| `GET /api/activity` | one timeline over audit, runs, tests and store events (two labelled clocks) |
| `GET /api/audit` | the raw audit chain; `GET /api/audit/verify` re-checks every hash |
| `GET /api/system` | version, commit, uptime, ten components, the 13 health checks |
| `GET /api/jobs/:runId` | one run's status |

Explorer routes take `run=<runId>` to address a specific run. With none, the
context is the live paper session if there is one, else the latest completed
run, else `{available:false, reason}`. They also take `limit` (≤ 500) and `offset`.

## Mutations

| Route | Role | Notes |
|---|---|---|
| `PATCH /api/config` `{changes, reason, expectedFingerprint?, confirm?}` | OWNER | allowlisted keys only; the agent's schema validates; a change that loosens a protection needs `confirm:"CONFIRM"` |
| `POST /api/config/preview` `{changes}` | OPERATOR | the diff and what it would loosen; applies nothing |
| `POST /api/config/strategies` `{enabled[], reason}` | OWNER | the set is inside the config fingerprint |
| `POST /api/config/trading` `{enabled, reason, confirm?}` | OPERATOR to disable, OWNER + `confirm:"ENABLE"` to enable | sets the Risk Engine's own emergency stop |
| `POST /api/config/mode` `{to, reason, approval?}` | OPERATOR to lower, OWNER + approval to raise | `to` may only be `BACKTEST` or `PAPER`; anything else is `403 LIVE_NOT_AVAILABLE` |
| `POST /api/config/mode/dry-run` | OPERATOR | whether an approval would be accepted |
| `POST /api/paper/start` `{data?, ticksPerSecond?, demo?}` | OPERATOR | needs PAPER mode |
| `POST /api/paper/pause` · `resume` · `stop` · `speed` | OPERATOR | |
| `POST /api/paper/reset` `{confirm:"RESET"}` | OPERATOR | archives the session; deletes nothing |
| `POST /api/backtest` | OPERATOR | 202; one run at a time |
| `POST /api/research/experiments` `{runId, proposalId}` | OPERATOR | evaluates a Research Agent proposal |
| `POST /api/research/challengers` `{runId, proposalId}` | OPERATOR | registers a challenger from a stored proposal |
| `POST /api/research/challengers/:id/evidence` | OPERATOR | from a recorded experiment or demo run only |
| `POST /api/research/challengers/:id/reject` `{reason}` | OPERATOR | |
| `POST /api/research/challengers/:id/promote` `{basis, confirm:"PROMOTE"}` | OWNER | the agent's gate decides; changes no running rule |
| `POST /api/research/champion/seed` `{basis, runId?}` | OWNER | |
| `POST /api/research/champion/rollback` `{reason, confirm:"ROLLBACK"}` | OWNER | |
| `POST /api/testing/run` `{scope, category?, file?, name?}` | OPERATOR | 202 |
| `POST /api/testing/cancel` | OPERATOR | |

### The approval record for BACKTEST → PAPER

```jsonc
{
  "to": "PAPER",
  "reason": "…",
  "approval": {
    "ownerApproval": true,
    "statement": "I approve the Mythos Trading Agent transition BACKTEST -> PAPER",
    "configFingerprint": "<the running fingerprint>",
    "commit": "<the running commit>",
    "gatesPassed": ["UNIT_TESTS_PASS", …],          // all ten
    "gateEvidence": { "UNIT_TESTS_PASS": "…", … },  // ≥ 8 characters each
    "nonce": "<fresh per submission>"
  }
}
```

The approver is taken from the **session**; a payload cannot name one. The
record is verified by the Trading Agent's own mode controller, is single-use
(also across restarts), and stops being valid the moment the configuration
changes.

### Research proposals

A Research Agent proposal is an inert override. Every key in it is merged and
validated by the Trading Agent's own configuration loader, with one exception:
`strategy.disable: [ids]` is not a configuration key (which strategies run is
a wiring argument), so it is applied to the enabled set instead. A proposal
can only **remove** strategies; an unknown id, any other `strategy.*` key or a
set left empty is refused with `PROPOSAL_NOT_APPLICABLE` (409). The same rule
builds an experiment's variant, a challenger's configuration hash and a DEMO
session's challenger arm, so the three always agree.

### The testing center

`POST /api/testing/run` takes `{scope:"all"}`, `{scope:"category", category}`
or `{scope:"test", file:"agent:<name>-test.js"|"cc:<name>-test.js", name}`.
Nothing else is accepted: no path, no argument, no command. One run at a time
(`TEST_RUN_IN_PROGRESS`, 409). A run's record carries, per file, `passed`,
`failed`, `skipped`, `durationMs`, `problem` (crashed, timed out, missing) and
`output` (what the file printed, kept only beside a failure). A cancelled run
never replaces a category's last finished result.

### Activity

`GET /api/activity` merges the audit chain, this process's events and one
run's store. Items carry `clock: "WALL"` (with `at`) or `clock: "BAR"` (with
`ts`); wall-clock items are always listed first and the two are never
interleaved. `fromTs`/`toTs` are applied to each item on its own clock.

## What does not exist

There is no route that places, sizes, modifies or cancels an order; no route
that selects LIVE; no field anywhere that carries a position size. `tests/security-test.js`,
`tests/live-lock-test.js` and `tests/integration-test.js` walk the route table
— and every store the platform produces — to keep it that way.
