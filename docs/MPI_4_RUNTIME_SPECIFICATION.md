# MPI-4 — Runtime Specification and Decision Ledger

**Status:** ACTIVE ledger for the MPI-4 (runtime) track · **Date:** 2026-08-15
**Authority:** decisions recorded here verbatim govern the MPI-4 runtime; architecture derives from `MYTHOS_CHATBOT_ARCHITECTURE.md`, `MODEL_ROUTING_ARCHITECTURE.md`, `MYTHOS_CONTEXT_ARCHITECTURE.md` §5, and the ratified MPI decision set (`MPI_2H_INGESTION_SPECIFICATION.md` §32–§35). Nothing here weakens a prior ratified decision.

## 1. Stage map

| Stage | Content | Status |
|---|---|---|
| **M4-1** | Provider-neutral adapter contract + deterministic offline mock provider | **PASS** (2026-08-15; suite 21/21) |
| **M4-2** | Offline runtime composition: request → identity/scope → R3 → ContextPackage → adapter → mock; explicit owner identity bridge; operator entry point; no-egress enforcement | authorised 2026-08-15 |
| M4-3 | First real-provider session | **BLOCKED by O-4-1 (§2)** |

## 2. Ratified O-4-1 — DEFER real external egress (owner, 2026-08-15)

Recorded exactly as provided, without reinterpretation or expansion:

- MPI personal memory must NOT leave the VPS at this stage.
- No external LLM provider is enabled.
- The M4-1 offline provider remains the only active provider.
- No provider API key is created.
- No provider endpoint is configured.
- No provider receives MPI summaries, content, provenance, identifiers, prompts, or ContextPackages.
- Real provider selection remains OPEN.
- Provider jurisdiction remains OPEN.
- Provider retention/training policy remains OPEN.
- Provider eligibility of memory classes remains OPEN.
- External identity handling remains OPEN.
- Context budget for a real provider remains OPEN.
- PROTECTED-memory egress remains forbidden until explicitly decided.
- D3 content remains local and must never be exported implicitly.
- This decision does NOT authorize any external data transfer.

**This is a current-state DEFER decision, not a permanent prohibition.** The full O-4-1 option analysis (A external provider · B self-hosted · C provider-selectable · D defer, with the A1–A5 sub-decisions) remains the historical/open alternative record — see the O-4-1 review in `docs/AI_HANDOVER.md` (2026-08-15). Revisiting O-4-1 is a new owner decision that must resolve, at minimum: provider+jurisdiction (A1), retention/training floor (A2), memory-class egress eligibility (A3), external identity handling (A4), and context budget (A5). **§2.1 below is the decision-ready record for that revisit.**

### 2.1 Decision-ready record (2026-08-15) — analysis only; O-4-1 remains DEFER

**Egress inventory — derived from the ACTUAL implementation** (runtime item mapping + compiler package shape + M4-1 CompletionRequest), stating what would leave the VPS if a real provider were enabled today, unmodified:

| # | Data | Leaves VPS | Implemented today | Required for a provider | Policy decision required |
|---|---|---|---|---|---|
| 1 | User request (message) | YES | yes (CompletionRequest.userMessage) | yes | no (it is the point) |
| 2 | Memory summaries (`content_summary`) | **YES** — item `value`s | yes | for memory-informed answers, yes | **YES — the core A3 decision** |
| 3 | Required facts | YES (same items) | yes | yes | A3 |
| 4 | Relevant preferences | YES when classified `user`-source | yes | optional | A3 |
| 5 | Milestone info (PROJECT_STATE summaries) | YES if retrieved | yes | optional | A3 |
| 6 | Provenance references (opaque `source_reference`) | **YES** — per item + in `_diagnostics.trimmed` | yes | no | **YES** (strip vs. keep) |
| 7 | `user_id` | **NO** — not a package field | n/a | no | A4 confirms it stays out |
| 8 | `organisation_id` | **NO** — not a package field | n/a | no | A4 |
| 9 | Domain/project info | only if explicitly supplied (narrowing echoes into diagnostics flags, values not in package items) | partial | no | minor |
| 10 | Intent | YES (`pkg.intent` = capability id) | yes | useful | no |
| 11 | Entities | YES (`pkg.entities`) | yes (empty today) | optional | A3-adjacent |
| 12 | Permissions object | **YES** (`pkg.permissions`) | yes | no | **YES** (strip candidate) |
| 13 | `content_reference` strings | **YES — finding: the runtime item mapping includes `contentReference`**, so the sha256 URIs would leave (they reveal content hashes, not content) | yes | **no** | **YES — strip-before-egress is the obvious candidate, but that is an owner call** |
| 14 | Content bodies (D3) | **NO — by construction** (no hydration into packages exists) | n/a | no | any change = new decision |
| 15 | Diagnostics (`_diagnostics`: exclusions, conflicts, trim reasons w/ source references) | **YES** (inside the package) | yes | no | **YES** (strip candidate) |

