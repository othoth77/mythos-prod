# OTH Knowledge — Knowledge Operating Layer Architecture

**Status:** CANONICAL — OTH-K1 (first implementation stage)
**Date:** 2026-08-19 · **Stage branch:** `claude/oth-knowledge-mission-05buds`
**Implementation:** `projects/oth-knowledge/` (this repository)
**Content canon (engineering memory):** the standalone private repository `othoth77/oth-knowledge` (unchanged in role — see §2)

---

## 1. Purpose

OTH Knowledge is the provider-agnostic knowledge operating layer of the
Mythos ecosystem. It is more than a document archive: it stores knowledge
that is **structured, searchable, traceable, versioned, reusable,
provenance-aware, provider-independent, secure and reproducible**.

It is NOT the same system as MPI (Mythos Personal Intelligence):

| | OTH Knowledge | MPI |
|---|---|---|
| Content | engineering / project / infrastructure knowledge | personal memory of a consenting user |
| Store | file-backed, append-only, in-repo library (`projects/oth-knowledge/`) | PostgreSQL `mythos_intelligence` + R2 content store |
| Governance | AGENTS.md + this document | ratified D1–D5, O-2H-*, F-* decisions |

MPI's ratified boundaries are **respected, not re-decided** here: nothing
in OTH Knowledge writes to MPI tables, and the Google Contacts source
class is registered **pointer/metadata-only** (no third-party PII bodies)
in deference to the spirit of D1 until the owner decides otherwise
(§6.2). OTH Knowledge never stores credentials or personal authentication
material of any kind.

## 2. Placement decision (recorded)

**Decision:** the knowledge operating layer *implementation* (code, tests,
fixtures, evaluation) lives in `othoth77/mythos-prod` under
`projects/oth-knowledge/`, like every other Mythos project. The standalone
repository `othoth77/oth-knowledge` remains the canonical home of the
*engineering-memory content* (PROJECTS/PROBLEMS/LESSONS + INFRASTRUCTURE)
and gains no code.

- **Evidence:** the standalone repo is four Markdown files at root commit
  `67b3a88`; its README forbids recreating memory *content* in
  mythos-prod but says nothing against code; every executable Mythos
  component lives in `projects/*` with suites in `tests/`.
- **Alternatives:** (a) implement inside the standalone repo — rejected:
  no test harness, no AGENTS.md governance, would turn a content repo
  into a code repo; (b) new third repository — rejected: the GitHub App
  cannot create repositories (recorded problem), adds governance surface.
- **Reversibility:** high — the library is dependency-free and
  path-relative; it can be promoted to its own repo later without change.

## 3. Canonical knowledge model

Record kinds (closed enum, validated fail-closed):

| Kind | Meaning |
|---|---|
| `source` | a registered origin system instance (e.g. one Takeout export) |
| `artifact` | one original file/object exactly as received (content-addressed; never modified) |
| `document` | the normalized representation derived from one artifact |
| `chunk` | a retrieval unit of a document (deterministic chunking) |
| `entity` | a named thing (project, host, tool, person-as-pointer) |
| `fact` | a statement accepted with stated confidence and provenance |
| `claim` | a statement asserted by a source, not yet accepted |
| `observation` | a dated first-hand recording (e.g. a test result) |
| `event` | something that happened at a time |
| `relationship` | a typed edge between two records |
| `evidence` | a link from a fact/claim to the record(s) supporting it |
| `derived` | AI- or tool-generated content (summary, extraction) |

Rules:
- A `derived` record is **never** an original fact; it must carry
  `derived_from` references. An AI summary can support a claim only as
  `derived` evidence, clearly typed.
- Every fact/claim keeps traceability to evidence whenever technically
  possible (`evidence` edges → chunks/artifacts/observations).
- Contradiction never overwrites: see §7.

## 4. Identity, versioning, immutability

- Artifacts are content-addressed: `othk://sha256/<64-hex>`; identical
  bytes deduplicate by construction; originals are never destroyed or
  edited by normalization.
- Records get deterministic ids `<kind>-<sha256(canonical seed)[0..16]>`
  where the seed is the record's identity key (per-kind), so re-ingestion
  is idempotent.
- The store is **append-only JSONL**. A correction is a new version of
  the same record id (`version: n+1`, `supersedes` the prior version's
  sequence); old versions remain readable. Deletion is a tombstone
  version (`deleted: true`), never a rewrite.

## 5. Storage

File-backed store under a root directory (default
`projects/oth-knowledge/data/` — git-ignored except committed seeds):

