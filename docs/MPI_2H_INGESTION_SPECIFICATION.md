# MPI-2H — Real-Data Ingestion Specification

**Status:** SPECIFICATION — ratified structure, **not implemented, not activated**
**Date:** 2026-08-14 · **Authority:** derived exclusively from `MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md` (§3–§9, §11, §12.1, §14, §15, §19, §20), `MYTHOS_USER_MEMORY_POLICY.md`, `MPI_FORENSIC_AUDIT.md` (F14), the D3 content store (`persistence/content-store.js`), and the MPI-2G evidence in `docs/AI_HANDOVER.md`. Nothing in this document invents a product requirement; every point either cites its source or is marked **OPEN** with the owner decision it awaits.

Real ingestion remains **BLOCKED** until the final gate in §24 is passed. The four blocking owner decisions were ratified 2026-08-14 (§32); the operator CLI they mandate is not yet built. This document existing changes nothing at runtime.

---

## 1. Purpose

MPI-2H is the first stage in which **real first-party personal data** may enter `mythos_intelligence`. Its scope is exactly: implement and activate the guarded ingestion path for owner-authorised real data, under every constraint already ratified (D1/D2/D3/D5, F8/F9, the capture pipeline, the append-only audit contract), with backup-before and backup-after verification. Importers (§15 of the architecture) and the chatbot runtime (MPI-4) remain **out of scope**.

## 2. Authoritative data sources

The architecture's provenance vocabulary (§5) admits `provider = mythos` with `source_type ∈ {observation, explicit_instruction, feedback, note}` as the only provider that does not imply an external import. **The initial real source is decided — O-2H-1, ratified 2026-08-14 (§32): `explicit_instruction` + `note`, entered by the owner via the operator CLI, first-party data only.** The CLI itself is future, separately-authorised implementation work; until it exists, ingestion cannot begin.

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

F14 (`MPI_FORENSIC_AUDIT.md`) was an unmade owner decision: `pi_users` deletion is RESTRICTed by memory rows while 7 children CASCADE; no erasure policy was stated. **Decided — F14-A/B/C/D ratified 2026-08-15, all as their zero-change options (§33):** erasure = tombstone suppression; user deletion forbidden permanently (the RESTRICT FK is now the *intended* guard, and the 7 CASCADE paths are unreachable because no user row is ever deleted); erasure stops at the live system; audit retention indefinite. An erasure request is therefore mechanically honourable today through the existing tombstone lifecycle, and its recorded limits (summary and content object persist; backups unaffected) are now **policy**, not gaps.

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

Ratified by §11.2 and MPI-2G's standing caution: before the first real item, a **fresh** MPI-2G-pattern backup (dump → C1 → upload → fresh download → C2 → C1==C2 → isolated restore) must exist and be recorded. Freshness tolerance is **decided — O-2H-6(a), ratified 2026-08-14 (§32): same session as, and immediately before, each real batch.** The prior verified backup is never overwritten or deleted (backups are additive).

## 26. Post-ingestion backup verification

Immediately after a real batch: verify DB health + inserted rows + provenance + audit (§28), then produce a **new** backup of the **pair** — schema dump *and* the `content/sha256/` prefix — with C1==C2 on both parts. The pre-ingestion backup object(s) remain in place; retention is **decided — O-2H-3(a) keep-everything, ratified 2026-08-15 (§35): nothing is deleted.**

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

Composition root requirements (§19.6, §20.5): env-injected connection contract (`MPI_PG_*`, statement timeout mandatory), real `pg` driver injection, `mythos_intelligence_app` role for the application, no config-file credentials, no mock/scratch fallback in production, guard decisions wired before protected actions, content store bound via `createFromConfig` to the dedicated bucket. **Hosting is decided — O-2H-2(a), ratified 2026-08-14 (§32): an operator-run CLI batch on the VPS, on-demand per owner order. The CLI is not yet built.**

## 30. STOP conditions

Immediate stop, no improvisation: any §31 blocking decision undecided · dry run failure · backup missing/stale per O-2H-6 · C1 != C2 · restore failure · `verifyConsistency` failure (dangling/malformed reference) · `assertSchema`/`checkHealth` failure · third-party PII detected in a candidate item (refuse item; stop batch if systematic) · credential-shaped value reaching any point past capture · append-only violation attempt · unexpected production delta · guard `DENY`/`REQUIRE_APPROVAL` on the ingestion action without recorded approval · observability events lost/altered outcomes · wrong bucket anywhere · any test failure · scope exceeding the owner's batch order.