Caveat honoured: opaque memory ids (`mem:batch-2h-002:item-01` as item keys) and provenance references are **pseudonymous, linkable identifiers**, not anonymity — they leave under the current shape (rows 3/6) and their handling is part of A4/A3.

**Sub-decision register (all OWNER decisions; none made here):** A1 provider+jurisdiction · A2 retention/training/logging floor (incl. abuse/safety retention, support access, provider-side + transport encryption — verify from official provider documentation at selection time, never from marketing) · A3 memory-class eligibility per class: PROTECTED (§8.1 — standing rule: forbidden until explicitly decided), `user_private`, DECISION, PREFERENCE, PROJECT_STATE/MILESTONE · A4 identity/pseudonym handling (ids stay out; item keys/references substituted or not) · A5 context budget (`approxBudget`/`maxItems` values). **F14 interaction:** a provider that retains prompts holds copies that tombstone-suppression can never reach — A2 is therefore load-bearing for the erasure policy's meaning, and must be decided with F14-C explicitly in view. **D1** unaffected (no third-party PII exists) · **D2** unaffected (pointers only) · **D3** protective (bodies stay home; row 13 is reference-string leakage only) · **D5** unaffected (storage-side).

**Policy options for the eventual revisit (proposal only — nothing here is authoritative):**

| Option | Consequence |
|---|---|
| **1. No external provider (continue offline)** | Status quo; zero egress; runtime remains a deterministic context inspector; zero new secrets/infrastructure/governance |
| **2. External provider only under explicit contractual guarantees** | Requires A1+A2 resolved against **current official provider documentation** (no guarantee may be assumed); one owner-created key; rows 1–5,10 leave; rows 6,12,13,15 should be decided (strip candidates); F14 caveat applies to whatever the provider retains |
| **3. External provider, selected memory classes only** | Option 2 plus A3 per-class allowlist enforced by the compiler's existing category/scope filters; smallest useful egress surface |
| **4. External provider with redaction/pseudonymization** | Option 3 plus an egress-sanitization step (strip references/ids/diagnostics, substitute item keys) — **new implementation stage**; the M4-1 boundary is the natural enforcement point |
| **5. Self-hosted model** | Zero egress with real capability; undocumented territory (new serving architecture, unassessed VPS resources); its own design stage |

No provider was contacted, no account or key exists, no data left the VPS, and no provider facts were asserted (which is why no web research was performed — this record makes no claims requiring verification; verification belongs to the selection moment under A1/A2).

### 2.2 O-4-1 AMENDED — RATIFIED: LIMITED FREE EXTERNAL EGRESS (owner, 2026-08-15)

The §2 DEFER record above is **preserved as history**; it governed until this amendment. The owner's execution order (2026-08-15) authorizes a bounded implementation. A first order named DeepSeek `:free` and **correctly stopped** when fresh verification found zero DeepSeek `:free` models in the official catalog; the follow-up order authorizes one currently available free model selected after fresh verification.