```
<root>/objects/sha256/<aa>/<hash>      original artifact bytes (read-only)
<root>/records.jsonl                   append-only record log (all kinds, versioned)
<root>/meta.json                       store format version + counters
```

Provider-independent by construction: no database, no network, no SaaS.
A PostgreSQL or object-store adapter is a future additive backend behind
the same `store.js` interface; the JSONL log is the durable interchange
format (export = the log itself, filtered).

## 6. Ingestion and source separation

Pipeline: **source system → source collection → original artifact →
normalized document → chunks → (optional) extracted knowledge**, each
step recorded with provenance; the original artifact is preserved
byte-for-byte at every step.

### 6.1 Source classes (`config/source-classes.json`)

Independent provenance is preserved per source class; artifacts are never
merged across classes on textual similarity:

`google-takeout`, `google-contacts`, `gemini`, `notebooklm`,
`google-other`, `manual`, `mythos-repo`, `owner-report`,
`external-provider` (extensible).

### 6.2 Policy per class

Each class carries a policy: `content` (bodies may be stored) or
`metadata-only` (pointers/metadata only). `google-contacts` is
**metadata-only** pending an explicit owner decision, honouring the
ecosystem's ratified third-party-PII stance (MPI D1). Policy is enforced
fail-closed at ingest time.

### 6.3 Data quality

Ingest validates and quarantines rather than silently drops: duplicate
artifacts (dedup, recorded), malformed records, missing metadata, invalid
timestamps, encoding problems (invalid UTF-8 / NUL), orphan references,
unsupported file types. Every refusal is a typed error; every quarantine
is an `observation` record.

## 7. Conflicts and contradiction handling

New information contradicting old information **never silently
overwrites** it. A `conflict` relationship links the competing
facts/claims with: both record ids, source classes, timestamps,
confidences, and a `resolution_state ∈ {open, resolved, superseded,
coexisting}`. Resolution is an explicit new version citing the decision;
losing records remain readable with their full history.

## 8. Retrieval

`lib/search.js` provides, over the chunk/fact/claim/observation corpus:

- **exact** matching (ids, references, literal strings);
- **lexical** retrieval — an inverted index with BM25 ranking
  (k1=1.5, b=0.75), unicode-folded tokenization;
- **semantic** retrieval — a pluggable `embedder` interface
  (provider-agnostic: any function `text → float[]`); the default
  offline embedder is a deterministic hashed character-n-gram vectorizer,
  explicitly labeled `pseudo-semantic` — it makes hybrid ranking real and
  testable without a network or a model provider, and is replaced by a
  real embedding provider via configuration, never code change;
- **hybrid** ranking — weighted reciprocal-rank fusion of lexical and
  vector lists;
- **filters** — metadata, entity, temporal (`observed_at`/`occurred_at`
  ranges), source class / provenance, kind, confidence.

Retrieval answers always carry provenance (source class, artifact ref,
record id, version), so a caller can trace any hit to its origin.

### 8.1 Evaluation

`eval/retrieval-eval.json` is a committed, reproducible evaluation set
(queries → expected record ids over the committed fixtures);
`eval/run-eval.js` measures Recall@5, MRR and exact-hit rate for lexical,
vector and hybrid modes and prints a comparable report. Search quality is
claimed **only** from these measured numbers.

## 9. APIs and exports

- Programmatic API: `lib/api.js` (`openStore`, `ingestArtifact`,
  `addRecord`, `search`, `exportRecords`, `verify`).
- CLI: `cli/othk-cli.js` — `ingest`, `search`, `export`, `validate`,
  `stats`, `seed`. Exit codes: 0 ok, 1 failure, 2 usage.
- Export: filtered JSONL (records) + referenced objects manifest;
  re-importable losslessly (round-trip covered by tests).

## 10. Security

- No secrets, credentials, tokens, or private keys are ever stored as
  knowledge content; ingest runs a credential-shape gate (key/token/
  private-key patterns) and **refuses** matching content with a typed
  error, storing only the refusal observation (kind of match, never the
  match itself).
- Imported knowledge is treated as sensitive: fixtures are synthetic;
  logs print ids and hashes, not bodies; the committed seed set contains
  only non-secret infrastructure metadata (§11).
- The store root is repository-external by default in production use;
  committed data is limited to seeds/fixtures reviewed for secrets.

## 11. Infrastructure / Deployment knowledge (recorded 2026-08-19)

