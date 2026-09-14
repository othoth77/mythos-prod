# OTHKM Architecture (as implemented)

OTHKM is the central Knowledge & Memory system of the OTH ecosystem. It is **OTH-K**
(`projects/oth-knowledge`) — a deterministic, append-only, provenance-first Node engine —
strengthened in place (branch `feat/othkm-strengthening`). This document describes what the
code actually does, not an aspiration. Every claim below is backed by a test suite
(`tests/othk-*`).

## 1. Truth model (unchanged core)
- **Append-only** JSONL record log + content-addressed object store (`lib/store.js`). Corrections
  are new versions; deletion is a tombstone version; nothing is ever rewritten in place.
- **12 record kinds** (`lib/model.js`): source, artifact, document, chunk, entity, fact, claim,
  observation, event, relationship, evidence, derived. Fail-closed validation.
- **claims ≠ facts**: a claim carries `asserted_by` (an assertion); a fact carries `confidence`.
  An LLM statement enters as a *claim*, never a bare fact.
- The store refuses to live inside the git repo (the truth store is never in Git).

## 2. Provenance & trust
- **Mandatory provenance** on every knowledge-bearing record (`source_class`, `source_reference`,
  `captured_at`). Orphaned provenance is impossible (`extract.js` ensures the source record).
- **OTH-K3 trust** (`lib/trust.js`, `config/trust-model.json`): 6 authority tiers
  (first-party, operator, repository-verified, imported, metadata-only, **model-output**).
  `assessTrust` is asOf-driven and returns a non-truth summary ("supported", never "true").
  Model output is its own lowest tier: "Claude said it" is structurally not "the owner confirmed it".

## 3. Bi-temporal memory (Phase 4)
- **Valid (event) time**: optional `valid_from`/`valid_to` on records. **Transaction time**:
  append-only `written_at`; **`expired_at` is derived** (write time of the superseding version),
  never stored (`lib/temporal.js`: `expiredAt`, `validAt`, `validAndKnownAt`).
- "What was valid at T" combines both axes (valid AND known at T). Supersession uses the
  Graphiti invalidate-don't-delete default (`suggestValidTo`: old `valid_to` = new `valid_from`).

## 4. Namespaces (Phase 2)
- `global` | `personal` | `projects/<slug>` — an optional record field (absent reads as global).
  Strict isolation in retrieval. Shared knowledge stays ONE record (normally global) referenced
  from projects via relationships — never duplicated. Domain/operational data stays in the
  project's own database; secrets stay out of OTHKM; code stays in Git.

## 5. Retrieval (Phases 5, 6, 12, 13)
- **BM25** + **vector** + **hybrid RRF** (`lib/search.js`, unchanged primitives).
- **Embeddings** (`lib/embeddings.js`): pluggable provider — zero-dep deterministic hashed default
  kept; optional real **local** model adapter (`@xenova/transformers`, lazy, fail-closed → falls
  back). A deterministic, **persistent, rebuildable VectorCache** (retrieval-only, never truth).
- **Constrained retrieval** (`lib/retrieve.js`): applies namespace, bi-temporal asOf,
  supersession exclusion, **trust-weighted ranking** (model-output cannot outrank authoritative
  evidence on similarity alone), and optional recency decay (ranking only — never forgets).

## 6. Memory lifecycle: propose → gate → promote (Phases 7, 8, 16)
```
AI/proposer → memory_propose → candidate → promotion gate → STAGING → (operator) promoteRun → OTHKM
```
- **Extraction decision** (`lib/extract-decision.js`, deterministic — the engine never calls an
  LLM): ADD / UPDATE / NOOP / CONFLICT. UPDATE appends a new record and closes the old one's
  validity (invalidate, not delete) + a `supersedes` link. CONFLICT stores the competing record
  and registers `conflicts_with` (both live, open, no winner).