**Ratified decision:**
- **OpenRouter is the only external gateway.** Only the exact selected model is permitted: **`nvidia/nemotron-3-ultra-550b-a55b:free`** (selected 2026-08-15 from the fresh official catalog: 16 `:free` models, 0 DeepSeek; strongest generally-capable text→text chat model — flagship-class general model, 1M context, $0 prompt/$0 completion; specialized models excluded by documented purpose).
- No paid model. · No automatic fallback (`provider.allow_fallbacks: false` + `provider.max_price {prompt: 0, completion: 0}` + response-model verification). · No automatic provider switching. · **No credits may be added** (the free ceiling stays 50/day by design). · No `:nitro`/`:floor`/routing shortcuts. · Runtime remains operator-run on the VPS (O-4-2 unchanged). · Identity remains `usr_othman`/`org_mythos` (O-4-3 unchanged). · **Only the existing ContextPackage crosses the provider boundary** — and the egress serializer sends the *minimal* subset (intent + item summaries + user message); item keys, provenance references, permissions object, content-reference strings and diagnostics are **stripped before egress** per the §2.1 strip candidates. · No raw PostgreSQL rows. · No R2 content bodies. · No credentials. · No ingestion. · No Coolify/Supabase changes.

**Quota and counter (verified from official documentation, 2026-08-15):** free-model limits are **50 requests/day** (accounts under $10 credits) and **20 requests/minute**, resetting on the **UTC day**; `GET /api/v1/key` exposes credit/limit information but **no exact free-requests-remaining counter** — therefore the runtime's displayed count is an **ESTIMATED LOCAL COUNT, labelled as such**, from a metadata-only local ledger (date, counts, model, success/failure — never prompts, packages, memory, responses, or keys). Failure behaviour: `FREE_LIMIT_REACHED` (local ceiling) · `FREE_RATE_LIMITED` (provider 429) · `FREE_MODEL_UNAVAILABLE` (model gone) · `FREE_MODEL_POLICY_VIOLATION` (response reports a different model) — never a silent substitution, never a paid retry. **Availability dependency:** `:free` variants churn; if the selected slug disappears the runtime refuses, and re-selection is a new owner order.

**Secret:** the OpenRouter API key lives only in the owner-created `/home/ubuntu/.config/mythos/openrouter.env` (mode 0600, `OPENROUTER_API_KEY=`), per the established credential-file convention — never in Git, logs, diagnostics, MPI, or R2.

**Consequences:** M4-2 and all further runtime work build exclusively against the offline mock. Zero-egress is an enforced property (structural tests), not a convention. The runtime carries no provider-selection surface until O-4-1 is re-decided.

## 3. Open decisions in the MPI-4 track

| # | Decision | Status |
|---|---|---|
| O-4-1 | Provider / data egress | **DEFER ratified (§2)** — sub-decisions A1–A5 OPEN |
| O-4-2 | Runtime surface & hosting | **RATIFIED (§4)** — operator-run CLI on the VPS, on-demand; any *deployed* runtime is a NEW decision |
| O-4-3 | Identity bridge for the current runtime | **RATIFIED (§5)** — explicit owner-declared single-identity bridge; a future multi-user bridge is a separate owner decision + implementation stage |
| O-4-4 | Memory→capability linking policy (skill/intent router) | OPEN — the operator runtime's interim linking rule is a documented composition choice (see `runtime/mpi-runtime.js` header), not a relevance judgment |
| D4 | Automatic `disputed` resolution | OPEN, non-blocking — the runtime surfaces conflicts and never resolves them |

## 4. Ratified O-4-2 — operator-run CLI on the VPS, on-demand (owner, 2026-08-15)

### 4.1 Surface gap analysis (historical/open alternatives — preserved, none deleted)

| Option | Class | Where/how | Coolify | Legacy app change | Secrets | Read-only + no-egress possible | Status |
|---|---|---|---|---|---|---|---|
| **A. Operator-run CLI on VPS** | documented pattern (O-2H-2(a) precedent) **and implemented** (M4-2 `cli/mpi-runtime-cli.js`) | operator invokes on demand; identity/scope as explicit arguments through the owner identity bridge; env contract per invocation; offline mock hard-wired | no | no | none (MPI read credential flows container-env → process env per invocation, never stored) | **yes — proven** (M4-2 suite + live check) | **RATIFIED** |
| B. Standalone service on VPS (non-Coolify) | technically possible, **undocumented** | daemon + local listener; needs process management, a request transport, standing env | no | no | standing env exposure | possible but adds a listening surface | historical/open — not promoted |
| C. Coolify-deployed service | architecturally implied for a future deployed runtime (§20.5 names Coolify as env injector), **unspecified** | deployment + injected env + service lifecycle | **yes** | no | Coolify-managed | possible | historical/open — requires its own deployment authorisation |
| D. Integration into the legacy browser/PHP app | **contra-indicated today**: §19.1 boundary (app never references MPI), no app-side identity/permissions (O-4-3 open) | new app surface + identity bridge | indirectly | **yes** | app-side | hard to bound | historical/open — blocked on O-4-3 at minimum |
| E. Other | none defined by any architecture document | — | — | — | — | — | none exists |

