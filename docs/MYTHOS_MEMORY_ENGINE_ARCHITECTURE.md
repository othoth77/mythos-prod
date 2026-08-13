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
- Resolution is explicit — by a user instruction, or by a binding precedence rule via `scope.resolveByPrecedence` (session → user → organisation → domain → global). The loser's `state` becomes `superseded` and its `superseded_at` is set. **The pointer direction is `winner.supersedes_memory_id = loser.memory_record_id`**: the surviving, newer record points at the record it supersedes, never the reverse. The loser holds no pointer to the winner. The column name describes the action of the row that carries it toward the row it references, matching the explicit `pi_learned_preferences` precedent, where "a correction inserts a new row referencing `supersedes_preference_id`". Nothing is deleted.
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

---

## 18. MPI-2 remediation gate — F1, F2, F3, F4, F7 (2026-08-13)

Stage A and Stage B validated the §2/§3 design against a throwaway PostgreSQL 15.18 and found five defects. They are **omissions in the SQL files, not flaws in this architecture** — every decision below is derived from a statement already in this document or in `MYTHOS_USER_MEMORY_POLICY.md`, not invented at remediation time.

The two ratified schema files remain **unmodified and authoritative for table definitions**. The remediation is a third delta file, applied strictly after them:

```
control-plane-schema.sql (15 tables) → memory-engine-schema.sql (5 tables) → mpi-2a-remediation-proposal.sql
```

`projects/personal-intelligence/database/mpi-2a-remediation-proposal.sql` is a **PROPOSAL, NOT APPLIED**, validated only in scratch.

### 18.1 F1 — schema boundary. Decision: **`mythos_intelligence.pi_*`**

Not a preference — §2.2 makes it structural. The MPI backup unit is defined as `pg_dump --schema=mythos_intelligence`, which is unimplementable if the tables are in `public`; §2.2 also defines per-schema independently versioned migrations, and `config/personal-intelligence.example.json` sets `logical_schema`. Applied as-is the files put all 20 tables in `public`, contradicting all three.

The 20 `CREATE TABLE` statements stay **unqualified**. The migration issues `SET search_path TO mythos_intelligence` and then asserts 0 `pi_*` tables in `public`. Qualifying 20 tables inline would edit the ratified files and hard-code placement into the schema definition instead of the migration.

### 18.2 F2 — foreign keys. Decision: **intra-schema FKs required; cross-schema and audit FKs intentionally absent**

The no-FK rule in §2.1/§2.3 is scoped to **cross-schema** links ("no foreign key … crosses into `idauto`"). It says nothing about two `mythos_intelligence` tables, and §2.2's schema-scoped dump/restore makes intra-schema FKs restore as one consistent unit. **33 FKs** are specified; every referenced column was already `UNIQUE`, so no new uniqueness was introduced.

Intentionally absent, and these are the load-bearing decisions:

| Absent FK | Why |
|---|---|
| every `*_ref`, `entity_external_id`, `connector_id`, `project_ref`, `content_reference` | cross-schema or external by construction (§2.3) |
| `pi_preference_audit.preference_id` → `pi_learned_preferences` | an audit row must **outlive its subject**. `CASCADE` would let erasing a preference erase its own audit trail; `RESTRICT` would block the erasure the memory policy requires. Both wrong → no FK. |
| `pi_guard_decisions.user_id` / `organisation_id` | a permission decision must stay provable after the user record is erased |
| `pi_memory_tombstones.memory_record_id` | a tombstone is evidence of deletion and must survive a hard purge of what it describes |
| `pi_memory_provenance.memory_record_id` | immutable under F7; any referential action is a write |

The rule that falls out: **nothing in the immutable set takes a foreign key, because a referential action is a write, and these tables do not accept writes.**

### 18.3 F3 — additive columns. All **MPI-2A**

§21 of the memory-engine file stated seven columns as comments with **0 executable `ALTER`**. They are required by the §6.1 state model and the §10 retrieval contract, whose `includeStates` default of `['active']` cannot be implemented without `state`.