- **Promotion gate** (`lib/promotion-gate.js`): validates provenance, registered source class
  (fail-closed), secret/PII (reuses the ingest gate), namespace, temporal sanity, and a
  **trust-escalation cap** (`maxTier` — an AI proposer cannot self-declare a first-party class).
  Never upgrades trust; never writes.
- **Staging** (`lib/propose.js`): `memory_propose` writes only to a separate staging store.
  Promotion into canonical remains the existing operator two-phase `promoteRun`. AI proposes;
  OTHKM (operator) decides.

## 7. Consolidation, contradiction, dedup (Phases 9, 10, 11)
- **Consolidation** (`lib/consolidate.js`): read-only pass → candidate plan; append-only
  relationship links only (never edits/merges/deletes knowledge). Not a "dreaming" engine.
- **Contradiction** (`lib/contradiction.js`): same subject + same property + overlapping validity
  + different value → conflict candidates. Conservative/structured (no false positives on prose).
- **Dedup** (`lib/dedup.js`): exact (content hash) + normalized (Jaccard) + **semantic** (embeddings)
  near-duplicates — link-only, never merges/deletes.

## 8. Entities, relations, context (Phases 14, 15)
- **Graph** (`lib/graph.js`): adjacency map over relationship records; neighbours, `same_as` alias
  resolution, entity mentions, bounded walk. Derived from truth, rebuildable — **no graph DB**.
- **Context builder** (`lib/context.js`): compact, namespace/asOf/trust-constrained, provenance-
  bearing context (retrieval + entity mentions + shallow graph expansion, budget-bounded). Not a
  memory dump.

## 9. MCP surface (Phase 16)
Read tools (all read-only): `knowledge_search`/`retrieveConstrained`, `knowledge_get`,
`sourceTrace`, `timeline`, `entitySearch`, `buildContext`, `project_context`, `currentState`,
`findContradictions`, `assessTrust`, `audit`, `system_health`. One gated write:
`memory_propose` (staging only). The read service exposes no canonical write method.

## 10. OTHMODE / project integration (Phases 17, 18)
`lib/othmode-memory.js` binds OTHMODE and projects to OTHKM as their **single** memory source
(scoped global/personal/projects/<slug>). OTHMODE reads context/search/timeline and proposes new
memory through the gated staged path (capped at model-output). OTHMODE keeps **no competing
permanent store**.

## 11. Conversation ingestion & migration (Phases 19, 3)
- **Conversations** (`lib/conversation-memory.js`): conversation → distilled candidates → gate →
  staging, preserving exact-conversation provenance. Only durable knowledge is stored — never raw
  messages.
- **Migration** (`lib/migrate-source.js`): existing markdown decisions/lessons/handovers →
  candidates with preserved repository provenance → gate → staging, with a report. `dryRun`
  reports without writing; re-migration is idempotent (NOOP); originals are never destroyed.

## 12. Evaluation & security (Phases 20, 21, 22)
- **Eval** (`eval/othkm-eval.js`, runnable, CI-gateable, deterministic, no LLM judge): recall@k,
  as-of accuracy + stale-leak, active-version/supersession, provenance completeness, namespace-leak,
  secret-block, hallucinated-memory rate, latency p50/p95/p99.
- **Security**: cross-project isolation, no unauthorized canonical write, secret/PII gate, memory-
  poisoning resistance (trust ranking), false-promotion prevention (gate), trust-escalation guard,
  temporal-manipulation resistance (asOf discipline).

## 13. Operations (Phase 26)
Restart recovery (store rebuilds from the log), idempotent re-append, corruption fail-closed on
open, tombstone-as-history, `store.verify()` integrity. Embedding index is a rebuildable sidecar.

## What OTHKM deliberately does NOT add
No Neo4j / graph database, no separate OTH-MEMORY repository, no separate memory database, no
external SaaS, no vector database service, no "dreaming" engine, no mutable truth storage, no
unrestricted AI writes. Simplicity, locality, determinism, provenance-first — preserved.