Distinction honoured: (1) documented architecture = A's pattern + C's env-injection principle; (2) implemented capability = A only; (3) technically-possible-but-undocumented = B (and D's mechanics) — **not promoted into a design by this ratification**.

### 4.2 The decision (verbatim)

- Runtime is operator-run. · Runtime executes on the VPS. · Runtime is not a deployed service. · Runtime is not a Coolify application. · Runtime is not scheduled. · Runtime does not run as a daemon. · Runtime does not modify the existing web application. · Runtime does not modify Supabase. · Runtime does not enable MPI ingestion. · Runtime uses the existing explicit identity bridge: `usr_othman` / `org_mythos`. · Runtime remains read-only against MPI. · Runtime uses the offline provider only while O-4-1 is DEFER. · No external provider is selected. · No provider credentials are required. · No personal memory leaves the VPS.

**Explicitly NOT authorized by this decision:** Coolify deployment · real LLM provider · external network access · public API · multi-user identity · automatic startup · scheduled execution.

### 4.3 Boundaries and relationships

**Operational boundary:** the runtime exists only for the duration of an operator invocation on the VPS shell; no listener, no port, no process survives the invocation (live-verified at ratification: 0 node listeners, 0 running MPI CLI processes). **Security boundary:** identity is a fail-closed explicit-input whitelist of one owner scope; the provider is hard-wired offline; the MPI read credential exists only in the invocation's process environment; the composition is structurally write-free and egress-free (test-asserted). **O-4-1:** fully respected — this decision changes nothing about egress and cannot be read as provider authorization. **O-4-3:** untouched — one owner scope remains the entire identity universe. **O-4-4:** untouched — the interim linking rule stands, disclosed per response. **Deployment implications:** none now; choosing B/C/D later is a new owner decision with its own authorization (and, for C, explicit Coolify authorization).

## 5. Ratified O-4-3 — explicit owner-declared single-identity bridge (owner, 2026-08-15)

### 5.1 The decision (verbatim)

- Current runtime identity maps explicitly to: `user_id = usr_othman`, `organisation_id = org_mythos`.
- The mapping is explicit and operator-controlled. · No automatic identity inference is permitted. · No arbitrary user can select another MPI user. · No organisation switching is permitted. · No multi-user identity system is introduced. · No legacy application authentication changes are made. · Missing or invalid identity fails closed. · Domain/project scope remains optional unless explicitly supplied and validated. · This decision applies only to the current operator-run runtime. · It is NOT a general multi-user architecture. · A future multi-user bridge requires a separate owner decision and implementation stage.

### 5.2 Identity semantics and boundaries

The mapped identity is **operator identity** (the owner acting on their own MPI scope) — not application identity and not tenant identity; the legacy application's shared-password session is not an identity source and is never consulted. **Permissions are not derived from identity**: the §10 `permissions` object remains explicit request input, filtered before ranking on the unchanged R3 path — operator identity is never a policy bypass. **Domain/project** narrowing is explicit-only, validated by the R1 filters; absent input stays absent — no defaults are inferred from identity. **Prohibited inference sources, permanently for this runtime:** IP, hostname, browser, filesystem user, email, display name, shared-password session, arbitrary environment variables — the bridge implementation (`runtime/identity-bridge.js`) has no code capability to read any of them, and the test suite asserts refusal of metadata-bearing identity objects.

### 5.3 Open/future alternatives (preserved, not designed)

A general multi-user bridge (application sessions → per-user MPI scopes, organisation membership, role-derived permissions per `MYTHOS_AI_MULTI_TENANCY.md`) remains **OPEN future work** requiring: an application identity system that does not exist today (§19.1 / auth.js findings), owner-authorized registry rows per user (the O-2H seed pattern), and its own decision + implementation stage. Nothing in §5.1 constrains or pre-designs it.
