# MYTHOS Telegram channel — implementation and E2E report

**Stage:** MYTHOS-TELEGRAM-0 (2026-09-05). **Branch:** `mythos/telegram-channel-20260905` (not merged).
**Code:** `projects/mythos-ai-executor/bridge/telegram.js`. **CLI:** `bin/mythos-github-bridge telegram-*`.
**Tests:** `tests/mythos-telegram-channel-test.js` (62 checks, offline, fake Bot API, no real token).
**Classification (this document's §7): BLOCKED** — implementation and automated tests are complete; the live
end-to-end test cannot run because no Telegram bot credential exists on the host.

## 1. Architecture map (Phase 1 — inspected, nothing modified)

There is no component literally named "Companion". The inbound side of MYTHOS is the **GitHub control bridge**
(`bridge/github-bridge.js`), and every channel is an adapter that writes control TASK files for it:

```text
inbound channels (adapters = boundaries)          the ONE pipeline (unchanged by this stage)
─────────────────────────────────────────         ─────────────────────────────────────────────────────────────
GitHub Issues  bridge/github-issues.js  ─┐        control/tasks/<id>.json (PENDING, mythos/control branch)
Telegram       bridge/telegram.js (NEW) ─┼──►     github-bridge.tick(): validate (schema, secret scan, task-id rules)
n8n webhook    server.js POST /tasks    ─┘             → runtime identity gate → claim
                                                       → OTHMODE Task record (command-center/reference/othmode/tasks.js)
                                                       → per-task worktree, push guard (no_push:// URL)
                                                       → executor.createTask(profile = PROFILE_BY_ACTION[requested_action])
                                                  mythos-ai-executor daemon (user unit, NoNewPrivileges):
                                                       Resource Guard admission → lib/policy.js tool permissions
                                                       → providers/claude-code.js (`claude -p`, OTHMODE contract)
                                                  github-bridge.tick(): Git-verified REPORT → control/reports/<id>.json
                                                       → OTHMODE record closed by the bridge → WhatsApp notify ledger
outbound                                          bridge/notify/whatsapp.js (owner-designated recipient, unchanged)
                                                  Issues adapter: Issue comments · Telegram adapter: chat replies (NEW)
```

Facts that shaped the design:

| # | Question | Finding |
|---|---|---|
| 1 | Companion architecture | GitHub control bridge + executor; channels are adapters over control files. |
| 2 | Existing channel adapters | `github-issues.js` (inbound), `notify/whatsapp.js` + `providers/{evolution,generic}.js` (outbound only). |
| 3 | How messages enter | Only as `control/tasks/<id>.json` (mythos-control/1) or `POST /tasks` (n8n, bearer). |
| 4 | OTHMODE / Governance / Executor | `othmodeCreate()` at claim, instruction opens with the `othmode` keyword; `requested_action → execution_profile` is closed server-side (`action-resolution.js`); pushes only via the root governance relay; Resource Guard + `lib/policy.js` in the executor. |
| 5 | Config conventions | `MYTHOS_<COMPONENT>_*` env; credentials in deploy-owned 0600 files bound by systemd drop-ins; `describe()` reports presence, never values. |
| 6 | Channel tests | `tests/mythos-github-issues-test.js` (fake GitHub API), `tests/mythos-bridge-whatsapp-*-test.js` (fake gateway). |
| 7 | Runtime | `mythos-github-bridge.timer` (1 min, deploy user unit) runs `tick` from the **main checkout**; executor daemon `mythos-ai-executor.service`. |
| 8 | Telegram adapter existing? | **No** — only strategy mentions in `docs/CLOUDFLARE_ARCHITECTURE.md` and `docs/OFFHOST_PROJECT_REGISTRY.md`. No token on the host. |
| 9 | Generic inbound interface? | Yes: the control TASK (`bridge/schemas/task.schema.json`) with a `source` block per channel. Telegram implements it. |

## 2. Implementation (Phase 2)

`bridge/telegram.js` — Bot API **long polling** (`getUpdates`, no webhook), node core only, token in a closure:

- **receive**: private text messages only (`chat.type === 'private'`, `chat.id === from.id`, sender not a bot);
- **normalise**: `{channel, update_id, chat_id, user_id, message_id, date, text}` → control TASK `tg-<update_id, 9 digits>`
  with `created_by = telegram:<user_id>` and a `source` block `{kind:"telegram", update_id, chat_id, user_id, message_id,
  content_sha256, idempotency_key, resolution, events, notifications}` (ids only, no username);
- **pass into the pipeline**: `bridge.validateTask` (unchanged), one control commit, then the **unchanged** `bridge.tick()`;
- **receive the response**: the bridge's REPORT file; **send back**: `sendMessage` to the origin chat — "queued" (task id,
  profile), "started" (executor id, OTHMODE id), report (status, summary, tests, executor id, OTHMODE id, report path);
