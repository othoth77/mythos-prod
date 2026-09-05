# MYTHOS AUTO — customer communication layer

Customer-facing WhatsApp communication for MYTHOS AUTO projects (`ssangyong.autos`, later `piece.autos`, `casse.autos`), designed in GitHub Issue #172 (CRM path) and made usable without a CRM by Issue #173 (lightweight auto-reply path). Architecture, evaluation and decisions: `docs/MYTHOS_AUTO_WHATSAPP_CRM_ARCHITECTURE.md`.

**This is not the notification layer.** Operational notifications (task COMPLETED / FAILED / BLOCKED → owner) live in `projects/mythos-ai-executor/bridge/notify/` and are untouched; this layer never uses them and they never use it (asserted by test). The only things borrowed from there are the private-host fence and the JSON poster.

## Shape

```
CUSTOMER ─► EXISTING PROVIDER ─► lib/crm/<adapter>.js (authorize, parse) ─► lib/envelope.js
   ─► lib/ledger.js   (own-outbound echo? duplicate inbound? — before any work)
   ─► lib/router.js   (project by (account, inbox) from lib/projects.js)
   ─► business HANDLER (built-in: handoff | auto-reply)
        auto-reply: lib/intents.js ─► lib/business-data.js (facts, or "unavailable")
                    ─► lib/ai (template | advisory + fact guard) ─► decision
   ─► lib/policy.js  (every send gate; names, never text)
   ─► [live only] router.deliver() ─► <adapter>.sendReply() ─► provider ─► CUSTOMER
   ─► lib/ledger.js   (SENT | SEND_FAILED | SUPPRESSED)
```

Two channel adapters satisfy the same contract (`lib/crm/index.js`):

