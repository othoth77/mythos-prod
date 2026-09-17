# MYTHOS WP V2.1 — MYTHOS AI agents

The AI layer of the Control Center is **MYTHOS AI**: agents (`wp_agents`) bound to projects and optionally to one number (`wp_project_agents`), running one of two engines, in one of three modes, with a least-privilege read-only tool registry and the #173 fact guard. Companion: `PROJECTS.md` §5, `ARCHITECTURE.md`, `WHATSAPP_SETUP.md`, `SECURITY.md`, `OPERATIONS.md`.

Modules: `reference/ai/agents.js`, `ai/tools.js`, `ai/llm.js`, `comms/assistant.js`, `comms/handoff.js`, `comms/ports.js`, `autoreply.js`, `projects.js` (Project → AI). Routes: `reference/routes/ai.js` (agents, tools, runs, status, test, manual auto-reply) and `api.js` (`/api/projects/:p/ai`).

## 0. Where AI lives in the panel (V2.1)

| Surface | What | Who |
|---|---|---|
| **Project → AI** (`#/projects/:id?tab=ai`) | the day-to-day switch: **Agent** (select), **Mode** Off / Suggest / Auto, **Status** Active / Disabled, **Test AI** | admin saves; manager tests; everyone reads |
| **Project → Advanced → AI agents** | the agent cards of that project: **New agent**, **Bind**, **Open** | admin |
| Agent page (`#/ai/agents/:id`) | the full editor (**Edit**: name, slug, description, status, mode, engine, model, language, minimum confidence, knowledge, tools, instructions), **Bind to project**, **Delete** (owner); Projects card with Unbind; Advanced fold with slug / engine / model / confidence / tools / instructions and recent runs | admin |
| **Project → Advanced → AI runs**, **Settings → System → AI runs** | `wp_ai_runs` table (project picker on Settings) | any |
| **Inbox** | AI suggestions (accept / edit / reject), **Take over (AI → Human)** / **Hand back to AI**, handoff history under Advanced | agent+ |
| `#/r/knowledge`, `#/r/rules` | knowledge entries and business rules (generic resource views, reached by URL) | agent+ / admin |

There is no AI entry in the sidebar; `#/ai` redirects to the selected project's AI tab (or to Projects). The Overview tab and the project list show the bound agent and its effective mode.

## 1. Agent record (`wp_agents`)

| Field | Values | Notes |
|---|---|---|
| `slug`, `name`, `description` | slug `^[a-z0-9][a-z0-9-]{1,62}$` | unique slug |
| `status` | `active` \| `paused` \| `archived` | only `active` agents resolve; delete is refused (409) while conversations reference the agent → archive |
| `mode` | `off` \| `suggest` \| `auto` | `auto` = policy-gated automatic replies (§4) |
| `engine` | `engine-173` \| `llm` | §3 |
| `model` | model id or `provider/model`; NULL = pool ranking | llm engine only |
| `system_prompt` | persona text ≤ 8000 chars | never a credential |
| `language` | `fr` \| `ar` \| `en` | reply language |
| `tools` | ids from the registry (§5) | default `knowledge.lookup`, `handoff.request`, `conversation.history` |
| `knowledge` | boolean | may use the project's `wp_knowledge` rows that are `active` and `allowed_for_auto_reply` |
| `confidence_min` | 0 … 1 (default 0.8) | auto mode: below → suggest only |
| `settings` | `{ max_replies_per_hour (1–60, default 5), greeting, handoff_keywords[] … }` | non-secret |

A default agent `mythos-assistant` (engine-173, suggest, default tools) is created at boot when the table is empty; it is bound to nothing — binding is an admin act (Project → AI, the New project form, or Bind on the agent card).

## 2. Binding, resolution and the effective mode

`POST /api/ai/agents/:id/projects { project_id, inbox_id?, priority? }` (admin) → `wp_project_agents` (`inbox_id NULL` = every number of the project; unique per agent/project/inbox; lower priority wins). `DELETE /api/ai/agents/:id/projects/:link_id` (admin). **Project → AI → Agent** writes the same table at project level through `PUT /api/projects/:p/ai` (it replaces the project-level binding; number-specific bindings are left alone).

