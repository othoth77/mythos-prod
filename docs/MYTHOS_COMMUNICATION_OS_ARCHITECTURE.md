# MYTHOS Communication OS — Architecture

Living document. Decision record: GitHub Issue #196 (research, Option D « hybride minimal »).
Implementation Issues: #197 (COMMS-1 foundation) and the MYTHOS-COMMS-2 … 17 series.

## 1. Shape

```
WhatsApp customer ──► Evolution API v2.3.7 (customer instance per project; `mythos-bridge` = notifications only)
                          │ per-instance webhook (loopback), events MESSAGES_UPSERT / MESSAGES_UPDATE / CONNECTION_UPDATE
                          ▼
              MYTHOS Communication Receiver (COMMS-2)  — authenticate, validate, normalise, dedupe, persist, emit
                          ▼
              Communication Core in projects/mythos-wp — PostgreSQL `mythos_wp` (this document §3)
                          ▼
              wp.mythosprod.xyz — Inbox / Conversations / Contacts (COMMS-4 …)
                          ▼
              MYTHOS Intelligence — projects/automotive/comms (#173): intents, verified ports, fact guard, policy gate → Claude
                          ▼
              suggested reply (human sends) | auto-reply (policy-gated, OFF by default) | handoff (wp_handoffs)
```

Reused as-is: Evolution API (transport), `projects/automotive/comms` (decision engine), MYTHOS-WP auth / roles / CSRF / audit / redaction / knowledge / products / stock / business rules / handoffs.
Reference only: Chatwoot and Evo CRM data models (conversation lifecycle, `contact_inboxes`, `messages.status`), Dify (app / dataset separation), n8n (peripheral automation).

## 2. Provider model

`wp_inboxes.provider` names the transport: `evolution` today, `meta_cloud` reserved. A `CommunicationProvider` (COMMS-16) exposes `parseInbound(payload) → NormalisedEvent`, `sendText(inbox, to, text) → provider_message_id`, `fetchMedia(ref)`. Nothing above the receiver knows provider payload shapes; `wp_messages.raw` keeps the redacted provider payload for audit and replay only.

## 3. Data model (migration `0001_comms_core`)

| Table | Purpose | Key rules |
|---|---|---|
| `wp_inboxes` | one provider instance of one project | `UNIQUE (provider, instance)`; `instance <> 'mythos-bridge'` (CHECK); `inbound_enabled` / `outbound_enabled` default **false** |
| `wp_contacts` | customer identity per project | `UNIQUE (project_id, wa_id)`, `wa_id` digits only, optional `lid`; `memory` JSONB for structured context; `status` active / blocked / merged |
| `wp_conversations` | thread per contact × inbox | status open / pending / waiting_customer / needs_human / resolved / archived; **one live conversation per (inbox, contact)** (partial unique index); assignee, team, priority, unread, timings for analytics |
| `wp_messages` | every message, in / out / activity | **exactly once**: `UNIQUE (inbox_id, provider_message_id)`; `sender_kind` customer / user / ai / system; `status` received → queued → sent → delivered → read / failed; `raw` = provider payload minus credentials; `redacted_at` retention marker |
| `wp_message_attachments` | media metadata | bytes never in DB: `storage_ref` into the controlled media store, `sha256`, `scan_status`; Phase 13 fills `transcript` / `extracted_text` / `vision_summary` |
| `wp_conversation_events` | append-only journal | source of analytics and audit of the thread |
| `wp_tags`, `wp_contact_tags`, `wp_conversation_tags` | labels per project | name shape `[a-z0-9][a-z0-9_.-]*` |
| `wp_ai_runs` | one AI execution: decision, confidence, facts used, prompt version + hash, tokens, latency | never the prompt text, never a credential |
| `wp_ai_suggestions` | proposed texts and what the human did with them | links the sent outbound message |
| `wp_handoffs` (+`conversation_id`) | existing REQUIRES_HUMAN queue, now linked to the thread | manual entries keep working (nullable) |
| `wp_schema_migrations` | ledger | one row per applied version |