| Adapter | Path | Status |
|---|---|---|
| `chatwoot` | CRM path (#172): Chatwoot owns the WhatsApp connection, agents work in the shared inbox | designed; Chatwoot not deployable on the host (RAM/disk) |
| `evolution` | lightweight path (#173): the **existing** private Evolution gateway (`127.0.0.1:8080`, `ops/whatsapp/evolution/`) on a **separate customer instance** per project; no CRM in between | implemented; nothing deployed, every send switch off |

The notification instance `mythos-bridge` stays what it is: `crm.reserved_inbox_ids` makes the configuration refuse any project that claims it, and a message arriving from it routes nowhere.

| File | Role |
|---|---|
| `lib/envelope.js` | Provider-independent inbound envelope (`customer.message.received`), validation, log-safe summary (number masked, no text) |
| `lib/projects.js` | Multi-project configuration: load / validate / resolve / policy / engine / describe; refuses credential literals, shared or reserved inboxes, public binds |
| `lib/crm/index.js` | Channel adapter contract + registry |
| `lib/crm/chatwoot.js` | Chatwoot adapter (#172) |
| `lib/crm/evolution.js` | Evolution adapter (#173): `messages.upsert` parsing (own / group / status / self-chat refused, LID resolved), URL or header token, `sendText` egress on the customer instance behind the private-host fence |
| `lib/router.js` | `route()`, `handleWebhook()`, `deliver()`; handler boundary and reply policy (`auto_reply` per project, default OFF) |
| `lib/intents.js` | Deterministic message understanding (fr / ar-TN / en): greeting, vehicle identification, part inquiry, price/availability, order status, human request, unsupported, ambiguous; entities are the customer's own words |
| `lib/business-data.js` | Business data port (catalogue / price / stock / compatibility / order). Nothing connected yet: every lookup is "unavailable" → handoff, never a guess |
| `lib/ai/index.js` | Reply generation: `template` (default, no network) or `advisory` (existing OmniRoute boundary, opt-in, customer text not shared by default) + `factGuard` rejecting any price / stock / delivery / compatibility / order claim without a fact behind it |
| `lib/handlers/auto-reply.js` | The `auto-reply` handler: classify → facts → generate → decision (`reply` / `handoff`, `requires_human`, fact names) |
| `lib/ledger.js` | File or in-memory ledger: O_EXCL claim per event (duplicate inbound), own-outbound ids (echo), hourly reply cap per conversation, provider breaker; hashed file names, no text |
| `lib/policy.js` | The send gate: `AUTO_REPLY_DISABLED`, `MODE_DRY_RUN`, `RECIPIENT_*`, `PROVIDER_*`, `CREDENTIAL_MISSING`, `BUSINESS_DATA_MISSING`, `REQUIRES_HUMAN`, `FACT_GUARD_VIOLATION`, `REPLY_RATE_EXCEEDED`, `TEXT_*` |
| `lib/engine.js` | One inbound → one governed, redacted outcome record; `readiness()` |
| `config/comms.example.json` | CRM-path example (#172) |
| `config/comms.evolution.example.json` | Lightweight-path example: three projects on three instances, `mythos-bridge` reserved, `mode: dry-run`, `auto_reply: false`, `send_handoff_ack: false` |
| `bin/mythos-auto-comms` | `config-check`, `dry-run`, `simulate`, `classify`, `readiness`, `describe` — never sends |
| `bin/mythos-auto-reply-receiver` | Loopback webhook receiver for the Evolution adapter (not deployed; see below) |

## Operator surface (nothing here sends)

```
node projects/automotive/comms/bin/mythos-auto-comms config-check <config.json>              # exit 0 / 2
node projects/automotive/comms/bin/mythos-auto-comms dry-run <config.json> <webhook.json>    # #172 route only
node projects/automotive/comms/bin/mythos-auto-comms simulate <config.json> <webhook.json>   # whole engine, dry-run forced, memory ledger
node projects/automotive/comms/bin/mythos-auto-comms classify <config.json> <project-id> "<text>"
node projects/automotive/comms/bin/mythos-auto-comms readiness <config.json>                 # presence of token files, mode, projects ON
node projects/automotive/comms/bin/mythos-auto-comms describe
```

`simulate` prints the **exact proposed message**, the recipient masked to its last three digits, and every policy gate a live run would hit (`MODE_DRY_RUN` included). It never reads the provider credential. Token files must be mode 0600.

## Turning a reply on (owner decision, per project — not done by any task)

Everything ships off. A message leaves only when **all** of these hold, in the real configuration file outside Git:

1. `auto_reply.mode: "live"` (any other value is dry-run);
2. the project has `business.handler: "auto-reply"` **and** `business.auto_reply: true`;
3. `crm.api_token_file` names a 0600 file holding the **customer instance's** apikey (not the notification instance's);
4. `auto_reply.state_dir` is set (the idempotency ledger is mandatory for a receiver);
5. the decision is a `reply` with no missing fact, no `requires_human` (unless `send_handoff_ack: true`), text that passes the fact guard, the recipient is a digits-only number, the provider breaker is closed and the conversation is under its hourly cap.

With the business data port unconnected, only greetings, vehicle acknowledgements and "please tell us your vehicle and part" replies can ever be sent; price, stock, compatibility and order questions are handed off.

## Receiver (Level 3 host action, documented, not performed)

The receiver listens on `127.0.0.1` only and serves `POST /webhook/evolution?token=<webhook token>` and `GET /healthz`. To run it for real the owner would: create a **new** Evolution instance for the project (never `mythos-bridge`), pair it with the customer number, write the instance apikey and a ≥16-char webhook token to 0600 files, set `state_dir`, point the instance's webhook at the receiver with events `["MESSAGES_UPSERT"]` (`POST http://127.0.0.1:8080/webhook/set/<instance>`), run `readiness`, then run the receiver in `--dry-run` under a user unit for as long as needed before ever setting `mode: live`. Host verification of 2026-09-05: RAM 7.7 GiB with ~2.8 GiB available and swap almost full, disk 88 % used (9.3 GiB free) — a Node receiver fits; Chatwoot does not.

## Handler contract (for the automotive business engine)

```js
handler(envelope, ctx) → Promise<{ action: 'handoff'|'reply'|'ignore', reason, reply_text?, intent?, entities?, requires_human?, facts?: { required, available, missing } }>
// ctx = { project, policy, catalog_api, business_data?, ai?, engine }
```

Anything malformed, thrown or slow (10 s) becomes a `handoff`. A `reply` is delivered only when the project has `auto_reply: true` and the policy gate passes. Connect a catalogue / price / stock / order source by implementing the port functions of `lib/business-data.js` and passing them as `business_data`; the handler and the fact guard start using them without any other change.

## Tests

- `node tests/mythos-auto-comms-test.js` — CRM path (#172), 113 checks
- `node tests/mythos-auto-reply-test.js` — lightweight path (#173), 169 checks: inbound normalisation, routing, auto-reply ON/OFF, dry-run, missing business data, human handoff, duplicate inbound, outbound loop prevention, provider failure and breaker, secret redaction, separation from operational notifications, multi-project configuration, receiver, CLI

Loopback stubs only; no gateway, no WhatsApp, no network, no customer.
