# MYTHOS AUTO — WhatsApp CRM / Business Communication Architecture

**Task:** GitHub Issue #172 (`t-20260905010513-4c5yeh`, OTHMODE `OTH-2026-00170`) · **Date:** 2026-09-05 · **Status:** architecture and boundary implemented; CRM deployment **BLOCKED** on host resources (§7), not attempted.

This document is the reference for how MYTHOS AUTO projects (`ssangyong.autos` first; `piece.autos`, `casse.autos` later) talk to customers over WhatsApp. It records what was inspected, what was evaluated, what was selected and rejected and why, what was built, and what is still owed before the first customer message flows.

---

## 1. Two WhatsApp layers, strictly separated

| | Operational notifications (existing) | Customer communication (this task) |
|---|---|---|
| Purpose | Tell the owner that a GitHub control task reached COMPLETED / FAILED / BLOCKED | Customers write to a business; humans and — later — MYTHOS answer |
| Code | `projects/mythos-ai-executor/bridge/notify/` (`whatsapp.js`, `http-json.js`, `providers/evolution.js`, `providers/generic.js`) | `projects/automotive/comms/` |
| Direction | Outbound only, `sendText` and nothing else | Inbound first (customer → CRM → MYTHOS), replies only by policy |
| WhatsApp connection | Owned by the bridge through a private Evolution gateway (`ops/whatsapp/evolution/`, deployed by the owner 2026-09-05) | Owned by the **CRM**; MYTHOS never addresses a WhatsApp provider for a customer message |
| Number | The owner's operational number | The business number of each project |
| Changed by this task | **No** (fence asserted by test) | New |

The notification adapter carries the fence *"MYTHOS AUTO customer chat … must not be built on this adapter"*. This task honours it: nothing under `bridge/notify/` changed, and the customer layer never requires `providers/evolution.js`, `providers/generic.js` or `sendText` (`tests/mythos-auto-comms-test.js`, section 7). What it does reuse from the bridge is exactly the three pieces that are not WhatsApp-specific: `http-json.js` (a JSON POST that never logs headers), `isPrivateHost` (the loopback / RFC1918 fence) and the shared `redact` module.

**No second uncontrolled gateway.** The customer layer introduces no WhatsApp session, no QR pairing, no gateway process. The only WhatsApp connection this layer will ever use is the one the CRM owns, and that connection is configured in the CRM by the owner.

## 2. Target architecture and how it maps to code

```
CUSTOMER ──► WHATSAPP BUSINESS ──► CRM (inbox, agents, contacts, history)
                                      │ account webhook (message_created)
                                      ▼
                     CRM ADAPTER  lib/crm/chatwoot.js
                       authorizeWebhook → parseWebhook → ENVELOPE (lib/envelope.js)
                                      │
                     ROUTER       lib/router.js
                       project ← (account, inbox)   lib/projects.js
                       consistency (channel vs configured provider)
                                      │
                     BUSINESS HANDLER boundary  (ctx = project, policy, catalog_api)
                       today: `handoff` → a human agent in the CRM answers
                       later: automotive engine → vehicle → catalogue → stock → price
                                      │ decision { handoff | reply | ignore }
                     REPLY POLICY   auto_reply per project, default OFF
                                      │
                     deliver() ──► CRM ADAPTER sendReply ──► CRM ──► WHATSAPP ──► CUSTOMER
```

Where OTHMODE / Governance / Executor sit: the handler boundary is *the* place where a customer message becomes a MYTHOS task. A receiver service (not built — §8) calls `router.handleWebhook()`, records the routed result as evidence, and hands the envelope to the governed execution path exactly like any other event; the reply comes back through `router.deliver()`, which refuses anything the router did not allow. No part of the layer bypasses governance to reach WhatsApp, because no part of it can reach WhatsApp.

### 2.1 The envelope (`lib/envelope.js`)

Provider-independent, follows the ecosystem event envelope of `docs/AUTOMOTIVE_INTEGRATION_CONTRACTS.md` §2.2: `event_id` (`cm-` + sha256 of adapter + CRM message id, so a redelivered webhook is the same event), `event_name` `customer.message.received`, `producer` `mythos-auto-comms`, `correlation_id`, `source_id`, `published_at`, `privacy_class: CUSTOMER_PII`, plus `direction`, `channel`, `provider`, `provider_class` (`official | unofficial | unknown`), `project_id`, `crm { adapter, account_id, inbox_id, conversation_id, message_id, contact_id, channel_type }`, `customer { msisdn, name, locale_hint }`, `message { content_type, text, attachments, external_id, received_at }`. `validate()` names every problem; `summary()` is the only thing meant for logs: no text, no name, masked MSISDN.

