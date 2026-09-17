# MYTHOS WP — MYTHOS Control Center

**Product:** MYTHOS WP · **URL:** https://wp.mythosprod.xyz/ · **Repository:** othoth77/mythos-prod (`projects/mythos-wp/`)
**Runtime:** Node `http` + `pg`, no framework, no bundler · **Unit:** `mythos-wp.service` (deploy user manager) · **Port:** loopback `127.0.0.1:8170` behind nginx + certbot
**Database:** `mythos_wp` in the `idauto-postgres` container (PostgreSQL 15) · **Env:** `/home/deploy/deployments/mythos-wp/.env` (0600)

MYTHOS WP is the operator control center of the MYTHOS group: one panel that
controls every project's WhatsApp numbers, conversations, AI agents,
integrations, automations, users and health. It owns the communication data
(contacts, conversations, messages, handoffs, audit) and reads everything else
from the systems that own it — product, price and stock come from the MYTHOS
AUTO Shared Kitchen, automations run through n8n, models come from the
free-LLM pool. It never duplicates a catalogue and never stores a secret.

## What it controls

| Area | What the panel does | Where |
|---|---|---|
| Projects | registry of services (SsangYong Autos, Dar Hijama, Mythos Prod, …), per-project members, settings, catalogue access via the Kitchen | `docs/PROJECTS.md` |
| WhatsApp | business accounts, phone numbers (one per provider instance), number ↔ project links (many-to-many), deterministic routing on shared numbers, receiver/webhook state, templates | `docs/WHATSAPP_SETUP.md` |
| Inbox | conversations, contacts (cross-project 360 view), tags, notes, human replies, AI ↔ human handoff | `docs/OPERATIONS.md` |
| MYTHOS AI | agents bound to projects/numbers, engines `engine-173` (deterministic) or `llm` (free-LLM pool with tools + fact guard), modes off / suggest / auto | `docs/AI_AGENTS.md` |
| Integrations | Evolution API, WhatsApp Cloud API (implemented, not configured), Kitchen, n8n, MCP servers, LLM pool, database — with health probes | `docs/INTEGRATIONS.md`, `docs/MCP.md` |
| Automations | event rules (conversation.created, message.received, conversation.inactive, handoff.requested) → assign / tag / handoff / AI / n8n webhook | `docs/OPERATIONS.md` |
| Health | one health center: database, backend, receiver, provider, every number, every integration, AI | `docs/OPERATIONS.md` |
| Users | roles viewer < agent < manager < admin < owner, project-level access, audit log | `docs/SECURITY.md` |

## Architecture

```
                         Internet
                            │ https (certbot)
                    nginx  wp.mythosprod.xyz
                            │ proxy_pass 127.0.0.1:8170
┌───────────────────────────▼──────────────────────────────────────────────┐
│ mythos-wp.service  (deploy user unit, MemoryMax=256M, loopback only)     │
│                                                                          │
│  reference/server.js  ── static shell (CSP script-src 'self')            │
│        │                ── /hooks/<provider>  → comms/receiver.js        │
│        └── api.js route table  (+ routes/whatsapp | ai | platform)       │
│              session · role · CSRF per route   (auth.js, users.js)       │
│              audit.js → wp_audit_events (never a secret)                 │
│                                                                          │
│  comms/   receiver → provider.parseInbound → routing.resolve → core      │
│           outbound (human / AI replies) · handoff · reconcile · numbers  │
│           providers/evolution.js (production)  providers/meta_cloud.js   │
│  ai/      agents · tools (read-only registry) · llm (free-LLM pool)      │
│  kitchen.js  read-only client, contract 1.3.0                            │
│  integrations.js · health.js · automations.js · notes.js · search.js     │
└───────┬──────────────┬───────────────┬──────────────┬────────────────────┘
        │ pg           │ http          │ http         │ http
   mythos_wp      Evolution API    Kitchen        n8n            free-LLM pool
 (idauto-postgres) 127.0.0.1:8080  127.0.0.1:3011 127.0.0.1:5678 (Groq active)
   PG 15           instance/number  ssangyong-autos webhooks      projects/mythos-ai-executor
```

