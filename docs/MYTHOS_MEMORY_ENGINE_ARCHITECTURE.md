# Mythos — Personal Learning & Memory Engine Architecture (MPI-2 Design Gate)

**Stage:** `MPI-2-DESIGN-GATE` · **Status:** DECIDED where marked, OWNER DECISION REQUIRED where marked · **Date:** 2026-08-12
**Baseline:** `ea4b61f783cda6257c1a337bef7020c38656bf87`

**Design only.** No schema was applied, no database or schema created, no row written, no migration executed, no persistent runtime built, no `pgvector` installed, no personal data imported, nothing deployed. This document ends at an owner decision gate.

**Predecessors:** [`MYTHOS_USER_MEMORY_POLICY.md`](MYTHOS_USER_MEMORY_POLICY.md) · [`MYTHOS_CONTEXT_ARCHITECTURE.md`](MYTHOS_CONTEXT_ARCHITECTURE.md) · [`MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md`](MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md) · [`MYTHOS_AI_MULTI_TENANCY.md`](MYTHOS_AI_MULTI_TENANCY.md) · [`MYTHOS_IDENTITY_ARCHITECTURE.md`](MYTHOS_IDENTITY_ARCHITECTURE.md) · `projects/personal-intelligence/database/control-plane-schema.sql`

---

## 0. The most important finding

**Most of this decision was already made in MPI-0, and two of the new requirements contradict it.**

`projects/personal-intelligence/database/control-plane-schema.sql` is a ratified 15-table draft in the `mythos_intelligence` schema. It already defines `pi_memory_records`, `pi_learned_preferences`, `pi_preference_audit`, `pi_entity_references` and `pi_knowledge_sources`, and it already fixes the storage boundary, the identity discipline, the supersession rule and the audit model. MPI-2 is therefore mostly **extension**, not fresh design.

But two MPI-2 requirements collide head-on with rules that schema states explicitly:

| MPI-0 ratified rule | MPI-2 requirement | Status |
|---|---|---|
| "**No raw personal-data column.** Every user/organisation-facing identifier is an opaque reference … never a name, email, or phone number" | Google Contacts import with "**strong identifiers: email / phone**", plus durable memory of *people* | **CONFLICT — owner decision required (D1)** |
| `pi_entity_references` "points at real entities owned by product schemas, **never duplicates them**" | Durable memory of people, organisations, projects and relationships that **no product schema owns** | **CONFLICT — owner decision required (D2)** |

Resisting the urge to quietly redesign around these is the main discipline of this document. They are surfaced as decisions **D1** and **D2** in §12 rather than resolved unilaterally, because both change what personal data the platform durably holds.

---

## 1. Storage decision

### Options evaluated

| Option | Integrity | Relational | Concurrency | Migrations | Backup/restore | Portability | Search | Future vector | Resource | Ops complexity | ID Auto isolation | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **A. Existing PostgreSQL instance, shared schema** | Strong | Strong | Strong | Shared | Shared | Good | Good | pgvector possible | None added | Lowest | **Poor — same schema as ID Auto** | **Rejected** |
| **B. Separate PostgreSQL database** | Strong | Strong | Strong | Independent | Independent | Good | Good | Possible | New DB, new connection pool | Medium | Strongest | Reasonable, heavier |
| **C. Separate PostgreSQL schema in the existing instance** | Strong | Strong | Strong | Independent per schema | Selectable per schema | Good | Good | Possible | Minimal | Low | Strong (no cross-schema FKs) | **CHOSEN** |
| **D. SQLite** | Good | Good | **Weak for concurrent writers** | Manual | File copy | Excellent | FTS5 | Extension needed | Tiny | Low | Total | Rejected |
| **E. Filesystem / JSON** | **Weak** | **None** | **Weak** | None | Easy | Excellent | Manual | No | Tiny | Low | Total | Rejected |
| **F. Hybrid PostgreSQL + object/file storage** | Strong | Strong | Strong | Independent | **Two coupled backups** | Good | Good | Possible | Moderate | Higher | Strong | **Partially adopted — see §2.3** |

