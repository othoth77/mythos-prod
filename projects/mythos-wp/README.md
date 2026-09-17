# MYTHOS WP — MYTHOS Control Center

**Product:** MYTHOS WP · **URL:** https://wp.mythosprod.xyz/ · **Repository:** othoth77/mythos-prod (`projects/mythos-wp/`)
**Runtime:** Node `http` + `pg`, no framework, no bundler · **Unit:** `mythos-wp.service` (deploy user manager) · **Port:** loopback `127.0.0.1:8170` behind nginx + certbot
**Database:** `mythos_wp` in the `idauto-postgres` container (PostgreSQL 15) · **Env:** `/home/deploy/deployments/mythos-wp/.env` (0600)
**Version:** V2.1 (2026-09-17, simplification) — history in `docs/CHANGELOG.md`

MYTHOS WP is the operator control center of the MYTHOS group: one panel where
an operator sees every project, answers its WhatsApp conversations and decides
which AI agent helps on which number. It owns the communication data
(contacts, conversations, messages, handoffs, audit) and reads everything else
from the systems that own it — product, price and stock come from the MYTHOS
AUTO Shared Kitchen, automations run through n8n, models come from the
free-LLM pool. It never duplicates a catalogue and never stores a secret.

## The five sections

The sidebar is exactly **Dashboard, Inbox, Projects, WhatsApp, Settings**.
Everything technical sits behind an **Advanced** fold on the page it belongs
to; nothing was removed from the server, only from the first screen.

| Section | What you do there | Detail |
|---|---|---|
| **Dashboard** | today's figures and one table of projects (WhatsApp numbers with their connection state, AI agent + mode) for the selected project or for all of them | — |
| **Inbox** | conversations (All / Unread / Human / Waiting / Closed), the chat, AI suggestions, **Take over (AI → Human)** / **Hand back to AI**, the customer panel; **Contacts** are the second tab of the Inbox (cross-project list + contact 360) | `docs/OPERATIONS.md` §6 |
| **Projects** | the list (Name, Type, Status, WhatsApp, AI); **New project** = Name, Type (Service / Auto / Internal), Domain, WhatsApp, AI agent, Description, Currency — the slug is generated; a project page with **Overview · WhatsApp · AI · Catalogue (Auto only) · Members · Advanced** | `docs/PROJECTS.md` |
| **WhatsApp** | one table of numbers (Number, Status, Projects, Connection, AI, Last message) with **Sync all**, **Check**, **Link to project**; **Templates**; **Advanced** (admin: accounts, add a number manually, routing rules + simulate + drops, receiver and providers, Meta WhatsApp MCP) | `docs/WHATSAPP_SETUP.md` |
| **Settings** | **General** (account, language, appearance) · **Users** · **Integrations** (cards: Meta / WhatsApp, Kitchen Mythos Auto, n8n, AI provider, Meta WhatsApp MCP) · **Automations** (admin) · **System** (Health, Audit, Backup, AI runs) | `docs/INTEGRATIONS.md`, `docs/MCP.md`, `docs/OPERATIONS.md`, `docs/SECURITY.md` |

AI is decided per project: **Project → AI** holds the Agent, the Mode
(Off / Suggest / Auto), the Status and a **Test AI** box. The agent editor
itself (engine, tools, instructions) lives under **Project → Advanced → AI
agents** — `docs/AI_AGENTS.md`. Global search (Ctrl / ⌘ K) returns projects,
conversations and contacts only.

Old links keep working: `#/ai`, `#/automations`, `#/integrations`,
`#/health`, `#/audit`, `#/r/projects`, `#/r/inboxes` redirect to where the
feature now lives.

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
│  projects.js (simple create, Project → AI) · integrations.js · health.js │
│  automations.js · notes.js · search.js · dashboard.js                    │
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
0600 users file is the bootstrap / break-glass source). Then, in the panel:

1. **Settings → System → Health** — every component, **Run checks**.
2. **WhatsApp → Sync all** — discovers the Evolution instances and their connection / webhook state.
3. **Projects → New project** — Name, Type, Domain, pick the WhatsApp number and the AI agent, Create. Or, on an existing project, **Project → WhatsApp → Link a number** and switch **Receiving** on.
4. **Project → AI** — choose the Agent, set the Mode to **Suggest**, **Test AI** with a customer sentence; move to **Auto** only after reviewing real suggestions.

Production rollout of V2: `deploy/v2-rollout.sh` — see `docs/DEPLOYMENT.md`.

## Documentation

| File | Content |
|---|---|
| `docs/CHANGELOG.md` | V2 and V2.1: what was removed, hidden, simplified, kept |
| `docs/PROJECTS.md` | the New project form, the project page tabs, Project → AI, Kitchen access, onboarding |
| `docs/WHATSAPP_SETUP.md` | the numbers table, links (dedicated / shared), switches, routing rules, personal numbers, receiver, Evolution vs Cloud API — technical parts under WhatsApp → Advanced |
| `docs/AI_AGENTS.md` | where AI is configured, mode precedence (agent → project → number link), engines, tools, handoff |
| `docs/INTEGRATIONS.md` | Settings → Integrations cards, integration rows, probes, n8n, Kitchen, LLM pool |
| `docs/MCP.md` | Meta WhatsApp Business Tools MCP and MYTHOS MCP: what they are and are not |
| `docs/OPERATIONS.md` | CLI, Settings → System (Health, Audit, Backup), Automations, reconcile / heartbeat / replay, users |
| `docs/ARCHITECTURE.md` | components, data model, request path, event bus |
| `docs/DEPLOYMENT.md` | rollout script, worktree model, rollback, backup |
| `docs/ENVIRONMENT.md` | every `MYTHOS_WP_*` variable: purpose, default, secret or not; legacy variables |
| `docs/SECURITY.md` | sessions, CSRF, roles, webhooks, audit, secrets |
| `docs/TROUBLESHOOTING.md` | symptom → check → fix |
| `docs/V2_BUILD_CONTRACT.md` | the internal build contract the V2 code implements (API paths, module ownership; the V2 navigation it describes was simplified in V2.1) |
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
