# Mythos — Context Architecture

**Stage:** MPI-0 — Personal Intelligence Foundation
**Status:** Draft architecture and contracts. Not deployed.
**Date:** 2026-08-06

---

## 1. Purpose

Defines `mythos-context-assembler` and `mythos-context-compiler` — how the platform decides, per request, exactly which slice of global rules, domain knowledge, organisation policy, user intelligence, and memory is worth including, and how that selection becomes a provider-neutral package a model can consume.

---

## 2. Context Assembler

**`mythos-context-assembler`** — given `user`, `organisation`, and `current task`, selects only the relevant context. It never dumps full user history into a prompt.

### Classification

Every candidate piece of context is classified before assembly:

```
REQUIRED    — the request cannot be handled correctly without this
USEFUL      — improves quality/personalisation but is not blocking
IRRELEVANT  — not related to the current task; excluded
FORBIDDEN   — excluded regardless of relevance, by permission or privacy rule
```

### Assembly

```
global rules
  + domain context
  + organisation context
  + role/permissions
  + relevant user preferences
  + relevant memory
  + current conversation/task
```

`FORBIDDEN` items are never assembled, regardless of how `REQUIRED` they might otherwise appear — permission filtering happens before relevance ranking is allowed to matter. This ordering is deliberate: relevance never overrides a permission boundary.

### Why This Matters

Token efficiency, privacy, latency, response quality, and avoiding conflicting context are treated as first-class requirements, not optimisations to add later. A context assembler that always includes everything "just in case" fails all five.

---

## 3. Retrieval Interface

Memory retrieval (`docs/MYTHOS_USER_MEMORY_POLICY.md` §5) is expressed as a provider-neutral interface:

```
retrieveRelevantMemory({ userId, organisationId, domainId, task, limit })
  → ranked, permission-filtered memory items
```

This stage does not require or force a vector database. The interface is designed so a future semantic/vector-ranking implementation can replace the illustrative in-memory ranking in `projects/personal-intelligence/reference/context-assembler.js` without changing any caller's contract.

---

## 4. Entity Resolution

An `EntityReference` (`docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §10) is resolved to real data only when a specific pipeline step needs it, and only within the `organisationScope`/`permissionScope` it carries. Resolution is lazy and scoped — never a bulk pre-load of every entity a user might reference.

---

## 5. Context Compiler

**`mythos-context-compiler`** — takes intent, user profile, organisation profile, domain, session, memory, skill plan, and permissions, and produces a minimal, provider-neutral **Context Package**:

```
ContextPackage {
  intent
  requiredFacts
  relevantPreferences
  organisationRules
  domainInstructions
  permissions
  selectedSkills
  entities
  outputRequirements
}
```

Provider adapters (see `docs/MODEL_ROUTING_ARCHITECTURE.md`) convert a `ContextPackage` into a specific model's prompt/tool-call format. **No personal or organisation intelligence is ever stored only in a provider-specific prompt file** — the `ContextPackage` (and the profiles it was compiled from) remains the source of truth, so switching providers never requires rewriting personal or organisation intelligence.

---

## 6. Personal Knowledge Sources

Interfaces are prepared, not implemented, for future authorised sources: user documents, organisation documents, course material, workshop documentation, invoices, vehicle records, calendar, email, internal notes. Every knowledge-source access is permission-aware by construction — resolved the same way an `EntityReference` is (§4), never bypassing the Guard layer. This stage implements no connector; it documents the contract future connectors must satisfy.

---

## 7. Relationship to the Automation Connector Model

Knowledge-source connectors are conceptually the same shape as the connector model already established in `docs/AUTOMATION_ARCHITECTURE.md` §5 — least-privilege capability grants, `secret_reference` only, never a value, health/rollback metadata. A future knowledge-source connector should be modelled as an `aut_connectors` entry with `connector_type = 'knowledge_source'` rather than inventing a parallel connector system.

---

## 8. Status

Draft architecture. `projects/personal-intelligence/reference/context-assembler.js` implements the classification and assembly rules in §2 for the reference profiles used by `tests/mpi-0-personal-intelligence-test.js`. No `mythos-context-compiler` provider adapter exists yet — see `docs/MODEL_ROUTING_ARCHITECTURE.md` §"Status".
