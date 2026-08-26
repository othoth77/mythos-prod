# OTHMODE — Target Architecture

Phase 1 design document. Nothing here is implemented yet.
Master document: [OTHMODE_AUDIT_AND_DESIGN.md](OTHMODE_AUDIT_AND_DESIGN.md)

**بالعربية باختصار:** هذه الوثيقة ترسم شكل النظام النهائي: منصّة واحدة (OTHMODE) فوق المحرّكات الموجودة، مع حدود واضحة — OTHMODE للتحكّم والتنظيم، وMythos OS وn8n للتنفيذ، وStatus Center هو مصدر الحقيقة عمّا حدث فعلاً، وClaude هو المزوّد الأساسي القابل للاستبدال.

---

## 1. Position in the ecosystem (boundaries)

| Layer | Owns | Never does |
|---|---|---|
| **OTHMODE** (`othmode.mythos`) | Control, organization, discovery, selection: commands, saved commands, skills, tools, providers, projects, health view, command history, memory view, evolution management | Execute workflows, run infrastructure, hold secrets, write execution truth |
| **Mythos OS** | Execution, automation, infrastructure, services (VPS, systemd, nginx, deploys) | Product control decisions |
| **n8n** | Workflow execution and integrations (Docker on the VPS; the 7 MYTHOS workflows) | Being a second OTHMODE workflow engine — `mcc_workflows` remain documentation, not execution |
| **Claude** | AI provider and reasoning/coding layer — primary provider | Being hard-coded as the only provider; elevating its own permissions |
| **Status Center** (`status.mythosprod.xyz`) | Execution truth: what was done, when, evidence, blockers, next action | Being duplicated by OTHMODE (OTHMODE reads it) |
| **Evolver / GEP** | Evolution technology/protocol (external, referenced) | Being forked and absorbed wholesale |
| **EvoMap** | — | **Fully out of the first implementation**: no EvoMap Hub, Worker Pool, Evolution Network, distributed agent network, or EvoMap infrastructure. OTHMODE must run with zero EvoMap dependency. |

## 2. Current vs target

**Current:** independent engines, each correct and tested, no shared surface.

```text
ordre.mythosprod.xyz  → command-center (MCC-1)         [live UI]
os.mythosprod.xyz     → mythos-os-console              [live UI]
status.mythosprod.xyz → status-center surface          [live UI, protected]
mythosprod.xyz        → hub dashboard                  [live UI]
(no UI)               → mythos-ai-executor (providers, skills, tools, policy, n8n)
(no UI)               → mythos-orchestrator (delegation, verification)
(CLI only)            → oth-knowledge (memory, live store on VPS)
(JSON only)           → projects/meta (project registry)
(.claude/skills)      → 20 Claude skills
```

**Target:** OTHMODE as the control shell over the same engines.

```text
                      ┌──────────────  OTHMODE (adapted MCC-1) ──────────────┐
                      │ Commands · Saved · Skills · Tools · Providers ·      │
                      │ Projects · Health · Status · History · Memory ·      │
                      │ Evolution · Search · Settings (OthMode ON/OFF)       │
                      └──┬────────┬──────────┬──────────┬──────────┬─────────┘
             read/write  │  read  │    read  │    read  │   read   │ append
                  ┌──────▼──┐ ┌───▼────┐ ┌───▼─────┐ ┌──▼─────┐ ┌──▼──────────┐
                  │ mcc DB  │ │executor│ │ meta +  │ │ oth-   │ │ evolution   │
                  │(pg, own)│ │configs │ │ status/ │ │knowledge│ │ memory (new,│
                  │         │ │+events │ │ monitor │ │ (RO)   │ │ append-only)│
                  └─────────┘ └────────┘ └─────────┘ └────────┘ └─────────────┘
```

Principles:
- **Read-first integration.** OTHMODE reads existing stores in place (executor configs, meta JSON, status/monitor outputs, oth-knowledge via its fail-closed service boundary). It writes only what it owns: the `mcc` schema and the new Evolution Memory.
- **One writer per noun** (existing repo rule) is preserved. OTHMODE never becomes a second writer of executor config, Status Center data, or the knowledge store.
- **No new framework, no new runtime.** Same zero-dependency Node + pg + plain web pattern as MCC-1.

## 3. Module architecture

For each module: owner store → API surface → UI. All APIs live under the MCC server (`/api/...`), reusing its auth/secret-gate/routing.

