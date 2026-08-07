# Mythos — Model Routing Architecture

**Stage:** MPI-0 — Personal Intelligence Foundation
**Status:** Draft architecture. No provider adapter is implemented.
**Date:** 2026-08-06

---

## 1. Principle: Provider Independence

The Personal Intelligence architecture is model-independent by design. No user, organisation, or domain intelligence is ever stored only in a provider-specific prompt file — the application-level profiles (`docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md`) and the compiled `ContextPackage` (`docs/MYTHOS_CONTEXT_ARCHITECTURE.md` §5) remain the source of truth. Switching or adding a model provider must never require rewriting personal or organisation intelligence.

---

## 2. Generic Capability Classes

Rather than routing by vendor/model name directly, requests are classified by the kind of work needed:

```
FAST
REASONING
CODING
DOCUMENT
VISION
RESEARCH
STRUCTURED_EXTRACTION
```

---

## 3. Provider Adapters

A provider adapter maps a generic capability class to a specific model for a specific call:

```
resolveModel(capabilityClass, constraints) → { provider, model, adapterConfig }
```

Adapters convert a compiled `ContextPackage` into that provider's expected prompt/tool-call shape. The mapping table (which model serves which capability class, under what cost/latency constraints) is configuration, not code baked into callers — mirroring the connector-configuration pattern already established in `projects/automation/config/automation.example.json`.

---

## 4. Mapping Today

| Capability class | Example current provider mapping |
|---|---|
| `CODING` | Claude (this repository's primary development assistant) |
| `FAST` | A smaller/faster model tier, provider TBD per deployment |
| `REASONING` | A stronger-reasoning model tier, provider TBD per deployment |
| `DOCUMENT`, `VISION`, `RESEARCH`, `STRUCTURED_EXTRACTION` | Not yet mapped — MPI-9 target |

This table is illustrative and intentionally incomplete; it is not a commitment to any specific vendor beyond what the repository already uses for development (Claude, per `AGENTS.md`/`CLAUDE.md`).

---

## 5. Relationship to Automation Connectors

A provider adapter is conceptually similar to a connector (`docs/AUTOMATION_ARCHITECTURE.md` §5) in that it is least-privilege, references credentials only (`docs/AUTOMATION_SECURITY_AND_SECRETS.md`), and carries health/rate-limit/timeout metadata — but it is not registered in `aut_connectors`, since it serves the AI-routing layer rather than an external business/infrastructure provider. A future stage may choose to unify these registries; this stage does not decide that.

---

## 6. Status

Draft architecture only. No `mythos-context-compiler` provider adapter is implemented. Model selection for any actual automated work in this repository continues to follow existing repository conventions (`AGENTS.md`, `CLAUDE.md`) unchanged by this document.
