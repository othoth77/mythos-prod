# MPI-2H — Real-Data Ingestion Specification

**Status:** SPECIFICATION — ratified structure, **not implemented, not activated**
**Date:** 2026-08-14 · **Authority:** derived exclusively from `MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md` (§3–§9, §11, §12.1, §14, §15, §19, §20), `MYTHOS_USER_MEMORY_POLICY.md`, `MPI_FORENSIC_AUDIT.md` (F14), the D3 content store (`persistence/content-store.js`), and the MPI-2G evidence in `docs/AI_HANDOVER.md`. Nothing in this document invents a product requirement; every point either cites its source or is marked **OPEN** with the owner decision it awaits.

Real ingestion remains **BLOCKED** until every OPEN item in §31 is decided and the final gate in §24 is passed. This document existing changes nothing at runtime.

---

## 1. Purpose

MPI-2H is the first stage in which **real first-party personal data** may enter `mythos_intelligence`. Its scope is exactly: implement and activate the guarded ingestion path for owner-authorised real data, under every constraint already ratified (D1/D2/D3/D5, F8/F9, the capture pipeline, the append-only audit contract), with backup-before and backup-after verification. Importers (§15 of the architecture) and the chatbot runtime (MPI-4) remain **out of scope**.

## 2. Authoritative data sources

No authoritative real data source is ratified anywhere in the repository. The architecture's provenance vocabulary (§5) admits `provider = mythos` with `source_type ∈ {observation, explicit_instruction, feedback, note}` as the only provider that does not imply an external import. **The initial real source selection is OPEN — decision O-2H-1 (§31).** Until O-2H-1 is decided, no real-data source exists and ingestion cannot begin.

## 3. Allowed source types

Per §5 of the architecture, for the `mythos` provider: `explicit_instruction`, `observation`, `feedback`, `note`. External providers (`openai`, `anthropic`, `deepseek`, `gemini`, `notebooklm`, `google`) are importer territory — **post-2H by design (§14), not allowed here**. `contacts` is **permanently excluded** by D1(c).

## 4. Allowed fields

Exactly the ratified schema columns of the carrier tables (§3 of the architecture): `pi_memory_records`, `pi_memory_events`, `pi_memory_provenance`, `pi_learned_preferences` (+ audit), `pi_memory_conflicts`, `pi_memory_tombstones`, `pi_memory_tags`, `pi_entity_references` (pointers only), `pi_guard_decisions`. Content-bearing fields are constrained:

| Field | Constraint |
|---|---|
| `content_summary` | ≤ 512 chars, **short and non-sensitive** (schema comment) |
| `content_reference` | D3 scheme only: `mpi-content://sha256/<64-hex>` — never raw content |
| `source_reference` | opaque id/URI/hash of the originating artefact — **never its content** (§5) |

## 5. Prohibited fields

No new columns. Never persisted anywhere, in any field, in any form: raw third-party names/emails/phone numbers (D1); credential-shaped values, API tokens, private keys (§8.2 — DENY, rejected at capture, only the *kind* audited); payment card data (§8.1 DENY); embedded memory content in any VARCHAR/TEXT column (D3); raw chat transcripts (memory policy §6 — a transcript is not memory).

## 6. Third-party PII boundary

**Hard boundary, ratified:** data about people who never consented to the platform does not enter MPI. Third-party contacts are out entirely (D1 = c). Third parties may appear only as **opaque pointers** (`pi_entity_references` to product-owned entities, D2) — never as originated records, never with raw identifiers. If a candidate real-data item contains third-party PII, the item is **refused at capture** with a guard-decision audit row; there is no redact-and-store path in this stage (none is ratified).

## 7. D1 enforcement

D1(c) stands unqualified (§12.1): no third-party names, emails, phone numbers imported into or stored in `mythos_intelligence`. The Google Contacts importer is permanently excluded. The MPI-2A table set is final for this purpose — no contacts/person table will be added. Enforcement points: capture-time sensitive-data gate (§8) + the absence of any schema place to put such data + review of O-2H-1 source selection against this rule.

## 8. D2 enforcement

