# Mythos Trading Control Center

Authenticated web console and REST API for the [Mythos Trading Agent](../mythos-trading-agent/),
served at `trading.mythosprod.xyz`.

> **BACKTEST and PAPER only. LIVE execution does not exist.** The Trading Agent
> has no venue connectivity, no credentials and no network client, and its live
> adapter refuses every call. This project adds no execution path: it has no
> route that sends an order and no way to select LIVE.
> Every dataset available is **synthetic** — results validate mechanics, never
> edge, and **no profitability claim is made**.

## What it is

A separate project that *imports* the Trading Agent and drives it through the
same contracts `bin/mtx.js` uses. The agent is not modified: its
`NO_NETWORK_CLIENT` health check greps its own `src/` and fails on anything that
could reach a network, so the HTTP server lives here instead of there.

```
browser ──HTTPS──▶ nginx ──▶ server/server.js   (auth · CSRF · rate limit · audit)
                               │
                               ▼
                         server/api.js          (the one route table)
                               │
                               ▼
                         server/platform.js     (composition; NO DATA is a value)
        ┌──────────────┬───────┴──────┬───────────────┬──────────────┐
   control.js       runs.js        paper.js       research.js    testing.js
 (config · mode)  (forked jobs)  (paper/demo)   (champion gate)  (node --test)
        └──────────────┴───────┬──────┴───────────────┴──────────────┘
                               ▼
                         server/agent.js        (the ONLY file that requires the agent)
                               │
                               ▼
                  projects/mythos-trading-agent  (unchanged)
```

Zero runtime dependencies, no build-time dependency, Node ≥ 22.

## Quick start

```bash
cd projects/mythos-trading-control-center
npm test                                   # every suite except the browser run

# a users file (0600) — the password is read from stdin, or generated:
node bin/tcc-user.js set /path/to/users.json othman OWNER --generate

TCC_USERS_FILE=/path/to/users.json TCC_STATE_DIR=/path/to/state node server/server.js
# → http://127.0.0.1:8210
```

| Variable | Meaning |
|---|---|
| `TCC_PORT`, `TCC_BIND` | listen address (default `127.0.0.1:8210`) |
| `TCC_USERS_FILE` | users file with scrypt hashes; refused unless mode `0600` |
| `TCC_STATE_DIR` | persistent state; without it state is in-memory and lost on stop |
| `TCC_PUBLIC_ORIGIN` | the only `Origin` accepted for state-changing requests |
| `TCC_TRUST_PROXY=1` | trust `X-Real-IP` from a loopback peer (nginx) |
| `TCC_COMMIT` | running commit when there is no `.git`; unknown ⇒ PAPER approvals refused |
| `TCC_CHROME` | headless browser binary for the browser end-to-end suite |

No credential is ever read from the environment.

## Roles

| Role | May |
|---|---|
| `VIEWER` | read everything, change nothing |
| `OPERATOR` | run backtests and tests, drive an already-approved paper session, and take any action that **reduces** exposure (disable trading, lower the mode) |
| `OWNER` | all of the above, plus change configuration, enable trading, raise the mode (still subject to the agent's own owner-approval record) and decide champions |

No role can execute LIVE.

## Safety model, in one paragraph

The Trading Agent's three locks on LIVE are untouched and are pinned by hash in
`tests/live-lock-test.js`. The Control Center adds its own: the mode route can
pass only `BACKTEST` or `PAPER` to the agent; raising the mode needs an `OWNER`
session **and** a complete approval record that the agent's own mode controller
verifies against the running config fingerprint and commit; approvals are
single-use across restarts; a configuration change invalidates the approval and
returns the platform to `BACKTEST`; a restart always comes up in `BACKTEST`. The
Risk Engine stays the last writer of position size — no route accepts a size.
Research can only propose: a promotion records which configuration is approved
and changes no running rule.

## Layout

| Path | Contents |
|---|---|
| `server/server.js` | HTTP plumbing and the mutation pipeline |
| `server/api.js` | the route table — every route, its role, its body shape, its audit action |
| `server/auth.js` | users, scrypt, sessions, CSRF, sign-in throttle |
| `server/audit.js` | append-only, hash-chained audit log |
| `server/control.js` | configuration, strategies, trading switch, execution mode |
| `server/runs.js`, `server/jobs/` | backtests and experiments as forked processes |
| `server/paper.js` | paper / demo control room and its event stream |
| `server/research.js` | journalled champion/challenger registry |
| `server/testing.js` | the testing center |
| `server/views.js` | read models over a run's store |
| `server/agent.js` | the Trading Agent boundary |
| `web/` | the interface |
| `tests/` | `node --test` suites |
| `deploy/` | systemd unit, nginx vhost, release script |
| `docs/` | [API reference](docs/API.md) |

The complete record — architecture, phases, security, tests, deployment and
limitations — is [`docs/TRADING_CONTROL_CENTER_FINAL.md`](../../docs/TRADING_CONTROL_CENTER_FINAL.md).
