# MYTHOS WP — Changelog

## V2.1.3 — 2026-09-18

- AI wording for projects that are not Auto: the fact-free reply templates of the shared engine ask for a vehicle model and a VIN. For a service or internal project, the suggestion now uses a neutral greeting, clarification or acknowledgement in the same language (fr, ar, en). The reply or handoff decision is unchanged, and the shared engine is not modified.
- The LLM system prompt keeps its vehicle/VIN data rule for Auto projects only.
- UI: on a phone the search button reads "Search" instead of a keyboard hint; the AI test example matches the project type (no car-part example on a service project).
- Security: the integrations list (internal URLs, credential variable names) is manager+ like the health center; the Settings → Integrations tab is hidden below manager.
- Database unreachable or not configured: logout, `/api/health` and `/api/meta` keep working (meta reports `degraded: true`), refusals (403/400) are decided before any database access, and the remaining routes answer 503 `db_unavailable` instead of a 500 that named environment variables.

## V2.1 — 2026-09-17 (simplification)

The operator screens were reduced to five sections; every technical surface moved under an **Advanced** fold. No API route, table or migration was removed.

**Removed (from the first screen)**
- Sidebar entries Contacts, AI, Automations, Integrations, Health, Audit. The sidebar is exactly Dashboard, Inbox, Projects, WhatsApp, Settings; the old hashes (`#/ai`, `#/automations`, `#/integrations`, `#/health`, `#/audit`, `#/r/projects`, `#/r/inboxes`) redirect.
- The long project form (slug, status, settings JSON, notes) as the way to create a project.
- Global search results for phone numbers, AI agents, templates, integrations and products: `GET /api/search` now returns projects, conversations and contacts only.
- The V1 per-project catalogue pool code (`db.catalog()` and the second pool `projects-store.resolve()` used to hand out): `db.js` holds one pool, `projects-store.resolve()` returns `{ project, wpPool }`.

**Hidden (still on the server)**
- `wp_projects.catalog_dsn_env` / `catalog_schema`: hidden, read-only legacy columns of the `projects` resource (absent from `/api/meta`), kept for rollback only. The `MYTHOS_WP_CATALOG_*` variables are unused; `check-env` still names them when present.
- Accounts, manual number registration, routing rules + simulate + drops, receiver / provider capabilities and the Meta WhatsApp MCP panel: WhatsApp → **Advanced** (admin).
- Agent cards and the agent editor, AI runs, routing rules, automations, technical integration rows, project audit: Project → **Advanced**.
- Technical integration cards (`mythos-mcp`, `database`, custom rows) and **New integration**: Settings → Integrations → **Advanced**.
- Conversation status / priority, routed-by, intent, ids and the handoff history: the **Advanced** fold of the Inbox customer panel; contact timeline and counters: the **Advanced** fold of the contact 360.
- The MCP endpoint, transport, auth, scopes and tool list: the **Advanced** fold of the Meta WhatsApp MCP card.

**Simplified**
- **New project** = Name, Type (Service / Auto / Internal), Domain, WhatsApp, AI Agent, Description, Currency; status Active; slug generated (`POST /api/projects`, `reference/projects.js`). Auto reveals *Vehicle brand* and attaches the Kitchen automatically. A chosen number is linked and a chosen agent bound in the same action; failures come back as warnings.
- Project page tabs: Overview · WhatsApp · AI · Catalogue (Auto only) · Members · Advanced.
- **Project → AI**: Agent, Mode (Off / Suggest / Auto), Status, Test AI (`GET/PUT /api/projects/:p/ai`). The project mode (`settings.ai_mode`) is a third restriction level in `agents.effectiveMode(agent, inbox, project)`: agent → project → number link, restrict only.
- `GET /api/projects/:p/numbers`: the project's numbers with masked phone, connection, receiving, switches.
- WhatsApp: one numbers table (Number, Status, Projects, Connection, AI, Last message) with Sync all / Check / Link to project / More (per-link switches Receiving · Replies · AI, Unlink, Edit number); Templates; Advanced.
- Settings → Integrations: five cards — Meta / WhatsApp, Kitchen Mythos Auto, n8n, AI provider, Meta WhatsApp MCP — Name · Status · Test · Configure.
- Settings → System: Health (Run checks), Audit, Backup, AI runs. Automations under Settings (admin).
- Contacts live inside the Inbox (Conversations | Contacts). Inbox filters: All, Unread, Human, Waiting, Closed.
- Dashboard: today's figures and one projects table (numbers with connection state, agent + mode); `GET /api/dashboard` activity items carry `whatsapp[]` and `ai { agent, mode }`.
- The `projects` resource form: sections Project / Advanced (settings JSON, notes) / Audit.

**Kept**
- Every route of V2 (`V2_BUILD_CONTRACT.md`) plus the three V2.1 additions above; the generic resources (`#/r/knowledge`, `#/r/rules`, `#/r/handoffs`, `#/r/users`, `#/r/tags`, `/api/r/projects`); the CLI (`seed-project` still accepts the catalogue arguments).
- Schema `0001` … `0007`; no new migration. The V1 tables `wp_product_commercial` / `wp_stock` (0 rows) and the two legacy columns stay for rollback.
- Routing order (dedicated → owner exclusion → sticky → identity rules → keyword → default → DROP), the personal-number privacy guard, the auto-reply gates, the read-only tool registry, the fact guard.
- Roles and permissions per route; every mutation audited.