D2 = NO (§12.1): MPI never originates people/organisations/projects. `pi_entity_references` remains a pointer registry ("never duplicates them"). Ingestion may reference a product-owned entity by opaque ref; it may never create an MPI-owned personal entity. Any ingestion input that requires originating an entity is refused.

## 9. D3 — content handling

Ratified and implemented (commit `94ae9ae`): memory content is written to the content store **before** the referencing row commits (write-content-before-row, `content-store.js` header); PostgreSQL stores the deterministic `content_reference` only. `putContent` is HEAD-verified before a reference is minted; duplicate content deduplicates by construction. `verifyConsistency(client, store)` must pass after any ingestion batch — a dangling or malformed reference is a **STOP** condition (§30).

## 10. D5 — destination

Content objects and MPI backups live **only** in the dedicated bucket `mythos-mpi-backups` (`content/sha256/` and `mythos-intelligence/` prefixes respectively). `mythos-offhost-backups` is refused by name in code (`createFromConfig`) and by rule here. Credential: `/home/ubuntu/.config/mythos/mpi-offhost.env`, mode 0600, bucket-scoped, never printed/committed/logged.

## 11. Provenance requirements

Every durable memory row gets a provenance row, in the **same transaction** (§19.4 "atomic pair"). Provenance is **immutable** (F7 append-only trigger); correction = new memory + new provenance + supersession link, never an edit (§5). Required: `provider`, `source_type`, `source_reference`, `captured_at`; `observed_at` where known and distinct; `confidence` from the existing vocabulary (`LOW/MEDIUM/HIGH/EXPLICIT`); `actor_ref`/`actor_type` where known; **`import_batch_ref` on every real-data row** so any batch is reversible (§5, §20.10 Data).

## 12. `observed_at` requirements

Per §5/§9: `observed_at` records when the fact was true/stated, where known and distinct from `captured_at`; UTC `TIMESTAMPTZ`. It participates in F8 uniqueness and in the reinforcement independence rule (§6.2: same source materially later counts; same source same time does not). Absent knowledge of `observed_at` is represented as NULL — F8's `NULLS NOT DISTINCT` makes even that case idempotent.

## 13. `source_reference` requirements

Opaque id/URI/hash of the originating artefact, never content (§5). For content-bearing sources the D3 reference of the stored artefact is a valid `source_reference` (hash form). Stability requirement: re-presenting the same artefact must yield the same `source_reference`, because F8 idempotency and §6.2 independence both key on it.

## 14. Idempotency and deduplication

Four ratified layers, all mandatory:
1. **F8**: `UNIQUE (memory_record_id, source_reference, observed_at) NULLS NOT DISTINCT` on provenance — re-ingesting the same observation for the same record is a constraint violation handled as "already ingested", not a new row.
2. **Reinforcement independence** (§6.2): repeat low-quality duplicates never inflate confidence; `reinforce` is a no-op when not independent (§19.4).
3. **Content addressing** (D3): identical content yields the identical reference; no duplicate objects.
4. **`import_batch_ref`**: a re-run batch carries a new batch ref; its rows dedup via 1–3, so a partial batch can be safely re-run to completion.

## 15. F8 enforcement

The production index `idx_pi_provenance_observation` (verified in MPI-2A apply and MPI-2G restore) is the enforcement. Ingestion code must treat its violation as the idempotent-replay signal, never disable, drop, or work around it. Regression: `tests/mpi-2f-f8-f9-test.js`.

## 16. F9 enforcement

`idx_pi_preference_audit_subject (preference_id)` must exist (verified in production and in restore). Every preference lifecycle transition writes its audit row in the same transaction as its subject (§19.4); the audit-write failure event (§20) makes silent audit loss impossible.

## 17. Lifecycle / tombstone behaviour

Ratified (§4, §20.10): deletion is a **tombstone**, never row removal; ingestion failure reverses by `import_batch_ref` via tombstones; a tombstoned record is excluded from retrieval; a second tombstone for the same record violates UNIQUE (§19.4). Capture never writes an established preference directly — single observations enter as `SESSION_OBSERVATION` at most (memory policy §6).

## 18. F14 erasure boundary