### 2.2 Multi-project configuration (`lib/projects.js`, `config/comms.example.json`)

One CRM, many projects. A project is `(id, crm.account_id, crm.inbox_ids[], whatsapp.provider, business.{handler, auto_reply, catalog_api})`. An inbox belongs to exactly one project; the code knows no project by name. Secrets never live in the file: `api_token_file` / `webhook_token_file` name 0600 files, a credential-named key without `_file`, or a `_file` value that looks like a token, refuses the whole configuration. A public CRM host needs `allow_public: true`; an unofficial WhatsApp provider needs `unofficial_acknowledged: true` — both explicit owner decisions in the file.

### 2.3 CRM adapter contract (`lib/crm/index.js`)

`id · describe() · authorizeWebhook({query, headers, expectedToken}) · parseWebhook(body) → {accepted, reason, envelope} · providerConsistency(channelType, provider) · sendReply({...}) → {ok, status, crm_message_id, error}` — never throws, never logs a body, never returns a header. A second CRM is a second file in `lib/crm/`; nothing else changes.

### 2.4 Router and the business boundary (`lib/router.js`)

Outcomes: `REJECTED` (invalid config / envelope, adapter mismatch, provider contradicts channel, handler unavailable), `UNROUTED` (no project for that inbox), `ROUTED` (decision attached). Handler contract: `handler(envelope, ctx) → Promise<{action, reason, reply_text?, intent?, entities?}>`. Whatever the handler does — throws, hangs (10 s), returns garbage, returns a forbidden action — the router turns it into a **handoff**, never a reply; a free-text error message never leaves the handler (only a bare error name is recorded). A `reply` is deliverable only when the project has `auto_reply: true`; otherwise it is recorded as suppressed and the human agent answers. `deliver()` is a separate, explicit call and sends only what the router allowed, to the conversation the message came from.

## 3. Open-source evaluation (live-verified 2026-09-05 via api.github.com and vendor documentation)

| Criterion | **Chatwoot** (chatwoot/chatwoot) | WaCRM (ArnasDon/wacrm) | Evolution API | WAHA (devlikeapro/waha) |
|---|---|---|---|---|
| Role considered | Inbox / CRM component | Inbox / CRM component | WhatsApp gateway (unofficial) | WhatsApp gateway (unofficial) |
| Licence | MIT core; `enterprise/` under the Chatwoot Enterprise licence (GitHub: NOASSERTION) | MIT | Apache-2.0 + additional conditions incl. a usage-notification obligation | Apache-2.0 |
| Maintenance | 36,501 ★, pushed 2026-09-04, monthly releases, latest **v4.17.1** 2026-08-27, 1,355 open issues | 2,231 ★, pushed 2026-08-31, **no releases**, single dominant maintainer | 9,531 ★, pushed 2026-07-14, last stable 2.3.7 (2025-12-05) | 7,336 ★, pushed 2026-09-01, release 2026.8.2 |
| Official WhatsApp API | **Yes** — native `Channel::Whatsapp` with providers `whatsapp_cloud` (Meta Cloud API) and `default` (360dialog); Twilio channel; API channel for anything else | Cloud API only | No (WhatsApp Web protocol, session/QR) | No (WhatsApp Web protocol; NOWEB/GOWS engines) |
| Architecture / footprint | Rails + Sidekiq + PostgreSQL + Redis; vendor minimum **4 GB RAM + 1 GB swap** for the single-box install; Docker compose or Linux script | Next.js 16 + **Supabase** (second auth + DB stack, or a hosted Supabase project) | Node + PostgreSQL + Redis; vendor minimum 2 GB | Node (+ Chromium for WEBJS; not for NOWEB/GOWS) |
| Persistence | PostgreSQL (contacts, conversations, messages, labels, notes) | Supabase Postgres | PostgreSQL | file / Postgres / Mongo options |
| Webhooks / API | Account webhooks (`message_created`, `conversation_*` …); full REST API with `api_access_token`; agent-bot API | Supabase-driven, Cloud API webhook | Yes | Yes |
| Multi-agent / assignment / contacts / tags / notes / history / templates | **All native** (teams, auto-assignment, labels, private notes, canned responses, WhatsApp templates on the Cloud channel) | Basic inbox, contacts, tags; its own AI assistant | Not a CRM | Not a CRM |
| Security / auth | Sessions + API tokens, roles, 2FA; webhooks unsigned (URL token + private network) | Supabase auth | API key | API key |
| Integration with the gateways | Both Evolution and WAHA ship a **native Chatwoot integration** (API-channel inbox) | — | → Chatwoot | → Chatwoot |
| Lock-in | Open data model, export API, MIT core | Fork-and-brand template; Supabase | Session data tied to the gateway | Session data tied to the gateway |
| VPS suitability today | **Not met** (§7) | Would need Supabase hosting or a second Postgres + auth stack | Deployed (loopback, owner) | Candidate per provider strategy §6 |

