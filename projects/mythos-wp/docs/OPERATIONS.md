# MYTHOS WP V2 — Operations

Day-2 procedures. Companion: `DEPLOYMENT.md`, `ENVIRONMENT.md`, `WHATSAPP_SETUP.md`, `AI_AGENTS.md`, `TROUBLESHOOTING.md`; repo-level runbook `docs/MYTHOS_COMMUNICATION_OS_OPERATIONS.md` (onboarding, pairing, shared routing order of operations).

Every command below runs as `deploy` with the production environment loaded, from the app root of the production checkout:

```bash
set -a; . /home/deploy/deployments/mythos-wp/.env; set +a
cd /home/deploy/worktrees/mythos-wp-main/projects/mythos-wp
```

## 1. CLI — `bin/mythos-wp` (never prints a secret)

| Command | What it does |
|---|---|
| `check-env` | which DB variables, users file, comms config and catalogue variables are present (names only) |
| `migrate status \| up \| down <version>` | additive migrations (`DEPLOYMENT.md` §7) |
| `users import` | 0600 users file → `wp_users` (existing names untouched, `all_projects = true`) |
| `users add <username> <role> [--display "Name"] [--all-projects]` | create/update an account; password from stdin or `MYTHOS_WP_NEW_PASSWORD` (≥ 12 chars) |
| `users list` | accounts (no hash) |
| `users grant <user> <project>` / `users revoke <user> <project>` | `wp_user_projects` |
| `set-password <users.json> <username> <role>` · `remove-user` · `list-users` | the bootstrap file (break-glass) |
| `seed-project <id> <display_name> <domain\|-> <brand_car\|-> [catalog_dsn_env\|-] [catalog_schema\|-]` | upsert a project row |
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

Roles viewer < agent < manager < admin < owner (`SECURITY.md` §3). UI Settings → Users (`#/r/users`, admin; owner for owner accounts): create (`POST /api/r/users`), edit role / status / display, `POST /api/users/:u/password` (admin; owner for an owner), `GET/PATCH /api/users/:u/projects` (admin). Rules: only an owner creates an owner or changes their own role; nobody deletes their own account; a disabled account cannot log in even if still in the users file.

Break-glass: if `wp_users` is unusable, the 0600 users file still answers logins (`all_projects`); keep one owner there (`set-password`), 0600, outside git.

## 3. Health center

`GET /api/health/center` (any) → the last known state per component (`wp_health_checks`, `DISTINCT ON (component)`), `summary { ok, warning, error, disconnected }`; `POST /api/health/run` (manager) → runs every check now and persists it. UI **Health**. Scheduler every `MYTHOS_WP_HEALTH_INTERVAL_MS` (default 5 min; `0` = off); first run 5 s after boot; the table keeps the last 2000 rows.

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

The legacy `GET /api/health` (any) still returns the process summary (db, users provisioned, session TTL, comms config). `GET /healthz` is the public liveness for nginx.

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

1. WhatsApp → Numbers → **Sync** (admin): discovers Evolution instances, statuses, digits, webhook state.
2. **Check** a number (manager) for a live provider state.
3. **Link** a number to a project (admin): `dedicated` (exclusive) or `shared` (+ routing rules before enabling inbound).
4. Project → Numbers → switches: `inbound_enabled` (persist), `outbound_enabled` (human/AI replies), `ai_mode` (inherit / off / suggest / auto).
5. Routing simulate (manager) before and after every rule change; routing drops (admin) to see what was refused and why.

## 6. Inbox work (agent+)

`#/inbox` (filters: all / unread / ai / human / waiting / closed / attention; project, number, agent, tag, text). Conversation pane: timeline (`GET …/messages`), reply (`POST …/messages { text, client_ref }` — 412 until the inbox is open and `outbound_enabled`, 429 above the hourly cap), retry a failed send, mark read, status / assignee / priority (`PATCH`), notes (activity rows, never sent), tags, AI suggestions (accept / edit / reject), **Take over (AI → Human)** / **Hand back to AI**, handoff history, contact panel. Live feed: SSE `GET /api/projects/:p/comms/events` (types + ids only).