F14 (`MPI_FORENSIC_AUDIT.md`) is an **unmade owner decision**: `pi_users` deletion is RESTRICTed by memory rows while 7 children CASCADE; no erasure policy is stated. **2H must not resolve this silently.** Boundary for this stage: real ingestion may proceed for the **owner's own first-party data only** (O-2H-1) under the tombstone lifecycle; **no user-record deletion path is implemented or executed**; a real erasure request cannot yet be honoured mechanically and this limitation must be recorded at activation. F14 design remains **OPEN — decision O-2H-5**, to be designed under the D1 no-third-party-PII posture (§12.1).

## 19. Append-only audit requirements

`pi_preference_audit`, `pi_guard_decisions`, `pi_memory_provenance` are append-only (F7 triggers, verified). Guard decisions are persisted **before** the protected action and **never inside the caller's transaction** (§19.5). No UPDATE/DELETE path exists or may be added without a separate governance amendment (control-plane schema header).

## 20. Observability requirements

The implemented minimum contract applies to every ingestion write: `transaction_failed` {kind, sqlstate, attempt, maxAttempts, willRetry}, `transaction_retries_exhausted`, `append_only_write_failed` {table, kind, sqlstate, opaque id} with **rethrow unchanged**, `persistence_health` at startup. Field whitelist only — never summaries, content, PII, credentials, or SQL text. A logger failure never alters an outcome.

## 21. Transaction and retry behaviour

Per §19.4's map: atomic pairs (memory+provenance), required transactions for supersede/tombstone/conflict/preference+audit; guard decisions standalone. Retries are the client's existing `withTransaction` semantics (visible via `transaction_failed`... `willRetry`); retry exhaustion surfaces `transaction_retries_exhausted` and fails the batch item. Idempotency (§14) is what makes retry safe.

## 22. Failure / rollback behaviour

- Item-level failure: transaction rolls back, nothing partial persists (proven pattern, MPI-2C case 23), guard decision survives by design.
- Batch-level failure: completed items stand (they are individually consistent); reversal, if required, is tombstone-by-`import_batch_ref` (§20.10) — never DELETE.
- Content-store orphans (object stored, row never committed): harmless by design — the store is a superset of references (D3 pairing rule); no cleanup deletion exists pre-F14.
- Activation failure: abort, no fallback to memory or mocks (§20.6); pure modules remain usable.

## 23. Synthetic dry-run procedure

Before any real item, the full ingestion path runs against **scratch only** (class B, §20.7): fresh PostgreSQL container (`--network none`, tmpfs, no ports), schema via `migrate.apply`, **in-memory/fake content-store adapter** (no real R2 objects), synthetic `.invalid` fixtures exclusively. The dry run must prove: provenance pairing, F8 idempotent replay, dedup (§14 all four layers), tombstone reversal by batch ref, append-only audit events on forced failure, transaction rollback, retry visibility, F9 present, `verifyConsistency` green. Pass criterion: existing regression (356) + D3 (27) + the new 2H suite, 0 failed.

## 24. Final real-data authorisation gate

All of the following, each independently true, none inferable from another:
1. Every OPEN decision in §31 that is marked *blocking* is decided by the owner in writing.
2. Dry run (§23) passed at the current HEAD.
3. Fresh verified MPI backup exists (§25).
4. `MPI_PERSISTENCE_ENABLED` activation contract satisfied against production (activate → healthy) — §29.
5. **A separate, explicit, scope-bound owner order to ingest real data**, naming the source (per O-2H-1) and the batch scope. Stage-precedent: the MPI-2A/2G authorisation pattern. This document is not that order, and no standing instruction can substitute for it.

## 25. Backup-before-ingestion requirement

Ratified by §11.2 and MPI-2G's standing caution: before the first real item, a **fresh** MPI-2G-pattern backup (dump → C1 → upload → fresh download → C2 → C1==C2 → isolated restore) must exist and be recorded. Freshness tolerance is the owner's (**OPEN — O-2H-6**); absent a decision, "same session as ingestion" is the only safe reading. The prior verified backup is never overwritten or deleted (backups are additive).

## 26. Post-ingestion backup verification