- **correlation logging**: `telegram:created / notify_started / notify_report / unauthorized / rejected` in the bridge
  `events.log` with update_id, task_id, chat_id, user_id, executor_task_id, othmode_task_id, reply message_id — through
  `scrub()` (bot-token shape) + the shared redaction.

Changed files: `bridge/telegram.js` (new), `bin/mythos-github-bridge` (5 `telegram-*` commands; `tick` runs the Telegram
intake before and the notify after the existing phases only when `MYTHOS_TELEGRAM_ENABLED=1`),
`bridge/schemas/task.schema.json` (additive: `source.kind` enum + 5 Telegram fields),
`bridge/systemd/mythos-github-bridge.service.d/telegram.conf.example` (new), this document, the test suite.
**Not changed:** `bridge/notify/*` (WhatsApp), `github-issues.js`, `github-bridge.js`, `executor.js`, `lib/policy.js`.

Configuration (all `MYTHOS_TELEGRAM_*`): `ENABLED`, `BOT_TOKEN_FILE` (preferred) / `BOT_TOKEN`, `ALLOWED_USER_IDS`
(numeric, empty = nobody), `ALLOWED_ACTIONS` (default `investigate,review`), `DEFAULT_ACTION`, `MAX_PER_TICK`,
`POLL_SECONDS`, `HTTP_TIMEOUT_MS`, `API_BASE` (tests only).

## 3. Security / governance (Phase 3)

- Allowlist first, then the same path as every task: schema validation, secret scan (shared kinds + bot-token shape),
  runtime identity gate, claim, OTHMODE record, `requested_action → execution_profile` invariant, Resource Guard,
  `lib/policy.js` permissions, governance relay. **No bypass, no Telegram → shell path**: the adapter's only outputs are
  control files and Bot API replies.
- The channel further restricts `Action` to READ-style `investigate`/`review` by default; widening it is a separate
  configuration decision (`MYTHOS_TELEGRAM_ALLOWED_ACTIONS`), and even then the engine's closed action set applies
  (`deploy` is refused; `implement` maps to `repo-write` under the same governance as an Issue).
- Strangers get no reply (the bot does not reveal itself); the drop is logged by user id.
- Token: never in source, Git, logs, task files, replies or CLI output; `describe()`/`telegram-config` report presence only.

## 4. Tests (Phase 4) — `node tests/mythos-telegram-channel-test.js`

| Requirement | Coverage |
|---|---|
| 1 update → normalised message → TASK | §1: fields, deterministic id, source block, `Action: review` honoured/stripped, validator passes |
| 2 malformed updates | §2: 14 shapes refused with reasons, never throw; group chats and edited messages ignored |
| 3 missing token | §3: `TELEGRAM_TOKEN_MISSING`, no request, no state; KEY=VALUE token file read; presence only |
| 4 secret redaction | §4 + §4b: scrub, secret-bearing messages refused without echo, 401 error token-free, **token in no file on disk, no request body, no reply, no CLI output** |
| 5 authorisation rejection | §5: stranger dropped (no task, no reply, offset advanced); group ignored; empty allowlist fetches nothing |
| 6 full flow with mocks | §6: intake → queued reply → unchanged bridge claim → OTHMODE record → started reply → mock executor → COMPLETED report → report reply; idempotent on repeat; outage retry once; main untouched |
| 7 WhatsApp untouched | `tests/mythos-bridge-whatsapp-notify-test.js` 131/131, `tests/mythos-bridge-whatsapp-resilience-test.js` 101/101 on this branch |