### Recommendation — **Option C, confirming the MPI-0 decision**

Use a **separate logical schema `mythos_intelligence` inside the existing PostgreSQL instance**, exactly as `control-plane-schema.sql` already specifies.

**Why C over B.** The isolation that actually matters — no cross-schema foreign keys, independent migrations, independent ownership, independent grants, selectable backup — is delivered by a schema boundary. A separate *database* would add a second connection pool, a second backup target and a second restore procedure to protect against a failure mode (logical corruption of one schema) that a schema boundary already contains. B remains the correct escalation if MPI later needs a different availability or retention profile from ID Auto; the schema-per-product design makes that migration mechanical.

**Why not D or E.** A memory engine's whole value is conflict detection, supersession and relational provenance across facts, entities and events. E gives none of it. D gives most of it but serialises writers, and the engine is explicitly designed to be written by a runtime while being read by MPI-1 retrieval.

**Why F is only partially adopted.** MPI-0 already mandates that content is stored *by reference* (`content_reference`, URI/hash) and never embedded. That implies an object/file side to the design — which is precisely what makes the backup problem in §11 non-trivial, because the database and the content store must then be restored **as a consistent pair**.

---

## 2. Database and schema boundary

### 2.1 Decision

| Question | Decision |
|---|---|
| Separate database? | **No** — separate logical schema |
| Schema name | **`mythos_intelligence`** (already fixed by MPI-0) |
| Placed in `mythos_core`? | **No.** `mythos_core` is the draft identity core (`MYTHOS-IDENTITY-CORE-0`) and is itself undeployed. Memory is not identity. |
| Coupled to ID Auto? | **Never.** No foreign key, no view, no trigger, no shared table crosses into `idauto`. |

### 2.2 Ownership, migration, backup, restore, failure isolation

- **Ownership.** `mythos_intelligence` is owned by the Personal Intelligence track. ID Auto stages must never alter it, and MPI stages must never alter `idauto`.
- **Migration boundary.** Migrations are per-schema and independently versioned. An MPI migration never runs in the same transaction as an ID Auto migration.
- **Backup boundary.** A schema-scoped `pg_dump --schema=mythos_intelligence` is the MPI backup unit. **The existing ID Auto backups do not contain it**, because they dump the `idauto` database — see §11.
- **Restore boundary.** MPI can be restored without touching ID Auto data, and vice versa. Restoring MPI must never require an ID Auto outage.
- **Failure isolation.** Logical corruption is contained per schema. The shared failure domain that remains is the **PostgreSQL instance and its host** — which is exactly what the off-host gate in §11 addresses, and which the deferral of IDA-3F leaves open.

### 2.3 Cross-schema references

Cross-schema links stay opaque reference columns with a comment, never foreign keys, exactly as MPI-0 established. An `EntityReference` may point at an ID Auto vehicle; it never joins to one.

---

## 3. Memory model

Reuse first. New structures are proposed **only** where an existing MPI-0 table cannot carry the concept.

| Concept | Carrier | New? |
|---|---|---|
| Memory / fact | `pi_memory_records` (7 types A–G, §1 of the memory policy) | **exists** |
| Preference | `pi_learned_preferences` (confidence/evidence/supersedes) | **exists** |
| Preference lifecycle audit | `pi_preference_audit` (append-only) | **exists** |
| Entity reference | `pi_entity_references` | **exists** |
| External source | `pi_knowledge_sources` | **exists** |
| Permission decision audit | `pi_guard_decisions` (append-only) | **exists** |
| **Provenance (per memory row)** | `pi_memory_provenance` | **NEW** |
| **Conflict relation** | `pi_memory_conflicts` | **NEW** |
| **Supersession** | `supersedes_memory_id` on memory + audit row | **NEW column, existing pattern** |
| **Tombstone** | `pi_memory_tombstones` | **NEW** |
| **Tag** | `pi_memory_tags` | **NEW** |
| **Event / timeline** | `pi_memory_events` | **NEW** |
| **Person · organisation · project · relationship · decision · goal · routine** | **see D1/D2 — deliberately not modelled here** | **BLOCKED on owner decision** |

