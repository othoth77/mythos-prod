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
