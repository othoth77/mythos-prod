# MYTHOS WP V2 — Projects

A **project is a service** and the tenant of everything the panel stores: numbers links, contacts, conversations, messages, knowledge, rules, agents bindings, automations, notes, audit. Companion: `WHATSAPP_SETUP.md`, `AI_AGENTS.md`, `INTEGRATIONS.md`, `SECURITY.md`.

## 1. Record (`wp_projects`)

| Field | Values | Notes |
|---|---|---|
| `id` | `^[a-z0-9][a-z0-9-]{1,62}$` | e.g. `ssangyong-autos`, `dar-hijama`, `mythos-prod`; also the comms project id |
| `display_name`, `domain`, `brand_car`, `currency` | | `brand_car` is passed to the Kitchen for automotive projects |
| `kind` | `automotive` \| `service` \| `internal` \| `other` | automotive = reads a Kitchen; the others own no catalogue |
| `status` | `active` \| `planned` \| `archived` | |
| `description` | text | |
| `settings` | JSON, non-secret | `kitchen` (integration key, `null`/`false` = none), `default_agent_id`, `timezone`, … |
| `catalog_dsn_env`, `catalog_schema` | | **V1 leftovers, unused by V2** (nullable since 0004; kept for rollback) |

Resource `projects` (`#/projects`, `GET/POST/PATCH/DELETE /api/r/projects`): read agent+, write admin+ (registry `resources.js`). CLI: `bin/mythos-wp seed-project <id> <display_name> <domain|-> <brand_car|-> [catalog_dsn_env|-] [catalog_schema|-]` (V2: leave the catalogue columns `-` and set `settings.kitchen` instead).

Production today holds one project (`ssangyong-autos`) and one inbox.

## 2. Access

- owner / admin, users with `all_projects = true`, and users-file logins see every project;
- every other user sees only the projects granted in `wp_user_projects` (`bin/mythos-wp users grant|revoke`, `PATCH /api/users/:u/projects { add:[], remove:[] }` (admin), UI Projects → Members);
- `api-util.projectFrom()` enforces it on every project-scoped route: an inaccessible project is reported as 404, exactly like an unknown one;
- `?project=all` / no project on cross-project lists (dashboard, search, contacts, agents, templates, automations) restricts to the accessible set;
- inbox-level scope still exists (`wp_inbox_members`): a user with at least one membership sees only member inboxes of that project (`GET /api/comms/my-inboxes`).

## 3. Numbers of a project

Projects → :id → **Numbers** lists the inboxes (`wp_inboxes` rows with `phone_number_id`) with their switches. Linking is done from the number side (`POST /api/whatsapp/numbers/:id/projects`), switches from the project side (`PATCH /api/projects/:p/inboxes/:inbox_id { inbound_enabled, outbound_enabled, ai_mode, display_name, settings }`). One project may own several numbers; one number may serve several projects (shared mode + routing rules). See `WHATSAPP_SETUP.md` §3–5.

Inbox `settings` (booleans, validated): `ai_suggest` (V1 auto-suggest switch, still honoured by `assistant.attach`), `auto_reply`, `allow_personal_account` (creation-time only).

## 4. Agents of a project

Projects → :id → **Agents**: the `wp_project_agents` bindings (agent, inbox or every number, priority, enabled). Resolution and modes: `AI_AGENTS.md` §2.

## 5. Kitchen access (automotive projects)

`settings.kitchen` names a `wp_integrations` row of kind `kitchen` (default `kitchen-mythos-auto`, `http://127.0.0.1:3011`, the Kitchen Mythos Auto service `projects/ssangyong-autos`, contract 1.3.0). WP owns **no** product, price or stock data: the Projects → :id → **Catalogue** tab (automotive only) and the AI tools read the Kitchen live.

| Route (any role, project access enforced) | Kitchen call |
|---|---|
| `GET /api/projects/:p/kitchen/describe` | `/api/health` + capability probe → `{ key, contract, base_host, status, read_only, database, counts, capabilities }` or `{ configured:false }` |
| `GET /api/projects/:p/kitchen/products?q=&ref=&category=&brand_car=&limit=&offset=` | `/api/products` (normalised rows, availability `IN_STOCK \| ON_ORDER \| UNAVAILABLE \| UNKNOWN`) |
| `GET /api/projects/:p/kitchen/products/:uid` | `/api/products/:uid` |
| `GET /api/projects/:p/kitchen/vehicle-models` · `…/part-categories` | `/api/vehicle-models` · `/api/part-categories` (1.2, degrades on 404) |

Failure shapes propagate as `{ ok:false, kind: UNREACHABLE | TIMEOUT | BAD_STATUS | BAD_PAYLOAD }`; the UI shows the Kitchen as unavailable rather than guessing. A non-automotive project has no catalogue tab and its agents get `KITCHEN_NOT_CONFIGURED` from the kitchen tools.

The V1 tables `wp_product_commercial` / `wp_stock` have 0 rows in production, are written by nothing, and stay only for rollback.

## 6. Integrations, members, settings, audit tabs

- **Integrations**: platform-wide rows (`project_id NULL`) plus rows scoped to this project (`wp_integrations.project_id`); `INTEGRATIONS.md`.
- **Members**: `wp_user_projects` (admin) and `wp_inbox_members` (admin) — `SECURITY.md` §3.
- **Settings**: `display_name`, `description`, `status`, `settings` JSON (never a credential — a key that looks like one is refused).
- **Audit**: `wp_audit_events` filtered by `project_id` (`#/audit`, `GET /api/r/audit?project=`).

## 7. Onboarding a new service (summary)

1. Create the project (`kind` = `service` unless it has a parts catalogue; `settings.kitchen` for automotive).
2. Grant the operators (`users grant`), optionally inbox memberships.
3. Number: owner creates the Evolution instance + webhook (`ops/whatsapp/evolution/customer-instance.sh`), pairs it (`qr-live.sh`), then **Numbers → Sync** in the panel and link the number to the project (`dedicated`, or `shared` + routing rules).
4. Switch `inbound_enabled` on (watch one real message land), then `outbound_enabled` (reply once), then bind an agent in `suggest`, and only after review `auto`.
5. Knowledge entries (`allowed_for_auto_reply`) and business rules as needed.

Full runbook with the pairing gotchas: `docs/MYTHOS_COMMUNICATION_OS_OPERATIONS.md` (repo level).
