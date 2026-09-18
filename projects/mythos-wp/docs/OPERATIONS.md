# MYTHOS WP V2.1 — Operations

Day-2 procedures. Companion: `DEPLOYMENT.md`, `ENVIRONMENT.md`, `WHATSAPP_SETUP.md`, `AI_AGENTS.md`, `PROJECTS.md`, `TROUBLESHOOTING.md`; repo-level runbook `docs/MYTHOS_COMMUNICATION_OS_OPERATIONS.md` (onboarding, pairing, shared routing order of operations).

In the panel, everything operational sits under **Settings**: **Users**, **Integrations**, **Automations** (admin), **System** (Health, Audit, Backup, AI runs). Every command below runs as `deploy` with the production environment loaded, from the app root of the production checkout:

```bash
set -a; . /home/deploy/deployments/mythos-wp/.env; set +a
cd /home/deploy/worktrees/mythos-wp-main/projects/mythos-wp
```

## 1. CLI — `bin/mythos-wp` (never prints a secret)

| Command | What it does |
|---|---|
| `check-env` | which DB variables, users file and comms config are present (names only); also names any legacy `MYTHOS_WP_CATALOG_*` variable still set (unused since V2.1) |
| `migrate status \| up \| down <version>` | additive migrations (`DEPLOYMENT.md` §7) |
| `users import` | 0600 users file → `wp_users` (existing names untouched, `all_projects = true`) |
| `users add <username> <role> [--display "Name"] [--all-projects]` | create/update an account; password from stdin or `MYTHOS_WP_NEW_PASSWORD` (≥ 12 chars) |
| `users list` | accounts (no hash) |
| `users grant <user> <project>` / `users revoke <user> <project>` | `wp_user_projects` |
| `set-password <users.json> <username> <role>` · `remove-user` · `list-users` | the bootstrap file (break-glass) |
| `seed-project <id> <display_name> <domain\|-> <brand_car\|-> [catalog_dsn_env\|-] [catalog_schema\|-]` | upsert a project row by hand (the panel's **New project** form is the normal path; the two catalogue arguments are legacy — leave them `-`) |
| `reserve-account <digits> [reason]` | `wp_reserved_accounts` — the notification account no inbox may claim (done once per host) |
| `comms reconcile [--threshold-min N]` | §4 |
| `comms heartbeat` | §4 |
| `comms replay-list` · `comms replay <event_id> [--apply] [--actor name]` | §4 |
| `comms route list <project> [--inbox ID]` | routing rules of a project (identity tails only) |
| `comms route add <project> --inbox ID --kind allowlist\|opt_in\|keyword\|default --identity <kind>:<value> [--code C] [--ttl-hours H] [--priority N] [--note …]` | keyword: `--identity entry:<token>`; default: no identity |
| `comms route enable\|disable <project> <rule_id>` · `comms route drops [--limit N]` | |
| `comms route shared-inbox <project> --instance I --account-ref DIGITS --display-name NAME --allow-personal-account` | explicit, audited shared inbox on a personal/reserved account (refused without the flag) |

Service: `systemctl --user status|restart mythos-wp.service`, `journalctl --user -u mythos-wp.service -f` (JSON lines; never a body, cookie, token or message text).

## 2. Users and roles

Roles viewer < agent < manager < admin < owner (`SECURITY.md` §3). UI **Settings → Users** (admin; owner for owner accounts): **New user** (owner; `POST /api/r/users`), **Edit** role / status / display / all-projects (owner), **Password** (`POST /api/users/:u/password`, admin; owner for an owner), **Projects** (`GET/PATCH /api/users/:u/projects`, admin). The same table, filtered to one project, is **Project → Members**. Rules: only an owner creates an owner or changes their own role; nobody deletes their own account; a disabled account cannot log in even if still in the users file.

Break-glass: if `wp_users` is unusable, the 0600 users file still answers logins (`all_projects`); keep one owner there (`set-password`), 0600, outside git.

## 3. Health — Settings → System → Health

`GET /api/health/center` (any) → the last known state per component (`wp_health_checks`, `DISTINCT ON (component)`), `summary { ok, warning, error, disconnected }`; `POST /api/health/run` (manager) → runs every check now and persists it — the **Run checks** button. Scheduler every `MYTHOS_WP_HEALTH_INTERVAL_MS` (default 5 min; `0` = off); first run 5 s after boot; the table keeps the last 2000 rows. The card lists Component · Status · Detail · Last check.

| Component | Check | ok | warning | error / disconnected |
|---|---|---|---|---|
| `database` | `SELECT 1` | latency | | query failed |
| `backend` | this process | rss ≤ 768 MiB → version, node, uptime, rss, pid | rss > 768 | |
| `receiver` | `receiver.describe()` | enabled + token file present | `RECEIVER_DISABLED` | `WEBHOOK_TOKEN_MISSING` |
| `whatsapp:evolution` (and `whatsapp:<key>` for other enabled providers) | `integrations.probe` | instances / open count | | `UNAUTHORIZED`, unreachable |
| `number:<instance>` | `provider.health({ instance })` per `wp_phone_numbers` row; also updates the row's `status` / `health_state` | `open` | `connecting`, `pairing`, `unknown` | `closed`, `unreachable` |
| `kitchen:<key>` | `/api/health` | status + counts | | HTTP error / unreachable |
| `ai` | free-LLM registry | ≥ 1 keyed provider | `NO_PROVIDER_KEY` / registry unavailable | |
| `integration:<key>` (n8n, mcp, api, …) | HTTP GET | reachable | | unreachable |

The legacy `GET /api/health` (any) still returns the process summary (db, users provisioned, session TTL, comms config). `GET /healthz` is the public liveness for nginx. The old `#/health` link redirects to Settings → System.

## 4. Reconcile, heartbeat, replay (`comms/reconcile.js`)

```bash
node bin/mythos-wp comms reconcile --threshold-min 15   # outbound rows still queued/sent after N min → ONE delivery.alarm (ack_alarm_at); never resends
node bin/mythos-wp comms heartbeat                      # every non-inactive inbox → provider.health → heartbeat_state ok|stale|unreachable (audited on change)
node bin/mythos-wp comms replay-list                    # failed/rejected deliveries whose redacted payload was kept and not yet replayed
node bin/mythos-wp comms replay <event_id>              # dry-run: PARSE:…, NOT_A_MESSAGE, <routing reason>, INBOX_INBOUND_DISABLED or WOULD_INGEST
node bin/mythos-wp comms replay <event_id> --apply      # re-ingest once (idempotent by provider id); refused a second time; audited
```

Replay honours the current routing decision. Owner scheduling: reconcile and heartbeat are safe every 5–10 min from a deploy-user timer; they change no provider state. Note: the CLI path registers only the Evolution provider for the heartbeat; a `meta_cloud` inbox is probed by the health center (which loads the provider module by name), not by `comms heartbeat`.

## 5. Numbers and links (summary — full text in `WHATSAPP_SETUP.md`)

1. **WhatsApp → Sync all** (admin): discovers Evolution instances, statuses, digits, webhook state. The table shows Number · Status · Projects · Connection (Receiving / Not receiving) · AI · Last message.
2. **Check** a number (manager) for a live provider state.
3. **Link to project** (admin): *This project only* (`dedicated`) or *Shared between projects* (`shared`, + routing rules under WhatsApp → Advanced before switching Receiving on). Or from the project: **Project → WhatsApp → Link a number**.
4. Switches per link (**More** on the number row, or Project → WhatsApp): **Receiving** (`inbound_enabled`, persist), **Replies** (`outbound_enabled`, human / AI replies), **AI** (`ai_mode` inherit / off).
5. WhatsApp → Advanced → Routing rules: **Simulate routing** (manager) before and after every rule change; **Recent routing drops** (admin) to see what was refused and why.

## 6. Inbox work (agent+)

`#/inbox`: left column **Conversations | Contacts**, search (name, number, text), a project select when *All projects* is chosen, filters **All · Unread · Human · Waiting · Closed**. Centre: the timeline (`GET …/messages`), reply (`POST …/messages { text, client_ref }` — 412 until the inbox is open and Replies is on, 429 above the hourly cap), retry a failed send, mark read, AI suggestions (accept / edit / reject), **Take over (AI → Human)** / **Hand back to AI**. Right column — the customer panel: name, phone (masked), project, tags, assigned to, handled by (AI / Human), notes (activity rows, never sent), **Open contact**; under **Advanced**: status / priority (`PATCH`), number, routed by, language, last intent, first / last seen, summary, conversation id, handoff history. Live feed: SSE `GET /api/projects/:p/comms/events` (types + ids only).

**Contacts** (second tab of the Inbox, `#/contacts`): cross-project list grouped by phone identity (`GET /api/contacts?q=&project=&limit=`, scoped to the caller's projects, masked unless admin); a contact opens the 360 in the centre column (`#/contacts/360/:phone`, `GET /api/contacts/360/:digits`: identity, projects, conversations, notes; timeline of events / AI runs / handoffs and counters under Advanced — no message text) — `comms/contacts360.js`. Notes: `GET/POST /api/notes` (agent), `DELETE /api/notes/:id` (agent route; the handler allows the author or manager+).

## 7. AI (admin)

Day to day: **Project → AI** — Agent, Mode (Off / Suggest / Auto), Status, **Test AI** (`PROJECTS.md` §5). Agents themselves: **Project → Advanced → AI agents** (cards: New agent, Bind, Open → the agent page with Edit / Bind to project / Delete). Runs: **Settings → System → AI runs** (project picker) or Project → Advanced → AI runs (`GET /api/ai/runs`). Knowledge `#/r/knowledge`, tools registry `GET /api/ai/tools`, `GET /api/ai/status` (engine availability, LLM providers with `credential_present`, agent counts).

Turning auto mode on: agent `mode = auto` **and** Project → AI mode Auto (or never set) **and** the number link's AI switch on (`inherit` / `auto`) **and** inbox open + Replies on; verify with one real message and watch `wp_ai_runs` / `wp_ai_suggestions.status = sent`. Kill switch: Project → AI → **Off** (that project), the **AI** switch of one number link, or the agent's own mode / status (every project). Precedence: `AI_AGENTS.md` §2.

## 8. Automations — Settings → Automations (admin; `reference/automations.js`)

`wp_automations`: `trigger` ∈ `conversation.created | message.received | conversation.inactive | handoff.requested`, `conditions { keywords:[…] (case-insensitive substring), inbox_id, handler:'ai'|'human', status, inactive_minutes }`, `actions [{ type: assign_agent { agent_id | agent:'project_default' } | assign_user { username } | tag { name } | set_status { status } | handoff { reason } | ai_suggest | ai_reply | n8n_webhook { path, include_text? } | note { text } }]`, `enabled`, `position` (order), project-scoped or global (`project_id NULL`). The page: a project picker, the table (On switch, Name, Scope, Trigger, Conditions, Actions, Runs / Edit / Delete), **New automation** (drawer editor), and **Recent runs**. The same panel, fixed to one project, is **Project → Advanced → Automations**. The old `#/automations` link redirects here.

Seeded (global, enabled): "Route new conversation to the project agent" (`conversation.created` → `assign_agent project_default`), "Customer asks for a human" (`message.received`, keywords human / humain / agent / conseiller / personne / شخص / بشري / عون → `handoff CUSTOMER_REQUESTED_HUMAN`), "Answer with the project agent" (`message.received`, `handler:'ai'` → `ai_reply`, skipped with a reason unless the effective mode is `auto`).

API: `GET /api/automations?project=` (any; rows carry `runs_24h`), `POST` / `PATCH /:id` / `DELETE /:id` / `POST /:id/enable|disable` (admin), `GET /api/automations/:id/runs`, `GET /api/automation-runs?project=&limit=` → `wp_automation_runs` (`result ok | skipped | error`, `detail` = per-action outcomes and reasons, never message text; an action whose module is missing is `skipped` with `MODULE_UNAVAILABLE`). Validation: `inactive_minutes` 5–43200 and required for `conversation.inactive`; `n8n_webhook.path` is relative to `webhook_base`. Inactivity sweep every `MYTHOS_WP_AUTOMATIONS_SWEEP_MS` (default 10 min): conversations open/pending whose `last_inbound_at` is older than `inactive_minutes`, at most one run per automation + conversation per 24 h.

## 9. Templates, integrations, MCP

Templates: **WhatsApp → Templates**, `WHATSAPP_SETUP.md` §8. Integrations and probes: **Settings → Integrations**, `INTEGRATIONS.md` (`POST /api/integrations/:key/test`). MCP card and the owner OAuth step: `MCP.md`.

## 10. Audit, backup and search

**Settings → System → Audit** (`GET /api/r/audit?project=`; filters who / action / what / project; a project-scoped session must select a project), `GET /api/audit/:resource/:id` history of one record; per project: Project → Advanced → Audit. `#/audit` and `#/r/audit` redirect here.

**Settings → System → Backup** shows the dump command, the last known dump, the restore note and what no dump contains (`.env`, `users.json`, `webhook.token`); the procedure is `DEPLOYMENT.md` §5.

Global search (`GET /api/search?q=&project=`, the Ctrl / ⌘ K menu) returns **projects, conversations and contacts** only — plus navigation and the actions *New project*, *Sync WhatsApp numbers*, *Toggle theme*, *Sign out*. Numbers, agents, templates, integrations and products are found on their own pages.

## 11. Retention and erasure (owner-run, not automatic)

Retention windows are business rules (`wp_business_rules` key `comms.retention`); after the window `wp_messages.text` and `raw` are set to NULL and `redacted_at` stamped, attachments purged; rows and counters stay. Right to erasure: contact `status = merged | blocked` plus the same purge over its conversations. The receiver never deletes anything. Routing-drop hashes are personal data: purge `wp_routing_drops` with the same policy.

## 12. Routine checklist

| When | Do |
|---|---|
| daily | Settings → System → Health green; WhatsApp table all connected and *Receiving*; routing drops (WhatsApp → Advanced) not growing unexpectedly; Settings → Automations → Recent runs without errors |
| after any env change | `check-env`, restart, sign in again (sessions are in memory) |
| before enabling Auto on a project | Test AI, one real Suggest cycle, the agent's minimum confidence reviewed, hourly cap set |
| before sharing a number | rules added and simulated; personal numbers have identity rules only |
| weekly | `pg_dump` of `mythos_wp` (`DEPLOYMENT.md` §5); `comms reconcile`, `comms heartbeat`, `replay-list` |

## Backups (scheduled since 2026-09-18)

`mythos-backup-db-wp.timer` runs daily at 05:20 UTC: root capture (`docker exec … pg_dump -Fc mythos_wp`) →
deploy stage → manifest → verify-local → push to R2 (`mythos-wp/daily`) → verify-remote.
`mythos-backup-db-verify-wp.timer` re-verifies the remote set daily at 16:19 UTC. Health record:
`/home/deploy/mythos-backups/health/backup-health-db-wp.json`, watched by the Status Center probe `wp-backup`
(fresh < 26 h). Config: `/home/deploy/.config/mythos/backup-schedule-db-wp.env` (0600). Same pipeline as the
ERP and ssangyong_autos instances (`ops/backup/mythos-backup-run-db.sh`).

```bash
sudo systemctl start mythos-backup-db-wp.service                      # run a backup now
sudo -u deploy bash -c 'cd /home/deploy/projects/mythos-prod && MYTHOS_BACKUP_DB_CONFIG=/home/deploy/.config/mythos/backup-schedule-db-wp.env MYTHOS_BACKUP_HEALTH_FILE=/home/deploy/mythos-backups/health/backup-health-db-wp.json bash ops/backup/mythos-backup-run-db.sh restore-test'
```

## Connecting a WhatsApp number

WhatsApp → Numbers → **Connect** (admin) shows the live pairing QR. The terminal equivalent is
`ops/whatsapp/evolution/qr-live.sh <instance>`. Both refuse nothing on their own; the panel refuses a number
that is already connected so a click can never disturb a live session.