The verified infrastructure facts of 2026-08-19 are recorded twice, by
design: as **content** in the canonical `othoth77/oth-knowledge`
repository (`INFRASTRUCTURE.md`) and as **structured seed records**
(`projects/oth-knowledge/seeds/infrastructure-2026-08-19.json`) ingested
into the layer with full provenance (`owner-report`, observed 2026-08-19).
Facts include: VPS 51.68.226.211, deploy account with ED25519 public-key
auth, owner-machine SSH/SCP verified successful, rsync on VPS but not on
the owner's Windows machine, and the explicit **capability limitation**
that owner-machine access is NOT evidence of AI-agent access. AI-agent →
VPS access was re-tested from this execution environment on 2026-08-19:
no SSH client, no key material, TCP 22 unreachable → **NOT AVAILABLE**
(consistent with `docs/DEPLOYMENT_READINESS.md` §1). No secret material
is stored anywhere in these records.

## 12. Deployment posture

The layer itself is a dependency-free Node library + CLI; "deployment" is
repository presence plus optional installation on any host with Node ≥ 18
(`node cli/othk-cli.js`). It requires no service, port, daemon or
credential, so it introduces **no new deployment blocker**. The wider
Mythos deployment picture after the 2026-08-19 infrastructure
verification is: Phase B operator steps are now executable by the owner
from the verified Windows→VPS SSH/SCP channel (rsync absent on Windows →
use `scp -r` or tar-over-ssh as the runbooks' transfer step); nothing is
executable from this AI execution environment (§11). The blocker class
therefore shifts from "no verified channel" to "operator execution
pending" — all runbooks unchanged.

## 12a. OTH-K2 decisions (2026-08-19, evidence-based)

**Embeddings — NO external provider now.** Measured on the OTH-K2
evaluation set (20 queries incl. importer-produced events/claims):
lexical BM25 alone already achieves recall@5 = recall@10 = **1.0**,
MRR **0.95**; the offline pseudo-semantic vectors add nothing the set
can measure (vector MRR 0.863 < lexical). A real embedding provider
would add a credential, a network dependency, and re-index cost for no
measurable retrieval gain at this corpus size. The pluggable embedder
interface stays (provider adapter = configuration, not code change);
revisit when a real corpus produces queries that lexical retrieval
measurably misses. Credentials, model/version recording, and embedding
provenance requirements are pre-documented in §8 and the operations doc.

**Database — NO PostgreSQL migration now.** Measured (`eval/bench-store.js`):
5,000 records → append 31k rec/s, reopen 50 ms, lexical query 3.0 ms,
log 3.8 MB, RSS 141 MB; 20,000 records → reopen 80 ms, lexical query
6.5 ms, hybrid 24 ms, log 15 MB, RSS 244 MB (index build 11 s is the
offline embedder, a batch cost). The real corpus today is orders of
magnitude smaller. Migration triggers (any one): >100k live records,
multi-writer concurrency, sustained query latency >100 ms, or an
operational backup requirement the JSONL-file model cannot meet. If
triggered: schema + deterministic migration preserving content hashes,
provenance and versions, with tested rollback — per the operations doc.
"PostgreSQL is more production" is explicitly not a trigger.

## 10a. Independent security audit (2026-08-19, OTH-K3)

An independent adversarial security audit (Opus, probe-driven) covered
path traversal, repository-store injection, credential leakage, endpoint
injection, filesystem access, prototype pollution, query/ReDoS abuse,
malformed source data, provenance spoofing, trust manipulation,
quarantine bypass, write-operation bypass, temporal-state bypass, and
the ops shell scripts. Verdict **PASS-WITH-FINDINGS**; every CONFIRMED
finding was fixed with a regression test:

- **F1** — the secret gate scanned only normalized text, so credential
  bytes hidden in stripped `<script>`/`<style>`/comment bodies reached
  the preserved-original artifact. Now the gate scans the raw decoded
  bytes as well (`lib/ingest.js`).
- **F2** — the non-authoritative-tier trust ceiling applied only to
  `kind:'fact'`; an attacker-supplied Takeout/Gemini `event`/`observation`
  could reach `supported`. The ceiling now applies to every statement
  kind (`lib/trust.js`).
- **F3** — `asOf` was checked only for truthiness; a non-date value made
  every `Date.parse` comparison NaN-false and returned future-dated
  statements as `current`. `asOf` is now validated as an ISO timestamp
  in the temporal path (`lib/temporal.js`).
- **F4** — quarantined records presented clean through non-`search`
  service ops and could appear in `latest_verified`. Quarantine is now
  flagged on `retrieve`/`lookupProvenance`/`currentState`, excluded from
  `latestVerified`, and detected in both tag spellings.
- **F5** — the HTML strip used unbounded `[\s\S]*?` regexes that were
  quadratic on an unterminated tag (single-file DoS). Bodies are now
  bounded (measured linear).
- **F6** — repository-containment was enforced only on the read-only
  consumer; the writer (`store.openStore`) had no check, and a symlink
  bypassed the executor's lexical check. `openStore` now refuses an
  in-repository root (realpath-resolved) except the git-ignored
  `data/` fixtures dir.
- **F7–F15** — widened forbidden-key matching (composite spellings) and
  added the scan to the source-class registry; refusal gates now run
  before any store write (F8); symlinked import root refused (F9);
  contacts header now requires a majority of recognised columns and
  rejects digit-run cells (F10); `restore-verify.sh` fails closed on a
  missing hash and extracts with `--no-same-owner/--no-same-permissions`
  (F11); `deploy-vps.sh` validates its arguments (F12); `artifact_ref`
  shape validated at write time (F13); a `not-yet-true` truth time never
  assesses `supported` (F14); query length bounded (F15).

No finding allowed code execution or a write outside the store; the
frozen read-only executor allowlist, content-addressed traversal
defense, corroboration-inflation resistance, and quarantine stickiness
all held under probing. Regression coverage lives in
`tests/othk-2-importers-test.js` §12 and `tests/othk-3-trust-test.js`
§13–§14.

## 12b. OTH-K3 — knowledge trust model (2026-08-19)

`lib/trust.js` + `config/trust-model.json`: a strictly READ-ONLY trust
derivation over the store (zero writes — test-pinned byte-identical
store after assessment). Independently reviewed (Opus architecture
review, APPROVE-WITH-CHANGES, all 13 required changes implemented).

- **Authority:** every source class maps to a tier
  (`first-party`/`operator`/`repository-verified`/`imported`/
  `metadata-only`/`model-output`) in a fail-closed registry closed both
  ways against `source-classes.json` (a registered class without a tier,
  or a tier naming an unregistered class, refuses the whole model at
  service open). Missing provenance → `untrusted`, fail closed.
- **Statement category** is a function of kind × tier × assertion class,
  never kind alone: a `fact` record carrying a model-output or imported
  source, or an INFERRED/DERIVED assertion class, categorizes as
  `imported-claim` — model output can never assess as an accepted fact.
  Claims split `user-provided-claim` vs `imported-claim`; quarantine
  overrides everything (`quarantined-assertion`).
- **Freshness** is relative to an explicit `asOf` only (never the wall
  clock): per-tier staleness horizons; `unknown-date` is stale
  fail-closed; truth time after `asOf` is `not-yet-true` (no negative
  age). **Stale ≠ false** — staleness never demotes the category.
- **Corroboration:** independent evidence = distinct
  (source class, collection, content anchor) identities, resolved by the
  chunk→document→artifact→content-ref walk; duplicate citations,
  derived records (recursed into `derived_from`), self-corroboration and
  unresolved ids are listed but NEVER counted; `also_present_in`
  attributions are enumerated separately, never silently folded in.
- **Contradiction/supersession as of `asOf`:** conflict state derives
  from `resolution.decided_at` (a conflict resolved after `asOf` was
  open at `asOf`); the losing side of a resolved conflict caps at
  `superseded`. The version assessed is the one selected by the same
  capture-aware rule as `temporal.knownAt`.
- **Quarantine is sticky** across version history ≤ `asOf` and across
  BOTH tag spellings (`quarantined`/`quarantine`) — a later version
  dropping the tag never silently recovers.
- **Confidence never becomes truth:** the summary is a closed,
  non-truth-shaped enum (`quarantined`/`superseded`/`contested`/
  `unverified-assertion`/`weakly-supported`/`stale`/`supported`) with
  non-overridable ceilings, `not_a_truth_value: true` on every report,
  a `basis[]` naming what set the label, no numeric score, and a
  `trace` block pointing every component at its evidence record ids.
  Corroboration and absence-of-conflict can only fail to lower a label.

Surface: `knowledge-service.assessTrust(id, {asOf})` (trust model loads
fail-closed at `openService`); executor allowlist + executor-side asOf
guard per the integration doc. Suite: `tests/othk-3-trust-test.js`.

## 13. Future (explicitly not in OTH-K1)

Real embedding providers; PostgreSQL/object-store backends; importer
implementations for real Takeout/Gemini/NotebookLM exports (formats are
modeled and fixtures-tested now; real personal-data imports require owner
authorization per source, and any contacts-body storage requires an owner
decision reversing §6.2); knowledge-graph query language; HTTP API.
