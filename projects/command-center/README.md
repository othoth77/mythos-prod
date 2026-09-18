# OTHMODE — Mythos control platform

**Commands · Skills · Tools · Providers · Projects · Health · Status · History · Memory · Evolution**

Stage OTHMODE-2 (formerly MCC-1, the MYTHOS AI COMMAND CENTER) · serves
**`othmode.mythosprod.xyz`** (canonical) and `ordre.mythosprod.xyz`
(recoverable legacy host, same process) · MCC architecture in
[`docs/MYTHOS_COMMAND_CENTER_ARCHITECTURE.md`](../../docs/MYTHOS_COMMAND_CENTER_ARCHITECTURE.md) ·
OTHMODE design + final audit in [`docs/othmode/`](../../docs/othmode/)

The command library below is unchanged and remains the LIBRARY core.
OTHMODE adds, in `reference/othmode/`: unified read models over the
existing engines (skills, tools, providers, projects), health aggregation
with recovery records, unified command history, a read-first memory bridge
through the oth-knowledge boundary, the controlled Evolution layer with an
append-only store outside Git (`/home/deploy/oth-evolution-store`,
fail-closed when absent), per-command activation by the standalone
`othmode` keyword (the global ON/OFF switch was removed 2026-08-26), the
free-LLM pool view (`/api/othmode/providers/free-llm`, over
`projects/mythos-ai-executor/free-llm/` — see
[`docs/MYTHOS_FREE_LLM_RESOURCES.md`](../../docs/MYTHOS_FREE_LLM_RESOURCES.md)),
and the operator CLI `cli/othmode-cli.js`. Suites:
`node tests/othmode-2-platform-test.js` and `node tests/othmode-3-tasks-test.js`
(no database needed); `node tests/mcc-1-command-center-test.js` needs the
`mythos_command_center_test` database (it truncates; it refuses any other name).

A searchable, permanent library of the commands used to build and operate Mythos. Find a
command, understand it, copy it, adapt it, note what you learned, and see which ones you
actually use.

> **This application never executes a stored command.** There is no `child_process`, no
> `exec`, no `eval` and no shell anywhere in the runtime, and the test suite asserts that
> at source level. A command is text that gets displayed, searched, filled in and copied.

---

## Layout

```
projects/command-center/
├── database/schema.sql          schema mcc — 13 tables, idempotent, never drops
├── reference/
│   ├── server.js                process entry point; binds 127.0.0.1 only
│   ├── api.js                   HTTP API + static host (node http + pg, no framework)
│   ├── db.js                    pg pool, search_path pinned to mcc, parameterized only
│   ├── auth.js                  bearer-token write authorisation
│   ├── secrets.js               credential-pattern gate on every write
│   ├── variables.js             {{PLACEHOLDER}} discovery and substitution
│   ├── versioning.js            MAJOR.MINOR bumping and snapshots
│   └── web/                     index.html · app.css · app.js · i18n.js
├── seed/
│   ├── library.json             24 commands, 26 categories, 6 projects, 3 workflows
│   └── load.js                  idempotent, non-destructive loader
└── deploy/
    ├── mythos-command-center.user.service
    └── nginx-ordre.mythosprod.xyz.conf
```

## Run locally

```bash
env MCC_DB_HOST=127.0.0.1 MCC_DB_PORT=5432 MCC_DB_USER=mythos_command_center_owner MCC_DB_PASSWORD=... MCC_DB_NAME=mythos_command_center MCC_ADMIN_TOKENS='{"your-token":"owner"}' node projects/command-center/reference/server.js
```

`server.js` refuses to start without `MCC_ADMIN_TOKENS` — otherwise every write endpoint
would be open to anyone who can reach the port.

## Test

```bash
env MCC_DB_HOST=127.0.0.1 MCC_DB_PORT=5432 MCC_DB_USER=mythos_command_center_owner MCC_DB_PASSWORD=... MCC_DB_NAME=mythos_command_center_test node tests/mcc-1-command-center-test.js
```