Contacts: `#/contacts` = cross-project 360 list grouped by phone identity (`GET /api/contacts?q=&project=&limit=`, scoped to the caller's projects, masked unless admin), `#/contacts/360/:phone` (`GET /api/contacts/360/:digits`: per-project persons with tags / notes / memory, conversations, timeline of events / AI runs / handoffs — no message text) — `comms/contacts360.js`. Notes: `GET/POST /api/notes` (agent), `DELETE /api/notes/:id` (agent route; the handler allows the author or manager+).

## 7. AI agents (admin)

`#/ai`: agents (create, mode, engine, tools, bindings), runs (`GET /api/ai/runs`), knowledge (`#/r/knowledge`), tools registry, `GET /api/ai/status` (engine availability, LLM providers with `credential_present`, agent counts). Test an agent without a conversation: `POST /api/ai/agents/:id/test { project_id, text }` (manager). Turning auto mode on: agent `mode = auto` **and** inbox `ai_mode` `inherit`/`auto` **and** inbox open + `outbound_enabled`; verify with one real message and watch `wp_ai_runs` / `wp_ai_suggestions.status = sent`. Kill switch: agent `mode = off` (or `status = paused`), or inbox `ai_mode = off`.

## 8. Automations (admin; `reference/automations.js`)

`wp_automations`: `trigger` ∈ `conversation.created | message.received | conversation.inactive | handoff.requested`, `conditions { keywords:[…] (case-insensitive substring), inbox_id, handler:'ai'|'human', status, inactive_minutes }`, `actions [{ type: assign_agent { agent_id | agent:'project_default' } | assign_user { username } | tag { name } | set_status { status } | handoff { reason } | ai_suggest | ai_reply | n8n_webhook { path, include_text? } | note { text } }]`, `enabled`, `position` (order), project-scoped or global (`project_id NULL`).

Seeded (global, enabled): "Route new conversation to the project agent" (`conversation.created` → `assign_agent project_default`), "Customer asks for a human" (`message.received`, keywords human / humain / agent / conseiller / personne / شخص / بشري / عون → `handoff CUSTOMER_REQUESTED_HUMAN`), "Answer with the project agent" (`message.received`, `handler:'ai'` → `ai_reply`, skipped with a reason unless the effective mode is `auto`).

API: `GET /api/automations?project=` (any; rows carry `runs_24h`), `POST` / `PATCH /:id` / `DELETE /:id` / `POST /:id/enable|disable` (admin), `GET /api/automations/:id/runs`, `GET /api/automation-runs?project=&limit=` → `wp_automation_runs` (`result ok | skipped | error`, `detail` = per-action outcomes and reasons, never message text; an action whose module is missing is `skipped` with `MODULE_UNAVAILABLE`). Validation: `inactive_minutes` 5–43200 and required for `conversation.inactive`; `n8n_webhook.path` is relative to `webhook_base`. Inactivity sweep every `MYTHOS_WP_AUTOMATIONS_SWEEP_MS` (default 10 min): conversations open/pending whose `last_inbound_at` is older than `inactive_minutes`, at most one run per automation + conversation per 24 h.

## 9. Templates, integrations, MCP

Templates: `WHATSAPP_SETUP.md` §8. Integrations and probes: `INTEGRATIONS.md` (`POST /api/integrations/:key/test`). MCP rows and the owner OAuth step: `MCP.md`.

## 10. Audit and search

`#/audit` (`GET /api/r/audit?project=`; a project-scoped session must select a project), `GET /api/audit/:resource/:id` history of one record. Global search `GET /api/search?q=&project=` → groups contacts, phone numbers, conversations, projects, agents, templates, integrations, products (via each project's Kitchen) — command menu in the UI.

## 11. Retention and erasure (owner-run, not automatic)

Retention windows are business rules (`wp_business_rules` key `comms.retention`); after the window `wp_messages.text` and `raw` are set to NULL and `redacted_at` stamped, attachments purged; rows and counters stay. Right to erasure: contact `status = merged | blocked` plus the same purge over its conversations. The receiver never deletes anything. Routing-drop hashes are personal data: purge `wp_routing_drops` with the same policy.

## 12. Routine checklist

| When | Do |
|---|---|
| daily | Health center green; Numbers all `open` with `webhook_state ok`; routing drops not growing unexpectedly; `wp_automation_runs` errors |
| after any env change | `check-env`, restart, sign in again (sessions are in memory) |
| before enabling auto mode | agent test, one real suggest cycle, confidence_min reviewed, hourly cap set |
| before sharing a number | rules added and simulated; personal numbers have identity rules only |
| weekly | `pg_dump` of `mythos_wp` (`DEPLOYMENT.md` §5); `comms reconcile`, `comms heartbeat`, `replay-list` |
