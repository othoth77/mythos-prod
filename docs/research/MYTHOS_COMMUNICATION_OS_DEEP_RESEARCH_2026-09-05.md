# MYTHOS Communication OS — Deep Research, Competitive Analysis & Reuse Architecture

Date: 2026-09-05 · Status: RESEARCH ARTIFACT (no implementation) · Predecessor: GitHub Issue #196 (first research round, Option D) · Related implementation: Issues #197 #202 #205 #207 #209 #211 #217 (MYTHOS-COMMS-1…8)

Evidence labels used throughout: **[FACT]** verified from the official repository, LICENSE file, documentation or the deployed MYTHOS host on 2026-09-05 · **[INFERENCE]** reasoning from facts · **[RECOMMENDATION]** what MYTHOS should do.

---

## 1. Executive summary

- **No existing open-source project is MYTHOS Communication OS.** Each candidate covers one layer well: Evolution API and its peers are *transports*, Chatwoot and its fork Evo CRM are *generic helpdesks*, Dify is an *LLM app platform*, n8n is an *automation engine*, Typebot is a *flow builder*, Twenty/EspoCRM/SuiteCRM/Frappe CRM are *sales CRMs*. None model "a message becomes verified business action" over MYTHOS's own products, stock, rules and projects. [INFERENCE from §5–§8]
- **What MYTHOS already has is the right shape and is ahead of the research baseline of #196**: a provider-neutral Communication Core in `projects/mythos-wp` (migrations 0001–0004, receiver, exactly-once ingest, inbox/contacts UI, human outbound, suggest-only assistant, multi-service model with account isolation and inbox members), 22 tables, 44 API routes, 7 test suites green, all switched OFF behind flags in production. [FACT §3]
- **Final decision (§11): Evolution API as the *first* transport behind a `CommunicationProvider` contract, Meta Cloud API as the *second* provider before any customer-facing scale, native MYTHOS Communication Core + MYTHOS AI as the system of record, n8n as an optional peripheral automation layer, Typebot not adopted (its WhatsApp integration is Cloud-API-only and its licence forbids competing use), Chatwoot / Evo CRM / Dify / Twenty as architectural references only.** Score 8.6/10 versus 5.8 for "Chatwoot as core" and 4.8 for "Evo CRM as core" (§8).
- **Top risks** (§7): the unofficial WhatsApp Web transport (Baileys) — account bans (Error 463 "reachout timelock", 2026), silent webhook loss after days of uptime (Evolution #2647), outbound stuck PENDING (Evolution #2597), passkey-linking changes (Baileys #2672, Evolution #2618), no release since 2025-12 and a mandatory manual licence activation from v2.4.0 (Evolution #2534); the Meta side — per-message pricing since 2025-07, BSUID/usernames rollout 2026 that breaks phone-keyed contacts (Chatwoot #13837); and MYTHOS's own past incident (`LOG_BAILEYS=debug` printed Signal private keys).
- **Recommended next implementation task**: MYTHOS-COMMS-9 "Provider contract + event ledger hardening" (formalise `CommunicationProvider`, provider-neutral event names, BSUID-ready contact identity, delivery-state reconciliation, dead-letter replay) — *before* auto-reply, because every later phase depends on it and it is the cheapest point to remove the Baileys lock-in.

---

## 2. Research methodology

1. Repository reconnaissance on the production host (read-only): `projects/mythos-wp`, `projects/automotive/comms`, `ops/whatsapp/evolution`, `docs/MYTHOS_COMMUNICATION_OS_*.md`, `docs/AI_HANDOVER.md`, Issues #196–#217, the live `mythos_wp` schema and Evolution instance list.
2. Official-source research: GitHub repositories (metadata via the GitHub API, README, source files, `LICENSE` files fetched raw), official documentation (Meta developers, docs.typebot.com, developers.chatwoot.com, docs.n8n.io, docs.dify.ai, waha.devlike.pro), release pages.
3. Community / failure research: GitHub Issues searches (reactions-sorted) on each repository, plus web searches for operator experiences; used **only** for problems, limitations and operational risks, never for feature claims.
4. Licensing verified from the official `LICENSE` text (or the GitHub API licence field when the file could not be fetched; noted where so).
5. Every conclusion is labelled FACT / INFERENCE / RECOMMENDATION. Where a documentation page could not be fetched (404), the fact is marked as *not verified* rather than guessed.

Limits of this round: no load testing, no code execution of third-party projects, no paid documentation; Reddit/Hacker News searches returned mostly vendor blog posts, so community evidence is dominated by GitHub Issues.

---

## 3. Current MYTHOS state (2026-09-05, read-only)

### 3.1 What exists [FACT]

| Layer | Present today | Where |
|---|---|---|
| Transport | Evolution API v2.3.7 (Baileys 7.0.0-rc.9) on loopback :8080, container healthy; instance `mythos-bridge` = **notification channel** (owner account, `open`, webhook null); instance `ssangyong-autos` created, per-instance webhook to the panel, **not paired** (`close`), inbox row `closed`, inbound/outbound OFF | `ops/whatsapp/evolution/`, Evolution DB |
| Notification bridge | `mythos-github-bridge` → WhatsApp ENABLED (4 kinds, 1 recipient), Telegram OFF, 6 real deliveries proven | deploy systemd drop-ins |
| Communication Core | migrations 0001–0004: `wp_inboxes`, `wp_contacts`, `wp_conversations`, `wp_messages`, `wp_message_attachments`, `wp_conversation_events`, `wp_tags` (+links), `wp_ai_runs`, `wp_ai_suggestions`, `wp_inbound_events`, `wp_reserved_accounts`, `wp_inbox_members`, `wp_handoffs.conversation_id`, `wp_projects.kind`, `wp_inboxes.account_ref` | `projects/mythos-wp/database/migrations/` |
| Receiver | `POST /hooks/evolution` behind `MYTHOS_WP_RECEIVER_ENABLED`; 0600 header token, constant-time compare, body limit, per-inbox dry-run, dead-letter ledger, credential/media-key stripping | `reference/comms/receiver.js`, `providers/evolution.js` |
| Core | transactional exactly-once ingest, one live conversation per (inbox, contact), delivery-state updates that never downgrade, SSE bus | `reference/comms/core.js`, `bus.js` |
| Inbox / Contacts | project-scoped API (17 routes), SSE feed, views, masking in lists, membership scoping | `reference/comms/inbox.js`, `web/js/views/inbox.js`, `contacts.js` |
| Human outbound | `client_ref` idempotency, gates (outbound_enabled, inbox open, hourly cap), one transport retry, manual retry, delivery states from `messages.update` | `reference/comms/outbound.js` |
| AI (suggest-only) | #173 engine in forced dry-run: intents, verified ports (products/price/stock/knowledge), fact guard, policy gate → `wp_ai_runs` + `wp_ai_suggestions`; human accept/edit/reject; opt-in auto-trigger | `reference/comms/assistant.js`, `projects/automotive/comms` |
| Multi-service | project = tenant (`kind` automotive/service/internal), one account per inbox, reserved notification account (trigger), inbox members with visibility scope, runbook | migration 0004, `docs/MYTHOS_COMMUNICATION_OS_OPERATIONS.md` |
| Tests | schema 62, receiver 61, inboxes 12, inbox 38, outbound 34, assistant 28, multiservice 37, panel 317 — all passing on `mythos_wp_test` | `tests/mythos-wp-comms-*-test.js` |

Production counts: 0 customer messages, 0 contacts, 1 inbox row, 1 reserved account. Nothing customer-facing is live.

### 3.2 What is missing [FACT, by comparison with the target in this document]

- A formal `CommunicationProvider` interface: today the abstraction is one module (`providers/evolution.js`) with `parseInbound` / `sendText` / `readApiKey` / `baseUrl`; no second provider, no capability descriptor (media, templates, reactions), no provider-neutral outbound beyond text.
- Contact identity beyond phone digits: `wp_contacts.wa_id` is the customer MSISDN; BSUID / username-era identifiers (§7.1) are not modelled.
- Media: attachment metadata only; no download, storage, scanning, transcription, OCR or vision.
- Auto-reply policy and kill switch; handoff workflow UI (claim/assign/resolve/reopen); automation rules; analytics; retention job; provider-neutral event names in the ledger; replay of dead letters; per-project AI configuration beyond business rules; agents/teams beyond membership rows; LLM generator (the engine runs its template generator; an LLM provider is not wired).
- Channels other than WhatsApp; Cloud API provider; number change / migration procedure.

---

## 4. Official sources reviewed

Repositories (GitHub API metadata + files, 2026-09-05):
- Evolution API — https://github.com/evolution-foundation/evolution-api (9.5k★; releases: 2.3.7 2025-12-05, 2.4.0-rc2 2026-05-17; last `main` commit 2026-05-06) · LICENSE · `prisma/postgresql-schema.prisma` · `src/api/integrations/event/event.controller.ts` · `src/api/integrations/chatbot/*`
- Evo CRM Community — https://github.com/evolution-foundation/evo-crm-community (274★, v1.1.0 2026-09-02) · https://github.com/evolution-foundation/evo-ai-crm-community (`NOTICE`, `db/schema.rb`) · https://github.com/evolution-foundation/evo-ai-processor-community · https://github.com/evolution-foundation/evo-flow-community · https://github.com/evolution-foundation/evo-bot-runtime
- Chatwoot — https://github.com/chatwoot/chatwoot (36.5k★, v4.17.1 2026-08-27) · `LICENSE`, `enterprise/LICENSE`, `db/schema.rb`, `app/models/{message,conversation,inbox,account_user,automation_rule}.rb`, `app/models/channel/{whatsapp,api}.rb`, `lib/events/types.rb`, `app/builders/v2/report_builder.rb`, `enterprise/app/models/captain/*` · https://developers.chatwoot.com/self-hosted/deployment/requirements
- Dify — https://github.com/langgenius/dify (154k★, 1.17.0 2026-08-25) · `LICENSE`, `api/pyproject.toml`, `docker/docker-compose.yaml`, `api/controllers/service_api/*` · https://docs.dify.ai/en/guides/knowledge-base/readme
- n8n — https://github.com/n8n-io/n8n (203k★, n8n@2.37.10 2026-09-04) · `LICENSE.md` · `packages/nodes-base/nodes/WhatsApp/*` · https://docs.n8n.io/hosting/scaling/queue-mode/
- Typebot — https://github.com/baptisteArno/typebot.io (10.3k★, v3.18.0 2026-08-21) · `LICENSE` (FSL-1.1-Apache-2.0) · `packages/whatsapp` · https://docs.typebot.com/deploy/whatsapp/overview
- Twenty — https://github.com/twentyhq/twenty (56k★, v2.37.0 2026-08-28) · `LICENSE` · `packages/twenty-server/{package.json,src/engine,src/modules}`
- EspoCRM — https://github.com/espocrm/espocrm (3.3k★, 10.0.7 2026-09-03) · `LICENSE.txt` · `application/Espo/Resources/metadata`
- SuiteCRM — https://github.com/SuiteCRM/SuiteCRM (5.7k★) · `LICENSE.txt`
- ERPNext / Frappe CRM — https://github.com/frappe/erpnext (38.9k★, GPL-3.0) · https://github.com/frappe/crm (3.5k★, v1.83.0 2026-09-02, AGPL-3.0 per API + `LICENSE`)
- WhatsApp gateways — https://github.com/devlikeapro/waha (7.3k★, 2026.8.2) · https://waha.devlike.pro/docs/how-to/waha-plus/ · https://github.com/wppconnect-team/wppconnect-server (1.0k★, v2.10.16) · https://github.com/wppconnect-team/wppconnect · https://github.com/vynect/venom (6.6k★) · https://github.com/wwebjs/whatsapp-web.js (22.5k★, v1.34.7 2026-04-24) · https://github.com/WhiskeySockets/Baileys (11k★, MIT; rc14 2026-07-29) · https://github.com/tulir/whatsmeow (7.2k★, MPL-2.0) · https://github.com/open-wa/wa-automate-nodejs
- Meta — https://developers.facebook.com/docs/whatsapp/cloud-api/overview · https://developers.facebook.com/docs/whatsapp/pricing · https://developers.facebook.com/docs/whatsapp/on-premises · https://developers.facebook.com/docs/graph-api/webhooks/getting-started · https://developers.facebook.com/docs/messenger-platform/instagram
- Telegram — https://core.telegram.org/bots/api (Bot API 10.3; `setWebhook`, `secret_token`, `getUpdates`)
- Local MYTHOS docs: `docs/MYTHOS_COMMUNICATION_OS_ARCHITECTURE.md`, `docs/MYTHOS_COMMUNICATION_OS_OPERATIONS.md`, `docs/MYTHOS_WHATSAPP_QR_PAIRING_DIAGNOSIS_2026-09-05.md`, `docs/MYTHOS_WHATSAPP_PROVIDER_STRATEGY.md`, `docs/AI_HANDOVER.md`, Issue #196 report.

Community / failure sources (GitHub Issues unless noted): Evolution #2597 #2647 #2618 #2534 #2538 #2298 #2463 #2506 #2582; Baileys #2737 #2765 #2741 #2782 #2672 #2707 #2441 #2331 #2679; WAHA #1456 #1992 #2223 #2227; whatsmeow #1233 #1234; Chatwoot #13837 #14494 #13970 #12562 and discussion #9645; OpenWA #560; web searches on Chatwoot scaling, Evolution bans, Cloud API pricing (respond.io, wati, peppercloud, blueticks — vendor blogs, treated as INFERENCE-grade only).

Count: 27 primary repositories/documentation sites, 24 issue threads, 6 web-search sweeps.

---

## 5. Projects evaluated

### 5.1 Evolution API

**[FACT]** Node 20+/TypeScript/Express, Prisma over PostgreSQL (or MySQL), bundled Baileys `7.0.0-rc.9` in 2.3.7; integrations `WHATSAPP-BAILEYS` and `WHATSAPP-BUSINESS` (Meta Cloud API, `graph.facebook.com`) present in the deployed image; 30 webhook events (`MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `CONNECTION_UPDATE`, `QRCODE_UPDATED`, `SEND_MESSAGE`, …), global or per-instance webhook, `webhookByEvents`, `webhookBase64`, optional custom headers; event fan-out to RabbitMQ, SQS, NATS, Kafka, WebSocket, Pusher; persistence of chats/contacts/messages/labels is optional (`DATABASE_SAVE_DATA_*`) and OFF in MYTHOS; built-in chatbot integrations (Chatwoot, Dify, n8n, OpenAI, Flowise, Typebot, EvoAI, EvolutionBot); media via `getBase64FromMediaMessage` or S3. Licence: Apache-2.0 **plus** logo-preservation and **Usage Notification Requirement** (`LICENSE`). Last stable release 2.3.7 (2025-12-05); 2.4.0-rc2 (2026-05-17, Baileys rc13); `main` last commit 2026-05-06; 145 open issues; 27 PRs merged since 2026-03.
**[FACT, failures]** #2597 outgoing stuck `PENDING` on 2.4.0 (open, no root cause); #2647 inbound received by Baileys but no `MESSAGES_UPSERT` webhook after days of uptime on 2.3.7, restart/re-pair as workaround (open); #2618 accounts requiring passkey cannot connect (53 comments, open); #2534 v2.4.0 requires **manual licence activation in `/manager`**, breaking automated self-hosting (open, no maintainer reply); #2538 bulk sending across instances raises ban concerns; #2298 account restricted after 1–2 days; #2463 QR loop / 515 / 408 attributed to CPU/RAM pressure; no webhook retry mechanism visible in the image (only `WEBHOOK_EVENTS_*` toggles).
**[INFERENCE]** Evolution is a capable, widely used *transport* whose reliability is bounded by Baileys and by a slowing release cadence; its persistence and bot integrations are conveniences, not a system of record; the v2.4.0 activation requirement is an operational and licensing red flag for unattended production.
**[RECOMMENDATION]** Keep Evolution 2.3.7 as the first WhatsApp transport only, behind the MYTHOS provider contract; never rely on its storage, bots or Chatwoot integration; do not upgrade to 2.4.x until the activation issue has a non-interactive path; plan the Cloud API provider before customer-facing scale.

### 5.2 Chatwoot

**[FACT]** Ruby 3.4 / Rails 7.2, PostgreSQL (`pgvector`, `neighbor`), Redis, Sidekiq, Vue; MIT except `enterprise/` (Chatwoot Enterprise License: valid licence key + seats for production). Captain AI models live under `enterprise/app/models/captain/` (assistant, document, custom tool, scenario, FAQ). Data model: `accounts` → `inboxes` (polymorphic `channel`: whatsapp, api, email, facebook_page, instagram, telegram, line, sms, tiktok, twilio_sms, twitter_profile, web_widget) → `contact_inboxes` → `conversations` (status open/resolved/pending/snoozed, priority low…urgent, assignee, team, SLA, `first_reply_created_at`, `waiting_since`) → `messages` (incoming/outgoing/activity/template, `content_type`, status sent/delivered/read/failed, `sentiment`); `automation_rules` (event_name + conditions + actions, `message_created`, `conversation_created/updated`, delays); roles agent/administrator (+ custom roles in enterprise); reports builder (timeseries, summaries per inbox/user/label/team, CSAT, live conversations); webhook events `conversation.created/updated/resolved/read/bot_handoff`, `message.created/updated`, `captain.*`; API channel (`channel_api`: `webhook_url`, `identifier`, `hmac_token`). WhatsApp providers: `default` (360dialog) and `whatsapp_cloud`; Evolution integration lives on Evolution's side. Requirements doc: 4 GB RAM / 4 cores for ~10 000 conversations/day, Sidekiq 1 GB+.
**[FACT, failures]** #13837 BSUID/usernames require a re-keying of contact identity before mid-2026; #14494 v4.14 blocked webhooks to private LAN addresses in self-hosted setups; #13970 WhatsApp Flow replies dropped; Sidekiq memory growth and Postgres degradation at millions of conversations reported in community guides (INFERENCE-grade).
**[INFERENCE]** The best-documented inbox model in open source; its AI is licence-gated; running it next to MYTHOS-WP would create two systems of record for customers and no path for MYTHOS's verified-facts rule.
**[RECOMMENDATION]** Reference only: adopt its conversation lifecycle, `contact_inboxes` identity mapping, automation-rule shape and webhook event taxonomy; do not deploy.

### 5.3 Evo CRM Community

**[FACT]** Umbrella repo (v1.1.0 2026-09-02) with six services: `evo-auth-service-community` (Rails 7.1), `evo-ai-crm-community` (Rails 7.1 — **derived from Chatwoot**, per its `NOTICE`; schema adds `pipelines`, `products`, `ai_agent_products`, `scheduled_actions`, `crm_forms`), `evo-ai-frontend-community` (React/Vite), `evo-ai-processor-community` (Python/FastAPI, Google ADK, LangGraph, Pinecone/Qdrant/OpenSearch, MinIO), `evo-ai-core-service-community` (Go/Gin), `evo-bot-runtime` (Go/Gin, Redis debouncing, dispatch across instances), `evo-flow-community` (NestJS, **Temporal** journeys, **ClickHouse** segments, **Kafka** events); providers Evolution API / Evolution Go; **single-tenant by design**; licence Apache-2.0 + logo + Usage Notification; 5 main contributors; backend at `v1.0.0-rc2`.
**[INFERENCE]** Strong conceptual coverage (inbox + CRM + agents + journeys) but a very heavy, young stack (Temporal, Kafka, ClickHouse, vector DB, MinIO, three languages) with a small team; single-tenant conflicts with MYTHOS multi-service; the AI stack is imposed.
**[RECOMMENDATION]** Reference for pipeline/scheduled-action ideas; not adopted as core or as a component.

### 5.4 Dify

**[FACT]** Python 3.12 Flask + Celery + Redis + PostgreSQL + vector store, Next.js web; ≈10 containers minimum in the reference compose; apps (chatbot, agent, workflow), RAG (vector/full-text/hybrid/rerank, parent-child chunking, metadata filtering, external knowledge bases via API), plugins/tools, model providers, observability integrations; service API per app and datasets API. Licence: modified Apache-2.0 — **no multi-tenant operation** without written authorisation, logo/copyright preservation, contributor clause. 1.17.0 (2026-08-25), daily commits. (Workflow docs page returned 404 in this round; workflow facts come from the README.)
**[INFERENCE]** Excellent reference for RAG hygiene (chunking, hybrid retrieval, rerank, metadata) and for run observability; as a component it would hold MYTHOS knowledge outside `mythos_wp`, add a large footprint to a host already under memory pressure, and cannot be offered per-service (tenant) under its licence.
**[RECOMMENDATION]** Learn: hybrid retrieval + rerank, parent-child chunks, per-run tracing fields, "external knowledge base" API shape. Do not install.

### 5.5 n8n

**[FACT]** TypeScript/Node; Sustainable Use License (internal business use permitted; no commercial redistribution/hosting for others; `.ee` files under Enterprise licence); queue mode = main + workers + optional webhook processors over Redis with PostgreSQL (SQLite unsupported), shared encryption key, worker concurrency default 10; execution history in DB; official WhatsApp nodes target **Meta Cloud API only** (`graph.facebook.com`, webhook auto-verification); Evolution support only via community nodes (`oriondesign2015/n8n-nodes-evolution-api`, MIT, last push 2025-03-20). n8n@2.37.10 (2026-09-04). An n8n instance already runs on the MYTHOS host (`n8n-n8n-1`, loopback :5678).
**[INFERENCE]** A robust, licence-safe (internal use) automation layer; unsuitable as the conversation database or as the WhatsApp ingress for Evolution (community node, stale).
**[RECOMMENDATION]** **Optional automation layer (B)**: consume Communication Core events via webhook, act back through the MYTHOS API; never own conversation state; credentials stay in n8n's encrypted store; retries handled by MYTHOS's ledger, not by n8n.

### 5.6 Typebot

**[FACT]** Bun/TypeScript monorepo (builder, viewer, chat-api, bot-engine, blocks incl. webhook/integrations, `packages/whatsapp`); WhatsApp integration uses **Meta Cloud API only** ("bring your own Meta application", Graph `v21.0`), sessions 0–48 h (default 4 h), limits: 3 buttons/20 chars, no GIF/SVG, several blocks unsupported on WhatsApp; no Evolution/Baileys support and no human-handoff documentation. Licence **FSL-1.1-Apache-2.0**: permitted for internal use; **Competing Use** (offering a product that substitutes or has substantially similar functionality) is forbidden until the change date, when each version converts to Apache-2.0.
**[INFERENCE]** Typebot cannot sit on MYTHOS's Evolution transport without a bridge; embedding a flow builder in a customer-facing MYTHOS offering is exactly the "competing use" the licence excludes; its value is the *visual flow model* (groups, blocks, variables, branching, webhook block).
**[RECOMMENDATION]** Not adopted. Borrow the flow model for MYTHOS automation rules (Phase I) — deterministic, versioned "scenarios" evaluated by the Core, not a separate runtime.

### 5.7 Twenty

**[FACT]** NestJS 11 + BullMQ + PostgreSQL + Redis + GraphQL/REST; metadata-driven objects (standard objects `person`, `company`, `opportunity`, `note`, `task`, `workflow`, `messaging`, `calendar`, `connected-account`; custom objects/fields); licence AGPL-3.0 with an *additional permission* for apps/SDK packages (MIT for SDKs), enterprise-marked files under commercial licence. v2.37.0 (2026-08-28), daily commits. Self-hosting docs page moved (redirect → 404 in this round; stack facts from `package.json`/README).
**[INFERENCE]** The best modern reference for a *metadata-driven object model* (custom objects/fields/views) and for BullMQ-based background jobs; AGPL would bind any MYTHOS modification that is offered over a network.
**[RECOMMENDATION]** Reference for custom attributes/views per project; not adopted.

### 5.8 EspoCRM · SuiteCRM · ERPNext / Frappe CRM

**[FACT]** EspoCRM (PHP, AGPL-3.0, 10.0.7) is fully metadata-driven (`entityDefs`, `clientDefs`, `aclDefs`, `scopes`, `logicDefs`, `integrations`); SuiteCRM (PHP, AGPL-3.0, 1 374 open issues); ERPNext (Python/Frappe, GPL-3.0) and Frappe CRM (AGPL-3.0, v1.83.0) build on Frappe DocTypes (lead/deal pages, Kanban, custom views).
**[INFERENCE]** Copyleft (AGPL/GPL) and PHP/Python stacks make them non-candidates for reuse in MYTHOS-WP; EspoCRM's declarative ACL-per-entity and Frappe's DocType permission matrix are worth copying as *patterns* for MYTHOS agent permissions.
**[RECOMMENDATION]** Patterns only (entity-level ACL, field-level permissions, custom views). No adoption.

### 5.9 WhatsApp gateway alternatives

| Provider | Official | Basis | Stability (evidence) | Ban risk | Multi-account | API | Webhooks | Media | Licence | Future viability |
|---|---|---|---|---|---|---|---|---|---|---|
| **Meta Cloud API** | Yes | Meta-hosted Graph API | 99.9% uptime claim; retries 36 h with `X-Hub-Signature-256` [FACT] | None for compliant use; opt-in rules | Yes (numbers under a WABA) | REST | Signed, retried, batched, **deduplicate yourself** [FACT] | Media ids, upload/download | Meta terms | Highest; On-Premises sunset 2025-10-23 [FACT] |
| **Evolution API** (Baileys) | No | WhatsApp Web protocol (Baileys rc.9) | Webhook loss after days (#2647), PENDING sends (#2597), passkey (#2618) [FACT] | Real (Error 463, #2707; restrictions #2298) | Instances | REST + events | Unsigned; no retry; optional headers [FACT] | base64 / S3 | Apache + notification clause | Medium: last stable 2025-12; 2.4.0 needs manual activation |
| **WAHA** | No | WEBJS (puppeteer), NOWEB (Baileys), GOWS (whatsmeow) | Passkey pairing implemented (GOWS) [FACT]; webhooks stopping until reconnect (#1456), 463 on cold contacts (#1992) | Real (#2223 restrictions) | Yes (all features free since 2026.6.1) [FACT] | REST | Yes | Yes | Apache-2.0 [FACT] | Medium-high: monthly releases, three engines |
| **WPPConnect server** | No | puppeteer + `@wppconnect/wa-js` | active (v2.10.16) | Real | Multiple sessions | REST | Yes | Yes | Apache-2.0 | Medium |
| **Venom** | No | puppeteer 24 | active | Real | Sessions | Library | — | Yes | Apache-2.0 | Medium-low (library, not a server) |
| **whatsapp-web.js** | No | puppeteer (browser) | v1.34.7 2026-04; README: "not guaranteed you will not be blocked" [FACT] | Real | Library | Library | — | Yes | Apache-2.0 | Medium |
| **Baileys** (library) | No | WebSocket protocol | rc14 2026-07-29; open pairing/463 issues | Real | Library | — | — | Yes | MIT | Medium; passkey PRs unmerged |
| **whatsmeow** (library) | No | Go protocol | passkey support since 2026-06-30 [FACT] | Real | Library | — | — | Yes | MPL-2.0 | Medium-high (active, used by WAHA GOWS) |

**Cloud API vs WhatsApp Web/Baileys — the decisive differences [FACT unless marked]:** Cloud API is the only Meta-supported channel; it requires a business portfolio, a WABA and a number *not registered on the WhatsApp app*; throughput 80 msg/s per number by default; per-message pricing since 2025-07-01 (marketing always paid; utility/authentication paid outside the 24 h customer-service window; service messages free; 72 h free window from ads/CTAs); templates need approval; webhooks are signed, retried for 36 h and may duplicate. Web-protocol gateways need a phone-linked account, cost nothing per message, deliver everything a personal client can (reactions, view-once, groups) but violate WhatsApp's terms for automation, expose the account to restrictions, depend on reverse-engineered protocol updates (passkey linking, `companion_reg_refresh`, 463 tokens) and sign nothing on their webhooks. Vendor blogs report a further change charging in-window service replies from 2026-10-01 [INFERENCE — not present in Meta's pricing page fetched today; treat as unconfirmed].

**[RECOMMENDATION]** Provider contract first; Evolution now; Cloud API second as a direct adapter (see §10.8 for why not through Evolution); WAHA-GOWS as the fallback Web-protocol engine if Evolution stalls (already verified in `docs/MYTHOS_WHATSAPP_PROVIDER_STRATEGY.md`).

---

## 6. Licensing table (from official LICENSE files)

| Project | Licence | Commercial use | Modification | SaaS / hosting for others | Restrictions | Risk for MYTHOS |
|---|---|---|---|---|---|---|
| Evolution API | Apache-2.0 + conditions | Yes | Yes | Yes | keep logo in its front end; **display a "uses Evolution API" notice** to admins | Low (notice already documented) |
| Evo CRM Community | Apache-2.0 + same conditions | Yes | Yes | Yes | logo + usage notice | Low, but single-tenant design |
| Chatwoot | MIT (core) / Enterprise License (`enterprise/`) | Yes (MIT part) | Yes | Yes | Captain AI and other `enterprise/` code need a licence key + seats | Medium if AI wanted |
| Dify | Apache-2.0 modified | Yes | Yes | **Not multi-tenant without written permission** | logo/copyright in front end | High for a per-service offering |
| n8n | Sustainable Use License + Enterprise (`.ee`) | Internal business use | Yes | **No** (no hosting for third parties) | notices kept | Low as internal layer; high if resold |
| Typebot | FSL-1.1-Apache-2.0 | Internal use yes | Yes | **No competing product/service** | converts to Apache-2.0 per version later | High if embedded in a MYTHOS offering |
| Twenty | AGPL-3.0 (+ MIT SDK packages, enterprise-marked files) | Yes | Yes, copyleft over network | Yes with AGPL obligations | source disclosure of modifications | Medium-high (copyleft) |
| EspoCRM / SuiteCRM / Frappe CRM | AGPL-3.0 | Yes | Copyleft | AGPL obligations | — | High for code reuse |
| ERPNext | GPL-3.0 | Yes | Copyleft | — | — | High for code reuse |
| WAHA | Apache-2.0 | Yes | Yes | Yes | — | Low |
| WPPConnect / Venom / whatsapp-web.js | Apache-2.0 | Yes | Yes | Yes | — | Low (ToS risk is WhatsApp's, not licence) |
| Baileys | MIT | Yes | Yes | Yes | — | Low |
| whatsmeow | MPL-2.0 | Yes | File-level copyleft | Yes | modified MPL files disclosed | Low |
| Meta Cloud API | Platform terms | Yes | n/a | Yes (BSP rules) | opt-in, templates, pricing | Commercial, not licence |

---

## 7. Real-world risk analysis — what MYTHOS must not repeat

7.1 **Identity keyed on phone numbers** — Meta's BSUID/usernames rollout (May–Aug 2026) means `wa_id` may stop being a phone number; Chatwoot had to introduce staged identity routing (#13837). MYTHOS: `wp_contacts` needs a provider-scoped identity table (channel, provider, external id kind, value) with the phone as one identity among others. [FACT + RECOMMENDATION]
7.2 **Session fragility** — passkey-required linking (Baileys #2672, Evolution #2618, OpenWA #560; whatsmeow implemented it), `companion_reg_refresh`, stale-QR scans (MYTHOS diagnosis). MYTHOS: pairing runbook already terminal-based; add health probes on `connection.update` and an "instance degraded" alert. [FACT]
7.3 **Silent inbound loss** — Evolution #2647 (no webhook after days), WAHA #1456 (webhooks stop until reconnect). MYTHOS: periodic reconciliation (`fetchMessages`-style probe or heartbeat message counts per instance), automatic instance restart policy, dead-letter replay. [FACT + RECOMMENDATION]
7.4 **Outbound stuck / silent failure** — Evolution #2597 (PENDING forever with 200 OK). MYTHOS already keeps `queued → sent → delivered` and never trusts HTTP 200 alone; add a "no ACK within N minutes" alarm. [FACT]
7.5 **Bans** — Error 463 reachout-timelock on cold contacts (Baileys #2707, WAHA #1992) and bulk sending (#2538, #2298). MYTHOS: never initiate cold outbound from the Web-protocol provider; rate caps per conversation already exist; marketing/outbound campaigns only through Cloud API templates. [FACT + RECOMMENDATION]
7.6 **Webhook trust** — Evolution signs nothing and does not retry; Meta signs, retries 36 h and duplicates. MYTHOS: header token + exactly-once ledger already; for Cloud API add HMAC verification and treat every event as at-least-once. [FACT]
7.7 **Ordering** — neither provider guarantees order; Meta batches up to 1000. MYTHOS: order by provider timestamp within a conversation, tolerate late arrivals, never derive state from arrival order (status updates never downgrade — already implemented). [FACT + RECOMMENDATION]
7.8 **Media** — base64 in webhooks bloats payloads (Evolution `webhookBase64`, MYTHOS off); media keys are decryption secrets (stripped). MYTHOS: download on demand through the provider, store outside the DB, scan, size-cap. [FACT]
7.9 **Persistence in the transport** — Evolution's optional DB storage is raw Baileys JSON, cannot be the system of record (and its logs at debug level leak Signal keys — MYTHOS incident 2026-09-05). [FACT]
7.10 **Scaling** — Chatwoot: Sidekiq 1 GB+, Postgres degradation at millions of rows; Evo CRM: Temporal/Kafka/ClickHouse; Dify: ≈10 containers. MYTHOS host is shared and memory-constrained (OOM history). Keep the Core in one Node process + Postgres, add workers only when measured. [FACT + INFERENCE]
7.11 **Vendor lock-in** — Evolution's 2.4.0 manual activation (#2534) and slowing releases; Cloud API pricing changes yearly. MYTHOS: provider contract with two implementations before scale. [FACT]
7.12 **Security lessons already learned in MYTHOS** — stale systemd unit sent 6 messages unintentionally (loaded unit ≠ file); debug logs leaked keys; QR relayed through chat is unsafe and stale. Keep: loaded-state verification, no debug in production, terminal-only pairing, secrets by file reference. [FACT]

---

## 8. Architecture comparison (scores 1–10; higher is better for MYTHOS)

| Option | Dev speed | Control | Scale | Maint. | Licence | Custom. | AI integ. | Multi-service | Multi-inbox | WhatsApp | Future channels | CRM | Automation | Security | Data ownership | Ops complexity | **Avg** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 Build everything (incl. transport) | 2 | 10 | 6 | 5 | 10 | 10 | 9 | 9 | 9 | 3 | 6 | 7 | 6 | 8 | 10 | 4 | **7.1** |
| 2 Chatwoot as core | 7 | 4 | 7 | 5 | 6 | 4 | 3 | 6 | 9 | 7 | 9 | 5 | 6 | 6 | 5 | 4 | **5.8** |
| 3 Evo CRM as core | 6 | 3 | 5 | 3 | 6 | 3 | 5 | 2 | 8 | 8 | 5 | 7 | 6 | 4 | 4 | 2 | **4.8** |
| 4 Evolution + Chatwoot | 7 | 4 | 6 | 4 | 6 | 4 | 3 | 5 | 8 | 7 | 8 | 5 | 6 | 5 | 5 | 4 | **5.4** |
| 5 Evolution + Dify + n8n | 6 | 4 | 5 | 3 | 3 | 5 | 6 | 3 | 5 | 7 | 5 | 2 | 8 | 4 | 4 | 2 | **4.5** |
| 6 Evolution + native MYTHOS Core | 7 | 9 | 7 | 8 | 9 | 9 | 9 | 9 | 9 | 7 | 7 | 8 | 6 | 8 | 10 | 8 | **8.1** |
| **7 Hybrid: provider contract (Evolution now, Cloud API next) + native Core + MYTHOS AI + optional n8n + reference patterns** | 7 | 9 | 8 | 8 | 9 | 9 | 9 | 10 | 9 | 9 | 9 | 8 | 8 | 8 | 10 | 7 | **8.6** |

Why the scores: options 2–4 lose on *control*, *AI* (Captain is Enterprise) and *data ownership* (two systems of record), and would double the host footprint; option 3 adds a six-service stack and single-tenancy; option 5 fails licensing (Dify no-multi-tenant, n8n as a hosted core) and leaves no verified-facts guard; option 1 pays for a transport nobody should write; option 6 is what MYTHOS has, minus the second provider; option 7 adds the provider contract and the Cloud API path, which is what makes WhatsApp and future channels score high without re-architecting.

---

## 9. MYTHOS Reuse Matrix

| Capability | Best existing project | Reuse | Build native in MYTHOS | Why |
|---|---|---|---|---|
| WhatsApp transport (Web protocol) | Evolution API (fallback WAHA-GOWS) | **YES** (run as is) | NO | Nobody should re-implement the protocol; keep it replaceable |
| WhatsApp transport (official) | Meta Cloud API | **YES** (second provider) | Adapter only | Only supported path; pricing and identity rules differ, so it must be a first-class provider |
| Provider abstraction | — (Chatwoot's polymorphic `channel` as pattern) | Pattern | **YES** | Two providers + future channels need one contract |
| Inbox / conversation lifecycle | Chatwoot | Pattern (statuses, `contact_inboxes`, `waiting_since`, `first_reply_at`) | **YES** (exists) | System of record must be MYTHOS |
| Contact identity | Chatwoot BSUID handling | Pattern | **YES** (extend) | BSUID/usernames + multi-channel identities |
| Contacts / CRM (light) | Twenty (custom objects), Evo CRM (pipelines) | Pattern | **YES** | Per-service attributes; sales pipeline only for services that need it |
| Products / stock / prices | MYTHOS-WP (existing) | n/a | **YES** (exists) | Verified facts are the differentiator |
| Knowledge / RAG | Dify (retrieval hygiene) | Pattern | **YES** (pgvector in `mythos_wp` later) | Licence + data locality |
| AI reasoning | #173 engine + Claude API | **YES** (exists) | Extend (LLM generator, prompts versioned) | Fact guard and policy gate already in place |
| Suggest / auto-reply / handoff | MYTHOS (exists, suggest-only) | — | **YES** | Policy must know MYTHOS rules |
| Flows (guided conversations) | Typebot (model only) | Pattern | **YES** (deterministic scenarios) | FSL competing-use + Cloud-API-only |
| Automation (peripheral) | n8n (existing instance) | **YES / PARTIAL** | Core rules native | Internal use is licence-safe; state stays in MYTHOS |
| Event model | Chatwoot `events/types.rb`, Meta webhooks | Pattern | **YES** | At-least-once, dedup, replay |
| Media pipeline | Chatwoot ActiveStorage (pattern) | Pattern | **YES** | Scan, quarantine, no bytes in DB |
| Analytics | Chatwoot `report_builder` metrics | Pattern | **YES** (SQL views) | Must reconcile with MYTHOS tables |
| Agents / teams / permissions | Chatwoot roles, EspoCRM ACL | Pattern | **YES** (inbox members exist) | Scope by inbox and project |
| Audit | MYTHOS `wp_audit_events` (exists) | — | **YES** | Already redaction-aware |
| Notifications to owner | MYTHOS bridge (exists) | — | keep separate | Never mixed with customer inboxes |

---

## 10. Target architecture (corrected after research)

```
Channel  (whatsapp · instagram · messenger · telegram · webchat · email)
   ↓
Provider (evolution · meta_cloud · meta_messenger · telegram_bot · webchat · imap/smtp)   ← CommunicationProvider contract
   ↓
Account  (the external identity: WhatsApp number / IG professional account / bot)   ← wp_inboxes.account_ref, reserved list
   ↓
Instance (provider-side handle: Evolution instance name, Cloud API phone_number_id, bot token ref)
   ↓
Inbox    (one per project × account × channel; switches: inbound, outbound, ai_suggest, auto_reply)
   ↓
Communication Core (receiver → normalise → dedupe → persist → publish)   [per project = tenant]
   ↓
Conversation ── Message ── Attachment ── Events (append-only)
   ↓
Intelligence: intent → context → knowledge → products/stock → business rules → AI → policy gate
   ↓
Suggest (human sends) | Auto-reply (policy-gated, kill switch) | Handoff (needs_human, members)
   ↓
Business systems: catalogue, stock, appointments, orders, CRM attributes; audit; analytics; automations (native rules, optional n8n)
```

Corrections to the draft diagram: **Account** sits between Provider and Instance (identity is what gets reserved, rotated or migrated); **Inbox** is per project × account × channel, not per instance; **Events** are a first-class output of the Core, feeding AI, automation and analytics alike; **Business systems** are consumed through ports (verified facts), never queried by the model directly.

### 10.1 Domain model and relations

| Entity | Owner | Key relations | Status in MYTHOS |
|---|---|---|---|
| project (= service, tenant) | owner | 1:N inboxes, contacts, conversations, knowledge, products, rules, AI config, members | exists (`kind`) |
| channel | catalogue value | provider belongs to a channel | implicit (`provider` enum) |
| provider | code | implements the contract for one channel | Evolution only |
| account | project | `account_ref` (+ future `channel`, `kind`); reserved list | exists |
| instance | provider | `wp_inboxes.instance` | exists |
| inbox | project | account + provider + switches; N:M members | exists |
| agent / team | project | `wp_inbox_members` (role, team); future `wp_teams` | foundation exists |
| contact | project | 1:N identities (phone, BSUID, IG id…), N:M tags, memory | exists; identities missing |
| conversation | inbox + contact | status, assignee, team, priority, timings, 1:N messages/events | exists |
| message / attachment | conversation | direction, provider ids, states, client_ref, ai_run | exists |
| knowledge / products / stock / rules | project | read through ports | exists |
| automation rule | project | trigger event + conditions + actions, versioned, kill switch | missing |
| AI run / suggestion | conversation | decision, facts, confidence, prompt version | exists |
| handoff | conversation | reason, status, assignee | exists |
| audit | project | every mutation, redacted | exists |

### 10.2 Multi-service, multi-inbox, numbers

- **One number = one customer-facing service** (decision of the Gate 3 review, confirmed): sharing an account across services mixes identities, quotas and ban blast radius; the only exception is an `internal` inbox that opts in explicitly. [RECOMMENDATION]
- **Change a number**: create the new account/instance/inbox, pair, run both inboxes on the project for a transition window (contacts are per project, so history stays attached), then set the old inbox `closed` and archive; no data moves. **Add / remove**: same rows; removal = close inbox + disable webhook, never delete rows. **Move a number to another service**: forbidden by the unique account rule unless the old inbox is closed first; conversations remain with the old project (audit trail).
- **Evolution → Cloud API**: new inbox with `provider = meta_cloud`, same project, same contacts (identity table maps phone ↔ BSUID), templates allowed only there; outbound routing chooses the inbox of the conversation; migration is per inbox, not per project.
- **Instagram / Messenger**: Meta Messenger Platform webhooks (signed, retried) → `meta_messenger` provider; identities are page-scoped ids (PSID/IGSID); 24 h messaging-window rules apply [FACT for Meta webhooks; window rule INFERENCE from Meta docs]. **Telegram**: Bot API `setWebhook` with `secret_token` [FACT]. **Web chat**: MYTHOS-owned widget posting to the receiver with a per-site key. **Email**: IMAP/SMTP provider with thread ids as conversation keys. Each is one provider module and one channel value; the Core, inbox UI, AI and rules do not change.

### 10.3 AI layer (validated against the projects)

`Incoming message → Intent detection (engine #173) → Context builder (last N messages, contact memory, inbox settings) → Conversation memory (summary + structured memory, not raw transcript) → Knowledge (project-scoped, hybrid retrieval later, Dify pattern) → Products / Stock (verified ports) → Business rules → AI (Claude via API; template generator today) → Policy gate → Suggest | Auto-reply | Human`.
Guard rails (policy, enforced in code, not in the prompt): no price/stock/policy/delivery claim without a port fact; no reply when the conversation is `needs_human` or has an open handoff (target — see §10.7); customer text is data (schema-validated JSON output, no tool execution from a run); no secrets or other conversations in context; every run stored with prompt version, facts used, confidence and rejections; auto-reply requires project opt-in **and** inbox opt-in **and** confidence ≥ threshold **and** allowed intent, with a global kill switch.

### 10.4 Media

Download on demand through the provider (never from webhook base64); quarantine → type/size validation (limits per kind) → scan → store outside the DB under a per-project path with a hash → thumbnails for images/video → transcription (voice) / OCR (documents) / vision (images) as AI runs of kind `transcribe|vision` with their own costs → retention by project rule → never public URLs, access through the panel session with audit.

### 10.5 Event model

Provider-neutral names: `message.received`, `message.sent`, `message.delivered`, `message.read`, `message.failed`, `conversation.created|updated|assigned|resolved|reopened`, `contact.created|merged`, `handoff.created|resolved`, `ai.run|suggested|sent|rejected`, `automation.triggered|failed`, `inbox.status`. Rules: at-least-once from providers, exactly-once in the ledger (provider id + inbox; `client_ref` outbound), ordering by provider timestamp per conversation (target — see §10.7), status monotonic, dead-letter with redacted payload and replay tool (target — see §10.7), every event appended to `wp_conversation_events` and exposed to SSE / n8n webhooks, observability = counts per status per inbox per hour.

### 10.6 Security

Webhook auth per provider (header token now; HMAC for Meta — target, see §10.7); credentials by file reference, rotation by file swap; tenant isolation by `project_id` in every query and by membership scope; RBAC roles owner/operator + inbox agent/lead/viewer; media access gated; prompt-injection = data-only handling + schema output + no tools; redaction at log/audit boundaries; retention by rule; backups of `mythos_wp` in the existing backup job; loaded-unit verification after every systemd edit; no debug logging of the transport in production.

---

## 10.7 Current vs Target — verified implementation drifts (review amendment, 2026-09-05)

The Architecture Decision Review of this artifact checked §10 against the code on `main` (`3ed398f`). Three statements in §10 describe the **target**, not the current behaviour. They are recorded here so nobody reads §10 as an inventory of what exists; all three are in the confirmed scope of MYTHOS-COMMS-9. [FACT, from `projects/mythos-wp/reference/comms/`]

| Topic | Current (verified in code) | Target (§10) | Where it lands |
|---|---|---|---|
| Message ordering | Timeline and conversation previews order by `wp_messages.created_at` (arrival order); `provider_timestamp` is stored but not used for ordering (`reference/comms/inbox.js`) | Order by provider timestamp within a conversation, `created_at` as tie-breaker, late arrivals tolerated | COMMS-9 |
| AI refusal gate | `assistant.suggest()` reads the conversation status but does not refuse when the conversation is `needs_human` or has an open handoff; a run can still be started manually on such a conversation (`reference/comms/assistant.js`) | No AI run, suggestion or auto-reply on a conversation flagged for a human (`needs_human`, open `wp_handoffs`) | COMMS-9 |
| Webhook verification | Receiver authenticates every provider delivery with the 0600 shared token (header `x-mythos-webhook-token` or query), compared in constant time (`reference/comms/receiver.js`); no signature verification exists | Provider-specific `verifyWebhook`: shared token for Evolution (it signs nothing), HMAC `X-Hub-Signature-256` with the app secret for Meta Cloud API / Messenger | COMMS-9 (contract) and Phase L (Meta adapter) |

Also confirmed as **target only**: the dead-letter replay tool (§10.5) and the delivery-reconciliation alarm (§7.4) do not exist yet; `wp_inbound_events` already keeps the redacted payloads a replay would consume.

## 10.8 Evolution-hosted Cloud API versus a direct MYTHOS adapter (review amendment)

**[FACT]** The deployed Evolution API 2.3.7 image contains a `WHATSAPP-BUSINESS` integration (Meta Cloud API through `graph.facebook.com`) next to `WHATSAPP-BAILEYS`; an instance can therefore be created against a Cloud API phone number and MYTHOS would receive the same Evolution webhooks it receives today. Evolution issue #2573 (open) reports the Cloud API status webhooks crashing the message handler, and #2534 reports the mandatory manual licence activation from v2.4.0.

**[INFERENCE]** Routing the official channel through Evolution would be the fastest path (no new adapter) but would keep every property of the Web-protocol dependency that the research identified as the main risk: unsigned, non-retried webhooks that lose Meta's signature and retry semantics; message normalisation dictated by Evolution's Baileys-shaped payloads; templates, pricing categories and the 24 h / 72 h windows invisible to MYTHOS; release cadence and the 2.4.0 activation requirement on the critical path of the *official* channel too; and a single vendor between MYTHOS and both of its WhatsApp transports.

**[RECOMMENDATION]** MYTHOS keeps Meta Cloud API as a **direct provider adapter** (`meta_cloud`) implementing the same `CommunicationProvider` contract as the Evolution adapter: Meta webhooks are verified with HMAC and treated as at-least-once, templates and messaging windows become provider capabilities the policy gate can see, and the account/number lifecycle in §10.2 applies unchanged. The Evolution-hosted Cloud API path remains a documented fallback for a fast pilot only, never the production design. The principle is the one the whole decision rests on: the Core, the inbox, the AI and the rules must never know which transport carried a message, and no single vendor may sit in front of every transport.

## 11. FINAL ARCHITECTURE DECISION

**Hybrid (option 7): Meta-agnostic `CommunicationProvider` contract with Evolution API as the first WhatsApp transport and Meta Cloud API as the second; a native MYTHOS Communication Core (already in `projects/mythos-wp`) as the single system of record for projects, inboxes, contacts, conversations, messages, media metadata, events and audit; MYTHOS AI (engine #173 + Claude API, fact-guarded, policy-gated) as the intelligence layer; native automation rules with n8n as an optional peripheral consumer; Chatwoot, Evo CRM, Dify, Twenty and Typebot used as design references only.** No third-party inbox, CRM or AI platform is deployed as a component.

---

## 12. Roadmap (research output; not implemented here)

| Phase | Objective | Depends on | DB | API | UI | Tests | Security | Production gate |
|---|---|---|---|---|---|---|---|---|
| A Foundation (done: COMMS-1, 8) | tenant model, schema, migrations, account isolation, members | — | 0001–0004 | resources | inboxes/members | schema/multiservice | reserved accounts | applied |
| B Messaging (done: COMMS-2, 3, 5; next COMMS-9) | provider contract, event names, delivery reconciliation, dead-letter replay, BSUID-ready identities | A | `wp_contact_identities`, event names in ledger | provider capability endpoint | — | contract tests per provider | HMAC support | dry-run on `ssangyong-autos` |
| C Inbox (done: COMMS-4; extend) | assignment queues, handoff claim/assign/resolve, bulk actions | B | — | handoff routes | inbox pane | inbox tests | membership scope | Gate 5 real message |
| D CRM | contact identities, attributes per project, notes, merge, pipeline for `service` kinds | C | `wp_contact_identities`, `wp_contact_attributes` | contacts routes | contacts | tests | PII masking | — |
| E AI | LLM generator behind config, prompt versioning, context builder, knowledge retrieval | C | `wp_ai_prompts` | suggest | suggestion card | replay tests, injection tests | no secrets in context | Gate 8 real suggestion |
| F Auto-reply | policy per project/intent, thresholds, kill switch, rate caps | E | rules keys | policy endpoints | switches | policy tests | double opt-in | one week dry-run report |
| G Handoff | SLA timers, reasons, alerts through the notification bridge | C | `wp_handoffs` fields | — | queue | tests | — | alert < 1 min |
| H Media | download, quarantine, scan, storage, thumbnails, transcription/OCR/vision | B | attachments fields | media routes | viewer | size/type/security tests | access gating | — |
| I Automation | native rules (Typebot-style scenarios), n8n webhooks, idempotent actions | B, F | `wp_automation_rules`, runs | rules routes | rules editor | tests | kill switch | — |
| J Analytics | conversations/day, response/resolution times, AI acceptance, handoffs, failures | B–I | views | reports | dashboard | reconciliation tests | no message text | — |
| K Multi-channel | Telegram bot, Messenger/Instagram, web chat, email providers | B | channel column | provider modules | inbox badges | contract tests | signed webhooks | per channel |
| L Cloud API | `meta_cloud` provider, templates, pricing awareness, number migration runbook | B, K | templates table | template routes | template picker | contract tests | HMAC, opt-in | first WABA number |

---

## 13. Open questions for the owner

1. Which services go live first after SSANGYONG.AUTOS (Dar Hijama needs appointments; MYTHOS PROD needs client events) — this orders Phase D attributes.
2. Budget and provider for the LLM generator (Claude API) and the acceptable monthly ceiling.
3. Whether a WABA and a Cloud API number should be provisioned now (Phase L) to hedge the Baileys risk before customer traffic.
4. Retention windows per project and the right to erasure procedure.
5. Whether n8n on this host is kept as the automation consumer or replaced by native rules only.

---

## 14. Recommended next implementation task

**MYTHOS-COMMS-9 — Provider contract and event ledger hardening**: formalise `CommunicationProvider` (`describe`, `parseInbound`, `sendText`, `fetchMedia`, `verifyWebhook`), provider-neutral event names in `wp_inbound_events` and `wp_conversation_events`, `wp_contact_identities` (phone, BSUID, LID, future channel ids) with contact resolution by identity, delivery-state reconciliation alarm, dead-letter replay CLI, contract test suite runnable against a fake provider. It unblocks Cloud API, multi-channel and safe auto-reply, and it does not depend on Gate 3.

## 15. Shared WhatsApp Account Mode (amendment, 2026-09-05 — MYTHOS-COMMS-11, #228)

**Status.** Explicit exception to §10.2 / §11. The recommended architecture stays **one number = one Evolution instance = one customer-facing service**. Shared-account mode is intended for controlled/internal deployments only (the owner's existing account carrying MYTHOS notifications *and* a first customer service) and carries additional privacy complexity. It is not the default and must never be enabled implicitly.

**Topology (the only safe one).**

```
WhatsApp account (one number)
  └─ ONE Evolution instance (`mythos-bridge`) — one session, never a second linked device
       └─ CommunicationProvider (Evolution adapter: own messages, self-chat, groups, broadcasts dropped pre-content)
            └─ PRIVACY GUARD  (routing.resolve → DROP before any ledger row)
                 └─ ROUTING POLICY  (wp_inbox_routes: allowlist | opt_in, priority, enabled, window)
                      └─ LOGICAL INBOX  (wp_inboxes.account_mode = 'shared', one per service)
                           └─ PROJECT (members, conversations, AI suggestions, handoffs)
```

The instance identifies the *session*; the routing rule identifies the *service*. The rejected alternative — the same account paired to a second Evolution instance — is a second linked device: duplicate ingestion of every message, doubled exposure of the personal history, session conflicts between two Baileys clients, and the notification channel exposed to any anti-abuse signal. It is **not** a supported topology.

**Data model (migration 0006, additive).** `wp_inboxes.account_mode` `dedicated|shared` (shared requires `account_ref`; several logical inboxes may share one `(provider, instance)` only when all are shared; a dedicated inbox keeps the COMMS-1..9 1:1 rule). `wp_inbox_routes` binds one sender identity (`phone|lid|bsuid|provider_user`) on one instance to one inbox, with a composite foreign key on `(inbox, project, provider, instance)` so a rule can never point across projects or instances; `kind` `allowlist` (routes at once) or `opt_in` (identity pre-registered by an operator, optional second-factor code that must appear in the text, expiry window, `activated_at` on first routed inbound). `wp_routing_drops` is the only trace of a dropped event: decision, reason, `sha256(kind:value:instance)` and `sha256(payload)` — no number, no message id, no text.

**Default deny.** No matching enabled rule → `UNROUTED` → drop. There is no "default inbox", no keyword-only entry (the opt-in code without a pre-registered identity is `UNROUTED`), and every fault (malformed rule, rule outside the instance, dedicated + shared on one instance, missing identity, expired window, missing code) fails closed with its own reason. Dead-letter replay goes through the same decision.

**Owner exclusion.** The account's own number (the inbox `account_ref`) and every `wp_reserved_accounts` entry can neither be routed (`wp_inbox_routes_owner_excluded` trigger + 412 in the API) nor ingested (`OWNER_EXCLUDED` drop). The adapter already drops `fromMe`, self-chat, groups and broadcasts before reading content; delivery/read events for messages the Core did not send are ignored with hash only. Consequence documented as a limitation: **replies typed by the owner on the phone are own messages and are not mirrored into the inbox** (future product decision, not part of COMMS-11).

**Internal notification separation.** The bridge sends notifications from the account *to itself* (`MYTHOS_BRIDGE_WHATSAPP_TO` = the owner number): they never enter an inbox, the Core never answers them, and the outbound path of the bridge is untouched by COMMS-11. Human replies from a shared inbox go out through the same instance and come back as own messages, which the adapter drops — no outbound → inbound loop; the assistant remains suggest-only; reconciliation never resends.

**Reserved-account guard (made explicit).** Reserved account + `account_mode='shared'` + `settings.allow_personal_account=true` is the only accepted combination; every accepted opt-in writes an audit row (`db:wp_inboxes_guard`, number masked). Reserved account in dedicated mode, shared mode without the opt-in, shared mode without `account_ref`, and `mythos-bridge` outside shared mode are all refused. `mythos-bridge` may host **only** shared inboxes.

**Limitations.** Unknown-instance dead-letters keep a redacted payload (COMMS-2 semantics) — the shared inbox row and its rules must exist *before* the instance webhook is enabled, otherwise personal traffic from that instance would be dead-lettered; identity matching is by phone/LID/BSUID only (no name heuristics by design); an opt-in code is a second factor, never a first; the inbox resource still refuses `mythos-bridge` on creation — shared inboxes are created through the audited CLI/API path.

**Risks.** Every message to the shared account reaches the receiver (hashes are recorded for all drops — volume, not content); a mis-registered identity would route a personal contact into a business inbox (mitigated by explicit per-identity rules, audit, and one-target uniqueness); the personal account's WhatsApp standing is shared with the business use (unofficial protocol); rollback of 0006 refuses while shared inboxes exist.