502 assertions. The suite truncates its tables and **refuses to run against a database
whose name does not end in `_test`**.

## Seed

```bash
node projects/command-center/seed/load.js
```

Existing commands are skipped, never overwritten. Use `--force-update` to overwrite from
`library.json` deliberately.

## Keyboard

| Key | Action |
|---|---|
| `/` | focus search |
| `c` | copy the selected command |
| `f` | toggle favourite |
| `n` | new note |
| `Esc` | close dialog |

## Editing access

Reading and copying are open. Editing needs a signed-in browser session — **nothing is
ever typed or pasted into the UI**:

```bash
node projects/command-center/cli/othmode-cli.js login-link
```

run on the host prints a one-time URL (single use, 15-minute expiry). Open it once in the
browser that should stay signed in; the server exchanges it for a 90-day session delivered
as an `HttpOnly; Secure; SameSite=Strict` cookie. Only sha256 hashes of codes and session
ids are stored (in the OTHMODE store, 0600); page JavaScript can never read the cookie,
and no credential exists in `localStorage`, the page source, or any API response.
`othmode-cli.js sessions` counts active sessions; `revoke-sessions` signs every browser
out. Cookie-authenticated writes additionally require same-origin proof (CSRF check).

`MCC_ADMIN_TOKENS` bearer tokens remain valid for the API (CLI, agents, automation) —
they are simply no longer part of any interface workflow.

## Command runs (OTHMODE V2)

A library command can be **run** from its detail page (button "Run", session
required). OTHMODE renders the placeholders, asks the executor's router which
advisory provider is healthiest (`POST /route`, repo-read), falls back to the
free-LLM pool when the router is off or would hand the task to an
execution-authority agent, creates an executor task (`report_to_git: false`,
`requested_by: othmode:<who>`) and records the link in the OTHMODE store
(`runs/records.jsonl`). The page then follows the task until it ends and shows
which provider and model actually answered, whether the pool fell back, how
long it took and the report summary. Runs are the fifth source of Command
History (`source=run`).

Rules that never bend: only **ACTIVE** commands with safety **SAFE** or
**READ_ONLY** are runnable here; a run is always an advisory task — anything
that must change a repository goes through work intake (Issue → bridge →
executor). Placeholder values pass the same secret gate as every other write.

Endpoints: `GET /api/othmode/run-config` (enabled?, the rule),
`POST /api/othmode/commands/:slug/run` (auth; body `{values, provider, task_type,
timeout_seconds}`; provider `auto` | `free-llm-pool` | `openai-compat`),
`GET /api/othmode/runs`, `GET /api/othmode/runs/:taskId` (public reads,
executor paths blanked).

Deployment: `sudo /home/deploy/othmode-v2-deploy.sh` on this host (pulls `main`,
installs the drop-in, reloads and restarts the command-center, and restarts the
executor only when no task is RUNNING). Enable on any host with the drop-in `deploy/executor-link.conf`
(`OTHMODE_EXECUTOR_TOKEN_FILE` → the executor's own 0600 bearer file, read at
call time and sent only as a header on loopback; `OTHMODE_EXECUTOR_URL`,
`OTHMODE_EXECUTOR_PROJECT`). Without the variable the edge is disabled and
says so. Tests: `node tests/othmode-4-run-test.js` (the run path, offline, stub executor)
and `node tests/othmode-5-ui-test.js` (the real front-end modules booted under a
DOM shim and driven through the V2 screens in EN/FR/AR — no browser, no network).

## Never store a credential here

Saving content that matches a known credential format (PEM key, AWS key ID, GitHub or
Anthropic token, JWT, connection string with an inline password) is **refused**, not
warned about. Use `{{PLACEHOLDER}}` or an environment-variable name instead. If a real
value was ever pasted, treat it as leaked and rotate it.
