# MYTHOS AUTO — customer communication layer

Customer-facing WhatsApp communication for MYTHOS AUTO projects (`ssangyong.autos`, later `piece.autos`, `casse.autos`), designed in GitHub Issue #172. Architecture, evaluation and decisions: `docs/MYTHOS_AUTO_WHATSAPP_CRM_ARCHITECTURE.md`.

**This is not the notification layer.** Operational notifications (task COMPLETED / FAILED / BLOCKED → owner) live in `projects/mythos-ai-executor/bridge/notify/` and are untouched; this layer never uses them and they never use it (asserted by test).

## Shape

```
CRM webhook ─► lib/crm/chatwoot.js  (authorize, parse)  ─► lib/envelope.js
           ─► lib/router.js  (project by (account, inbox) from lib/projects.js)
           ─► business HANDLER (boundary; built-in: handoff)
           ─► decision + reply policy (auto_reply per project, default OFF)
           ─► router.deliver() ─► chatwoot.sendReply() ─► CRM ─► WhatsApp
```

MYTHOS never addresses a WhatsApp provider for a customer message: the CRM (Chatwoot, selected; not deployed — host resources) owns the WhatsApp connection, whether official (Meta Cloud API, 360dialog) or, per explicit acknowledgement, unofficial (Evolution, WAHA via Chatwoot's API-channel integration).

| File | Role |
|---|---|
| `lib/envelope.js` | Provider-independent inbound message envelope (`customer.message.received`), validation, log-safe summary |
| `lib/projects.js` | Multi-project configuration: load / validate / resolve / policy / describe; refuses credential literals and shared inboxes |
| `lib/crm/index.js` | CRM adapter contract + registry |
| `lib/crm/chatwoot.js` | Chatwoot adapter: webhook authorisation (URL token, constant-time), `message_created` parsing, channel/provider consistency, reply egress |
| `lib/router.js` | `route()`, `handleWebhook()`, `deliver()`; the handler boundary and reply policy |
| `config/comms.example.json` | Example configuration (three projects, one CRM); the real file lives outside Git |
| `bin/mythos-auto-comms` | `config-check`, `dry-run` (never sends), `describe` |

## Operator surface

```
node projects/automotive/comms/bin/mythos-auto-comms config-check <config.json>      # exit 0 / 2
node projects/automotive/comms/bin/mythos-auto-comms dry-run <config.json> <webhook.json>
node projects/automotive/comms/bin/mythos-auto-comms describe
```

`dry-run` runs a recorded Chatwoot webhook body through authorise → parse → route with the built-in handlers and prints the outcome, the decision and a summary without customer text; `sent` is always `false`. Token files must be mode 0600.

## Handler contract (for the future automotive engine)

```js
handler(envelope, ctx) → Promise<{ action: 'handoff'|'reply'|'ignore', reason, reply_text?, intent?, entities? }>
// ctx = { project, policy, catalog_api }
```

Anything malformed, thrown or slow (10 s) becomes a `handoff`. A `reply` is delivered only when the project has `auto_reply: true`.

## Tests

`node tests/mythos-auto-comms-test.js` — loopback stub only; no CRM, no WhatsApp, no network.