## 31. OPEN owner decisions (exact, blocking status marked)

| # | Decision required | Blocking for first real ingestion? | Status |
|---|---|---|---|
| **O-2H-1** | **Initial real data source(s) and surface**: which first-party data, entered where, by whom (owner-operated entry per §2–§3 vocabulary). | **YES** | **CLOSED — see §32** |
| **O-2H-2** | **Ingestion trigger, frequency, and hosting**: which process hosts the composition root; manual batch vs. scheduled; operator procedure. | **YES** | **CLOSED — see §32** |
| **O-2H-3** | **Retention/rotation policy** for MPI backups and ingested data (nothing is deleted until decided). | was: NO (defaulted to keep-everything) | **CLOSED — see §35** |
| **O-2H-4** | **Encryption at rest for content objects** (§11.2 "RECOMMENDED; at minimum documented" — client-side encryption named as the stronger option). | **YES** for sensitive content classes | **CLOSED — see §32** |
| **O-2H-5** | **F14 erasure design** under the D1 posture (user deletion vs. cascade asymmetry). | was: YES before any broader user base | **CLOSED — see §33** |
| **O-2H-6** | **Backup freshness tolerance** before ingestion (§25). | **YES** | **CLOSED — see §32** |
| **D4** | Automatic `disputed` resolution (pre-existing, §12). | NO (non-blocking, unchanged) | OPEN |

## 32. Ratified O-2H decisions (owner, 2026-08-14)

Recorded exactly as provided, without reinterpretation or expansion:

| # | Owner decision (verbatim) | Consequence |
|---|---|---|
| **O-2H-1** | "explicit_instruction + note, entered by me via the operator CLI; first-party data only." | Initial source types are `explicit_instruction` and `note` (provider `mythos`); `observation` and `feedback` are **not** authorised for the initial source. Entry surface is the operator CLI (to be built — §29/O-2H-2). Owner's own first-party data only, consistent with the F14 boundary (§18). |
| **O-2H-2** | "(a) operator-run CLI batch on the VPS, on-demand per owner order." | The composition root is an operator-run CLI on the VPS satisfying every §29 requirement. No deployed service, no Coolify change, no scheduling — each batch runs on an explicit owner order, matching §24(5). Scheduled ingestion would be a new, separately-authorised decision. |
| **O-2H-4** | "(b) provider-side R2 at-rest encryption with documented acceptance." | Content objects rely on Cloudflare R2's provider-side encryption at rest. **Documented acceptance:** the owner accepts the residual risk that content confidentiality against the storage provider and against any holder of the bucket credential rests on the provider's controls and the credential's secrecy, not on client-side cryptography. Client-side encryption (option a) remains available as a future, separately-authorised upgrade; this acceptance does **not** extend beyond the O-2H-1 source without re-decision. |
| **O-2H-6** | "(a) same-session backup." | The §25 backup round-trip (dump → C1 → upload → fresh download → C2 → C1==C2 → isolated restore) must be executed **in the same session as, and immediately before, each real batch**. A backup from any earlier session makes the `backupVerified` gate assertion untruthful. |

---

**Consequence (updated 2026-08-14):** all four blocking decisions are CLOSED. Real ingestion still requires: the operator CLI composition root (implementation stage, separately authorised), and at execution time the full §24 gate — including the fresh same-session backup (§25/O-2H-6) and the separate, explicit, scope-bound owner order for the specific batch (§24(5)). O-2H-3 and D4 remain OPEN and non-blocking. *(O-2H-5/F14 was subsequently closed — §33.)*

## 33. Ratified F14 erasure policy (owner, 2026-08-15)

Recorded exactly as provided, without reinterpretation or expansion. All four choices are the zero-change options — no schema migration, no governance amendment, no code change required or performed.