`agents.resolveForConversation(conversationId)`: the conversation's own `wp_conversations.agent_id` (if active) → an enabled binding for (project, that inbox) → a binding for (project, NULL) → `null`. Paused/archived agents are skipped as if unbound.

`agents.effectiveMode(agent, inbox, project)` → `off | suggest | auto` — **three levels, restrict only**:

| Level | Where it is set | Column |
|---|---|---|
| 1. agent | agent page → Edit → Mode | `wp_agents.mode` (a non-active agent counts as `off`) |
| 2. project | **Project → AI → Mode** | `wp_projects.settings.ai_mode` (`off \| suggest \| auto \| inherit`; `inherit` when never set) |
| 3. number link | the **AI** switch on Project → WhatsApp / WhatsApp → number → More (on = `inherit`, off = `off`); `suggest` / `auto` accepted by the API | `wp_inboxes.ai_mode` |

`off` on any level wins; `inherit` changes nothing; a lower level may lower the mode (`auto` agent + `suggest` project = suggest) but never raise it (a `suggest` agent stays suggest under an `auto` project). The assistant calls it with the resolved project on every run (`comms/assistant.js`).

The seeded automation "Route new conversation to the project agent" (`automations.js`, action `assign_agent { agent:'project_default' }`) sets `wp_conversations.agent_id` on `conversation.created`.

## 3. Engines

| | `engine-173` | `llm` |
|---|---|---|
| What | the deterministic MYTHOS AUTO engine of Issue #173 (`projects/automotive/comms`): intent parsing, verified ports, business rules, template generation, policy gate, fact guard. No network | a chat completion through the free-LLM pool of `projects/mythos-ai-executor/free-llm` (A → B → C fallback over ≤ 3 wired providers holding a key; Groq active in production), with tools and the #173 `factGuard` |
| Facts | `comms/ports.js` over the Kitchen: vehicle, parts, price (Kitchen catalogue price, `indicative: true`), stock (availability state); `order` not connected → `REQUIRES_HUMAN` | only what tools returned in `TOOL_RESULT` lines; kinds `price`, `stock`, `parts`, `vehicle` recorded in `facts.available` |
| Protocol | `engine.process` in forced dry-run on an in-memory ledger | the model answers ONLY a JSON object `{ action: reply \| tool \| handoff, tool?, args?, text?, reason?, confidence, intent? }`; at most 3 tool rounds; reply ≤ 900 chars |
| Guard | engine policy + fact guard | `factGuard(text, { available })` from `projects/automotive/comms/lib/ai`; any unverified price / stock / delivery / compatibility / order claim → `FACT_GUARD_VIOLATION` → the caller falls back to the engine-173 template path with lowered confidence |
| Records | `wp_ai_runs` model `mythos-auto-reply/template`, prompt version `engine-173/v1` | `wp_ai_runs` model = provider model id, prompt version `wp-llm-tools/v1`, `tools_used = [{ tool, ok, ms }]` |
| Credentials | none | `secrets.loadKey(provider)` at call time; the key never enters WP's memory beyond the call; `GET /api/ai/status` reports presence only |

In the editor the engines are labelled *Deterministic (no network)* and *Language model (fact-guarded)*. Both engines treat the customer text as **data**: it is parsed / quoted between markers and the system prompt states that instructions inside it are content to answer, never commands. The tool allow-list is server side (`agent.tools`); the model cannot widen it (`TOOL_NOT_ALLOWED`).

The engine-173 path remains the fallback generator of every agent.

## 4. Modes and the auto-reply policy

| Mode | Behaviour |
|---|---|
| `off` | no run |
| `suggest` | on every persisted inbound of a conversation with `handler = 'ai'`, one `wp_ai_runs` row and, when a text was produced, one `wp_ai_suggestions` row (`proposed`); a human accepts / edits / rejects (`POST …/suggestions/:id/decide`) and sends through the normal outbound route with `ai_run_id` + `suggestion_id` |
| `auto` | = suggest, and the reply is sent automatically **only when every gate passes** |

