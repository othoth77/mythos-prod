# MPI Production Readiness — Deep Audit

**Date:** 2026-08-14 · **Checkpoint audited:** `92c254de4e22f6d7113f20f27890eaa7ee84e1ee`
**Verdict:** **CONDITIONAL** — the design and the scratch-verified implementation hold up, and the audit found **three real defects** that must be resolved before production. Backup remains intentionally deferred.

**Nothing was executed against production.** Production DB modified 0 · data copied 0 · containers/volumes/networks 26/20/9 identical, 0 restarts, all healthy. Scratch PostgreSQL **15.19**, `--network none`, tmpfs, no published port, removed; 0 scratch resources remain.

Evidence levels are distinguished throughout, because they are not equivalent:

- **DESIGN VERIFIED** — the document says so and the code/SQL matches it.
- **SCRATCH VERIFIED** — proven against a real isolated PostgreSQL.
- **PRODUCTION VERIFIED** — proven against production. **Nothing in this document is production verified.**

---

## Findings — three defects, in severity order

### F8 — Concurrent reinforcement double-counts evidence (**SCRATCH VERIFIED**, new)

`MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md` §6.2 is binding: reinforcement counts only *independent* observations, because "without this rule, confidence measures verbosity rather than truth."

`lifecycles.js` wraps the read-then-write in one transaction, and its comment claims that containment. **A transaction under READ COMMITTED does not provide it.** Reproduced with two concurrent sessions against a real database:

| | Observed | Correct |
|---|---|---|
| both sessions saw `hash://S2` as a new independent source | **true** | — |
| `evidence_count` after both commits | **3** | 2 |
| provenance rows for `hash://S2` | **2** | 1 |

Both sessions read the provenance set before either wrote, so both concluded the observation was independent. The row lock serialises the two `UPDATE`s but does not invalidate the decision each had already made. The same import processed twice concurrently inflates confidence exactly as §6.2 forbids.

**Fix (identified, not implemented):** a `UNIQUE` constraint on `pi_memory_provenance (memory_record_id, source_reference)` makes the second insert fail, so the race becomes self-correcting at the database layer rather than depending on application timing. `SERIALIZABLE` would also work but costs retries on every write path. **This is a schema change and belongs to the owner's ratification, not to an audit.**

### F9 — Audit-table reads are unindexed and degrade monotonically (**SCRATCH VERIFIED**, new)

With 20,000 seeded rows and fresh `ANALYZE`:

```
pi_preference_audit  WHERE preference_id = $1   ->  Seq Scan
pi_guard_decisions   WHERE user_id       = $1   ->  Seq Scan
```

`pi_preference_audit` carries only its primary key and the unique index on `preference_audit_id`; `repositories.js listForPreference()` queries by `preference_id`, which no index leads on. `pi_guard_decisions` is the same for any user-scoped read.

This matters more than an ordinary index gap for one reason: **these are append-only tables.** They never shrink, so the scan cost only ever rises. There is a causal link worth naming — F2 deliberately gives the immutable tables **no foreign keys**, and an FK is normally what prompts an index on the referencing column. The F2 decision is still right; this is its unbudgeted second-order cost.

**Fix (identified, not implemented):** `CREATE INDEX` on `pi_preference_audit (preference_id)` and `pi_guard_decisions (user_id, decided_at DESC)`.

### F10 — The migration runner enforces only one of the three closure gates (**DESIGN VERIFIED**, new)

`OFF_HOST_BACKUP_GATE.md` §6 defines gates **F** (PC-decommission) and **G** (final VPS inventory reconciled) alongside the backup gate. `migrate.js` `preflight()` demands exactly three operator assertions: `diskOk`, `backupGateClosed`, `applicationReady`. There is **no `pcGateClosed` and no `inventoryReconciled`**.

So a future operator can satisfy the runner while gates F and G are open. The backup gate is genuinely enforced in code — verified, `backupGateClosed=false` refuses — but the runner is weaker than the documented gate set, and a gate enforced only in prose is a gate that will eventually be skipped.

**Fix (identified, not implemented):** two more operator-asserted checks, matching the existing pattern.

---

## A–P readiness matrix

| | Area | Status | Evidence level | Note |
|---|---|---|---|---|
| **A** | Architecture | **PASS** | DESIGN VERIFIED | §2/§3/§18/§19/§20 internally consistent; no unratified decision invented |
| **B** | Schema | **PASS** | SCRATCH VERIFIED | 20 `pi_*` + `schema_migrations`, 0 in `public`, 33 FK, 8 CHECK, 55 idx, 8 triggers, 3 roles |
| **C** | Migration runner | **CONDITIONAL** | SCRATCH VERIFIED | 23/23 pass; **F10** — gates F/G unenforced |
| **D** | Persistence layer | **PASS** | SCRATCH VERIFIED | 38/38; all values `$n`-parameterised; 9/9 lifecycles transactional |
| **E** | Application boundary | **PASS** | SCRATCH VERIFIED | 26/26; reference modules pure; legacy app references persistence **nowhere** |
| **F** | Security | **PASS** | DESIGN VERIFIED | no credential/URL/token/key in MPI paths; no secret fallback defaults; fixtures `.invalid` only |
| **G** | Data classification | **PASS** | DESIGN VERIFIED | idauto/Mythos/DarHijama data stay at source; OAuth never stored; CIN/RIB gated on D1 |
| **H** | Backup | **BLOCKED** | — | intentionally deferred to R2; no destination exists |
| **I** | Restore | **NOT TESTED** | — | blocked by H; procedure written and isolation defined |
| **J** | Rollback | **PASS** | SCRATCH VERIFIED | transactional DDL rollback proven; no automatic `DROP CASCADE` |
| **K** | Observability | **FAIL** | — | **no logging, metrics, or health endpoint exists in the persistence layer.** Not a defect of what was built — it was never in scope — but it is a genuine production-readiness gap |
| **L** | Performance | **CONDITIONAL** | SCRATCH VERIFIED | retrieval hot path correctly indexed; **F9** on two audit tables |
| **M** | Concurrency | **FAIL** | SCRATCH VERIFIED | **F8** reproduced |
| **N** | Activation | **PASS** | DESIGN VERIFIED | flag default false; no in-memory fallback; startup aborts on failure |
| **O** | Real-data migration | **BLOCKED** | — | D1/D2/D3 unanswered, D5 undecided |
| **P** | Final gates | **BLOCKED** | — | see matrix below |