| # | Owner decision (verbatim) | Consequence |
|---|---|---|
| **F14-A** | "(a) Suppression. Erasing a memory means tombstoning it; the row remains and the memory becomes invisible to retrieval." | The existing atomic tombstone lifecycle IS the erasure mechanism. `content_summary`, `content_reference`, provenance and audit rows persist by policy. The R2 content object persists; the content store's absence of a delete operation is now the **intended** posture, not a deferral. |
| **F14-B** | "(a) User deletion forbidden permanently. Do not delete MPI users; memory can be disabled/tombstoned according to the lifecycle." | No user-record deletion path will be built. The `pi_memory_records → pi_users` RESTRICT FK is the intended permanent guard; the 7 CASCADE child paths are unreachable (no `DELETE FROM pi_users` is ever authorised) and the audited asymmetry is thereby resolved **by policy rather than by migration**. Per-user shutdown = `memory_enabled = false` + tombstoning per the lifecycle. |
| **F14-C** | "(a) Erasure stops at the live system. Production backup objects are not deleted as part of normal erasure." | Backups remain additive and keep-everything (O-2H-3 default); an erased memory persists in restore-proven backups. Any future backup-object deletion remains a separate, explicitly-authorised act (AGENTS §16), outside normal erasure. |
| **F14-D** | "(a) Indefinite audit retention. No audit purge period is established at this stage." | Append-only tables retain forever; the memory policy §7 retention clause is satisfied by an explicit "indefinite" rather than an undefined gap. Establishing a period later requires a governance amendment first. |

**Standing consequences:** an erasure request is honourable today (tombstone; proven with real machinery in `batch-2h-001-20260814` reversal testing). The broader-user-base condition formerly attached to O-2H-5 is lifted **for F14 specifically** — other broader-user-base requirements (D1 posture, per-batch gates, activation contract) are unaffected. Revisiting any of A–D is a new owner decision; A(c)-style hard purge and D(b)-style audit purge additionally require governance amendments before they can even be designed.

## 34. Ratified O-EV-1 — record-anchored events (owner, 2026-08-15)

Context: `pi_memory_events` is ratified (event types `DECISION / GOAL / ROUTINE / PROJECT_STATE / MILESTONE`) but carries no `import_batch_ref`, no provenance linkage, and no tombstone path — so §11/§14/§17 were unsatisfiable for standalone events. The owner ratified option (a), recorded exactly as provided:

- Every real event must be anchored to a corresponding `pi_memory_records` row; **`memory_record_id` is mandatory for real event ingestion**.
- The parent memory record carries the `import_batch_ref`; **provenance and F8 idempotency are inherited through the parent memory record**.
- **Event erasure follows the parent memory's F14 tombstone lifecycle.**
- **No standalone real event ingestion is permitted.**
- **No schema migration is authorized or required** for this decision.
- The `event_type` whitelist is enforced **by the ingestion code** using the ratified vocabulary: `DECISION, GOAL, ROUTINE, PROJECT_STATE, MILESTONE` (the column has no DB CHECK; code-side enforcement is the ratified mechanism).

**Consequences:** the §11/§14/§17 requirements are satisfied for events by inheritance — batch reversal tombstones the parent record (closing the event's standing per F14-A semantics), replays dedup on the parent's provenance triple, and every real event is reachable from an audited, provenance-tracked record. Implementation (ingestion-module + CLI event support + tests) is **future, separately-authorised work**; until it lands, no event batch can run. Sources for event batches remain O-2H-1 (`explicit_instruction`/`note`, owner-authored); Git/doc-derived bulk events remain excluded. *(Implemented and first exercised by `batch-2h-004` on 2026-08-15 — see `docs/AI_HANDOVER.md`.)*

## 35. Ratified O-2H-3 — keep-everything retention (owner, 2026-08-15)

Recorded exactly as provided, without reinterpretation or expansion:

- Keep all MPI memory rows indefinitely.
- Keep all tombstones indefinitely.
- Keep all provenance records indefinitely.
- Keep audit records indefinitely, consistent with F14-D.
- Keep all R2 content objects indefinitely while referenced.
- Keep all restore-proven MPI backup objects indefinitely.
- **No automatic rotation. No automatic deletion. No retention job. No destructive retention process.**
- This ratification does **not** authorize deletion of any existing object; no existing MPI row, R2 content object, or backup object may be deleted.

**Consequences:** the keep-everything default is now the ratified policy, aligned with F14-A (rows permanent by suppression-only erasure), F14-D (audit indefinite), the D3 pairing rule (referenced content permanent), and AGENTS §16 (any backup deletion is a separate, explicitly-authorised per-object act — nothing here grants one). The report-only rotation classification in `offhost-backup.js` remains available as unexecuted tooling; adopting it, or any per-memory-type retention rule (memory policy §1's undefined clause), is a **new owner decision**. With this, every O-2H decision (1–6) and F14 and O-EV-1 are CLOSED; **D4 is the sole remaining open MPI decision**, non-blocking.
