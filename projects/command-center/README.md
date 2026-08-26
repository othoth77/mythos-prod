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
fail-closed when absent), the owner-only OthMode ON/OFF switch, and the
operator CLI `cli/othmode-cli.js`. Suite:
`node tests/othmode-2-platform-test.js` (no database needed).

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

Reading and copying need no token. Editing does: click **Read-only** in the header and
paste the token from
`/home/deploy/deployments/mythos-command-center/.env` (`MCC_ADMIN_TOKENS`). It is stored in
`localStorage` and sent only as an `Authorization: Bearer` header to this origin.

## Never store a credential here

Saving content that matches a known credential format (PEM key, AWS key ID, GitHub or
Anthropic token, JWT, connection string with an inline password) is **refused**, not
warned about. Use `{{PLACEHOLDER}}` or an environment-variable name instead. If a real
value was ever pasted, treat it as leaked and rotate it.