Immediately after a real batch: verify DB health + inserted rows + provenance + audit (§28), then produce a **new** backup of the **pair** — schema dump *and* the `content/sha256/` prefix — with C1==C2 on both parts. The pre-ingestion backup object(s) remain in place; rotation/retention is **OPEN — O-2H-3** and until decided nothing is deleted.

## 27. Restore verification

The post-ingestion backup is restore-verified per MPI-2G isolation rules (scratch container, `--network none`, tmpfs, restore **from the downloaded copy**), plus the D3 pair check: `verifyConsistency` against the restored database and the content store must be green. Structural figures compare against the recorded production census, and row counts must equal the just-ingested state.

## 28. Production safety checks

Before and after every 2H action: `idauto.public` = 24 tables / 2,551 rows (or the then-current recorded baseline) unchanged · container census unchanged (modulo the documented hourly queue recycles) · no Coolify/Supabase change · `pi_*` row deltas exactly equal the authorised batch · zero credential exposure · `mythos-offhost-backups` untouched.

## 29. Activation flag and composition root

Two distinct flags, both strict-`'true'`, both default-off, per §20.6 and the activation implementation:

| Flag | Meaning | Status |
|---|---|---|
| `MPI_PERSISTENCE_ENABLED` | activate the persistence layer (driver → connect → `assertSchema` → healthy, no fallback) | **implemented** (`persistence/activation.js`) |
| `MPI_REAL_MEMORY_INGESTION_ENABLED` | additionally permit class-D (real) writes through the ingestion path | **documentation-only today — must be implemented in the 2H implementation stage** with the same strict-flag discipline, fail-closed default |

Composition root requirements (§19.6, §20.5): env-injected connection contract (`MPI_PG_*`, statement timeout mandatory), real `pg` driver injection, `mythos_intelligence_app` role for the application, no config-file credentials, no mock/scratch fallback in production, guard decisions wired before protected actions, content store bound via `createFromConfig` to the dedicated bucket. **Where the composition root lives (which process/service hosts ingestion) is OPEN — O-2H-2.**

## 30. STOP conditions

Immediate stop, no improvisation: any §31 blocking decision undecided · dry run failure · backup missing/stale per O-2H-6 · C1 != C2 · restore failure · `verifyConsistency` failure (dangling/malformed reference) · `assertSchema`/`checkHealth` failure · third-party PII detected in a candidate item (refuse item; stop batch if systematic) · credential-shaped value reaching any point past capture · append-only violation attempt · unexpected production delta · guard `DENY`/`REQUIRE_APPROVAL` on the ingestion action without recorded approval · observability events lost/altered outcomes · wrong bucket anywhere · any test failure · scope exceeding the owner's batch order.

## 31. OPEN owner decisions (exact, blocking status marked)

| # | Decision required | Blocking for first real ingestion? |
|---|---|---|
| **O-2H-1** | **Initial real data source(s) and surface**: which first-party data, entered where, by whom (owner-operated entry per §2–§3 vocabulary). | **YES** |
| **O-2H-2** | **Ingestion trigger, frequency, and hosting**: which process hosts the composition root; manual batch vs. scheduled; operator procedure. | **YES** |
| **O-2H-3** | **Retention/rotation policy** for MPI backups and ingested data (nothing is deleted until decided). | NO (defaults to keep-everything) |
| **O-2H-4** | **Encryption at rest for content objects** (§11.2 "RECOMMENDED; at minimum documented" — currently documented only; client-side encryption named as the stronger option). | **YES** for sensitive content classes; owner may accept documented-only for the initial source if that source is non-sensitive |
| **O-2H-5** | **F14 erasure design** under the D1 posture (user deletion vs. cascade asymmetry). | NO for owner-only first-party data (boundary in §18), YES before any broader user base |
| **O-2H-6** | **Backup freshness tolerance** before ingestion (§25). | **YES** (absent a decision: same-session) |
| **D4** | Automatic `disputed` resolution (pre-existing, §12). | NO (non-blocking, unchanged) |

---

**Consequence:** MPI-2H implementation (the flag, the ingestion entry point, the 2H test suite) may be authorised next, but **real ingestion cannot begin** until O-2H-1, O-2H-2, O-2H-4 (or its explicit waiver for a non-sensitive initial source), O-2H-6 and the §24 gate are satisfied.