Ownership: every row carries `project_id` → `wp_projects`. Deleting a message referenced by an AI run is refused (integrity); attachments and tag links cascade with their parent.

Migrations: `projects/mythos-wp/database/migrations/<version>.{up,down}.sql`, runner `reference/migrate.js`, CLI `bin/mythos-wp migrate status|up|down <version>`; each file runs in one transaction. Base schema stays `database/schema.sql`; migrations are additive on top. Test: `tests/mythos-wp-comms-schema-test.js` (apply → fixtures → rollback → re-apply).

## 4. Privacy and retention

- No provider secret, token, session or key column exists (test-enforced by column name; receiver strips `apikey`-shaped keys before any insert).
- Stored WhatsApp identifiers: customer digits (`wa_id`), LID when provided, provider message ids, the business number masked for display.
- Retention is a business rule (`wp_business_rules` key `comms.retention`, per project): after the window, message `text` and `raw` are set to NULL and `redacted_at` stamped; rows, counters and events remain so analytics reconcile. Attachments become `purged` and the media object is removed from the store. Applied by an owner-run job (COMMS-17), never by the receiver.
- Right to erasure: contact `status = 'merged'|'blocked'` plus the same purge over its conversations.

## 5. Security principles (expanded in COMMS-15)

Receiver on loopback only, token compared in constant time, per-instance validation against `wp_inboxes`, body size limit, idempotency by provider message id, dead-letter for malformed events. Customer text is untrusted input: it is data for the model, never instructions; facts come only from ports; sending always passes policy + fact guard + human or explicit auto-reply rule. `LOG_BAILEYS=debug` is forbidden in production (leaks Signal session keys — incident 2026-09-05).

## 6. Deployment

`mythos-wp.service` (deploy user manager, 127.0.0.1:8170, nginx `wp.mythosprod.xyz`) executes from a checkout of `main`. Migrations are applied by the owner/operator with the production environment: `bin/mythos-wp migrate up`. Rollback: `migrate down <version>` (data in the dropped tables is lost — only acceptable while they are empty or after a backup).

## 7. Communication Receiver (COMMS-2)

Route `POST /hooks/evolution` on the panel's loopback server (`reference/comms/receiver.js`), mounted before any session logic and absent (404) unless `MYTHOS_WP_RECEIVER_ENABLED=1`. Pipeline: body limit (`MYTHOS_WP_RECEIVER_MAX_BODY`, default 512 KiB, 413 + connection close) → JSON → token from the 0600 file `MYTHOS_WP_WEBHOOK_TOKEN_FILE` (header `x-mythos-webhook-token` or `?token=`, constant-time compare, min 16 chars) → provider normalisation (`reference/comms/providers/evolution.js`: refuses own / group / status / self-chat / unresolved-LID by name, strips `apikey`, `token`, `mediaKey`, `fileEncSha256`, `url`, `directPath`, thumbnails and base64 from `raw`) → inbox lookup in `wp_inboxes` (unknown → 202 rejected + dead-letter) → `connection.update` sets `wp_inboxes.status` → messages: `inbound_enabled=false` ⇒ **dry-run** (ledgered, nothing persisted); `true` ⇒ `reference/comms/core.js` `ingest()` in one transaction: contact upsert, live conversation (or open one), message `ON CONFLICT DO NOTHING` (replay ⇒ duplicate, counters untouched), attachment metadata, unread + timestamps, `message_in` event.

Ledger `wp_inbound_events` (migration 0002): one row per delivery with status `persisted | duplicate | dry_run | ignored | rejected | failed`; the redacted payload is kept only for `rejected`/`failed` rows (dead-letter, replayable in COMMS-17). Logs carry reasons, instance, message ids and counts — never token, apikey, media keys or message text (test-enforced).

Provider contract seed: `parseInbound(body) → { ok, kind: message|connection, event }`, `redactDeep`, `payloadHash`. The `#173` engine keeps its own parser for decisions; the two never share a message path.