## V2 — 2026-09-17 (Control Center)

Multi-project WhatsApp control center on the COMMS-1 … 11 communication layer (`../../docs/MYTHOS_COMMUNICATION_OS_ARCHITECTURE.md`).

**Removed**
- The catalogue as WP data: no catalogue resource, no product / price / stock table is written. Product, price and stock are read live from the MYTHOS AUTO Shared Kitchen (contract 1.3.0) through `kitchen.js`.
- The V1 SsangYong-only navigation and any product identity other than MYTHOS WP / MYTHOS Control Center / MYTHOS AI.

**Hidden / kept for rollback**
- `wp_product_commercial`, `wp_stock` (0 rows), `wp_projects.catalog_dsn_env` / `catalog_schema` (nullable since `0004`), the `MYTHOS_WP_CATALOG_*` variables.

**Added**
- Migration `0006_shared_account_routing` (account modes, routing rules, drops, guard triggers) and `0007_control_center` (users + RBAC, accounts + phone numbers, `wp_inboxes.phone_number_id` / `ai_mode`, keyword / default routes, `routed_by` / `handler` / `agent_id`, agents, handoff direction, templates, integrations, health checks, automations, notes).
- Users and roles (viewer < agent < manager < admin < owner), project-level access, break-glass users file.
- WhatsApp numbers (Sync from Evolution, webhook state, check), number ↔ project links (dedicated / shared), deterministic routing on shared numbers, personal-number privacy guard, receiver ledger, templates, the Cloud API provider (implemented, not configured).
- MYTHOS AI: agents (`engine-173` / `llm`), modes off / suggest / auto with policy gates, read-only tool registry, fact guard, AI ↔ human handoff, agent test.
- Integrations registry with probes, health center, automations (triggers → actions incl. n8n webhooks), notes, contact 360, global search, dashboard, audit history.
- Rollout script `deploy/v2-rollout.sh` (backup → checkout → migrate → users import → restart → smoke).

**Kept**
- The receiver / routing / core / outbound path of COMMS-1 … 11, the #173 deterministic engine as the fallback generator, the no-secret-in-database rule, the loopback-only process.

## V2.1.1 — 2026-09-17 (WhatsApp connection status)

**Fixed.** A health check that could not reach the WhatsApp gateway was written as the number's device
status (`status = 'error'`), so a probe timeout under host load showed "WhatsApp 0 / 2" and ERROR on every
project row while the session was open. A project link created during that window kept `error` for ever and
blocked replies for that project.

- `health.js` / `comms/numbers.js`: only a state the provider really reported may change the device status;
  a failed check records `health_state = 'error'` and keeps the last known status.
- `comms/numbers.connectionOf()`: one connection model — **Connected · Action required · Disconnected ·
  Error** — with a plain-language detail; a never-paired number reads *Action required*, not an error.
- `comms/numbers.syncInboxStatus()`: every project link follows its number on each successful check.
- Dashboard, project pages and the Numbers table use that model; the dashboard counts connected numbers.
- `MYTHOS_WP_DB_CONNECT_TIMEOUT_MS` makes the pool connect timeout configurable for a loaded host.
- New suite `tests/mythos-wp-v21-whatsapp-status-test.js` (26 assertions) locks the behaviour down.

## V2.1.2 — 2026-09-18 (final production pass)

**Security (independent audit, all fixed):**
- CRITICAL — `POST /api/r/users` could overwrite an existing account (password, role, status) because it
  upserted; it now refuses any name that exists in the database **or** in the 0600 credentials file
  (a database row would shadow the break-glass file account at login).
- HIGH — the short *New project* form implied the personal-number sharing opt-in; it now links a personal
  number only when the caller passes `allow_personal_account: true`, otherwise it reports a warning.
- Full customer digits (`contact_wa_id`, contact `wa_id`/`lid`) are returned to admins only.
- Inbox membership now scopes WRITES too (read, patch, note, tag, reply, retry), not only reads.
- Clearing a user's "every project" access ends their live sessions.
- Single-agent reads filter project bindings to the caller's projects.
- The WhatsApp business-account list and the Health Center are manager+.
- The sharing opt-in can no longer be toggled through the generic inbox PATCH.
- Tag and contact-tag mutations are audited; a prototype key can no longer reach the project INSERT.

**WhatsApp:** WhatsApp → Numbers → **Connect** shows the pairing QR for a number that is not connected,
refreshes it every 15 s (the pairing ref rotates every 20–45 s) and closes by itself once the number is
connected. Refused on a connected number; the QR is never logged or stored.

**Kitchen search (no Kitchen change):** customer words are matched against the Kitchen's accent-free
category facet first (`filtre a huile` → `category=filtre-a-huile`), and a model name shared by several
generations (three `KORANDO` rows) narrows by all of them. When the catalogue still cannot single out a
product the answer is a human handoff — never a guess.

**Operations:** scheduled off-host backup of `mythos_wp` (daily 05:20 UTC, verify 16:19 UTC, restore
tested); MYTHOS WP probes on the Status Center (loopback health, auth wall, backup freshness).