| # | Module | Data owner (source of truth) | OTHMODE access | New code needed |
|---|---|---|---|---|
| 3.1 | Commands | `mcc_commands` etc. (OTHMODE-owned) | read/write (existing) | rebrand only |
| 3.2 | Saved Commands | `mcc_templates`, favorites, notes | read/write (existing) | minor |
| 3.3 | Skills | `.claude/skills/` + executor `config/skills.json` | read (renderer over both registries); lifecycle changes go through Git PRs per `mythos-skill-evolution` | unified read model `/api/skills` |
| 3.4 | Tools | executor `config/tools.json` + `mcp-capabilities.json` | read | `/api/tools` |
| 3.5 | Accounts / Providers | executor `config/agents.json` + `router.json`; orchestrator `router.js` | read + non-secret status (enabled, authority, last health). **Secrets stay in `~/.config/.../*.env` (0600) — never in app data or DB.** | `/api/providers` |
| 3.6 | Projects | `projects/meta/*.json` | read; edits remain Git changes | `/api/projects` |
| 3.7 | Health | status-center `monitor/` output + sites `health.json` + provider/tool probes | read + state model (ACTIVE/DEGRADED/FAILED/BLOCKED/DEPRECATED/REPLACEMENT_REQUIRED); recovery workflow tracked as records, executed by operators/Mythos OS | `/api/health` + recovery record table |
| 3.8 | Status | Status Center (protected, owner-controlled) | read-only embed/links of `data/current.json` | `/api/status` proxy (read) |
| 3.9 | Command History | new unified read model over: `mcc_usage_events` + executor task events + orchestrator task state | read; each source keeps writing its own store | history aggregator + `/api/history` (fields: command, timestamp, duration, status, result, evidence, next action) |
| 3.10 | Memory | oth-knowledge store via `knowledge-service` boundary (read-only, fail-closed); ingestion/curation stays operator CLI | read/search | `/api/memory/search` behind the boundary |
| 3.11 | Evolution | **new** Evolution Memory (append-only JSONL, oth-knowledge store pattern, outside Git like the knowledge store; Git holds code/config, store holds events) | read UI first; writes only via reviewed pipeline | see [OTHMODE_EVOLUTION.md](OTHMODE_EVOLUTION.md) |
| 3.12 | Settings / OthMode switch | small `mcc` table or config file `othmode.json` (`{"othmode": "ON"|"OFF"}`) | read/write (owner role) | flag + consumption contract |

### 3.12.1 OthMode ON/OFF semantics

- **ON:** Claude entry points (Claude Code sessions via CLAUDE.md instruction, executor task prompts via template) are instructed to route through OTHMODE: consult commands/skills/memory, honor Search First, record history/evolution events.
- **OFF:** Claude operates normally; OTHMODE surfaces remain readable but impose nothing.
- The switch is an *instruction-layer* contract (prompt/config), not a technical interceptor — Claude can always operate; OTHMODE never becomes a single point of failure.

## 4. Provider independence

Keep the executor's proven model as the canonical provider architecture:
- Registry: `agents.json`-style records (provider, capabilities, task_types, execution_authority, risk, cost, latency, enabled).
- **Execution authority is the security line**: only providers explicitly granted it may modify repositories; advisory providers (OpenAI-compat, Gemini, DeepSeek, future) may research/review/plan. Fallback never crosses this line (existing `router.json` rule).
- Claude is primary by registry data, not by code: adding a provider = adding a registry record + adapter file, following `providers/openai-compat.js`.
- Credentials: env files outside the repo, 0600, referenced by name only. OTHMODE UI shows presence/health, never values.

## 5. Memory vs Status (separation)

| | OTH Knowledge / Memory | Status Center |
|---|---|---|
| Stores | knowledge, decisions, relationships, architecture decisions, long-term context, Evolution Memory (adjacent store, same pattern) | what was done, time, changes, evidence, blockers, next action |
| Writer | operator CLI (curated, provenance-tracked) | review engine + owner |
| OTHMODE role | read/search UI | read/embed only |
| Never | execution logs as knowledge | knowledge/decisions as status |

## 6. Deployment shape (target, not executed)

Same pattern as today: one Node user service + nginx vhost + `mythos-deploy` target with health gate and rollback. The `ordre` target either keeps its name (serving the OTHMODE app) or a new `othmode` target/host is added — owner decision. Status Center remains PROTECTED and outside `mythos-deploy` scope.

---

## ACTIVATION MODEL CHANGE (2026-08-26, supersedes the ON/OFF sections above)

The global OthMode ON/OFF switch described in this document was REMOVED by owner order. The current model:

- **OTHMODE is always available** — installed, healthy, READY; no global operating mode exists.
- **Activation is per command**: a Claude command activates OTHMODE only when it contains the standalone keyword `othmode` (case-insensitive; never as part of another word — `othmodel`, `myothmode`, `othmode-test` do not activate). Rule implemented once, in `projects/command-center/reference/othmode/activation.js`; checkable via `POST /api/othmode/activation` and `othmode-cli.js activation "<text>"`.
- **Without the keyword, Claude behaves normally** — no Search First, no OTHMODE skill/memory routing, no OTHMODE command policies, no evolution recording for that command.
- Only explicitly activated operations are OTHMODE commands in OTHMODE-specific history/context; evolution events are recorded only for activated operations whose actions actually qualify.
- The keyword selects the control contract ONLY. It grants no permission: session/bearer authentication, roles, owner gates, the secret gate and all boundaries are evaluated unchanged.
- `GET /api/othmode/mode` remains as a read-only availability report (`READY` + trilingual hint); its POST is gone and no replacement toggle exists anywhere.