| Table | Column | Type | Null/default | Index | Consumer | Slice |
|---|---|---|---|---|---|---|
| `pi_memory_records` | `state` | `VARCHAR(16)` | NOT NULL `'active'` | partial + plain | §10 `includeStates` | 2A |
| | `supersedes_memory_id` | `VARCHAR(64)` | NULL | yes | §6.2 supersession | 2A |
| | `superseded_at` | `TIMESTAMPTZ` | NULL | — | §6.2 | 2A |
| | `observed_at` | `TIMESTAMPTZ` | NULL | in partial idx | §10 ordering | 2A |
| | `valid_from` / `valid_to` | `TIMESTAMPTZ` | NULL | — | temporal validity | 2A |
| | `evidence_count` | `INTEGER` | NOT NULL `1` | — | §6.2 reinforcement | 2A |

Plus `chk_pi_memory_state` (the four §6.1 states; `possible_match` excluded — it is an entity-resolution outcome, §6.1), `chk_pi_memory_window`, `chk_pi_memory_evidence_positive`, and `idx_pi_memory_active` — a partial index on `state='active'` ordered per §10.

### 18.4 F4 — conflict pairs. Decision: **canonical ordering at storage, `CHECK (a < b)`**

`idx_pi_conflict_pair` alone accepts both `(A,B)` and `(B,A)`, storing one contradiction twice. Alternatives weighed: a `LEAST/GREATEST` expression index dedupes but leaves the stored order arbitrary, forcing every later query to re-derive the canonical form; generated columns duplicate data; application-only normalisation was excluded because Stage B proved the application does not canonicalise and the database must not depend on it. §10 makes determinism binding, so **one canonical stored form** wins. With `a < b` enforced, the existing index becomes sufficient and **is not modified**.

### 18.5 F7 — audit integrity. Decision: **two independent layers, plus a narrow maintenance path**

Stage B demonstrated that an audit record of a *regulated* `REQUIRE_APPROVAL` guard decision could be silently rewritten to `ALLOW`. Privilege alone is insufficient — a table owner bypasses `REVOKE` silently, which is how this went unnoticed.

| Table | INSERT | UPDATE | DELETE | TRUNCATE | Basis |
|---|---|---|---|---|---|
| `pi_preference_audit` | yes | forbidden | forbidden | forbidden | file header + "never updated or deleted after insert" |
| `pi_guard_decisions` | yes | forbidden | forbidden | forbidden | same |
| `pi_memory_tombstones` | yes | forbidden | forbidden | forbidden | "never updated or deleted after insert" |
| `pi_memory_provenance` | yes | forbidden | forbidden | forbidden | §5 "Provenance is **immutable**" |
| `pi_learned_preferences` | yes | **allowed** | **allowed** | — | **deliberately excluded** |

`pi_learned_preferences` is excluded because `MYTHOS_USER_MEMORY_POLICY.md` states *"No learned personal preference record is ever immutable."* Locking it would break correction and erasure. **The subject stays mutable; its audit does not.**

Mechanism: (1) `REVOKE UPDATE, DELETE, TRUNCATE` from the application role; (2) a `BEFORE UPDATE OR DELETE` row trigger that raises for **every** role including the owner, plus a separate `BEFORE TRUNCATE` statement trigger — row triggers never fire for `TRUNCATE`, so without it `TRUNCATE pi_guard_decisions` would empty the trail silently. The one legitimate path requires **both** the `mythos_intelligence.maintenance` GUC **and** membership of `mythos_intelligence_maint`; either alone fails. The three roles are `NOLOGIN` privilege boundaries carrying no password — they are not credentials.

### 18.6 Scratch validation — all negative cases pass

Isolated PostgreSQL 15.18, `--network none`, tmpfs, no volume, no published port, `.invalid` fixtures. Result: 20 tables in `mythos_intelligence` / **0 in `public`**, 33 FKs, 0 FKs on the immutable set, all 7 columns present, 8 CHECK constraints, 54 indexes, 8 triggers on 4 tables.

| # | Test | Expected | Actual |
|---|---|---|---|
| N1 | invalid FK | rejected | rejected (`fk_pi_memory_user`) |
| N2 | mirrored pair `(B,A)` | rejected | rejected; 1 conflict row, not 2 |
| N3 | UPDATE audit / flip guard to `ALLOW` | rejected | rejected; still `REQUIRE_APPROVAL` |
| N4 | DELETE audit, and TRUNCATE | rejected | both rejected |
| N5 | valid INSERT | accepted | accepted |
| N6a | app role UPDATE | rejected | permission denied (privilege layer) |
| N6b | maint role, no GUC | rejected | trigger raised |
| N6c | maint role + GUC | **accepted** | accepted — maintenance path works |
| N6d | GUC without role membership | rejected | permission denied |
| N7 | preference UPDATE/DELETE | accepted | accepted, **and its audit row survived** |
| N8 | invalid `decision` value | rejected | rejected |

