# MYTHOS WP V2 — Architecture

Companion documents: `README.md`, `DEPLOYMENT.md`, `SECURITY.md`, `WHATSAPP_SETUP.md`, `AI_AGENTS.md`, `V2_BUILD_CONTRACT.md` (internal API contract). Repo-level history of the communication layer: `docs/MYTHOS_COMMUNICATION_OS_ARCHITECTURE.md`.

## 1. Shape

One Node process (`reference/server.js`), one PostgreSQL database (`mythos_wp`), loopback only, published by nginx. No framework, no bundler, no npm dependency other than `pg`. The browser loads ES modules directly under a CSP that forbids inline code.

```
browser (ES modules)  ──same-origin JSON, X-Requested-With: MythosWP, httpOnly cookie──►  server.js :8170
                                                                                          │
   /login /wp.css /brand/* /js/*   static map (nothing outside it is served)              │
   /healthz                        public liveness                                        │
   /hooks/<provider>               comms/receiver.js (token / HMAC, no session)           │
   /api/*                          api.js ROUTES  (+ routes/whatsapp.js, routes/ai.js, routes/platform.js)
                                     └─ session → role → CSRF → JSON body ≤ 256 KiB → handler → { ok, at, data }
```

Every mutation is audited (`audit.js` → `wp_audit_events`), every internal error is logged with a request id and never echoed, and no log line ever carries a body, a cookie, a token or a message text (`projects/mythos-orchestrator/lib/redact.js` on every log value).

## 2. Modules (reference/)

| Module | Role |
|---|---|
| `server.js` | HTTP server, static map, security headers, route dispatch, platform boot (`bootPlatform`: integrations/agents/automations defaults, automations bus attach + sweep timer, health scheduler) |
| `api.js` | route table: session, meta, health, generic resources (`/api/r/:resource`), users, project dashboard, Communication OS (conversations, messages, contacts, tags, SSE), providers, routing rules, receiver status, auto-reply status/simulate, audit history; concatenates the three V2 route modules |
| `api-util.js` | `projectFrom(req, params)` (resolves `?project=` / `:project` and enforces project access → 404), `accessibleProjects`, `auditFor`, `q` |
| `auth.js` | scrypt hashes, users file, `verifyCredentials` (wp_users first, file second), in-memory sessions (8 h absolute), CSRF check, login throttle, roles and ranks |
| `users.js` | `wp_users` / `wp_user_projects`: list, import from the users file, upsert, password, project grants |
| `resources.js` + `crud.js` | declarative registry (fields, validation, permissions, filters) → generic list/get/create/update/delete with audit. V2 registry: knowledge, rules, handoffs, inboxes (number ↔ project links), inbox_members, audit, projects, users, tags. **No catalogue resource exists any more** |
| `db.js` | one `pg` pool for `mythos_wp` (`MYTHOS_WP_DB_*`); `catalog()` (per-project catalogue pool named by `wp_projects.catalog_dsn_env`) is kept for rollback and unused by V2 |
| `migrate.js` | additive SQL migrations, one transaction each, ledger `wp_schema_migrations` |
| `audit.js` | `record()` (secret-shaped keys dropped, values redacted, bounded), `history()`; action vocabulary in `ACTIONS` |
| `kitchen.js` | read-only client of the MYTHOS AUTO Shared Kitchen, contract 1.3.0 (see §6) |
| `integrations.js` | `wp_integrations` registry, seeded defaults, credential presence (never the value), HTTP probes per kind |
| `health.js` | health center: runs every check, persists `wp_health_checks` (last 2000 rows), scheduler |
| `automations.js` | bus subscriber that runs `wp_automations` (project rows + global rows, in `position` order) and journals `wp_automation_runs`; `sweepInactive` every 10 min; modules it needs (handoff, agents, assistant) are required lazily → action `skipped` with `MODULE_UNAVAILABLE` when absent |
| `notes.js` | `wp_notes` on contacts / projects |
| `search.js`, `dashboard.js` | global search groups and dashboard counters (WhatsApp, projects, AI, infrastructure, alerts) |
| `autoreply.js` | status + `simulate()` of the #173 engine with the panel ports connected (forced dry-run) |
| `comms/ports.js` | the #173 business-data ports (vehicle, parts, price, stock) implemented over the Kitchen; `order` not connected |
| `comms/provider.js` | provider contract + registry (`describe, capabilities, parseInbound, sendText, fetchMedia, verifyWebhook, health, payloadHash, redactDeep`) |
| `comms/providers/evolution.js` | Evolution API v2 (unofficial, unsigned webhooks, loopback :8080) — production transport |
| `comms/providers/meta_cloud.js` | WhatsApp Cloud API (official, signed webhooks, templates) — implemented, not configured |
| `comms/receiver.js` | webhook endpoint: verification → parse → routing → ingest, ledger `wp_inbound_events` |
| `comms/routing.js` | deterministic routing on shared numbers + privacy guard (see `WHATSAPP_SETUP.md`) |
| `comms/core.js` | `ingest()` (contact upsert, live conversation, exactly-once message), inbox state, status updates |
| `comms/inbox.js` | conversations / messages / contacts / tags read-write model, membership scope |
| `comms/outbound.js` | human and AI replies: gates, idempotent `client_ref`, one retry, journal, SSE |
| `comms/handoff.js` | AI → human / human → AI with `wp_handoffs.direction`, `taken_by`, `previous_state` |
| `comms/numbers.js` | `wp_wa_accounts`, `wp_phone_numbers`, Evolution discovery (`sync`), webhook state, number ↔ project `link/unlink`, inbox switches |
| `comms/reconcile.js` | delivery reconciliation alarm, inbox heartbeat, dead-letter replay |
| `comms/assistant.js` | AI runs on a conversation: `suggest` (engine-173 or llm with fallback to the template path), `decide`, `markSent`, `autoReply` (every policy gate, `client_ref auto-<run id>`), `test` (synthetic message, no run row, no send), `attach` (bus listener: resolved agent → autoReply / suggest / nothing; legacy `settings.ai_suggest` when no agent is bound) |
| `comms/bus.js`, `comms/events.js` | in-process event bus (`comms` channel) and neutral event names |
| `ai/agents.js` | `wp_agents` / `wp_project_agents`, `resolveForConversation`, `effectiveMode`, default agent |
| `ai/tools.js` | least-privilege read-only tool registry (Kitchen, knowledge, conversation history, handoff flag) |
| `ai/llm.js` | completion over the free-LLM pool, JSON tool protocol, #173 `factGuard` |
| `comms/templates.js` | `wp_templates`: render (`{{1}}` / `{{name}}`, missing listed), CRUD, Meta sync (412 `META_CLOUD_NOT_CONFIGURED` without token file + WABA id), test send through `outbound.send` (`client_ref tpl-<id>-<ts>`) |
| `comms/meta-mcp.js` | descriptor + HTTPS reachability probe of the Meta WhatsApp Business Tools MCP (18 documented tools); no tool invocation |
| `comms/contacts360.js` | cross-project contact list grouped by phone identity and the 360 document (persons, conversations, timeline, counters; masked unless admin) |
| `routes/whatsapp.js`, `routes/ai.js`, `routes/platform.js` | the V2 route arrays concatenated by `api.js` (paths and roles as in `V2_BUILD_CONTRACT.md`; one addition: `POST /api/projects/:p/comms/conversations/:id/auto-reply`, manager) |
| `web/**` | shell (`index.html`), `app.js` (nav: Dashboard, Inbox, Contacts, Projects, WhatsApp, AI, Automations, Integrations, Health, Audit, Settings), views, `wp.css` on the brand tokens |

