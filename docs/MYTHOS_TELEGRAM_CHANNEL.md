# MYTHOS Telegram channel — implementation and E2E report

**Stage:** MYTHOS-TELEGRAM-0 (2026-09-05). **Branch:** `mythos/telegram-channel-20260905` (not merged).
**Code:** `projects/mythos-ai-executor/bridge/telegram.js`. **CLI:** `bin/mythos-github-bridge telegram-*`.
**Tests:** `tests/mythos-telegram-channel-test.js` (62 checks, offline, fake Bot API, no real token).
**Classification (this document's §7): COMPLETE** — implementation, automated tests (66/66) and the live end-to-end test
(§9, 2026-09-05) are done; the branch is not merged and no production unit was changed.

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
| implementation status | complete on the branch, not merged; live E2E passed (§9) |
| files changed | `bridge/telegram.js`, `bin/mythos-github-bridge`, `bridge/schemas/task.schema.json`, `bridge/systemd/…/telegram.conf.example`, `tests/mythos-telegram-channel-test.js`, this document |
| tests executed / results | see §4 |
| Telegram update_id | 611867278 (message_id 192, chat/user 5005015506) |
| MYTHOS correlation ID | control TASK `tg-611867278` (attempt `tg-611867278#1`) |
| OTHMODE ID | `OTH-2026-00172` (RUNNING at claim → COMPLETED 02:15:51Z, closed by the bridge) |
| Executor ID | `t-20260905015410-5s8mok` (repo-read, claude-haiku-4-5, execution x-mtnr1kuq, COMPLETED) |
| final Telegram delivery result | three replies delivered: queued message_id 193, started 194, report 195 |
| governance result (mocked flow) | READ task ran under `repo-read`, OTHMODE record opened/closed by the bridge, main untouched |
| security / secret-redaction result | proven in the suite: token in no file, log, request body, reply or CLI output |
| WhatsApp untouched | yes — `bridge/notify/*` unchanged; both WhatsApp suites pass unchanged |
| production | untouched — no unit restarted, no drop-in installed, no credential created |
| exact blocker | none (token supplied by the owner 2026-09-05 01:25Z; webhook removed with approval, §9.1) |
| classification | **COMPLETE** — E2E gates `telegram_received → task_created → claimed (OTHMODE, executor) → started_notified → executor COMPLETED → REPORT → report reply` all proven live (§9.2); `secrets_exposed = false` (token in no file, log, task, report or reply) |

## 8. Existing bot `othoth77/telegram-bot` — inspection and integration plan (2026-09-05, design only)

Inspected read-only (public repository, 4 files, 16 commits on 2026-05-11, last push 2026-09-02). The committed
token was never used, printed or copied; the local inspection copy was deleted after reading.

### 8.1 Capabilities of the existing bot (`bot.py`, 197 lines, pyTelegramBotAPI, Python 3.11)
- `/start` greeting (French); **photo → Tesseract OCR (fra+eng) → invoice field extraction** (supplier, client,
  invoice number, description, HT/TVA/TTC amounts, currency TND/EUR) → `append_row` to one Google Sheet → summary reply;
- **any text message → appended as a row to the same sheet** (date, first name, text) → "Message enregistré" reply;
- transport: `bot.polling(none_stop=True)` (long polling, same mechanism as the MYTHOS adapter);
- packaging: Dockerfile (python:3.11-slim + tesseract) for an external PaaS (a `Nixpacks.TOML` was added then removed).
  **It is not deployed on this VPS** (no container, no Coolify application, no systemd unit references it).

### 8.2 Security problems found
1. **BotFather token hard-coded in `bot.py` line 17 and public in Git history** (present in 5 historical blobs, one
   distinct value). Treated as compromised: anyone can read the bot's messages, send as the bot, and take over polling.
   Rotation with @BotFather is mandatory; a rotation invalidates every copy, including the running one if any.
2. **No sender allowlist at all**: every Telegram user who finds the bot can write rows into the Google Sheet and
   trigger OCR work (cost/abuse surface).
3. **Google service-account credentials taken from `GOOGLE_CREDENTIALS` and written to a temp file that is never
   deleted** (`delete=False`, no cleanup) → the private key persists on the container filesystem.
4. `SHEET_ID` hard-coded; exceptions echoed back to the user verbatim (`❌ Erreur: {e}`) → internal details leak;
   `print()` of full OCR text and errors to stdout (invoice content in platform logs).
5. Unpinned dependencies (`requirements.txt` has no versions); no tests; no README.
6. Media download builds a URL containing the token (`api.telegram.org/file/bot<TOKEN>/…`) and logs errors with
   `str(e)`, which can include that URL.

### 8.3 Can the same bot become the MYTHOS Telegram channel?
**The bot *identity* can be reused; the bot *code* must not be.** Telegram allows exactly one poller per token, and
the MYTHOS adapter already implements the transport (`getUpdates`), the allowlist, the secret scrubbing and the control
TASK boundary in node with zero dependencies. Running `bot.py` alongside would fight the adapter for updates (HTTP 409
"terminated by other getUpdates request") and would keep problems 2–6 alive. Therefore:

| Element | Decision |
|---|---|
| BotFather bot identity (username, chat history with the owner) | **reuse**, after token rotation |
| `bot.py` polling loop, handlers, Google Sheets connection, `TOKEN`, `SHEET_ID`, `GOOGLE_CREDENTIALS` | **not reused, not copied** |
| Invoice OCR/extraction logic (`analyser_image_tesseract`, `extraire_donnees_facture`) | **kept isolated**; candidate for a later, separate `photo` capability of the adapter (needs its own owner decision, a governed executor task, and no Google Sheets credential in MYTHOS) |
| Text-message-to-sheet logging | **dropped**: MYTHOS records the task on the control branch and in OTHMODE instead |

Exact files reused from `othoth77/telegram-bot`: **none**. The only thing carried over is the bot identity.

### 8.4 Exact MYTHOS integration point
`projects/mythos-ai-executor/bridge/telegram.js` `intake()` — Bot API `getUpdates` → `normalizeUpdate()` → allowlist →
`messageToTask()` → `control/tasks/tg-<update_id>.json` → the unchanged `github-bridge.tick()` (Governance gates, OTHMODE
record, executor) → `notify()` → `sendMessage` to the origin chat. Configuration enters only through the
`MYTHOS_TELEGRAM_*` environment (drop-in template `bridge/systemd/mythos-github-bridge.service.d/telegram.conf.example`).

### 8.5 Changes required (none of them in production yet)
1. **Owner:** rotate the token with @BotFather (`/revoke` or `/token`), which kills the exposed one everywhere.
2. **Owner:** store the NEW token only on the VPS at `/home/deploy/mythos-ai-executor/secrets/telegram-bot.env`
   (`MYTHOS_TELEGRAM_BOT_TOKEN=<NEW_TOKEN>`, owner `deploy`, mode 0600). Never in Git, Issues, chat or reports.
3. **Owner:** stop any external deployment still running `bot.py` (it would 409 against the adapter and it still
   holds the old token in its image layers); optionally make `othoth77/telegram-bot` private and purge the token
   from history — rotation is what actually closes the exposure, history rewriting is hygiene.
4. **Owner:** supply the numeric Telegram user id for `MYTHOS_TELEGRAM_ALLOWED_USER_IDS`.
5. **Branch (already done, 30cd40c):** adapter, CLI, schema, tests, drop-in template. No code change is needed to
   adopt the existing bot identity: the adapter is bot-agnostic and reads only `getUpdates`/`sendMessage`.
6. **Later, separately:** if invoice OCR is wanted inside MYTHOS, add a `photo` update kind to `normalizeUpdate()`
   that turns the image into a governed READ task (OCR by the executor), never into a direct Google Sheets write.

### 8.6 Tests required
- Already in `tests/mythos-telegram-channel-test.js` (62): normalisation, malformed, missing token, redaction,
  allowlist, mocked full flow, CLI, WhatsApp untouched.
- Add before the live test: (a) a token-file permission check in `describe()` (refuse a token file that is not 0600 /
  not owned by the running user) with a test; (b) a `photo` update is reported as `skip_malformed: no text` (covered by
  §2 today; keep it explicit once a photo path exists); (c) a 409-conflict test (`TELEGRAM_API_409` → intake deferred,
  offset not advanced) so a leftover external poller is diagnosed, not retried blindly.

### 8.7 Live E2E prerequisites
1. Rotated token in `/home/deploy/mythos-ai-executor/secrets/telegram-bot.env` (0600, deploy) — `telegram-config`
   must report `token_present: true`, `ready: true`; `telegram-check` must return the bot username.
2. `MYTHOS_TELEGRAM_ALLOWED_USER_IDS` = the owner's numeric id.
3. No other process polling the bot (`telegram-check` succeeds and a dry-run `telegram-tick --no-bridge --dry-run`
   returns updates without a 409).
4. Executor daemon healthy (`/health` ok) — it is, as of 2026-09-05 00:24 UTC.
5. One READ-style message from the owner; the sequence in §5 of this document, run from the branch worktree as
   `deploy`; no unit restart, no drop-in installation, no merge.

### 8.8 Blocker
The rotated token does not exist on the host yet (owner action; cannot be requested through chat).

## 9. Bot identity transfer + live E2E (2026-09-05, owner-approved)

### 9.1 Webhook removal (owner approval recorded in the session; bot `@Othoth77_bot`, id 7598630137)

The bot identity was registered with an external webhook integration; long polling (`getUpdates`) cannot coexist
with a webhook, so the owner explicitly approved removing it. Every call below was made once, with the token read
from `~deploy/mythos-ai-executor/secrets/telegram-bot.env` (deploy, 0600) and never printed.

| Step | Bot API call | Result (verbatim, token-free) |
|---|---|---|
| 1. audit record before | `getWebhookInfo` 2026-09-05T01:45:32Z | `url: "https://webhook.sherlock.st/c/1991ae12-9db9-48c8-b34f-7e485b9cd0dc/7598630137"`, `has_custom_certificate: false`, `pending_update_count: 0`, `max_connections: 100`, `ip_address: "172.67.70.125"`, `allowed_updates: ["message","channel_post"]` |
| 2. removal | `deleteWebhook {"drop_pending_updates": false}` 2026-09-05T01:45:51Z | `ok: true, result: true, description: "Webhook was deleted"` — pending updates NOT dropped (there were 0) |
| 3. verification | `getWebhookInfo` 2026-09-05T01:46:34Z | `url: ""`, `pending_update_count: 0` — no webhook registered |
| 4. `telegram-config` (deploy, branch worktree) | — | `ready: true`, `token_present: true`, `token_source: "file"`, `allowed_user_ids: 1`, `problems: []` |
| 5. `telegram-check` | `getMe` | `ok: true, bot_id: 7598630137, username: "Othoth77_bot"` |
| 6. `telegram-tick --no-bridge --dry-run` | `getUpdates` | `ok: true`, `fetched: 0`, `api_calls: 1`, no HTTP 409 → no other poller, no webhook conflict |
| 7. offline suite | `tests/mythos-telegram-channel-test.js` | **66 passed, 0 failed** (as deploy, before the live test) |

Production untouched during the transfer: `mythos-github-bridge.timer` active (runs `tick` from the main checkout,
which has no Telegram code), `mythos-ai-executor.service` active, `/health` ok at 01:45 UTC; no unit reloaded or
restarted, no drop-in installed, WhatsApp drop-in unchanged.

### 9.2 Live E2E result (2026-09-05, one private message from user 5005015506, text "test mythos")

| Gate | Evidence (verbatim from Meta-free sources: control branch, bridge `events.log`, executor `events.log`) |
|---|---|
| telegram_received | `getUpdates` → update_id **611867278**, message_id 192, chat_id = user_id = 5005015506, message_date 2026-09-05T01:52:04Z; dry run reported `would_create tg-611867278` (nothing written) |
| normalised control TASK | `control/tasks/tg-611867278.json`, `created_by: telegram:5005015506`, `source.kind: telegram`, content_sha256 `177a3d0e…b6e5`, resolution `default → investigate → repo-read (server-side map)`; control commit `4dc7f7f8` (`control: telegram → tg-611867278`); queued reply message_id **193** at 01:54:08.740Z |
| GitHub/control bridge | unchanged `github-bridge.tick()` from the branch worktree (runtime head `06021f43`, verified, not stale): claim `tg-611867278#1`, fence 5553, control commit `f08aac7f`; the same tick also acknowledged the pre-existing CANCELLED state of `gh-issue-164` (`cancelled_before_claim`, no file of that task changed) |
| Governance / OTHMODE | `OTH-2026-00172` created at claim (actor `github-bridge`, command `othmode tg-611867278: Test mythos`, activation `othmode`, RUNNING) |
| executor | `t-20260905015410-5s8mok` created 01:54:10Z QUEUED (model auto → claude-haiku-4-5, `mcp_capabilities_resolved: allowed []`); started reply message_id **194** at 01:54:11Z; waited behind the running `gh-issue-173` (`t-20260905014252-3igcmy`, single-slot daemon — no supported pause/defer exists, nothing was touched); RUNNING 02:14:03Z (execution x-mtnr1kuq) → COMPLETED 02:15:27Z |
| REPORT | written by the production 1-minute tick at 02:15:51Z: `control/reports/tg-611867278.{json,md}`, status COMPLETED, `Git verified: true`, commits none (READ task), control commit `0b29505f`; `OTH-2026-00172` closed COMPLETED 02:15:51.053Z by the bridge; production bridge also queued its usual WhatsApp ledger entry `tg-611867278__COMPLETED` (gateway HTTP 500, breaker open — pre-existing, nothing delivered) |
| Telegram reply | `telegram-tick` (branch worktree, 02:16:06Z, after the production tick released the bridge lock): `notify report` → `sendMessage` message_id **195**, control commit `b9c5b40e`; `telegram-status`: status COMPLETED, report_file `control/reports/tg-611867278.json`, notifications {queued 193, started 194, report 195}; `trail tg-611867278`: `found: true`, `Git verified` |
| tests after the live run | `tests/mythos-telegram-channel-test.js` **66 passed, 0 failed** (as deploy) |
| gh-issue-173 intact | completed on its own at 02:13:54Z (executor `t-20260905014252-3igcmy` COMPLETED, OTHMODE `OTH-2026-00171` COMPLETED, report with 2 commits) — not cancelled, not deferred, not edited |
| secrets | token read only from the 0600 file; appears in no task file, report, reply, `events.log` line or CLI output (`telegram-check` prints id/username only) |
| production | no unit restarted or reloaded; no drop-in installed; timer + executor daemon ran throughout; bridge lock serialised the worktree ticks with the production ticks (one attempt refused with `another bridge process holds the lock`, retried) |

**Final classification: COMPLETE.** Remaining owner steps to make the channel permanent: install
`bridge/systemd/mythos-github-bridge.service.d/telegram.conf.example` as a drop-in with
`MYTHOS_TELEGRAM_ALLOWED_USER_IDS=5005015506` and `daemon-reload` (§6), and merge this branch so the production
checkout carries `bridge/telegram.js`; until then the channel only runs when `telegram-tick` is invoked from this worktree.

### 9.3 Production activation (2026-09-05, owner instruction "Activate Telegram Lifecycle Notifications")

Owner-facing message format (decision recorded here; enforced by `queuedText` / `startedText` / `reportText` and the
suite): **task id + state + short description + result / what is needed**, the Claude model name when the executor
recorded one, and the MYTHOS guard only *described* ("guard: MYTHOS protection/monitoring active"). Executor task ids,
execution ids, OTHMODE numbers and host / report paths never appear in a chat message; the full correlation stays in
`source.notifications`, `telegram-status` and `trail` for the operator. Suite: **68 passed, 0 failed** (66 + 2
negative assertions on the reply texts).

Pre-merge host state, verified as `deploy` from this worktree with the drop-in environment: drop-in
`mythos-github-bridge.service.d/telegram.conf` present and loaded by the live unit (`MYTHOS_TELEGRAM_ENABLED=1`,
`MYTHOS_TELEGRAM_ALLOWED_USER_IDS=5005015506`, token bound by file reference); `telegram-config` → `ready: true,
problems: []`; `telegram-check` → bot 7598630137 `@Othoth77_bot`; `getWebhookInfo` → `url: ""` (no webhook, polling
only, `pending_update_count: 1`); `telegram-status` → `tg-611867278` COMPLETED, replies 193/194/195; executor daemon and
bridge timer active. Nothing restarted, no WhatsApp file touched.

Activation path = the governed one: this branch is delivered by the root relay (`refs/heads/mythos/*`), PR #175 is
merged on GitHub under the owner's explicit instruction, then the production checkout is fast-forwarded to
`origin/main` so the 1-minute timer runs the Telegram phases from `main`. The single pending update is the smallest
possible live test (no extra test message is sent).

## 10. Unified event notifications (gh-issue-187, 2026-09-05) — implemented and tested, not yet activated

**Objective:** extend the Telegram channel above from "per-chat replies for a task that started on Telegram" into
the single outbound notification surface for every important MYTHOS/GitHub event, regardless of origin — a GitHub
Issue/task, a pull request, or the bridge/governance layer itself — with importance filtering, deduplication, rate
limiting and one unified message format, without touching WhatsApp, without expanding the allowlist, and without a
second bot.

**New modules (Phase 2):**

| File | Role |
|---|---|
| `bridge/notify/telegram-events.js` | The engine: importance filter (`EVENT_DEFS`), per-(event,key) dedup ledger, sliding-window rate limiter that critical events (failure/blocker/governance) always bypass, the unified `formatEvent()`, and `stripInternal()` — a defense-in-depth scrub of executor task ids, OTHMODE numeric ids, execution ids and filesystem paths, on top of the existing token/secret redaction. Reuses `bridge/telegram.js`'s own `config()/readToken()/createClient()/scrub()` — same bot, same token, same `MYTHOS_TELEGRAM_ALLOWED_USER_IDS` allowlist — and broadcasts to every allowlisted id (these are system events, not a reply to one chat). |
| `bridge/pr-watch.js` | Read-only pull-request poller (reuses `github-issues.js`'s REST client, extended with `listPulls/getPull/listReviews/getCombinedStatus`; no new credential). Detects: opened, ready-for-review/retitled ("updated"), a review (approved/changes requested), a checks/status conclusion (`checks` / critical `checks_failed`), merged, closed without merge, and a merge conflict (`mergeable_state === 'dirty'`, fetched from the single-PR endpoint since the list endpoint does not reliably carry it). State: `MYTHOS_BRIDGE_HOME/pr-watch/state.json`. Disabled by default — `MYTHOS_PR_WATCH_ENABLED=1` required, the same opt-in posture as Issues/Telegram before it. Never merges, comments, labels or closes a pull request. |
| `bridge/gov-notify.js` | Tails the one shared, append-only `events.log` that the bridge, Issues adapter and Telegram adapter already write to (`bridge.log()`), by byte offset, for a small watch-list (`sync_failed`, `blocked_preflight`, `lock_takeover`, `claim_failed`, `report_failed`, `lease_expired`, `issues:phase_error`, `pr-watch:fetch_failed`) → `git:sync_blocker` / `git:governance_blocker` / `git:bridge_failure`. Deduplicated by `(event, reason)` so a standing problem is announced once, not every tick, while a genuinely different failure is never swallowed. The `telegram:`/`telegram-events:` namespaces are deliberately excluded from the watch-list — a Telegram delivery problem cannot reliably be reported over Telegram, and including it would risk a feedback loop. One new one-line log call was added at the bridge's existing `sync.ok` check (`bridge/github-bridge.js`) so a control-branch sync failure is observable at all; no other bridge logic changed. |

**Wiring into the existing adapters (`bridge/github-issues.js`):** four call sites inside the already-existing
`intake()`/`notify()` phases — where the adapter already knows a task was created, claimed, or reached a terminal
report state (COMPLETED/FAILED/BLOCKED/HUMAN_APPROVAL/CANCELLED) — now also call the unified notifier. Every call is
wrapped so a Telegram outage or misconfiguration can never affect Issue/task processing (`notifyTelegram()` always
resolves). HUMAN_APPROVAL is exactly the existing "owner intervention" presentation state
(`bridge/github-issues.js`'s `issueStateOf()`), so it is covered without new detection logic. This satisfies
gh-issue-187 §1 (create/claim/complete/fail/blocker/owner-intervention, with the first lines of `report.tests`
carried as `result`) without duplicating the Issue-comment logic — it is the same state transitions, one more sink.

**Unified format** (`formatEvent()`): `MYTHOS <TASK|PR|SYSTEM>: <event> <id> (<status>)`, then the title/summary, then
optional `result:` / `next:` lines, then `model <x>` and, only when relevant, `guard: MYTHOS protection/monitoring
active` (OTHMODE is never named, matching the existing per-chat lifecycle texts). No executor task id, execution id,
OTHMODE numeric id or filesystem path ever reaches the text — proven in `tests/mythos-telegram-events-test.js` §1 and
§4 by regexing the actual Telegram-bound strings, not just by code inspection.

**Tests (Phase 4) — `tests/mythos-telegram-events-test.js`, 52/52, offline, two in-process fakes (GitHub REST +
Telegram Bot API), no real token, no real message:**

| # | Coverage |
|---|---|
| 1 | unified formatter + `stripInternal()` (pure) |
| 2 | deduplication: an identical (event, key) is never sent twice |
| 3 | rate limiting: routine events throttled past the configured cap; a critical event still gets through |
| — | redaction: a secret-shaped string inside free text is scrubbed, the event is still delivered (not silently dropped) |
| 4 | GitHub Issue → Telegram, end to end through `issuesTick()`: created → claimed → completed, one message each, an unchanged re-tick sends nothing new, a BLOCKED (MODEL_UNAVAILABLE) task is notified even with the rate window artificially filled |
| 5 | pull-request lifecycle against the fake GitHub API: opened → review (approved) → checks_failed → conflict → merged for PR #1, and opened → closed_without_merge for an independent PR #2 |
| 6 | `gov-notify` against a synthetic `events.log`: a governance blocker and a bridge failure are notified once each; an identical repeat is deduplicated; a `telegram:` log line is never notified (no feedback loop) |
| 7 | disabled by default (`MYTHOS_TELEGRAM_ENABLED` unset) is a strict no-op; `describe()` never leaks the bot token |

Regression, same host state as this stage's other work: `mythos-telegram-channel-test.js` 68/68,
`mythos-github-issues-test.js` 208/208, `mythos-github-bridge-test.js` 150/150,
`mythos-bridge-whatsapp-notify-test.js` 131/131, `mythos-bridge-whatsapp-resilience-test.js` 101/101,
`model-selection-policy-test.js` 81/81, `mythos-bridge-push-guard-test.js` 23/23,
`mythos-github-bridge-timer-test.js` 16/16, `mythos-governance-invariant-test.js` 111/111,
`mythos-n8n-bridge-test.js` 80/80, `redact-governance-false-positive-test.js` 199/199,
`whatsapp-gateway-verify-test.js` 24/24, `bridge-action-resolution-test.js` 88/88 — all unchanged and passing.
`tests/mpi-0-finalization-governance-test.js` shows 3 pre-existing, unrelated failures (skill-registry directory
count drift under `.claude/skills/`) present before this stage and outside its scope; not investigated further here.

**CLI (`bin/mythos-github-bridge`):** `pr-watch-tick [--dry-run]`, `pr-watch-status`, `gov-notify-tick [--dry-run]`,
`gov-notify-status`, `notify-events-status`. The combined `tick` runs `pr-watch-tick` (when
`MYTHOS_PR_WATCH_ENABLED=1`) and `gov-notify-tick` (when `MYTHOS_TELEGRAM_ENABLED=1`) strictly after the
bridge/Issues/Telegram phases have returned — read-only against the control branch, best effort, never affecting
`tick`'s own exit code, exactly like the existing WhatsApp flush.

**Security (gh-issue-187 §6):** no bot token, API key, executor id, execution id, OTHMODE numeric id, or internal
path is ever placed in a notification — `stripInternal()` plus the existing token/secret scrub, proven by regex
assertions against the actual fixture-captured Telegram text in the test suite above, not by code reading alone.
OTHMODE is described only as "MYTHOS protection/monitoring", identical to the existing per-chat lifecycle texts.

**Scope not covered (recorded, not silently dropped):**
- PR "important update" is scoped to ready-for-review and a retitle; a plain new commit on an open PR does not
  notify, to avoid per-push spam — not explicitly required by gh-issue-187 and consistent with its anti-spam goal.
- `git:deploy` is defined in `EVENT_DEFS` for a future deployment-event source but nothing calls it yet — there is no
  existing deployment-event emitter in this repository to hook into without inventing one, and doing so was judged
  out of scope for a notification-channel stage.
- **Production activation is a separate owner step**, exactly like §9.3 above: this stage is implementation +
  automated tests only. `MYTHOS_PR_WATCH_ENABLED` is a new opt-in flag (unset in production today, so pull-request
  polling does not start on its own); the task/Issue and git/governance notifications activate together with the
  existing `MYTHOS_TELEGRAM_ENABLED=1` drop-in once this branch reaches `main` — no additional drop-in is required
  for those two, only for `MYTHOS_PR_WATCH_ENABLED` if the owner also wants pull-request notifications live.
- A real GitHub→Telegram live smoke test (an actual Issue/PR event observed in the owner's chat) was not run from
  this task: it would require either waiting for a real Issue/PR event during this session or manufacturing one
  against the real repository, and the bridge constraints for this task forbid pushing or merging. The offline
  fixture suite (§ above) is the verification performed; a live check is the natural first step after this branch
  merges, mirroring how §9.2 above validated the original channel.

## Presentation (2026-09-05, gh-issue-191)

Lifecycle report replies and the unified event notifier render through the shared
`bridge/notify/presenter.js` (same short owner-facing format as WhatsApp, simple Arabic
explanation, explicit owner action, no report path in a chat reply). The channel itself
remains **disabled** (`MYTHOS_TELEGRAM_ENABLED=0`); tests are offline regression only.
See `docs/MYTHOS_NOTIFICATION_PRESENTER.md`.