N6a–N6d together prove the two layers are **independently necessary**. N7 is the direct evidence for §18.2: deleting a preference destroyed nothing of its audit trail.

### 18.7 Interfaces the future persistence layer must consume (§8 — not built)

Stage B established there is **no MPI persistence layer**: zero executable `pi_*` references, no `pg` dependency, no query layer, no ORM, no migration runner. None was built here. The contract it must satisfy:

- **Schema/database name** — `mythos_intelligence` in the existing PostgreSQL instance; `search_path` set per connection, never assumed to be `public`.
- **Repository boundaries** — one repository per aggregate: domains/capabilities · organisations/users/access · sessions · memory (records, tags, events, provenance) · preferences · conflicts · audit (write-only) · entity references · knowledge sources. No repository writes another's tables.
- **Transaction boundaries** — one transaction per lifecycle step in §4. Capture→persist is atomic with its provenance row. Conflict detection writes both `disputed` state changes and the conflict row in one transaction. An MPI transaction never spans another schema (§2.2).
- **Identity model** — opaque `VARCHAR(64)` refs, `usr_<uuidv7>` / `org_<uuidv7>`; `*_ref` + `*_ref_source` retained; `role_ref` stays a pointer, never duplicated authorisation logic.
- **Memory lifecycle** — §4 order is binding; permission gate before relevance; sensitive-data gate before persistence; capture never writes an established preference; deletion is a tombstone.
- **Conflict lifecycle** — the writer **must** canonicalise pair order before insert (`a < b` is now enforced, so an uncanonicalised write is a hard error, not silent duplication). Both rows go `disputed`; resolution is explicit; D4 governs whether precedence may auto-resolve.
- **Audit lifecycle** — append-only, INSERT only, no update path in any repository. Audit rows must be written even when the subject write fails, and must survive the subject's erasure.
- **Guard-decision lifecycle** — MPI **consumes** decisions and records them; it implements no authentication, session, JWT or permission persistence beyond the audit row (§9).

### 18.8 Status of this gate

F1–F4 and F7 are **designed and scratch-validated, not applied**. MPI-2A remains blocked on **D1, D2, D3** independently of these findings; D5 gates real data. Nothing in this section was applied to any production database.

---

## 19. Application integration boundary (MPI-2C, 2026-08-13) — validated, not activated

Audited against the actual repository, then proven end-to-end on scratch PostgreSQL. **Nothing is wired into a running application.**

### 19.1 Where the boundary actually is

The legacy application (`index.html`, `js/app.js`, and the `js/*.js` modules) **does not reference `projects/personal-intelligence/` at all**. The only consumers are `tests/`. There is therefore no existing entry point to "connect to" — the integration boundary is new surface, not a modification of a live path. That is what makes this stage safe and what makes activation a separate, deliberate decision.

### 19.2 Chosen structure

```
pure domain logic (reference/*.js — UNCHANGED)
        ↓
persistence adapter (persistence/adapters.js — translation + transaction)
        ↓
repositories (persistence/repositories.js)
        ↓
PostgreSQL (mythos_intelligence)
```

The reference modules are **not** rewritten to be persistent. They are pure, deterministic, and already covered by 149 MPI-0/MPI-1 assertions; making them database-aware would destroy determinism and couple domain rules to storage. Every impedance mismatch is absorbed in the adapter.

### 19.3 The hazard the adapter exists to contain

`learning-engine.observe(existingPreferences, observation)` has **two** effects, not one:

1. it **returns** a new or updated preference record, and
2. it **mutates in place** a *different* record inside the array it was passed, setting `existing.status = 'SUPERSEDED'` (or incrementing `evidenceCount`).

Verified empirically before the adapter was written. **An adapter that persisted only the return value would leave the superseded record still active in the database** — two live preferences for the same key, the exact state the memory policy forbids. `persistObservation()` therefore snapshots the input array, diffs it after the pure call, and persists both effects plus their audit rows in one transaction. Proven by MPI-2C cases 16–19.