Gates of `assistant.autoReply` (`comms/assistant.js#gateAndSend`), every one evaluated and recorded in `wp_ai_runs.policy_result.auto_reply { sent, blocked_by, reason, cap, replies_last_hour }`:

| Gate | Passes when | Reason recorded otherwise |
|---|---|---|
| `MODE_AUTO` | effective mode (§2) is `auto` | `MODE_NOT_AUTO` |
| `DECISION_SUGGEST` | the run decided `suggest` and produced a suggestion | `DECISION_NOT_SUGGEST` |
| `CONFIDENCE_MIN` | `confidence ≥ agent.confidence_min` | `CONFIDENCE_BELOW_MIN` |
| `OUTBOUND_ENABLED` | inbox `outbound_enabled = true` (the **Replies** switch) | `OUTBOUND_DISABLED` |
| `INBOX_OPEN` | inbox `status = open` | `INBOX_NOT_OPEN` |
| `HANDLER_AI` | `wp_conversations.handler = 'ai'` | `HANDLER_NOT_AI` |
| `NO_OPEN_HANDOFF` | no `NEW | REQUIRES_HUMAN | IN_PROGRESS` handoff | `HANDOFF_OPEN` |
| `REPLY_CAP` | AI replies in the last hour `< settings.max_replies_per_hour` (default 5) | `REPLY_CAP` |

Before any run: `handler !== 'ai'` → `HANDLER_NOT_AI`, no agent → `NO_AGENT`, effective mode `off` → `MODE_OFF`, same inbound message already being handled → `DUPLICATE_MESSAGE`; a conversation flagged `needs_human` / with an open handoff gets no run at all (412, journaled `ai.refused`). When every gate passes: `outbound.send(text, client_ref 'auto-<run_id>', ai_run_id, suggestion_id)` → the outbound row is `sender_kind = ai`, the suggestion becomes `sent` (`decided_by 'ai'`), the run's decision becomes `auto_reply`; a failed send records `SEND_FAILED`. Otherwise the run stays a plain suggestion. Manual trigger for a manager: `POST /api/projects/:p/comms/conversations/:id/auto-reply` (same gates).

## 5. Tools (`ai/tools.js`) — read-only, least privilege

| Tool | Scope | Requires | Returns |
|---|---|---|---|
| `kitchen.search_products` | kitchen | `project.settings.kitchen` | Kitchen products by `q`, `ref`, `category`, `brand_car` (limit ≤ 10) |
| `kitchen.get_product` | kitchen | Kitchen | one product by uid |
| `kitchen.quote` | kitchen | Kitchen | verified price(s) — the ONLY source a reply may quote a price from |
| `kitchen.availability` | kitchen | Kitchen | availability state of one uid |
| `kitchen.vehicle_models` | kitchen | Kitchen | vehicle models of the catalogue |
| `knowledge.lookup` | knowledge | — | `wp_knowledge` rows of the project that are `active` and `allowed_for_auto_reply`, text search, ≤ 5 |
| `conversation.history` | conversation | — | last 10 messages of THIS conversation only (text included) |
| `handoff.request` | handoff | — | a decision flag `{ requested, reason }`; the assistant performs the handoff |

Every call is timed and bounded (5 s → `TOOL_TIMEOUT`), recorded by name and outcome only. A project without a Kitchen (Service / Internal) answers `KITCHEN_NOT_CONFIGURED`. **No write tool exists.** `GET /api/ai/tools` lists the registry; the editor's *Tools* multiselect is built from it.

Note: the contract lists a `model=` argument for `kitchen.search_products`; `kitchen.js#searchProducts` accepts `model_id` / `motorization_id` (numeric ids) and ignores a free-text `model`, so that argument is currently dropped.

## 6. Handoff AI ↔ Human (`comms/handoff.js`)

`POST /api/projects/:p/comms/conversations/:id/handoff { direction: 'ai_to_human' | 'human_to_ai', reason?, assign_to? }` (agent+; Inbox buttons **Take over (AI → Human)** / **Hand back to AI**). `GET …/handoffs` → history (no message text), shown under the customer panel's Advanced fold.