### 3.1 Why people/projects/relationships are not modelled in this gate

The requirement asks for durable memory of people, organisations, projects, relationships, decisions, goals and routines. Four of those — decisions, goals, routines and long-term project state — fit the existing model cleanly: they are `pi_memory_records` rows with a `memory_type` and a scope, plus `pi_memory_events` for their timeline.

**People and organisations do not**, and pretending otherwise would smuggle a major privacy change past review. A "person" record sourced from Google Contacts is raw personal data about a **third party who never consented to the platform**, holding a name, email and phone. MPI-0 forbids exactly those columns, and `pi_entity_references` is explicitly a pointer to product-owned entities, not a place to originate them. Modelling this needs **D1 and D2** answered first.

---

## 4. Memory lifecycle

```
capture → normalize → classify → entity resolution → permission/privacy gate
       → deduplication → conflict detection → persistence
       → retrieval → reinforcement → supersession → deletion/tombstone
```

Binding ordering rules, inherited and extended:

1. **The permission/privacy gate precedes relevance**, as `MYTHOS_CONTEXT_ARCHITECTURE.md` §2 requires and MPI-1 already enforces structurally. A `FORBIDDEN` item is never classified, ranked or persisted.
2. **The sensitive-data gate precedes persistence** (§8). A credential never reaches the deduplication step, let alone storage.
3. **Capture never writes directly.** Per memory policy §6, a single observation is at most a `SESSION_OBSERVATION`. Promotion to `CANDIDATE_PREFERENCE` and `ESTABLISHED_PREFERENCE` follows the existing pipeline; nothing skips straight to established.
4. **Deletion is a tombstone, never a silent row removal** (§7).
5. **Reinforcement is not a write of a new duplicate.** It increments `evidence_count` and moves `last_observed_at` on the existing row — see §6 for why this is quality-gated.

---

## 5. Provenance

Every durable memory row gets a provenance row. Provenance is **immutable**; correcting a memory creates a new memory with new provenance and a supersession link, never an edit.

| Field | Meaning |
|---|---|
| `provider` | `google` · `openai` · `anthropic` · `deepseek` · `gemini` · `notebooklm` · `mythos` · … |
| `source_type` | `contacts` · `conversation` · `file` · `note` · `observation` · `explicit_instruction` · `feedback` |
| `source_reference` | Opaque id/URI/hash of the originating artefact — never its content |
| `captured_at` | When Mythos recorded it |
| `observed_at` | When the fact was true/stated, where known and distinct from capture |
| `confidence` | `LOW` · `MEDIUM` · `HIGH` · `EXPLICIT`, reusing the existing vocabulary |
| `actor_ref` / `actor_type` | Opaque `usr_*`/`svc_*` reference and `HUMAN`/`SYSTEM`, where known |
| `import_batch_ref` | Groups rows from one import so a whole import can be reversed |

`import_batch_ref` is a deliberate addition: without it, a bad contacts import cannot be cleanly undone, and an un-undoable import of third-party personal data is a poor position to be in.

---

## 6. Conflicts, supersession and confidence

### 6.1 States

Memory rows carry a `state`: `active` · `superseded` · `disputed` · `tombstoned`.
`possible_match` is **not** a memory state — it is an *entity-resolution outcome* (§7), and conflating the two would let an unresolved identity masquerade as a disputed fact.

### 6.2 Rules

- Contradictory facts are **never silently overwritten**. Both rows persist; a `pi_memory_conflicts` row links them, and both move to `disputed` until resolved.
- Resolution is explicit — by a user instruction, or by a binding precedence rule via `scope.resolveByPrecedence` (session → user → organisation → domain → global). The loser becomes `superseded` with `superseded_at` and a `supersedes_memory_id` pointer. Nothing is deleted.
- **Repeated low-quality duplicates must not inflate confidence.** Reinforcement only counts when the new observation is *independent*: a different `source_reference`, or the same source at a materially later `observed_at`. Re-importing the same contacts file twice, or the same sentence appearing five times in one transcript, counts **once**. Without this rule, confidence measures verbosity rather than truth.