This is the general lesson for every future seam: **a pure module's return value is not necessarily its whole effect.**

### 19.4 Operation → repository map

| Operation | Current source | Repository | Transaction | Returns | Error behaviour |
|---|---|---|---|---|---|
| create memory | new | `memory` + `provenance` | **required** (atomic pair) | `{memory, provenance}` | `FOREIGN_KEY` if user/org absent |
| retrieve memory | `context-assembler.retrieveRelevantMemory` (injected array) | `memory.retrieve` via `loadMemoryStore` | single read | hydrated array | throws if `limit` missing |
| update memory | none | `memory.setState` | trivial | `{state}` | `CHECK` on invalid state |
| supersede memory | none | `memory.supersede` | **required** (two rows) | `{memory_record_id, supersedes_memory_id}` | — |
| tombstone memory | none | `tombstones` + `memory` | **required** | `{tombstone, state}` | `UNIQUE` on second tombstone |
| add evidence | `learning-engine` thresholds | `memory.reinforce` | **required** (read-then-write) | `{reinforced, evidenceCount}` | no-op when not independent |
| add provenance | new | `provenance` | with its memory | `{memory_provenance_id}` | `APPEND_ONLY` on any update |
| create conflict | `context-assembler` (key-based, in-memory) | `conflicts` + `memory` ×2 | **required** | conflict row | `UNIQUE` on mirrored pair |
| resolve conflict | none (D4 governs auto-resolution) | `conflicts.resolve` + `memory.supersede` | **required** | `{resolution_state}` | — |
| update learned preference | `learning-engine.observe` | `preferences` + `preferenceAudit` | **required** | `{domainResult, persisted, supersededInPlace}` | see §19.3 |
| record preference audit | `learning-engine` status transitions | `preferenceAudit` | with its subject | `{preference_audit_id}` | `APPEND_ONLY` |
| record guard decision | `guard.evaluate` | `guardDecisions` | **standalone** | `{decision, persisted}` | `APPEND_ONLY`; `CHECK` on bad value |

Supersession follows the ratified direction throughout: `winner.supersedes_memory_id = loser`, loser `NULL`. `learning-engine` independently uses the same direction for `supersedesPreferenceId`, so domain and storage agree without translation.

### 19.5 Governance ordering

`guard.evaluate()` is pure and returns one of `DENY · REQUIRE_APPROVAL · DRY_RUN_ONLY · READ_ONLY · ALLOW`. The decision is persisted **before** the protected action runs, and **never inside the caller's transaction**. Both choices are deliberate: persisting afterwards would lose the record exactly when it matters most (the action crashed), and enlisting it in the caller's transaction would let a rolled-back action erase the evidence that a decision was taken. Proven by case 23 — a rollback discarded both the preference and its audit row, while a separately committed guard decision was unaffected.

Verified live: `evaluate()` narrowed a requested `ALLOW` to `REQUIRE_APPROVAL` for `regulated` data, that narrowed value was what got persisted, and a later attempt to flip it back to `ALLOW` was refused by the F7 trigger.

### 19.6 Configuration — what exists and what is still missing

`config/personal-intelligence.example.json` supplies **only** `target_dbms`, `logical_schema: "mythos_intelligence"`, and `implementation_stage`. It contains **no host, port, database, user, password or pool settings**, and no code reads it. `client.js` honours the schema contract structurally — it refuses `schema: 'public'` at construction and sets `search_path` explicitly per unit of work — so `logical_schema = mythos_intelligence` is respected consistently.

A future real connection must obtain host/port/database/credentials/pool settings from **environment injection at the composition root**, never from this file and never committed. No credential was created, and no connection string exists anywhere in the repository. Defining that env contract is MPI-2A/production-readiness work, not this stage.

### 19.7 Status

Boundary **proven, not activated**. 26 end-to-end cases pass against scratch PostgreSQL, plus 38 MPI-2B and 149 MPI-0/MPI-1 assertions. No production wiring, no production database, no environment variable changed.

---

## 20. MPI-2A migration preparation / production readiness (2026-08-13) — PREPARED, NOT EXECUTED

The runner exists and is scratch-validated. **It has never been pointed at a production database, and the backup gate in §20.8 forbids doing so today.**