---

## Schema ↔ design reconciliation

| Requirement | Source | Executable implementation | Validation | Status |
|---|---|---|---|---|
| Schema `mythos_intelligence` | §2.1 | `CREATE SCHEMA` in remediation + `search_path` | 20 tables in target, 0 in `public` | **MATCH** |
| No cross-schema FK | §2.3 | no FK leaves the schema | catalog | **MATCH** |
| Intra-schema FK | §18.2 | 33 FKs | catalog | **MATCH** |
| Immutable tables carry no FK | §18.2 | none present | catalog = 0 | **MATCH** |
| 4 memory states | §6.1 | `chk_pi_memory_state` | invalid state rejected | **MATCH** |
| Validity window | §6.1 | `chk_pi_memory_window` | inverted window rejected | **MATCH** |
| Evidence ≥ 1 | §6.2 | `chk_pi_memory_evidence_positive` | `0` rejected | **MATCH** |
| Independent-observation rule | §6.2 | application-side only | **race reproduced** | **GAP — F8** |
| Canonical conflict pair | §18.4 | `chk_pi_conflict_canonical_order` | mirrored pair rejected | **MATCH** |
| Append-only | §18.5 | 8 triggers + REVOKE | UPDATE/DELETE/TRUNCATE rejected | **MATCH** |
| Maintenance path | §18.5 | GUC **and** role membership | either alone fails | **MATCH** |
| Preferences stay mutable | memory policy | excluded from immutable set | update+delete succeed, audit survives | **MATCH** |
| Supersession direction | §6.2 (ratified) | winner → loser | loser pointer `NULL` | **MATCH** |
| Guard decision vocabulary | §9 | `chk_pi_guard_decision` | invalid value rejected | **MATCH** |
| Preference status vocabulary | memory policy | `chk_pi_pref_status` | invalid value rejected | **MATCH** |
| Retrieval default `['active']` | §10 | partial index + repository default | plan uses index | **MATCH** |
| Audit retrievable by subject | §18.7 | `listForPreference` | **Seq Scan at 20k** | **GAP — F9** |
| Gates F and G | backup runbook §6 | **absent from preflight** | — | **GAP — F10** |

No undocumented executable object was found; no documented object is missing beyond the gaps above; no naming drift; no incorrect FK action; no role privilege drift.

---

## Concurrency — assessed honestly, not assumed

| Scenario | Status |
|---|---|
| Concurrent reinforcement | **FAIL — F8, reproduced** |
| Serialization conflict / retry | **NOT TESTED** — retry path exists for `40001`/`40P01` but no serialization failure was induced |
| Concurrent conflict insertion | **PASS by construction** — the unique index on the canonical pair makes the loser fail |
| Concurrent supersession | **NOT TESTED** — two winners could both point at one loser; no constraint prevents it |
| Concurrent tombstoning | **PASS by construction** — `memory_record_id` is UNIQUE on tombstones |

Two of five are genuinely unvalidated and are recorded as such rather than presumed safe.

---

## Migration safety — required future order

```
preflight → destination assertion → backup gate → schema migration
  → schema assertion → application activation → synthetic validation
  → controlled ingestion → post-migration validation
```

Confirmed: production migration **cannot** begin while the backup gate is blocked — `preflight()` refuses without `backupGateClosed`, verified by test. Real-data ingestion is separately gated by D1/D2/D3/D5 and `MPI_REAL_MEMORY_INGESTION_ENABLED = NO`.

---

## Final gate matrix

| Gate | Status | Evidence | Blocking reason |
|---|---|---|---|
| PC-DECOMMISSION-GATE | **CLOSED** | owner-declared 2026-08-14 | — |
| OFF-HOST-BACKUP-GATE | **BLOCKED** | 0 `s3_storages`, no config file | R2 deferred |
| MPI-2A (schema) | **CONDITIONAL** | 23/23 runner, scratch | F10; F8/F9 are schema-level |
| MPI-2B (persistence) | **PASS** | 38/38 scratch | — |
| MPI-2C (boundary) | **PASS** | 26/26 scratch | — |
| D1 third-party personal data | **OPEN** | — | owner decision |
| D2 MPI-originated entities | **OPEN** | — | owner decision |
| D3 memory content location | **OPEN** | — | owner decision |
| D5 MPI backup destination | **OPEN** | — | owner decision |
| Production migration | **BLOCKED** | enforced in code | backup gate + F8/F9/F10 |
| Real-data ingestion | **BLOCKED** | flag NO | D1/D2/D3/D5 |
| Supabase | **NOT STARTED** | — | recommended against |

---

## What must happen before production, in order

1. **Owner ratifies fixes for F8, F9, F10** — one schema constraint, two indexes, two preflight checks. All small; none should be applied without ratification, because F8 and F9 change the ratified schema.
2. **Provision R2** and execute the backup gate end to end.
3. **Answer D1/D2/D3/D5.**
4. **Decide observability (K)** — what a production persistence layer must log and expose.
5. Only then: migration readiness review, then migration.