---

## 7. Entity resolution

MPI-1's rules are binding and carry forward unchanged:

- Strong identifiers may resolve: `id`, `externalId`, and — **subject to D1** — verified `email`/`phone`.
- Aliases may assist; a unique alias match resolves.
- **Name similarity alone never causes a hard merge**, even when the match is unique. It yields `POSSIBLE_MATCH` carrying every candidate.
- Ambiguous names stay ambiguous. Multiple strong identifiers yield `CONFLICTING_IDENTITIES` with no silent pick.
- Resolution is lazy and scoped to `organisationScope`/`permissionScope`; never a bulk preload.

This matters most for contacts: address books are full of "Mohamed", and a name-based merge would silently fuse distinct people and leak one person's context into another's. `POSSIBLE_MATCH` rows persist as unresolved and are surfaced for human resolution rather than guessed.

---

## 8. Privacy and sensitive data

### 8.1 Categories and handling

| Category | Handling |
|---|---|
| Passwords, API tokens, credentials, private keys | **DENY — never stored, in any form.** Not summarised, not hashed, not referenced. Detected at capture and dropped with a `pi_guard_decisions` audit row recording only the *kind* detected. |
| Payment card data | **DENY.** Same treatment. Out of scope for this platform entirely. |
| Identity documents (passport, CIN, licence) | **PROTECTED** — reference only, never content; excluded from retrieval unless an explicit permission scope grants it. |
| Health data | **PROTECTED**, and never included in a default retrieval. |
| Intimate/private information | **PROTECTED**, `user_private` scope, never promoted to organisation or global scope by any learning rule. |
| Third-party personal data (contacts) | **Subject to D1.** |

### 8.2 The credential rule is absolute

MPI-0 already states: "No secret-value column anywhere. Credentials belong exclusively to `aut_secret_references`; this schema never stores one." MPI-2 keeps this and strengthens it into a pipeline rule: **a credential-shaped value is rejected at capture, before normalization.** A secret must never become ordinary retrievable memory, and the safest way to guarantee that is for no code path to exist that could persist one.

MPI-2 **consumes** permission decisions. It implements no authentication, no session, no login, no JWT, and no permission persistence beyond auditing decisions it was given.

---

## 9. Temporal model

| Field | Meaning | On which rows |
|---|---|---|
| `captured_at` | When Mythos recorded it | every memory row |
| `observed_at` | When it was true/stated, where distinct | memory + provenance |
| `valid_from` / `valid_to` | The window in which the fact holds — how "he lives in Tunis" becomes historical rather than wrong | facts with a validity window |
| `updated_at` | Last mutation of mutable metadata (evidence count, state) | every row |
| `superseded_at` | When a newer fact replaced it | superseded rows |
| `deleted_at` | Tombstone time | tombstoned rows |
| `expires_at` | Ephemeral/session rows only | existing field, unchanged |

All `TIMESTAMPTZ`, stored and interpreted as UTC, per the existing rule.

---

## 10. Retrieval contract for MPI-1

Provider-neutral, and a strict superset of the §3 interface MPI-1 already consumes — so MPI-1's caller contract does not change.

```
retrieveMemory({
  userId, organisationId,            // required scope
  domainId, projectRef,              // optional narrowing
  intent, entities,                  // relevance inputs
  timeRange: { from, to },           // optional
  tags,                              // optional
  permissions,                       // REQUIRED — filtering, not decoration
  minConfidence,                     // optional floor
  includeStates,                     // default ['active'] only
  requireProvenance,                 // default true
  limit                              // REQUIRED, no unbounded default
}) -> { items, conflicts, diagnostics }
```

Binding behaviour:

- **Default is minimal, never exhaustive.** `limit` is required and has no "all" value. `loadAllUserMemory()` is named an anti-pattern by the memory policy and must never be implemented.
- **`includeStates` defaults to `['active']`.** Superseded, disputed and tombstoned memory is never returned unless explicitly asked for.
- **Deterministic ordering**: confidence rank → `observed_at` descending → scope precedence → stable opaque id as final tiebreak. Identical inputs return an identical, reproducible order.
- Permission filtering happens **before** ranking, never after.
- Provenance travels with every returned item, so MPI-1's compiler can honour `requireProvenance`.
- Conflicts are returned **alongside** items, never silently collapsed into one winner.