### 20.1 Inputs — and a naming correction

There is **no "MPI-1 schema"**. MPI-1 is the context runtime: pure JavaScript, no SQL. The three inputs are:

| Version | File | Stage | Depends on | Provides |
|---|---|---|---|---|
| `001-mpi-0-control-plane` | `control-plane-schema.sql` | MPI-0 | — | 15 tables |
| `002-mpi-2-memory-engine` | `memory-engine-schema.sql` | **MPI-2** delta | 001 | 5 tables, 12 indexes, 2 CHECKs |
| `003-mpi-2a-remediation` | `mpi-2a-remediation-proposal.sql` | MPI-2A | 002 | 33 FKs, 7 columns, 6 CHECKs, 3 indexes, 8 triggers, 3 roles |

Order is fixed by file evidence, not stage numbers: 001 and 002 emit **unqualified** DDL and depend on `search_path`; 003 is schema-qualified and references objects the first two create. Each input is sha256-tracked so a recorded version whose file later changed is detected as drift.

**Expected result:** schema `mythos_intelligence` containing exactly **20 `pi_*` tables**, **0 in `public`**, 33 FKs, 8 CHECKs, **55 indexes**, 8 triggers, 3 `NOLOGIN` roles, plus one non-`pi_` table, `schema_migrations`.

### 20.2 Runner

`projects/personal-intelligence/persistence/migrate.js`. The repository had **no** migration runner — `MYTHOS_SUPABASE_MIGRATION_DESIGN.md` documents plain `psql -f`, and `projects/idauto/database/migrations/` is a bare `.sql` with no runner. This wraps that documented approach with preflight, versioning and assertions; it does not introduce a competing mechanism. It is driver-agnostic like `client.js`, so scratch and production exercise the same code path.

