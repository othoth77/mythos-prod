# MYTHOS WP — MYTHOS Web Panel

**Product:** MYTHOS WP · **Domain:** https://wp.mythosprod.xyz/ · **Repository:** othoth77/mythos-prod (`projects/mythos-wp/`)
**First project:** ssangyong.autos · **Reusable for:** piece.autos, casse.autos, any MYTHOS AUTO project
**Authoritative state record:** `docs/AI_HANDOVER.md` (entry MYTHOS-WP-0)

MYTHOS WP is the owner/operator back-office for MYTHOS AUTO business data: the
automotive catalogue (parts, references, vehicles, motorizations, fitments,
media), the **verified** commercial and stock layers, Auto-Reply knowledge,
business rules, the human-handoff queue, and a full audit log. It is also the
business-data layer the MYTHOS AUTO auto-reply engine (Issue #173) reads from.

## What it is built on (nothing duplicated)

| Concern | Reused | Where |
|---|---|---|
| Catalogue source of truth | PostgreSQL `ssangyong_autos`, tables `sya_*` (projects/ssangyong-autos) | written to directly, per project, audited |
| Design system | canonical tokens `assets/brand/tokens/tokens.css` + self-hosted faces `assets/brand/fonts/` (served as-is), ERP component layer (`sites/erp.mythosprod.xyz/app/assets/erp.css`) carried into `reference/web/wp.css` | dark-first, light theme, reduced motion, print |
| Auth pattern | `projects/mythos-os-console/reference/auth.js` (server-side sessions, 0600 secret file, throttle) + roles, scrypt, CSRF | `reference/auth.js` |
| Auto-Reply engine | `projects/automotive/comms` (#173): business-data port contract, engine, policy, templates, fact guard | consumed via `reference/comms/ports.js`, `comms/integration.js`, `reference/autoreply.js` |
| WhatsApp gateway | existing private Evolution gateway `127.0.0.1:8080` | probed read-only; never called to send |
| Service conventions | Node `http` + `pg`, loopback port, deploy user unit, certbot nginx vhost, 0600 env in `/home/deploy/deployments/<name>/` | `deploy/` |
| Redaction | `projects/mythos-orchestrator/lib/redact.js` | logs and audit values |

**Open-source patterns adopted, not cloned:** Refine's `resources` + `dataProvider`
split (one declarative registry → generic list/create/edit/delete API and UI,
`reference/resources.js` + `reference/crud.js`), shadcn/Kiranism dashboard IA
(rail + topbar + command menu + data table with column visibility + record
detail/edit). No React/Next.js: the repository has no React anywhere, the design
system is CSS-token based, and a Next build on this host (2.8 GiB available,
OOM history) is a production risk for no functional gain.

## Architecture

```
browser (ES modules, CSP script-src 'self')          reference/web/
  app.js · router · command menu · table.js · form.js · views/*
      │  same-origin JSON, X-Requested-With: MythosWP, httpOnly cookie
server.js (127.0.0.1:8170)  ── static (shell, /brand/* from assets/brand) ── api.js route table
      │  session + role + CSRF per route (auth.js)
crud.js  ← resources.js (registry: fields · validation · permissions · joins · filters)
      │  validate.js (shared with the browser)          audit.js → wp_audit_events
      ├── db.wp()       mythos_wp        (registry, commercial, stock, knowledge, rules, handoffs, audit)
      └── db.catalog(p) <project DB>     (sya_* catalogue; search_path pinned per project)
autoreply.js ── status (config · gateway probe · receiver probe · ledger · business data)
             ── simulate: engine.process (forceDryRun, memory ledger) with comms/ports.js connected
comms/ports.js       vehicle · parts · price · stock  (order not connected)   → #173 lib/business-data.js
comms/integration.js { ports, onOutcome }  → receiver --integration  → wp_handoffs (REQUIRES_HUMAN)
```

### Data model

`database/schema.sql` (database `mythos_wp`, role `mythos_wp_owner`, same cluster
as the catalogue — no new server): `wp_projects` (registry → catalogue connection
by env-var **name**), `wp_product_commercial` (verified selling price), `wp_stock`,
`wp_knowledge`, `wp_business_rules`, `wp_handoffs`, `wp_audit_events`. Catalogue
rows are referenced by `product_uid`, never by serial id.

The catalogue itself is unchanged: `sya_products` (with `price_tnd` = the collected
market price), `sya_vehicle_models`, `sya_vehicle_motorizations`,
`sya_product_vehicle_compatibility`, `sya_product_images`.

### Verified vs unknown (the Auto-Reply contract)

The engine may only state a fact a port returns `{ ok: true }` for. The ports answer
`ok` only for an unambiguous, verified record: one matching part, a **selling price
set in this panel** (never the scraped catalogue price), a stock record whose
availability is not `unknown`, a fitment row. Anything else → the kind is missing →
the engine decides `REQUIRES_HUMAN`. `order` is not connected (no order system).

## Operating it

```
node projects/mythos-wp/bin/mythos-wp set-password <users.json> <user> <owner|operator>   # password on stdin
node projects/mythos-wp/bin/mythos-wp seed-project <id> <name> <domain> <brand> <ENV_VAR> [schema]
node projects/mythos-wp/bin/mythos-wp check-env
bash projects/mythos-wp/tools/check.sh          # syntax · module graph · eslint · design rules · secret scan · tests
node tests/mythos-wp-test.js                    # needs MYTHOS_WP_TEST_DB_URL (mythos_wp_test)
```

Roles: `owner` (everything) · `operator` (read, create/update business data, handoff
work; no delete, no rules, no projects). Sessions: 8 h absolute, in memory.

Environment (`/home/deploy/deployments/mythos-wp/.env`, 0600): `MYTHOS_WP_DB_*`,
`MYTHOS_WP_USERS_FILE`, one `MYTHOS_WP_CATALOG_<PROJECT>` URL per project (named by
`wp_projects.catalog_dsn_env`), optional `MYTHOS_WP_COMMS_CONFIG` (the real #173
configuration file; absent = Auto-Reply shows OFF / not configured).

## Deployment (done 2026-09-05; see handover)

`deploy/provision-db.sh` (root, idempotent) · `deploy/mythos-wp.user.service`
(deploy user manager, `MemoryMax=256M`) · `deploy/nginx-wp.mythosprod.xyz.conf` +
certbot. The unit runs from the implementation worktree until the branch is merged.

## Turning the auto-reply on is NOT done here

The panel has no switch by design. Owner steps (comms README §Turning a reply on):
customer Evolution instance, 0600 token files, `state_dir`, webhook to the loopback
receiver started with `--integration projects/mythos-wp/reference/comms/integration.js`,
dry-run first, then `mode: live` + `business.auto_reply: true` per project.

## Migrations (Communication Core, since MYTHOS-COMMS-1)

`database/schema.sql` is the base; everything after it is an additive migration in
`database/migrations/<version>.up.sql` + `.down.sql`, applied by `reference/migrate.js`:

```bash
node projects/mythos-wp/bin/mythos-wp migrate status          # applied / pending
node projects/mythos-wp/bin/mythos-wp migrate up               # apply pending, one transaction each
node projects/mythos-wp/bin/mythos-wp migrate down 0001_comms_core   # roll back ONE version
node tests/mythos-wp-comms-schema-test.js                      # apply → fixtures → rollback → re-apply on mythos_wp_test
```

Data model and retention rules: `docs/MYTHOS_COMMUNICATION_OS_ARCHITECTURE.md`.

## Communication Receiver (webhook endpoint)

Disabled by default. To enable on a host: a 0600 token file (`openssl rand -hex 32 > …/webhook.token`),
`MYTHOS_WP_WEBHOOK_TOKEN_FILE=<path>` and `MYTHOS_WP_RECEIVER_ENABLED=1` in the 0600 env file, restart.
Evolution then posts per-instance webhooks to `http://127.0.0.1:8170/hooks/evolution?token=…` (loopback only).
An inbox persists traffic only when its `wp_inboxes.inbound_enabled` is true; otherwise deliveries are validated
and ledgered as `dry_run`. Tests: `node tests/mythos-wp-comms-receiver-test.js`.