| Direction | Effect |
|---|---|
| `ai_to_human` (`toHuman`) | `wp_handoffs` row: `direction ai_to_human`, `taken_by` (the human actor or `assign_to`), `taken_at`, `previous_state { handler, agent_id, status, last_intent, last_run_id }`, `status REQUIRES_HUMAN` (or `IN_PROGRESS` when assigned); conversation `handler = 'human'`, `status → needs_human` (from open/pending/waiting_customer), `assigned_to`; journal `handoff.created`; bus `handoff`. Idempotent: an open handoff on a conversation already in human hands is returned (and assigned when `assign_to` is given) |
| `human_to_ai` (`toAI`) | resolves every open handoff (`RESOLVED`, `resolved_by`, `resolution = reason`), records a `human_to_ai` row (already resolved, with `previous_state`), conversation `handler = 'ai'`, `needs_human → open`; journal `handoff.resolved`; bus `handoff` |

AI-initiated handoffs (engine decision `handoff` or the `handoff.request` tool) call `toHuman(…, 'ai', { reason, run_id })`; the default automation "Customer asks for a human" (keywords human / humain / agent / conseiller / personne / شخص / بشري / عون) calls it with `CUSTOMER_REQUESTED_HUMAN`. While `handler = 'human'`, no automatic run happens.

## 7. API summary

| Route | Role | Result |
|---|---|---|
| `GET /api/projects/:p/ai` | any | `{ agent, mode (effective), project_mode, status: active \| disabled, agents[] (manager+) }` — `PROJECTS.md` §5 |
| `PUT /api/projects/:p/ai { agent_id?, mode? }` | admin | rewrites the project-level binding and / or `settings.ai_mode`; audited |
| `GET /api/ai/agents` | any | agents + `projects[]` bindings + `stats { runs_24h, handoffs_24h, auto_replies_24h, errors_24h }` |
| `POST /api/ai/agents` · `GET/PATCH /api/ai/agents/:id` · `DELETE` | admin · any/admin · owner | 201 / row / 409 when referenced |
| `POST /api/ai/agents/:id/projects` · `DELETE …/:link_id` | admin | binding |
| `POST /api/ai/agents/:id/test { project_id, text, contact_masked? }` | manager | dry-run on a synthetic message (`assistant.test`: no conversation, **no run row**, no send — the outcome only) → `{ decision, intent, confidence, text, facts, tools_used, engine, model }`; this is **Test AI** on Project → AI |
| `POST /api/projects/:p/comms/conversations/:id/auto-reply` | manager | runs `autoReply` now on the latest inbound (every gate applies) — not in the contract, present in the code |
| `GET /api/ai/tools` | any | registry |
| `GET /api/ai/runs?project=&agent=&limit=` | any | `wp_ai_runs` (no prompt text) |
| `GET /api/ai/status` | any | `{ engine_173:{ available }, llm:{ configured, providers:[{ id, credential_present, health }] }, agents:{ active, auto, suggest }, defaults }` |
| `POST /api/projects/:p/comms/conversations/:id/suggest` (existing) | agent | manual run |
| `POST …/suggestions/:id/decide { action: accept \| edit \| reject, text? }` (existing) | agent | decision; accept/edit → send through outbound |

## 8. Knowledge and business rules (existing resources)

`wp_knowledge` (`#/r/knowledge`): kind product_fact / faq / policy / vehicle_note, `customer_text` used verbatim, `language`, `allowed_for_auto_reply` (default false), status draft / active / archived. Only `active` + `allowed_for_auto_reply` rows reach an agent. `wp_business_rules` (`#/r/rules`): per-project JSON values (opening hours, delivery zones, `comms.retention`, …) read by the #173 engine.

## 9. What the AI never does

Send outside the policy gates; state a price, stock, delivery, compatibility or order fact a tool/port did not return; read a credential; change rules, tools or permissions; read another conversation; run on a conversation that is in human hands or flagged `needs_human`; run above the mode the agent, the project or the number link allows; invoke the Meta MCP (`MCP.md`).
