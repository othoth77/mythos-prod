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
resources.

**Delivered (OTH-K2-W):** the executor side of this wiring exists at
`projects/mythos-ai-executor/lib/knowledge.js` +
`config/knowledge.json`, validated under the MOS-v2 regression gate.
It follows the executor's fail-closed config discipline (unknown
fields, endpoint/url/credential-shaped keys anywhere, a relative or
in-repository store root, or an unreadable file each disable the whole
layer), exposes ONLY an explicit read-operation allowlist (a write
operation appearing on the service surface would still not become
reachable), and enforces the consuming-side rules below in code:
`currentState` without `asOf` is refused at the executor boundary
(`MYTHOS_KNOWLEDGE_ASOF`), and every search hit carries provenance plus
a `presentation` annotation (`assertion_class`, `is_claim`,
`statement_class`, `quarantined`). The config ships **disabled** with
`store_root: null` — activating it is the operator step of pointing it
at a provisioned persistent private store outside the repository.
Suite: `tests/othk-2w-executor-wiring-test.js`. Nothing in the
knowledge layer changed.

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