## 3. Data model

Base `database/schema.sql` + migrations `0001` … `0007` (`database/migrations/`). All additive, idempotent, one transaction each. Nothing holds a secret: credentials are referenced only by the NAME of an environment variable / file path variable.

```
wp_projects ──┬─< wp_user_projects >── wp_users
              ├─< wp_inboxes  (PROJECT ↔ PHONE NUMBER link; account_mode dedicated|shared; switches; ai_mode)
              │      └── wp_phone_numbers (one per provider instance) ── wp_wa_accounts
              ├─< wp_contacts ─< wp_contact_identities (phone | lid | bsuid | provider_user)
              ├─< wp_conversations (status, handler ai|human, agent_id, routed_by, route_rule_id, assigned_to)
              │      ├─< wp_messages (exactly once per (inbox, provider_message_id); client_ref for outbound)
              │      ├─< wp_conversation_events (append-only journal)
              │      ├─< wp_ai_runs ─< wp_ai_suggestions
              │      └─< wp_handoffs (direction, taken_by, taken_at, previous_state)
              ├─< wp_inbox_routes (allowlist | opt_in | keyword | default)      wp_routing_drops (hashes only)
              ├─< wp_project_agents >── wp_agents (engine, mode, tools, confidence_min)
              ├─< wp_knowledge, wp_business_rules, wp_tags, wp_notes, wp_templates, wp_automations ─< wp_automation_runs
              └─  wp_integrations, wp_health_checks, wp_inbound_events, wp_reserved_accounts, wp_audit_events, wp_schema_migrations
```

Retired but kept for rollback (0 rows in production, no code path writes them): `wp_product_commercial`, `wp_stock`, and the columns `wp_projects.catalog_dsn_env` / `catalog_schema`. Product, price and stock are read from the Kitchen (§6).

Per-migration summary:

| Version | Adds |
|---|---|
| `0001_comms_core` | inboxes, contacts, conversations, messages, attachments, events, tags, ai_runs, ai_suggestions, handoffs.conversation_id |
| `0002_inbound_events` | receiver ledger / dead-letter |
| `0003_outbound` | `client_ref`, `attempts`, provider-id CHECK on inbound rows only |
| `0004_multiservice` | `wp_projects.kind`, catalogue columns optional, `account_ref`, reserved accounts, inbox members |
| `0005_identities_reconciliation` | contact identities, ordering index, neutral event names, ack alarm, replay columns, heartbeat |
| `0006_shared_account_routing` | `account_mode`, composite inbox key, routes table, drops table, guard triggers |
| `0007_control_center` | users + RBAC, accounts + phone numbers, `wp_inboxes.phone_number_id` / `ai_mode`, keyword/default routes, `routed_by` / `handler` / `agent_id`, agents, handoff direction, templates, integrations, health checks, automations, notes |