Detail: `docs/ARCHITECTURE.md`.

## Quick start (operator)

```bash
# as deploy, with the production environment loaded
set -a; . /home/deploy/deployments/mythos-wp/.env; set +a
cd /home/deploy/worktrees/mythos-wp-main/projects/mythos-wp

node bin/mythos-wp check-env                   # names only, never values
node bin/mythos-wp migrate status              # applied / pending
node bin/mythos-wp users list                  # wp_users accounts
node bin/mythos-wp users add <name> admin --display "Name"   # password on stdin
node bin/mythos-wp users grant <name> <project-id>

curl -s http://127.0.0.1:8170/healthz          # { "ok": true }
systemctl --user status mythos-wp.service
journalctl --user -u mythos-wp.service -n 100 --no-pager
```

Sign in at https://wp.mythosprod.xyz/login with a `wp_users` account (the
0600 users file is the bootstrap / break-glass source). First things to look
at: **Health** (every component), **WhatsApp → Numbers → Sync** (discover the
Evolution instances), **Projects** (link a number to a project), **AI**
(bind an agent).

Production rollout of V2: `deploy/v2-rollout.sh` — see `docs/DEPLOYMENT.md`.

## Documentation

| File | Content |
|---|---|
| `docs/ARCHITECTURE.md` | components, data model, request path, event bus |
| `docs/DEPLOYMENT.md` | rollout script, worktree model, rollback, backup |
| `docs/ENVIRONMENT.md` | every `MYTHOS_WP_*` variable: purpose, default, secret or not |
| `docs/WHATSAPP_SETUP.md` | numbers, links, dedicated vs shared, routing rules, personal numbers, receiver, Evolution vs Cloud API |
| `docs/AI_AGENTS.md` | agents, engines, modes, tools, handoff |
| `docs/PROJECTS.md` | projects, kinds, settings, members, Kitchen access |
| `docs/INTEGRATIONS.md` | integration rows, probes, n8n, Kitchen, LLM pool |
| `docs/MCP.md` | Meta WhatsApp Business Tools MCP and MYTHOS MCP: what they are and are not |
| `docs/SECURITY.md` | sessions, CSRF, roles, webhooks, audit, secrets |
| `docs/OPERATIONS.md` | CLI, health center, automations, reconcile / heartbeat / replay, users |
| `docs/TROUBLESHOOTING.md` | symptom → check → fix |
| `docs/V2_BUILD_CONTRACT.md` | the internal build contract the V2 code implements (API paths, module ownership) |
| `../../docs/MYTHOS_COMMUNICATION_OS_ARCHITECTURE.md` | repo-level Communication OS record (COMMS-1 … 11) |
| `../../docs/MYTHOS_COMMUNICATION_OS_OPERATIONS.md` | repo-level runbook (onboarding, pairing, shared routing) |

## Checks and tests

```bash
bash projects/mythos-wp/tools/check.sh                 # syntax · module graph · eslint · design rules · secret scan · tests
node tests/mythos-wp-test.js                           # needs MYTHOS_WP_TEST_DB_URL (mythos_wp_test)
node tests/mythos-wp-comms-*-test.js                   # receiver, outbound, routing, contract, hardening, …
node tests/mythos-wp-v2-whatsapp-test.js               # V2 suites: whatsapp, platform, ai
node tests/mythos-wp-v2-platform-test.js
node tests/mythos-wp-v2-ai-test.js
```

## Naming

The product is **MYTHOS WP**, the panel is the **MYTHOS Control Center**, the
AI layer is **MYTHOS AI**. No other product identity exists in the code, the
git history or GitHub. The deterministic reply engine is
`projects/automotive/comms` (Issue #173) and remains the fallback generator of
every agent.
