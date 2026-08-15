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
| O-4-2 | Runtime surface & hosting for a *deployed* runtime | OPEN — the M4-2 operator-run local entry point follows the established O-2H-2(a) CLI pattern and does not decide deployment |
| O-4-3 | General identity bridge (beyond the owner scope) | OPEN — M4-2 implements only the explicit owner-declared scope (`usr_othman`/`org_mythos`); no application-session mapping exists or is implied |
| O-4-4 | Memory→capability linking policy (skill/intent router) | OPEN — the operator runtime's interim linking rule is a documented composition choice (see `runtime/mpi-runtime.js` header), not a relevance judgment |
| D4 | Automatic `disputed` resolution | OPEN, non-blocking — the runtime surfaces conflicts and never resolves them |