Production state at the time of writing: `0001` … `0005` applied; `0006` and `0007` are applied by `deploy/v2-rollout.sh` (see `DEPLOYMENT.md`).

## 4. Request path of one inbound WhatsApp message

```
Evolution instance ──POST /hooks/evolution?token=… (or header x-mythos-webhook-token)──► receiver.handle
  1. MYTHOS_WP_RECEIVER_ENABLED=1 ? else 404
  2. provider from the path (evolution | meta_cloud); unsigned provider → token compared constant-time BEFORE the body is read
  3. body ≤ MYTHOS_WP_RECEIVER_MAX_BODY (default 512 KiB) → JSON → provider.parseInbound
       not ok → wp_inbound_events ignored|rejected (payload kept only for rejected/failed, and never when the instance hosts a shared inbox)
  4. routing.inboxesOn(instance) → none → 202 INBOX_UNKNOWN (dead-letter)
       connection event → wp_inboxes.status for every inbox on the instance; status event → our outbound row
  5. routing.resolve(): dedicated → sticky → identity rule → keyword → default → DROP
       DROP → wp_routing_drops (hashes only) and NOTHING else is written
  6. inbox.inbound_enabled=false → dry_run (ledgered, not persisted)
  7. core.ingest(): contact (identities) → live conversation (routed_by, rule_id) → message ON CONFLICT DO NOTHING → events → bus message.in
  8. subscribers: assistant (agent resolution → suggest / autoReply per effective mode), automations (rules), SSE feed
```

Outbound (`outbound.send`): conversation in project → same `client_ref` → existing row (no second send) → `outbound_enabled` (412) → inbox `open` (412) → per-conversation hourly cap (429) → `wp_messages out/queued` → `provider.sendText` (credential read at call time) → `sent`/`failed` → journal → bus.

## 5. Roles and access

`ROLES = viewer < agent < manager < admin < owner` (`auth.js`). Legacy `operator` in the users file is read as `manager`; route declarations may still say `'operator'` and mean `agent`. Owner/admin (and `all_projects` users and users-file logins) see every project; everyone else sees only `wp_user_projects` rows, enforced by `api-util.projectFrom()` (an inaccessible project is a 404). Details: `SECURITY.md`.

## 6. Kitchen (product, price, stock)

WP V2 owns no product data. An automotive project reads the MYTHOS AUTO Shared Kitchen (`projects/ssangyong-autos`, read-only HTTP on `127.0.0.1:3011`, contract **1.3.0**) through `kitchen.js`:

- integration key = `project.settings.kitchen` (default `kitchen-mythos-auto` for `kind = automotive`; `null`/`false` = no Kitchen; non-automotive kinds have none);
- routes: `/api/health`, `/api/products?q=&ref=&category=&brand_car=&limit=&offset=`, `/api/products/:uid`, `/api/vehicle-models`, `/api/vehicle-models/:id/motorizations`, `/api/brands`, `/api/vehicle-brands` (1.1), `/api/part-categories` (1.2), `/api/quotes?uids=` (1.1);
- 404 on a capability route = older Kitchen → degrade (`{ ok:true, degraded:true, empty }`); any other failure → `{ ok:false, kind: UNREACHABLE | TIMEOUT | BAD_STATUS | BAD_PAYLOAD }`; timeout 3 s;
- availability is normalised once to `IN_STOCK | ON_ORDER | UNAVAILABLE | UNKNOWN`; there is no quantity anywhere;
- consumers: `comms/ports.js` (engine-173 facts), `ai/tools.js` (`kitchen.*` tools), `/api/projects/:p/kitchen/*` passthrough, search.

## 7. Event bus and background workers

`comms/bus.js` is an in-process `EventEmitter` (channel `comms`). Publishers: receiver (`inbox.status`, `message.in` via core), outbound (`message.out`), assistant (`ai.run`), handoff (`handoff`), reconcile (`delivery.alarm`, `inbox.heartbeat`). Subscribers: SSE `/api/projects/:p/comms/events` (ids and types only, never text), `assistant.attach`, `automations.attach`.

Timers started by `server.js` (never in tests unless started): health every `MYTHOS_WP_HEALTH_INTERVAL_MS` (default 5 min, `0` = off), automations inactivity sweep every `MYTHOS_WP_AUTOMATIONS_SWEEP_MS` (default 10 min, `0` = off). Reconcile and heartbeat are CLI/owner-scheduled (`OPERATIONS.md`).

## 8. What is deliberately outside

- No WhatsApp send path other than `outbound.send` (human) and `assistant.autoReply` (policy-gated). The Meta MCP is never invoked at runtime (`MCP.md`).
- No write tool in the AI registry; no tool crosses a project boundary.
- No secret column, no secret in logs, audit, SSE or API responses; hashes in `wp_routing_drops` are never returned by the API.
- `mythos-bridge` (notification instance, reserved account `+216…660`) can host only explicit shared inboxes and routes by identity only.