---

## 11. Backup and the real-data gate

### 11.1 IDA-3F does **not** cover MPI

This must be stated plainly because assuming otherwise is the easy mistake:

- The ID Auto backup dumps the **`idauto` database**. `mythos_intelligence` is a **different schema** and is **not** in those dumps.
- The IDA-3F tooling is provider-neutral and would work for MPI, but it is **configured for, and only verified against, ID Auto artefacts** — and it is currently **BLOCKED / DEFERRED** with no off-host destination provisioned.
- Therefore MPI has, today, **no backup of any kind** — not even a same-host one.

### 11.2 The gate

MPI-2 will eventually hold **real personal data about the owner and about third parties**, which is not regenerable and may be legally significant. Applying the same reasoning §11 of the IDA-3 design applies to community evidence:

| Requirement | Verdict |
|---|---|
| Local schema backup + restore test | **REQUIRED before any real-data ingestion** |
| Content-store backup, paired consistently with the DB dump | **REQUIRED** (the by-reference model makes DB-only backup insufficient) |
| Off-host backup | **REQUIRED before real, non-synthetic memory is ingested** |
| Encryption at rest | **RECOMMENDED**; at minimum documented. Personal memory is a higher-sensitivity class than vehicle sightings. Client-side encryption is the stronger option given the content store may leave the host. |
| Synthetic-only until then | **YES** |

**Recommendation: `MPI_REAL_MEMORY_INGESTION_ENABLED = NO` until MPI has its own verified, restore-tested, off-host backup.** Schema, repository layer, capture logic and retrieval can all be built and tested against synthetic fixtures in the meantime — exactly the pattern IDA-3A–3E followed. This does **not** require resuming IDA-3F, and it does not require Cloudflare R2; it requires a decision about where MPI's own backups go, which is **D5**.

---

## 12. Owner decisions required

| # | Decision | Why it cannot be made here |
|---|---|---|
| **D1** | **May `mythos_intelligence` store raw third-party personal data — names, emails, phone numbers — for contacts?** | MPI-0 forbids it in writing. Google Contacts import is impossible without it. This changes what the platform durably holds about people who never consented, so it is a privacy posture decision, not an engineering one. Options: **(a)** allow it in a dedicated, `user_private`, encrypted-at-rest table with import-batch reversibility; **(b)** store only hashed identifiers (fully reversible matching for email/phone, no human-readable directory — heavily degrades usefulness); **(c)** keep contacts out of MPI entirely. |
| **D2** | **May MPI *originate* entities (people, projects) rather than only referencing product-owned ones?** | `pi_entity_references` says "never duplicates them". Personal contacts have no owning product schema. Either MPI becomes an owner for a `personal` entity class, or contacts cannot be modelled. |
| **D3** | **Where does memory *content* live**, given MPI-0 mandates `content_reference` with no embedded content? | Options: a content table in the same schema (simplest, one backup unit); the existing content-addressed filesystem store (reuses proven tooling and dedup, adds a second backup target that must stay consistent); or object storage (needs the R2 decision that is deferred). This choice determines the backup topology in §11. |
| **D4** | **Is `disputed` resolvable automatically by scope precedence, or only by explicit human instruction?** | The memory policy defines precedence but does not say whether it may auto-resolve a contradiction. Auto-resolution is convenient and occasionally wrong in a way the user never sees. |
| **D5** | **Where do MPI backups go, given IDA-3F is deferred?** | MPI has no backup today. Options: extend the IDA-3F tooling to MPI with a local-only backup now and off-host later; wait for the R2 decision; or provision a separate destination. Real-data ingestion stays disabled until this is answered. |

---

## 13. Vector search — **DEFERRED, decided**

`pgvector` is **not** required for MPI-2 v1 and should **not** be installed in this stage.