Results on the host (as `deploy`, 2026-09-05): telegram-channel **62/62**; whatsapp-notify **131/131**;
whatsapp-resilience **101/101**; github-issues **193/193**; action-resolution **88/88**; github-bridge **150/150**;
governance-invariant **111/111**.

## 5. Live E2E (Phase 5) — NOT RUN

Prerequisites on the host, none of which exist today (verified: no `*telegram*` file, no `TELEGRAM` variable under
`~deploy/mythos-ai-executor/secrets`, `~deploy/deployments`, `~deploy/.config`):

1. A bot created by the owner with @BotFather; its token written by the owner, **never pasted anywhere else**, to
   `/home/deploy/mythos-ai-executor/secrets/telegram-bot.env` (owner `deploy`, mode 0600) as one line
   `MYTHOS_TELEGRAM_BOT_TOKEN=<token>`.
2. The owner's numeric Telegram user id (e.g. from @userinfobot), for `MYTHOS_TELEGRAM_ALLOWED_USER_IDS`.

Smallest possible live test, from the branch worktree as `deploy`, without touching production units (the timer keeps
running `tick` from the main checkout; the bridge lock serialises the two; the production executor daemon runs the READ
task exactly as it runs Issue tasks):

```bash
cd /home/deploy/worktrees/telegram-channel
export MYTHOS_TELEGRAM_ENABLED=1 MYTHOS_TELEGRAM_BOT_TOKEN_FILE=$HOME/mythos-ai-executor/secrets/telegram-bot.env \
       MYTHOS_TELEGRAM_ALLOWED_USER_IDS=<owner id>
B=projects/mythos-ai-executor/bin/mythos-github-bridge
node $B telegram-config          # ready: true, token_present: true (no value)
node $B telegram-check           # getMe → bot username (read-only)
# owner sends ONE private message to the bot:  "Action: investigate\n\nReport the HEAD commit and branch of mythos-prod."
node $B telegram-tick --no-bridge --dry-run   # would_create tg-<update_id> (nothing written)
node $B telegram-tick            # intake (queued reply) → bridge tick (claim, OTHMODE, executor) → started reply
node $B telegram-status          # update_id ⇄ task ⇄ executor ⇄ OTHMODE
# after the executor finishes (the 1-minute production tick writes the REPORT):
node $B telegram-tick            # report reply
node $B trail tg-<update_id>     # full audit trail
```

Expected correlation to record (redacted of nothing but the token, which never appears): Telegram `update_id` →
`tg-<update_id>` → `execution.othmode_task_id` (`OTH-2026-…`) → `execution.executor_task_id` (`t-…`) →
`control/reports/tg-<update_id>.json` → reply `message_id`s in `source.notifications`.

## 6. Rollback

The channel is inert without `MYTHOS_TELEGRAM_ENABLED=1` and a token. Removing the drop-in (or the env) and
`systemctl --user daemon-reload` returns the timer to its previous behaviour; no data model changed on the control
branch beyond additive `source` fields.

## 7. Report (Phase 6)

| Item | Value |
|---|---|
| implementation status | complete on the branch, not merged |
| files changed | `bridge/telegram.js`, `bin/mythos-github-bridge`, `bridge/schemas/task.schema.json`, `bridge/systemd/…/telegram.conf.example`, `tests/mythos-telegram-channel-test.js`, this document |
| tests executed / results | see §4 |
| Telegram update_id | none (live test not run) |
| MYTHOS correlation ID | none |
| OTHMODE ID | none |
| Executor ID | none |
| final Telegram delivery result | none |
| governance result (mocked flow) | READ task ran under `repo-read`, OTHMODE record opened/closed by the bridge, main untouched |
| security / secret-redaction result | proven in the suite: token in no file, log, request body, reply or CLI output |
| WhatsApp untouched | yes — `bridge/notify/*` unchanged; both WhatsApp suites pass unchanged |
| production | untouched — no unit restarted, no drop-in installed, no credential created |
| exact blocker | **no Telegram bot token exists on the host** (owner-supplied credential required, see §5) |
| classification | **BLOCKED** (E2E gates `telegram_received … telegram_response_sent` unproven; `secrets_exposed = false` proven only for the mocked flow) |
