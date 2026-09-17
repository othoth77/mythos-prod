# MYTHOS WP V2.1 — WhatsApp setup

Numbers, links, routing, receiver, providers. In the panel, **WhatsApp** has three tabs: **Numbers** (one table, §2), **Templates** (§8) and **Advanced** (admin only: accounts, add a number manually, routing rules + simulate + drops, receiver and providers, Meta WhatsApp MCP). A project's own numbers and switches are also on **Project → WhatsApp**. Companion: `ARCHITECTURE.md` §4, `SECURITY.md`, `OPERATIONS.md`, `TROUBLESHOOTING.md`, `MCP.md`; repo-level runbook `docs/MYTHOS_COMMUNICATION_OS_OPERATIONS.md` (pairing, `customer-instance.sh`, `qr-live.sh`).

## 1. The model

```
wp_wa_accounts (business account)            optional grouping; Meta WABA id in external_ref (not a secret)
      └── wp_phone_numbers                   ONE row per provider instance (Evolution instance name | Cloud API phone_number_id)
               │   phone_ref (digits), status, is_personal, health_state, webhook_state
               └──< wp_inboxes               ONE logical inbox per (number, project) link  =  the many-to-many
                        │   account_mode dedicated|shared, inbound_enabled, outbound_enabled, ai_mode, settings
                        └── wp_projects
```

A **phone number ↔ projects is MANY-TO-MANY**: one number may carry several logical inboxes (one per project) and a project may own several numbers. The instance identifies the *session*, never the service; on a shared number the routing decision (§5) picks the project.

Two link modes:

| `account_mode` | Meaning | Constraint (DB trigger `wp_inboxes_guard`) |
|---|---|---|
| `dedicated` | the number serves exactly one project; every inbound goes to that inbox (COMMS-1..9 behaviour) | the only link on the instance (`wp_inboxes_dedicated_uidx`) |
| `shared` | the number serves several projects; an explicit routing decision is required for every inbound; unrouted = DROP | `account_ref` mandatory; no dedicated neighbour; a reserved (notification) account only with the audited `allow_personal_account` opt-in; `mythos-bridge` allowed only in shared mode |

## 2. Numbers: the table, discover, register, check

**The numbers table** (WhatsApp → Numbers, every role) — one row per number:

| Column | Meaning |
|---|---|
| Number | masked digits (`***` + last 4) and the display name (or the instance) |
| Status | the provider connection: connected (`open`), connecting (`pairing`), disconnected (`closed`), error, unknown |
| Projects | the linked projects (chips); *Not linked* when none |
| Connection | **Receiving** when the instance webhook points at the receiver (`webhook_state ok`), otherwise **Not receiving** |
| AI | **Active** when at least one link has its AI switch on, **Off** otherwise |
| Last message | last event on the number |
| actions | **Check** (manager), **Link to project** (admin), **More** — the per-project link cards with the switches **Receiving · Replies · AI**, *Project* (opens Project → WhatsApp), **Unlink**, and **Edit number** (admin) |

**Sync all** (admin) — `POST /api/whatsapp/numbers/sync` (the button above the table; also the command-menu action *Sync WhatsApp numbers*; module `comms/numbers.js#sync`):

1. `GET <MYTHOS_WP_EVOLUTION_BASE_URL>/instance/fetchInstances` with the key from `MYTHOS_WP_EVOLUTION_API_KEY_FILE` (412 when the file is absent);
2. every instance is upserted into `wp_phone_numbers` (`provider = evolution`, `status` from `connectionStatus` → `open | closed | pairing | error | unknown`, `phone_ref` from `ownerJid` digits, `display_name` from the profile name, `health_state` ok / warning / disconnected);
3. `is_personal` becomes true when `phone_ref` is in `wp_reserved_accounts` (never turned back to false by a sync);
4. `GET /webhook/find/:instance` → `webhook_state`: `ok` (URL host:port/path = the receiver, `MYTHOS_WP_RECEIVER_URL`), `mismatch`, `missing`, `disabled`, `unknown` (lookup unreachable). The webhook URL query (token) is never stored.

Sync **never creates an instance and never changes a webhook** — those are owner steps with `ops/whatsapp/evolution/customer-instance.sh`.