Rationale: MPI-1's retrieval contract is a ranking *interface*, and `MYTHOS_CONTEXT_ARCHITECTURE.md` §3 states explicitly that a future semantic implementation can replace the ranking strategy "without changing any caller's contract". PostgreSQL relational filtering plus native full-text search is sufficient for v1 volumes and is deterministic — which matters, because determinism is a testable property here and embedding similarity is not. Embeddings also imply an external model provider, which this gate forbids.

**Trigger for reconsideration:** when relevance quality demonstrably limits retrieval on real data volumes, as a separate authorised stage with its own gate. The schema deliberately avoids anything that would make adding a vector column later a migration problem.

---

## 14. Proposed implementation slices

Each requires its own authorisation. Boundaries are drawn so every slice is independently testable and independently revertible.

| Slice | Objective | Depends on | Touches live data? |
|---|---|---|---|
| **MPI-2A** | Draft schema finalised and applied to `mythos_intelligence` | **D1, D2, D3** | Creates schema only — no rows |
| **MPI-2B** | Repository/storage layer over the schema, synthetic fixtures only | 2A | No |
| **MPI-2C** | Capture + normalize + classify + **sensitive-data gate** | 2B | No |
| **MPI-2D** | Deduplication, conflict detection, supersession, confidence rules | 2C | No |
| **MPI-2E** | MPI-1 retrieval adapter implementing §10 | 2B | No |
| **MPI-2F** | Lifecycle: delete, tombstone, import-batch reversal, retention | 2D | No |
| **MPI-2G** | Backup, restore test, and the real-data gate | 2A, **D5** | Backups only |
| **MPI-2H** | *(only after 2G passes)* Enable real-memory ingestion | 2G | **YES — first real personal data** |

**Recommended first slice: MPI-2A**, and it is blocked until D1, D2 and D3 are answered — all three change the table set.

Deliberately **not** slices here: importers (ChatGPT, Claude, Gemini, DeepSeek, NotebookLM, Google Contacts) and the chatbot runtime. Importers belong after 2H because they are the thing that brings real third-party data; the chatbot is MPI-4.

---

## 15. Import compatibility

Designed for, not implemented. The provenance model in §5 is what makes these possible without redesign:

| Provider | `provider` | `source_type` | Notes |
|---|---|---|---|
| ChatGPT | `openai` | `conversation` | Export is conversation-shaped; capture rules in §4 apply — a transcript is **not** memory |
| Claude | `anthropic` | `conversation` | Same |
| DeepSeek | `deepseek` | `conversation` | Same |
| Gemini | `gemini` | `conversation` | Same |
| NotebookLM | `notebooklm` | `file` / `note` | Source documents, not dialogue |
| **Google Contacts** | **`google`** | **`contacts`** | **Entities/source records, never conversations.** Strong identifiers: **email / phone**. Name similarity alone is a **possible match only** — never a merge. Subject to **D1**. |

Every import carries an `import_batch_ref` so a whole import can be reversed. No importer may bypass the §4 pipeline or the §8 sensitive-data gate.

---

## 16. Test strategy

To be implemented per slice, all offline against synthetic fixtures:

exact fact insert · duplicate fact (no double-count) · conflicting fact preserved as conflict · supersession chain · temporal update with `valid_from`/`valid_to` · entity exact match · alias match · ambiguous name stays ambiguous · **no name-only merge** · provenance preserved through retrieval · permission allowed/denied/mixed · private data filtered from default retrieval · **credential rejected at capture, never persisted** · delete · tombstone excluded from retrieval · retrieval `limit` honoured · minimal retrieval (no full dump) · domain isolation · project isolation · deterministic ordering · migration idempotency · backup/restore round trip · provider neutrality of every returned structure · **low-quality repeat does not inflate confidence** · import batch fully reversible.

---

## 17. Status

**Design complete; blocked on owner decisions D1, D2, D3 (and D5 before any real data).** Nothing was implemented, applied, provisioned or deployed. `MPI_REAL_MEMORY_INGESTION_ENABLED` remains **NO**.