**SELECTED — Chatwoot** as the inbox/CRM component: the only candidate that is mature, actively released, natively speaks the official WhatsApp Business Platform, gives every CRM feature the issue lists without building any of it, and is the documented endpoint of both unofficial gateways' integrations — so the CRM choice is the same whichever provider a project runs on. Designated, **not deployed** (§7).

**REJECTED — WaCRM** as the CRM: a fork-and-brand Next.js template rather than a product (no releases, one maintainer), a Supabase dependency that would add a second authentication and database stack beside OTHMODE's, Hostinger-oriented deployment, Cloud-API-only, and its own AI assistant that would compete with MYTHOS as the intelligence layer. Useful as a reference for Cloud API webhook handling, nothing more.

**RETAINED, scoped — Evolution API** stays exactly what #170 made it: the private operational-notification gateway. It is unofficial (WhatsApp Web protocol), carries a usage-notice obligation and a 2 GB minimum, and is not the transport for customer conversations unless the owner decides so per project (`provider: "evolution"`, `unofficial_acknowledged: true`, through Chatwoot's API-channel integration — never a second gateway).

**RETAINED as candidate — WAHA**: the safe unofficial candidate of `docs/MYTHOS_WHATSAPP_PROVIDER_STRATEGY.md` §6; same route into Chatwoot; same acknowledgement rule.

**Others looked at, not shortlisted:** Typebot / n8n-style flow builders (automation, not a CRM; MYTHOS is the automation), Rocket.Chat omnichannel (heavier, MongoDB, WhatsApp via paid connectors), Zapier-style SaaS (data leaves the host).

## 4. Provider architecture and the official/unofficial decision

- **Preferred: Meta WhatsApp Business Platform (Cloud API)** through Chatwoot's native WhatsApp channel. Official, templated outbound, business verification, no session to keep alive, no ban risk, conversation-based pricing (owner cost decision). Requires a Meta Business account, a phone number not bound to a personal WhatsApp, and business verification for scale.
- **Alternative official: 360dialog** (Chatwoot `default` provider) or Twilio — same class, different commercial terms.
- **Unofficial (Evolution, WAHA):** free, immediate, session-based (QR), against WhatsApp's terms for automated business messaging, ban risk on the business number, session drops after WhatsApp protocol changes, and — for Evolution — the licence notice. Allowed per project only with an explicit `unofficial_acknowledged: true`, and the router refuses the combination *unofficial provider configured on a `Channel::Whatsapp` inbox* (which can only be official) — so the class of transport is never misdeclared.
- **The boundary is the CRM.** Because MYTHOS reads from and replies into the CRM conversation, swapping Cloud API ↔ 360dialog ↔ Evolution ↔ WAHA is a Chatwoot inbox change plus one `provider` field in the project configuration. No MYTHOS code knows a WhatsApp endpoint.
- The notification adapter boundary (`providers/generic.js`) was considered for reuse and **not** reused: it is an outbound-text contract to a gateway, whereas the customer layer needs inbound + conversation context, which is the CRM's contract. Reusing it would have made MYTHOS the WhatsApp client — the thing the fence forbids.

## 5. MYTHOS as the intelligence layer — the future flow

"عندي Korando 2020 نحب filtre huile" arrives as an envelope with `project_id: ssangyong.autos`, `message.text` and the customer's MSISDN. The business handler for the project (not built) resolves vehicle → catalogue (`business.catalog_api`, the read-only `projects/ssangyong-autos/reference/api.js` on loopback, not deployed) → compatible parts → stock/price → decision `reply` with `intent: part_request`, `entities: {model, year, part}`. Today the handler is `handoff`: the message is visible to the human agent in Chatwoot with nothing lost, and the envelope is available to MYTHOS as evidence. Turning on an automated answer for a project is two owner decisions in the configuration (`handler`, `auto_reply: true`), never a code change.

## 6. Security conclusion