**Manual registration** (admin) — WhatsApp → Advanced → **Add a number manually**, or `POST /api/whatsapp/numbers { provider, instance, phone_ref?, display_name, is_personal?, account_id? }` → 201; instance shape `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; a Cloud API number uses the `phone_number_id` as instance. `PATCH /api/whatsapp/numbers/:id` (admin; **Edit number** under More) changes name, digits, `is_personal`, account, status, settings. `DELETE` (owner) is refused with 409 while links exist.

**Check** (manager, the row button) — `POST /api/whatsapp/numbers/:id/check` → `provider.health({ instance })` (Evolution: `GET /instance/connectionState/:instance`) → updates `status`, `health_state`, and the `status` of every inbox on the instance.

**List** — `GET /api/whatsapp/numbers` returns `phone_masked` (`***` + last 4) for everyone; `phone_ref` (full digits) only for admin+; plus `projects: [{ project_id, inbox_id, account_mode, inbound_enabled, outbound_enabled, ai_mode, status }]`.

Accounts (WhatsApp → Advanced → **Accounts**): `GET/POST /api/whatsapp/accounts` (any / admin), `PATCH` (admin), `DELETE` (owner); `external_ref` = Meta Business / WABA id or `evolution:<host>`; unique per `(provider, external_ref)`.

## 3. Linking a number to one or several projects

UI: **Link to project** on the number row (dialog: Project · Use = *This project only* (`dedicated`) | *Shared between projects (routing rules decide)* (`shared`) · checkbox *Allow a personal / already-used number*), or **Project → WhatsApp → Link a number** (a free number, always `dedicated`), or the WhatsApp field of the **New project** form (`PROJECTS.md` §2). API: `POST /api/whatsapp/numbers/:id/projects { project_id, display_name?, account_mode: 'dedicated' | 'shared', allow_personal_account?: true }` (admin) → 201 `{ inbox }` (`comms/numbers.js#link`). Rules, in order:

| Request | Result |
|---|---|
| project already linked to this number | 409 |
| `dedicated` and the number already has any link | 409 "use account_mode shared" |
| `dedicated`, no other link | inbox created `dedicated`, `account_ref = phone_ref`, status copied from the number |
| `shared` and `phone_ref` unknown | 412 — sync or set the digits first (a shared inbox needs `account_ref`) |
| `shared` and a `dedicated` link exists | 409 — unlink it first (all links on an instance must be shared) |
| `shared` and the number `is_personal` | 412 unless `allow_personal_account: true`; then created through `routing.createSharedInbox` (audited `shared_account_optin`) |
| `shared`, ordinary number | inbox created `shared` |

Every new inbox starts with `inbound_enabled = false` (dry-run), `outbound_enabled = false`, `ai_mode = inherit`. In the panel these are the three switches of a link — **Receiving** (`inbound_enabled`), **Replies** (`outbound_enabled`), **AI** (`ai_mode` on = `inherit`, off = `off`) — under More on the number row and on Project → WhatsApp. API: `PATCH /api/projects/:p/inboxes/:inbox_id { inbound_enabled, outbound_enabled, ai_mode, display_name, settings }` (admin, audited); `ai_mode` also accepts `suggest` / `auto`, which restrict the agent's mode (`AI_AGENTS.md` §2). `allow_personal_account` cannot be toggled through this PATCH: it is a creation-time opt-in only.

Unlink (**Unlink** on the link card): `DELETE /api/whatsapp/numbers/:id/projects/:inbox_id` (admin) → 409 while the inbox has conversations (nothing is archived automatically); resolve/archive them first.

To move a number from one project to several: unlink the dedicated inbox (requires zero conversations) and relink every project as `shared`, then add routing rules (§5) **before** enabling `inbound_enabled` on any of the shared inboxes — until a rule exists every message is dropped.

## 4. Dedicated vs shared, in practice

| | Dedicated | Shared |
|---|---|---|
| Who receives an inbound | the one inbox | the inbox chosen by the routing decision |
| Rules needed | none | at least one (identity, keyword or default) — otherwise DROP |
| Unrouted messages | impossible | dropped, hashes only in `wp_routing_drops` |
| Reply-side | unchanged | unchanged (a human or the agent replies from the inbox of the conversation) |
| Typical use | one business number per service | one number for a small group of services, or the owner's number serving several |

## 5. Routing on a shared number (deterministic, auditable)

`comms/routing.js#resolve()` runs **before any ledger row**. Decision order and the `wp_conversations.routed_by` it stamps:

1. **dedicated** — a single dedicated inbox owns the instance → `dedicated`. A mix of dedicated and shared inboxes is a misconfiguration → `ROUTING_AMBIGUOUS` (drop).
2. **owner exclusion** — the sender's phone equals a shared inbox's `account_ref` or a reserved account → `OWNER_EXCLUDED` (drop).
3. **sticky** — the sender already has a live conversation (`open | pending | waiting_customer | needs_human`) on one of the shared inboxes of this instance → that inbox, `sticky` (most recent first). Skipped on a personal number.
4. **identity rules** — enabled `wp_inbox_routes` of kind `allowlist` (routes at once) or `opt_in` (pre-registered identity; optional `opt_in_code` that must appear in the text as a *second* factor; `expires_at` window; activated on the first routed inbound and then behaves like allowlist) matching one of the sender identities (`phone`, `lid`, `bsuid`, `provider_user`), lowest `priority` then lowest id → `rule`.
5. **keyword** (entry point) — kind `keyword`, `identity_kind = entry`, `identity_value` = a lowercase token (`^[a-z0-9#*_-]{2,64}$`); matches when the lower-cased message text *contains* the token; lowest priority wins → `keyword`. Ignored on a personal number.
6. **default** — kind `default`, `identity_kind = any`, value `*`; at most one per instance (unique index) → `default`. Ignored on a personal number.
7. **DROP** — `routing.dropAudit()` writes `wp_routing_drops (provider, instance, reason, identity_sha256, payload_sha256)`; no contact, conversation, message, payload or dead-letter. Reasons: `UNROUTED`, `IDENTITY_MISSING`, `OWNER_EXCLUDED`, `ROUTING_AMBIGUOUS`, `RULE_MALFORMED`, `RULE_EXPIRED`, `TOKEN_REQUIRED`, `INBOX_UNKNOWN`.