Version state lives in `mythos_intelligence.schema_migrations` so `pg_dump --schema=mythos_intelligence` (§2.2's backup unit) captures schema and version **together** — a restore that loses its version is a restore nobody can reason about. It is deliberately not `pi_`-prefixed, keeping the "exactly 20 `pi_*`" assertion exact.

### 20.3 Idempotency and refusal

Inputs 001 and 002 are **not idempotent** — zero `IF NOT EXISTS`/`DROP`/`CREATE OR REPLACE` guards; re-apply fails with `relation "pi_domains" already exists`. They fail **closed**: Stage A confirmed no partial mutation. The runner therefore never retries and never repairs — it refuses up front on any of: unexpected `pi_*` tables, conflicting objects in the target schema, unexpected ownership, version state inconsistent with the files on disk, identity mismatch, backup gate not asserted, or PostgreSQL below the documented major version.

**`DROP ... CASCADE` is never issued as automatic recovery.** On this schema it would destroy the append-only audit rows that exist precisely so history cannot be destroyed. Recovery is an explicit, separately reviewed human act.

### 20.4 Preflight — and the two checks that are honestly not machine-verifiable

Machine-verified from the catalog: PostgreSQL version · database identity · **server identity via `pg_control_system().system_identifier`** (survives renames; not something a misconfigured host fakes by accident) · not-a-replica · target schema absent · `pi_*` count anywhere · `pi_*` in `public` · installed extensions · active vs. max connections · database size · migration version consistency.

**Operator-asserted, and flagged as such rather than pretended:** free disk space and off-host backup status cannot be established from inside PostgreSQL. The runner demands explicit assertions (`diskOk`, `backupGateClosed`, `applicationReady`) and refuses without them. Ambiguity is treated as failure, never as permission — a missing `--system-identifier` fails the check rather than defaulting to "probably right".

### 20.5 Configuration contract (documented only — no credential created, no value written)

| Setting | Source | Notes |
|---|---|---|
| host / port / database | env (`MPI_PG_HOST`, `MPI_PG_PORT`, `MPI_PG_DATABASE`) | no default; absent = refuse to start |
| user | env (`MPI_PG_USER`) | `mythos_intelligence_app` for the application; the owner role only for migrations |
| password | **secret reference only** — env injected by Coolify at runtime | never in the repository, never in `personal-intelligence.example.json`, never logged |
| schema / `search_path` | `mythos_intelligence`, fixed | `client.js` refuses `public` at construction and sets `search_path` per unit of work |
| pool size / connection timeout / statement timeout | env, explicit | no unbounded statement timeout in production |
| SSL mode | env | required if the database is ever reached over a network rather than a local socket |

`config/personal-intelligence.example.json` currently supplies **only** `logical_schema`; it has no connection fields and no code reads it. That gap is stated here, not filled — filling it means creating configuration that only matters once activation is authorised.

### 20.6 Activation plan (designed, NOT activated)

Flag `MPI_PERSISTENCE_ENABLED`, default **false**. On startup with the flag true: construct the client → run a connection test → run `assertSchema()` → initialise repositories. **Any failure aborts startup of the MPI feature.**

**There is deliberately no fallback to the in-memory store.** A silent fallback after a production persistence failure would accept writes that are then lost, and — worse for this schema — would bypass the F7 append-only audit trail entirely. Failing loudly is the correct behaviour. The pure reference modules remain usable independently, exactly as MPI-0/MPI-1 use them today; that independence is what makes refusing to fall back affordable.

### 20.7 Data migration classes (design only — no real data in this stage)

| Class | Source → transform → destination | Validation | Rollback |
|---|---|---|---|
| **A. schema** | 3 SQL inputs → none → `mythos_intelligence` | `assertSchema()` | transaction rollback (proven); post-commit → reviewed `DROP SCHEMA`, gated |
| **B. synthetic validation** | generated `.invalid` fixtures → none → scratch only | existing suites | discard the container |
| **C. non-sensitive development data** | hand-authored non-personal records → direct insert → dev database | FK/CHECK/trigger enforcement | delete by `import_batch_ref` |
| **D. real personal/business data** | **BLOCKED** | — | tombstone + `import_batch_ref` reversal |

Explicit classification: **idauto personal/client data — never migrates into MPI** (separate schema, separate owner, no cross-schema FK; MPI may hold an opaque `EntityReference`, never a copy). **Mythos business data — never migrates into MPI** (product-schema owned). **DarHijama data — out of scope entirely** (separate MySQL stack). **OAuth tokens and secrets — never stored in any form**, rejected at capture; credentials belong to `aut_secret_references`. **CIN / RIB / client records — PROTECTED**; reference-only, and subject to **D1** before any contact-shaped data exists at all.

### 20.8 Backup gate — hard precondition, not weakened

Production migration stays **BLOCKED** until *all* of: (A) an off-host backup exists · (B) SHA-256 verification passes · (C) restore-from-off-host is tested · (D) the PC-Decommission Gate is closed · (E) the final VPS inventory is reconciled. The runner encodes this as a refusal condition, so migrating without asserting it is not merely discouraged — it aborts.

### 20.9 Dry-run plan (non-mutating)

`preflight()` alone is already a complete non-mutating dry-run: it performs only catalog reads and one `pg_control_system()` call, writes nothing, and reports every check with expected vs. actual. It validates identity, schema state, version compatibility, connections and capacity signals.

A fuller rehearsal — apply inside a transaction, assert, then `ROLLBACK` — is **safe on this schema and evidenced, not assumed**: test 21 forces a failure between inputs and confirms zero surviving objects, because PostgreSQL has transactional DDL. That rehearsal is nonetheless proposed only against a **clone**, never production, because it briefly takes DDL locks and creates cluster-wide roles that a rollback does not always unwind cleanly.

### 20.10 Rollback

**Schema** — *before commit*: automatic, proven by test 21. *Partial*: cannot occur inside one transaction; if the connection dies mid-apply, PostgreSQL rolls back on its own, and the runner then refuses to re-run until state is reconciled. *Post-commit validation failure*: `DROP SCHEMA mythos_intelligence CASCADE` is the only complete reversal and is safe **only** because nothing outside the schema references it (no cross-schema FKs) — it is explicitly gated behind human review and is never issued by the runner.

**Application** — activation failure or repository failure disables the MPI feature and leaves the pure modules running; no fallback write path exists. Incompatible runtime: revert the flag to false; the schema can remain in place harmlessly because nothing else references it.

**Data** — future ingestion failure reverses by `import_batch_ref` via tombstones, never by row deletion.

### 20.11 Status

Runner **prepared and scratch-validated, never executed against production**: 23/23 runner cases pass, including a proven transactional-DDL rollback and five distinct refusal paths. Production migration remains **BLOCKED** on §20.8.