- Inbound authentication: Chatwoot webhooks are unsigned; the layer requires a ≥16-char shared token in the webhook URL (constant-time compare against a 0600 file) **and** a private CRM host. A receiver must additionally bind to loopback / the private network.
- Egress: `sendReply` refuses a non-private CRM host (unless `allow_public`), non-numeric ids, a missing token, empty or >4096-char text; the token is a request header for the lifetime of one `postJson` call and never in a result or log.
- Data: customer text and names are in the envelope for the handler only; `summary()` is the loggable form; handler entities pass `redact.redactValue`; error messages from handlers are reduced to a name.
- Governance: no file under `control/`, no executor policy/budget/service file, no `.github/`, no credential-named path touched; new token files are `*.token` referenced by `*_file` keys, matching the governance protected-path patterns by *not* matching them.
- No WhatsApp send, no deployment, no DNS, no production data touched.

## 7. VPS findings (2026-09-05 01:06 UTC)

| Resource | Measured | Chatwoot minimum | Verdict |
|---|---|---|---|
| RAM | 7,746 MiB total, **2,729 MiB available** | 4 GB available + 1 GB swap headroom | **Not met** |
| Swap | 4,095 MiB, **3,538 used / 557 free** | ≥ 1 GB free | **Not met** |
| CPU | 4 vCPU, load 0.39 | 2 vCPU | Met |
| Disk | 88 % used, **9.4 GiB free** | ~10 GB for images + Postgres growth | Marginal |
| Services already present | OTHMODE, executor, bridge, Evolution API + its Postgres (loopback) | — | Would compete for the same RAM |
| Ports | 3000 (Chatwoot default) free on loopback | — | OK |

**Decision: CRM deployment BLOCKED on resources; not attempted.** Deploying Chatwoot (Rails + Sidekiq + Postgres + Redis) beside the executor and the Evolution stack on this host would push it into the Resource Guard's CRITICAL regime. Options for the owner, in order of preference: (a) host Chatwoot on a second small VPS / managed Chatwoot and point the private fence at a WireGuard address; (b) raise this host's RAM and resolve the swap exhaustion first (provider strategy §6 step 1, still open); (c) a lighter inbox only if Chatwoot's features are given up — no such candidate met the CRM requirements.

## 8. What is deliberately not built yet

- **HTTP receiver service** for the Chatwoot webhook: it belongs to the deployment phase, once a CRM exists to send webhooks. Until then `bin/mythos-auto-comms dry-run` runs a recorded webhook body through the same `handleWebhook()` path and sends nothing.
- **The automotive business engine** (vehicle recognition, catalogue lookup, stock/price): only the handler boundary and its contract exist.
- **Media replies, templates, label/contact mutation, agent-bot handover**: listed in `chatwoot.describe().not_implemented`.

## 9. Owner runbook outline (deployment phase, after the resource gate)

1. Decide CRM hosting (§7) and the WhatsApp provider per project (§4) — official Cloud API preferred; for an unofficial provider, acknowledge it in the configuration.
2. Install Chatwoot; create one account, one inbox per project; connect the inbox to the chosen WhatsApp provider; create agents/teams.
3. Create an API access token for a MYTHOS bot user with the least role that can post into conversations; store it in `~/mythos-ai-executor/keys/chatwoot-api.token` (0600). Generate a ≥32-char webhook token into `chatwoot-webhook.token` (0600).
4. Write `~/mythos-ai-executor/config/auto-comms.json` from `config/comms.example.json`; `mythos-auto-comms config-check` must print `"problems": []`.
5. Deploy the receiver (next task) on loopback / private network; configure the Chatwoot account webhook `http://<private>/…?token=<webhook token>` for `message_created`.
6. Record one real inbound webhook body (redacted) and keep it beside the tests as the fixture; `dry-run` it.
7. Keep every project on `handler: handoff`, `auto_reply: false` until the business engine exists and its decisions have been reviewed in the CRM history.

## 10. Tests

`tests/mythos-auto-comms-test.js` — 113 checks: envelope, configuration model (credential-literal refusal, inbox exclusivity, unofficial acknowledgement, private-host fence), Chatwoot parse/authorise/consistency against the verified payload shape, router outcomes and the handler boundary (custom reply handler suppressed vs allowed, throw / timeout / malformed → handoff, error message never recorded), `deliver` against a loopback stub (endpoint, header, body, no token in results, refusals before any request), separation guarantees (notification layer untouched and unaware, fence text still declared), CLI exit codes and `sent: false`. Regression suites re-run unchanged (see the handover entry).

## 11. Lightweight auto-reply path (Issue #173, 2026-09-05) — addendum

§7 blocks the CRM on this host. Issue #173 asks for the intelligence layer to become usable **without** Chatwoot and **without** a second WhatsApp gateway. The answer keeps every boundary of §1–§6 and adds one channel adapter and one engine on top of the #172 code:

```
CUSTOMER → EXISTING EVOLUTION GATEWAY (127.0.0.1:8080, separate customer instance)
  → lib/crm/evolution.js (authorize, parse: fromMe / group / status / self refused)
  → lib/ledger.js (own-outbound echo, duplicate inbound — before any work)
  → lib/router.js → handler `auto-reply` (lib/handlers/auto-reply.js)
      → lib/intents.js (fr / ar-TN / en; entities = the customer's own words)
      → lib/business-data.js (catalogue / price / stock / compat / order port — unconnected: "unavailable")
      → lib/ai (template, or advisory via the existing OmniRoute boundary; fact guard last)
  → lib/policy.js (send gate, all refusals by name)
  → [live only] router.deliver() → evolution.sendReply() → gateway → CUSTOMER
  → lib/ledger.js (SENT | SEND_FAILED — never auto-resent | SUPPRESSED)
```

**Provider reused, not duplicated.** The Evolution gateway deployed for #170 is the only WhatsApp transport; the customer path uses a *new instance* on it (`ssangyong-autos` in the example), never the notification instance `mythos-bridge`, which `crm.reserved_inbox_ids` keeps out of every project. The notification adapter, ledger, breaker and scope fence in `bridge/notify/` are untouched (asserted by both test suites). The transport stays unofficial: every project on the adapter must carry `unofficial_acknowledged: true` and the envelope records `provider_class: unofficial`.

**What can be answered without a business source.** Greeting, vehicle acknowledgement (echo of the model/year the customer wrote + "which part?"), and a request for details on ambiguous text. Everything that needs a fact — part availability, price, delivery, compatibility, order status — is a handoff (`BUSINESS_DATA_UNAVAILABLE`) with the missing fact *kinds* recorded on the decision; optionally an acknowledgement that promises nothing (`send_handoff_ack`, off). Voice notes, media without caption, locations and "I want a person" are handoffs. The advisory generator receives the intent, the entities and the verified facts — not the customer text unless `share_customer_text: true` — under a system prompt that forbids inventing prices, stock, delivery, compatibility, references, hours or numbers; its output passes `factGuard`, which also runs again inside the policy gate.

**Outbound policy (§10 of the issue).** `lib/policy.js` refuses by name: `AUTO_REPLY_DISABLED`, `MODE_DRY_RUN`, `DECISION_NOT_REPLY`, `REQUIRES_HUMAN`, `RECIPIENT_MISSING|INVALID`, `PROVIDER_NOT_CONFIGURED`, `CREDENTIAL_MISSING`, `PROVIDER_UNAVAILABLE` (breaker), `BUSINESS_DATA_MISSING`, `FACT_GUARD_VIOLATION`, `REPLY_RATE_EXCEEDED`, `TEXT_EMPTY|TOO_LONG`, `NOT_ROUTED`. Dry-run evaluates every gate and shows the exact proposed text with the recipient masked.

**Idempotency and loops (§11 of the issue).** Event id = hash(adapter, provider message id) claimed with O_EXCL before routing → a provider retry is `DUPLICATE_INBOUND`, during or after the first run; a `SEND_FAILED` is final (a timeout that actually delivered is never doubled); provider ids we sent are recorded and an inbound carrying one is `ECHO_OF_OWN_OUTBOUND` even if `fromMe` is absent; `fromMe`, groups, status and self-chat are refused at parse; hourly cap per conversation; provider breaker after N consecutive failures.

**Host verification (2026-09-05 01:5x UTC, read-only).** RAM 7,746 MiB total / 2,788 MiB available, swap 3,649 / 4,095 MiB used, 4 vCPU, disk 88 % (9.3 GiB free), Evolution API v2.3.7 on loopback 8080 answering, port 8790 free on loopback, deploy user has no service-management right beyond user units. A Node receiver fits; Chatwoot still does not. **Nothing was deployed**: the receiver, its state directory, token files, the customer instance and the gateway webhook are owner actions (README "Receiver").

**Security result.** No real send (live mode exercised against a loopback stub only); no credential printed, persisted or committed (`*_file` references, 0600 enforced, `apikey` in the webhook body never read); records and logs carry names, hashes and a masked number; receiver loopback-only with a strict bind check, ≥16-char token (URL or header, constant-time), 256 KiB body limit, 200 on refusals so the gateway does not retry; no governance-protected path touched.

**Deliberately not built.** Media replies, read receipts, typing state, instance lifecycle / pairing (owner via the gateway), the business data sources themselves (the port is the integration point), a persistent conversation store (the gateway keeps history; a CRM remains the target of §2 when resources allow).