Rules never route across projects or instances (a rule whose inbox is not on the instance or not in the rule's project is `RULE_MALFORMED` and skipped). Disabled rules are absent (deny).

**Managing rules** — UI: WhatsApp → Advanced → **Routing rules** (pick a project), or Project → Advanced → Routing rules; each shows the rules table (priority, kind, match, number, opt-in state, note, Enabled switch, Delete), **Add rule** (admin), a **Simulate routing** card (manager, *never writes*) and **Recent routing drops** (admin, hashes only). API: `GET /api/projects/:p/comms/routes` (any), `POST` (admin) `{ inbox_id, kind, identity_kind?, identity_value | entry, opt_in_code?, ttl_hours?, expires_at?, priority?, note? }`, `POST …/routes/:id/enable|disable` (admin), `DELETE …/routes/:id` (admin, `routes/whatsapp.js` → `routing.removeRule`, audited without the identity value). CLI: `bin/mythos-wp comms route list|add|enable|disable|drops|shared-inbox …` (`OPERATIONS.md`). Rules apply to shared inboxes only (412 on a dedicated inbox). The API lists identity rules with `identity_tail` (last 4) only; keyword/default rules show their `entry`.

**Dry-run** (the Simulate routing card) — `POST /api/whatsapp/routing/simulate { provider, instance, from (digits), text }` (manager) → `{ routed, mode, reason, project_id, inbox_id, rule_id, personal, would_activate }` — no write, no activation, no ledger.

**Drops** — `GET /api/whatsapp/routing-drops` (admin; alias of `/api/comms/routing-drops`) → `{ id, at, provider, instance, reason, has_identity_hash }`. The hash itself is never returned.

### Worked example — one number serving SsangYong Autos, Dar Hijama and Mythos Prod

Number `ssangyong-autos` (instance) with `phone_ref 21612345678`, three shared links: inbox 11 → `ssangyong-autos`, inbox 12 → `dar-hijama`, inbox 13 → `mythos-prod`.

```bash
# as deploy, env loaded, from the app root
node bin/mythos-wp comms route add ssangyong-autos --inbox 11 --kind keyword --identity entry:pieces          # "pièces", "pieces …" → SsangYong parts
node bin/mythos-wp comms route add dar-hijama      --inbox 12 --kind keyword --identity entry:hijama          # "hijama", "rdv hijama" → Dar Hijama
node bin/mythos-wp comms route add mythos-prod     --inbox 13 --kind allowlist --identity phone:21698765432   # a known partner → Mythos Prod, always
node bin/mythos-wp comms route add dar-hijama      --inbox 12 --kind opt_in --identity phone:21655555555 --code DH-2026 --ttl-hours 72
node bin/mythos-wp comms route add ssangyong-autos --inbox 11 --kind default                                  # everything else → SsangYong
```

Decisions (`POST /api/whatsapp/routing/simulate`):

| From | Text | Decision | Why |
|---|---|---|---|
| `21698765432` | anything | inbox 13 (`rule`) | allowlist beats keywords |
| `21655555555` | "bonjour DH-2026" | inbox 12 (`rule`, activated) | opt_in with the code present, inside the window |
| `21655555555` | "bonjour" (before activation) | DROP `TOKEN_REQUIRED` … then falls to keyword/default: "bonjour" matches no keyword → inbox 11 (`default`) | the opt_in reason is remembered only when nothing else routes |
| `21611111111` | "Prix plaquettes Tivoli" | inbox 11 (`default`) — no keyword "pieces" in the text | keywords are substring matches on the lower-cased text |
| `21611111111` | "je veux des pieces pour Korando" | inbox 11 (`keyword`) | token `pieces` |
| `21611111111` | "RDV hijama demain ?" | inbox 12 (`keyword`) | token `hijama` |
| `21611111111` | second message, any text, while the Dar Hijama conversation is live | inbox 12 (`sticky`) | a live conversation pins the sender to its inbox |
| `21612345678` (the number itself) | anything | DROP `OWNER_EXCLUDED` | the account is never its own customer |

To change where a customer lands after a wrong keyword: resolve the conversation (sticky applies only to live statuses), then add an allowlist rule for that identity.

### Personal / notification numbers — the privacy guard (COMMS-11)

A number with `wp_phone_numbers.is_personal = true` (set by sync when the digits are reserved, or by an admin; fallback: an inbox whose `account_ref` is in `wp_reserved_accounts`) **routes by identity rules only**:

- `keyword` and `default` rules are refused at creation (412 "a personal number routes by identity only") and ignored at decision time even if a row exists;
- sticky is not applied;
- no rule for the sender → DROP with hashes only. Nothing of a private chat is ever persisted.

The reserved account `+216…660` (instance `mythos-bridge`) is the MYTHOS notification account: `bin/mythos-wp reserve-account <digits>` marks it; it can host only explicit shared inboxes created with `allow_personal_account: true` (audited), and the bridge's own notifications are never ingested.

## 6. Receiver and webhook

UI: WhatsApp → Advanced → **Receiver and providers** (admin) — the receiver card (route, enabled, webhook token present / missing, max body, providers, inboxes with persisting / dry-run) and, per provider, the capability table and the credential-present badge (`GET /api/comms/receiver`, `GET /api/comms/providers`).

Endpoint `POST /hooks/evolution` (and `GET|POST /hooks/meta_cloud`) on the panel process; mounted only when `MYTHOS_WP_RECEIVER_ENABLED=1`; status via `GET /api/comms/receiver` (enabled, token presence, max body, providers, capabilities, inbox rows — never the token).

Evolution (unsigned): the shared token from `MYTHOS_WP_WEBHOOK_TOKEN_FILE` (0600, ≥ 16 chars) must be presented as `?token=` or header `x-mythos-webhook-token`; compared in constant time **before the body is read**; missing file → 503 `receiver_not_configured`, wrong token → 401. The per-instance webhook is set by `ops/whatsapp/evolution/customer-instance.sh` to `http://127.0.0.1:8170/hooks/evolution` with the header, events `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `CONNECTION_UPDATE`, `byEvents=false`, `base64=false`. **Sync** reports whether each instance's webhook points at the receiver.

Outcomes per delivery (`wp_inbound_events.status`): `persisted`, `duplicate` (same provider message id), `dry_run` (inbox `inbound_enabled=false`), `ignored` (own message, group, status broadcast, self chat, unknown event), `rejected` (malformed, `INBOX_UNKNOWN`), `failed` (ingest error — dead-letter kept, replayable). A routing DROP writes **no** `wp_inbound_events` row at all.

Connection events set `wp_inboxes.status` for every inbox on the instance and publish `inbox.status`. Status events (`SERVER_ACK → sent`, `DELIVERY_ACK → delivered`, `READ/PLAYED → read`, `ERROR → failed`) update our outbound rows only.

## 7. Evolution API vs WhatsApp Cloud API

| | `evolution` (production today) | `meta_cloud` (implemented, not configured) |
|---|---|---|
| Nature | unofficial WhatsApp Web protocol (Baileys), one instance per number, paired by QR | official Cloud API, one `phone_number_id` per number, WABA-level templates |
| Endpoint | `http://127.0.0.1:8080`, header `apikey` from `MYTHOS_WP_EVOLUTION_API_KEY_FILE` | `https://graph.facebook.com/v21.0`, bearer token from `MYTHOS_WP_META_ACCESS_TOKEN_FILE` |
| Webhook auth | shared token (unsigned, never retried by the provider) | `X-Hub-Signature-256` HMAC over the raw body with `MYTHOS_WP_META_APP_SECRET_FILE`; subscription `GET hub.mode=subscribe` + `hub.verify_token` from `MYTHOS_WP_META_VERIFY_TOKEN_FILE` → `hub.challenge` echoed as text |
| Inbound | `messages.upsert` / `messages.update` / `connection.update`; LID senders resolved via `senderPn`/`remoteJidAlt` | `entry[].changes[].value.messages | statuses`; one event per body; `metadata.phone_number_id` = instance |
| Outbound | `POST /message/sendText/:instance { number, text }` | `POST /{phone_number_id}/messages { messaging_product:'whatsapp', to, type:'text', text:{ body } }`; `sendTemplate` |
| Templates | none (local templates are sent verbatim as text) | `GET/POST/DELETE /{waba_id}/message_templates` (WABA id = `wp_wa_accounts.external_ref`); statuses normalised to draft / pending / approved / rejected / paused |
| 24 h window | n/a | free-form text only inside the customer-service window; otherwise an approved template is required |
| Media | inbound metadata only; fetch not implemented (Phase H) | `fetchMedia(media_id)` via Graph (≤ 16 MiB) |
| Health | `GET /instance/connectionState/:instance` | `GET /{phone_number_id}?fields=display_phone_number,verified_name,quality_rating` |
| Limitations | unofficial; cold outbound to unknown contacts refused by policy; `LOG_BAILEYS=debug` forbidden in production (leaks Signal keys) | needs Meta approval per template; media outbound not implemented |

Switching a number to the Cloud API is an owner project: create the three 0600 files, set the variables, enable the `meta-cloud-api` integration row, register the number with `provider: meta_cloud` and `instance = phone_number_id`, put the WABA id on its account, point Meta's webhook at `https://wp.mythosprod.xyz/hooks/meta_cloud`, verify the subscription, then link projects as usual. The official Meta MCP helps with the Meta-side steps but is not the messaging path (`MCP.md`; its card is on Settings → Integrations and under WhatsApp → Advanced).

## 8. Templates (`comms/templates.js`)

UI: WhatsApp → **Templates** (project picker, **New template** for manager+, **Sync with Meta** for admin; a row opens the preview drawer with variables, Preview, Sync with Meta and **Test send…**). `wp_templates` (project-scoped or shared, optional number, name `^[a-z0-9_]{1,120}$`, `{{1}}` positional / `{{name}}` named placeholders; local drafts are sent verbatim by unofficial providers, Meta-synced rows carry `provider meta_cloud`, `provider_template_id` and the WABA status). `GET /api/templates?project=` (any), `POST` (manager), `PATCH` (manager), `DELETE` (admin), `POST …/:id/preview { variables }` (any) → `{ text, missing, used }` (a missing placeholder is left in place), `POST …/:id/sync` and `POST /api/templates/sync-all` (admin) → Meta Graph `/{waba_id}/message_templates` when the Cloud API is configured (token file **and** a `meta_cloud` account with `external_ref` = WABA id), else 412 `META_CLOUD_NOT_CONFIGURED`, `POST …/:id/test { conversation_id, variables }` (manager) → rendered and sent through `outbound.send` (`client_ref tpl-<id>-<ts>`, i.e. the normal policy path: inbox open + `outbound_enabled`, hourly cap) into an existing conversation.

## Connection states

The Numbers table shows **Connected · Action required · Disconnected · Error** (hover for the reason).
The rule behind them, and why a failed check never marks a number broken, is in
[TROUBLESHOOTING.md](TROUBLESHOOTING.md#whatsapp-connection-states-what-the-four-words-mean).
