# OTH Knowledge ↔ Mythos AI Operating Layer — Integration Boundary

**Status:** CANONICAL — OTH-K2 (2026-08-19)

## 1. Principle

The AI Operating Layer **consumes** knowledge. It never owns, hosts, or
mutates the knowledge database. OTH Knowledge remains independent of
every AI provider (OpenAI, Anthropic, Google/Gemini, future providers):
no provider SDK, credential, network call, or provider-specific type
exists anywhere in `projects/oth-knowledge/`.

## 2. The boundary

One module: `projects/oth-knowledge/lib/knowledge-service.js` —
`openService(storeRoot)` returns a **read-only** operation surface:

| Operation | Answers |
|---|---|
| `search(query, {mode, filters, limit})` | exact / lexical / vector / hybrid retrieval, hits carry provenance |
| `retrieve(id)` | one record + version envelope summary |
| `lookupEntity(name)` | folded-name entity lookup + linked record ids |
| `lookupEvidence(id)` | the evidence chain behind a fact/claim |
| `lookupHistory(id)` | full version history incl. tombstones |
| `lookupProvenance(id)` | provenance, artifact availability, import lineage, assertion class |
| `findContradictions({state, entity_id})` | conflict records with both sides |
| `currentState({asOf, tag})` | temporal view: known / latest verified / open contradictions |
| `audit()` | read-only provenance audit report |
| `stats()` | corpus statistics |

Write operations are deliberately absent. Ingestion and curation go
through the importer/CLI paths under operator control — an AI-layer
call can never create, version, or tombstone knowledge.

## 3. How the Operating Layer connects

The executor/console (projects/mythos-ai-executor, mythos-os-console)
integrate by requiring `knowledge-service.js` with a store-root path
from configuration — the same pattern as their existing config-driven
resources. That wiring is a separate, executor-scoped stage (it touches
the MOS-v2 regression-gate surface and must run under that gate); the
boundary contract above is what it codes against. Nothing in the
knowledge layer will need to change.

Rules for the consuming side:
1. Treat `asOf` as an explicit input — never let the layer default to
   "now" silently (`currentState` refuses a missing `asOf` by design).
2. Surface provenance with every answer shown to a human.
3. A `claim` (incl. everything NotebookLM/Gemini-derived) is never
   presented as a fact.
4. Quarantined/`superseded` items are shown only with their state.

## 4. Provider independence guarantee

Enforced by construction and by suite othk-2 §10 (service surface is
read-only; hits carry provenance) plus the zero-dependency rule
(`package.json`-free project, plain Node). Any future embedding
provider plugs in as an `embedder` function via configuration —
recorded with model/version in the operations doc when that day comes.