## 8. Customer instance and webhook (COMMS-3)

One Evolution instance per project, named after the project (`ssangyong-autos`), created with `ops/whatsapp/evolution/customer-instance.sh <instance>` (owner-run, idempotent, refuses `mythos-bridge`). The script sets a **per-instance** webhook to `http://127.0.0.1:8170/hooks/evolution` with `byEvents=false`, `base64=false`, events `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `CONNECTION_UPDATE`, and the receiver token as the request header `x-mythos-webhook-token` (stored in Evolution's private database, never in a URL). Host side: `/home/deploy/deployments/mythos-wp/webhook.token` (0600) + `MYTHOS_WP_WEBHOOK_TOKEN_FILE` + `MYTHOS_WP_RECEIVER_ENABLED=1` in the panel's 0600 env. The panel registers the instance in `wp_inboxes` (resource **WhatsApp → inboxes**, owner-writable, `mythos-bridge` refused by pattern and by CHECK) with `inbound_enabled=false` until Phase 4; `GET /api/comms/receiver` and the System page show enabled / token presence / inbox state without any secret. Pairing: `ops/whatsapp/evolution/qr-live.sh <instance>` with the owner's phone and the project's dedicated customer number; `connection.update` then moves `wp_inboxes.status` to `open`.

## 9. Inbox, conversations, contacts (COMMS-4)

Read/write model `reference/comms/inbox.js`, every query scoped by the resolved project. API (session, CSRF on mutations): `GET …/comms/conversations` (filters `status` incl. `live`, `assigned=me|none`, `tag`, `inbox`, `q` over name / number / summary / message text, cursor `before`; returns masked numbers, last message preview, tags, open-handoff flag, counts), `GET …/conversations/:id` (full number for operators), `GET …/conversations/:id/messages` (timeline with attachment metadata, cursor `before_id`), `POST …/read`, `PATCH` (status / assignee / priority / team / summary → journal event + audit), `POST …/notes` (activity row, never sent), tags (`GET/POST …/tags`, attach/detach on conversations and contacts), contacts (`GET`, `GET :id`, `PATCH` name / language / notes / status / memory). Live feed: `GET …/comms/events` (SSE; `message.in`, `message.note`, `conversation.updated`, `conversation.read`, `inbox.status` — ids and types only, never text; 25 s heartbeat), published by `reference/comms/bus.js` from the Core ingest and the API mutations. Front end: `views/inbox.js` (list + pane: timeline, handling, notes, tags, contact panel, reply box disabled until COMMS-5), `views/contacts.js`; navigation group **WhatsApp**: Inbox / Contacts / inboxes. The UI never calls the provider.

## 10. Human outbound (COMMS-5)

`reference/comms/outbound.js`: `POST /api/projects/:p/comms/conversations/:id/messages` `{ text, client_ref }` (operator, CSRF). Gates, in order: conversation exists in the project → same `client_ref` already used ⇒ the existing row is returned (200, no second send) → `wp_inboxes.outbound_enabled` (412) → inbox `open` (412) → per-conversation hourly cap `MYTHOS_WP_OUTBOUND_CAP_PER_HOUR` (default 30; 429). Then one `wp_messages` row `out / queued / user`, provider `sendText` (`providers/evolution.js`: `POST {base}/message/sendText/{instance}`, header `apikey` read at call time from the 0600 file `MYTHOS_WP_EVOLUTION_API_KEY_FILE`, base `MYTHOS_WP_EVOLUTION_BASE_URL` default loopback :8080), one automatic retry on a TRANSPORT error only, then `sent` + `provider_message_id` or `failed` + scrubbed error; conversation → `waiting_customer`, `first_reply_at`; journal `message_out` / `send_failed`; audit; SSE `message.out`. `POST …/messages/:mid/retry` re-sends one `failed` row (max 5 attempts). Delivery state: Evolution `messages.update` (`SERVER_ACK→sent`, `DELIVERY_ACK→delivered`, `READ/PLAYED→read`, `ERROR→failed`) updates the outbound row through the receiver, never downgrading; SSE `message.status`. Migration 0003: `client_ref` (unique per conversation), `attempts`, and the provider-id CHECK now applies to inbound rows only. `mythos-bridge` stays impossible as an inbox (CHECK), so the notification path is never used for customer replies.

## 11. AI assistant, suggest-only (COMMS-7)

`reference/comms/assistant.js` runs the MYTHOS AUTO engine (#173) exactly as the panel simulator does — forced dry-run, panel ports for Products / Prices / Stock / Knowledge, business rules, fact guard, policy gate — on the latest inbound message of a conversation. Outcome → `wp_ai_runs` (kind `suggest`, model `mythos-auto-reply/template`, prompt version `engine-173/v1`, intent, language, confidence heuristic, `facts_used` = verified / unknown / required / entities, `policy_result` with every rejection gate, latency, trigger `manual|auto`; never the prompt or the customer text). Decision `suggest` ⇒ one `wp_ai_suggestions` row (rank 1); `handoff` ⇒ a linked `wp_handoffs` row (`REQUIRES_HUMAN`, reason from the engine) and the conversation moves to `needs_human`. Human decision API: `POST …/suggestions/:id/decide` `{ action: accept | edit | reject, text }` → for accept/edit the client sends through the normal outbound route with `ai_run_id` + `suggestion_id`; the outbound row is `sender_kind = ai`, the suggestion becomes `sent` with `sent_message_id`. Auto-trigger on `message.in` only when `wp_inboxes.settings.ai_suggest = true` (default off). The customer text is data: the engine's intent parser and ports read it, nothing else; policy gates (`AUTO_REPLY_DISABLED`, `MODE_DRY_RUN`) are unaffected by anything written by the customer (test-enforced with an injection message). An LLM generator, when the owner provides a credential, plugs into the engine's `lib/ai` behind the configuration file outside Git; the run record already carries the fields to version it.

## 12. What the assistant never does

Send on its own; state a price, stock, delivery promise or policy that a port did not return; read secrets; change rules or permissions; run on an inbox that did not opt in. Auto-reply (COMMS-9) will reuse the same runs with an explicit, per-project, owner-controlled policy and a kill switch, only after Gates 4–6 and the security review.

## 13. Multi-service model (COMMS-8)

Decision (Gate 3 review, 2026-09-05): a **project is a service** and the tenant of every table; `wp_projects.kind` = `automotive` (catalogue connection required, CHECK `wp_projects_catalog_required`), `service` (Dar Hijama …, no catalogue) or `internal` (MYTHOS PROD). An **inbox** is one provider instance of one project linked to one WhatsApp **account**: `wp_inboxes.account_ref` (business number digits, non-secret). Account rule: one account per inbox (partial unique index `wp_inboxes_account_uidx`), unless the inbox sets `settings.allow_personal_account = true` (internal inboxes only, discouraged); the accounts in `wp_reserved_accounts` — the MYTHOS notification account behind `mythos-bridge` — can never be claimed (trigger `wp_inboxes_guard`, constraint name `wp_inboxes_account_reserved`), and `mythos-bridge` itself can never be an inbox (CHECK). Documented inbox settings (booleans, validated): `ai_suggest`, `auto_reply`, `allow_personal_account`. Agents: `wp_inbox_members` (inbox, username, role `agent | lead | viewer`, team); a user with at least one membership is **scoped** — conversations, messages and contacts are visible only through member inboxes (`inbox.scope()`, `GET /api/comms/my-inboxes`); owners/operators without memberships see the whole project. Scoping of intelligence: conversation → inbox → project → that project's catalogue connection (if automotive), `wp_knowledge`, `wp_product_commercial`, `wp_stock`, `wp_business_rules`; for non-automotive projects the product/price/stock ports answer "not connected" and the engine hands off or uses knowledge. Onboarding and rollback: `docs/MYTHOS_COMMUNICATION_OS_OPERATIONS.md`. The catalogue and commercial navigation is hidden for non-automotive projects.
