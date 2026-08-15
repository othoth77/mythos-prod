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

**This is a current-state DEFER decision, not a permanent prohibition.** The full O-4-1 option analysis (A external provider · B self-hosted · C provider-selectable · D defer, with the A1–A5 sub-decisions) remains the historical/open alternative record — see the O-4-1 review in `docs/AI_HANDOVER.md` (2026-08-15). Revisiting O-4-1 is a new owner decision that must resolve, at minimum: provider+jurisdiction (A1), retention/training floor (A2), memory-class egress eligibility (A3), external identity handling (A4), and context budget (A5).

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
