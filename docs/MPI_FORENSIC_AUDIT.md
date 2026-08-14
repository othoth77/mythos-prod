# MPI Deep Repository Forensic Audit

**Date:** 2026-08-14 · **Checkpoint:** `68f7d24869a120fa767f563550c99ba06b3535fe`
**Scope:** READ-ONLY INVESTIGATION + SCRATCH VALIDATION + DOCUMENTATION. No SQL, application, or test file was modified. Nothing applied to production.

**Scratch:** PostgreSQL **15.19**, `mythos-forensic-scratch-pg`, `--network none`, tmpfs `PGDATA`, no volume, no published port, no production credentials. Removed; 0 scratch resources remain. Production census 26/20/9 identical, 0 restarts, all healthy.

Evidence is labelled **PROVEN/SCRATCH VERIFIED** · **STATIC ONLY** · **NOT TESTED** · **BLOCKED** throughout.

---

## Executive summary

The prior stages' conclusions survive scrutiny, with one important qualification: **F8/F9/F10 are not the deepest defects in this layer.** Four new findings, two of them HIGH:

| ID | Title | Severity | Evidence |
|---|---|---|---|
| **F11** | `withTransaction` is unsafe under the documented `pg` **Pool** contract | **HIGH** | STATIC ONLY |
| **F12** | `pi_memory_tags` has no writer anywhere — dead table | MEDIUM | STATIC ONLY |
| **F13** | Preference reinforcement silently discards `evidence_count` and `last_observed_at` | **HIGH** | **SCRATCH VERIFIED** |
| **F14** | Asymmetric erasure: memory `RESTRICT` blocks user deletion while 7 children `CASCADE` | MEDIUM | **SCRATCH VERIFIED** |

F13 matters most for correctness: the *memory* side of reinforcement increments evidence, the *preference* side does not, so the confidence model is half-implemented — and every existing test passes anyway.

---

## F11 — `withTransaction` is unsafe under the documented Pool contract

**Severity:** HIGH · **Evidence:** STATIC ONLY (cannot be tested without adopting a driver) · **Owner decision:** no · **Implementation:** yes

**Precondition:** production injects a `pg.Pool`, exactly as `client.js` documents.

**Current behaviour.** `withTransaction` issues `BEGIN`, each statement, and `COMMIT` as **separate `driver.query()` calls**. `client.js:15-17` states: *"a real `pg` Pool/Client satisfies it unchanged."*

A `pg.Pool.query()` checks out a connection **per call** and returns it immediately. So `BEGIN` runs on connection #1 and is released; the writes may run on #2 in autocommit; `COMMIT` on #3 has no open transaction. **Every write commits individually, and `ROLLBACK` becomes a no-op** — silently, with no error.

**Why no test caught it:** the psql test driver is a *single persistent session*, so it behaves like a `pg.Client`. Every atomicity guarantee in MPI-2B/2C was proven under the one driver shape where the bug cannot appear. `Pool` appears in 0 MPI tests.

**Expected behaviour:** a transaction executes on one dedicated connection (`pool.connect()` → `client.query()` → `client.release()`).

**Architecture reference:** §18.7 transaction boundaries; the atomicity claims in MPI-2B/2C rest on this.

**Disposition:** narrow the documented contract to a *connection-scoped* driver, or have `client.js` acquire and release a connection per transaction. **Do not adopt a Pool until this is resolved** — F11 would convert every "ATOMIC, REQUIRED" lifecycle into a sequence of independent writes.

---

## F12 — `pi_memory_tags` has no writer

**Severity:** MEDIUM · **Evidence:** STATIC ONLY · **Owner decision:** no · **Implementation:** yes

`MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md` §18.7 assigns tags to the memory repository: *"memory (records, tags, events, provenance)"*. The persistence layer contains **zero references** to `pi_memory_tags` — no create, no read, no delete, in any repository, lifecycle, or adapter.

The table exists with 2 indexes (one unique) and is exercised only by direct SQL in tests. It is a **dead table** in the current implementation: reachable by migration, unreachable by application.

**Disposition:** either implement tag methods on the memory repository, or move tags out of §18.7's stated boundary. Documented-but-unimplemented is the state that misleads.

---

## F13 — Preference reinforcement discards evidence and timestamps

**Severity:** HIGH · **Evidence:** **SCRATCH VERIFIED** · **Owner decision:** no · **Implementation:** yes

**Architecture reference:** §4 rule 5 — *"Reinforcement is not a write of a new duplicate. It increments `evidence_count` and moves `last_observed_at` on the existing row."*

**Reproduction (scratch):** create a preference, then observe the **same value** again through `adapters.persistObservation()`.

| | Domain object | Database row |
|---|---|---|
| `evidence_count` | incremented to **2** | **stayed 1** |
| `last_observed_at` | moved | **unchanged** |

**Cause.** `learning-engine.observe()` mutates the existing record in place (`existing.evidenceCount += 1; existing.lastObservedAt = now`). `adapters.persistObservation()` routes an existing preference to `repositories.preferences.updateStatus()`, which writes **only** `status` and `updated_at`. Neither `evidence_count`, `last_observed_at`, nor `first_observed_at` is written by **any** repository method — they hold their `DEFAULT NOW()` from insert forever.

**Consequence.** Confidence promotion is driven by `evidenceCount` thresholds (`CANDIDATE` at 2, `ESTABLISHED` at 4). Those thresholds are evaluated against the **in-memory** array, which is rebuilt from the database on the next request — where the count is still 1. **Promotion can never persist across requests.** The learning pipeline is, in storage terms, inert.

This is the exact inverse of MPI-2C's F-hazard: there the adapter correctly captured an in-place mutation of a *different* row; here it drops the in-place mutation of the *same* row.

**Disposition:** `updateStatus()` should become a full reinforcement write (status, evidence_count, confidence, last_observed_at), or `persistObservation()` should call a dedicated `reinforce()` on the preference repository — mirroring `memory.reinforce()`, which does this correctly.

---

## F14 — Asymmetric erasure semantics

**Severity:** MEDIUM · **Evidence:** **SCRATCH VERIFIED** · **Owner decision:** **YES** · **Implementation:** deferred

Actual `ON DELETE` actions from `pi_users`:

| Child | Action |
|---|---|
| `pi_memory_records` | **RESTRICT** |
| `pi_sessions`, `pi_learned_preferences`, `pi_memory_conflicts`, `pi_memory_events`, `pi_context_packages`, `pi_feedback_events`, `pi_user_domain_access` | **CASCADE** |

Proven: deleting a user holding one memory row raises `FOREIGN_KEY_VIOLATION`.

Both halves are uncomfortable for a privacy-facing system. A user with any memory **can never be deleted** — so an erasure request cannot be satisfied by deleting the user. And if memory were cleared first, deleting the user would **silently cascade-delete** preferences, sessions, conflicts, events, context packages and feedback, with the audit tables (correctly, per F2) surviving as the only trace.

Nothing in the architecture states an erasure policy, so this is not drift — it is an **unmade decision** that the FK actions have quietly made on its behalf. It intersects **D1**.

---

## Data model map

| Table | Writers | Readers | Lifecycles | Status |
|---|---|---|---|---|
| `pi_domains`, `pi_domain_capabilities`, `pi_user_domain_access` | migration/seed only | none | — | registry, documented |
| `pi_organisations`, `pi_users` | repository | repository | — | live |
| `pi_sessions` | none | none | — | **no repository** |
| `pi_memory_records` | repository | repository | A,B,C,D,E | live |
| `pi_memory_provenance` | repository (insert) | repository | A,E,F | live, immutable |
| `pi_memory_conflicts` | repository | — | G | live |
| `pi_memory_tombstones` | repository (insert) | — | D | live, immutable |
| `pi_memory_tags` | **none** | **none** | — | **F12 dead** |
| `pi_memory_events` | repository | — | — | write-only, no reader |
| `pi_learned_preferences` | repository | repository | H | live, **F13** |
| `pi_preference_audit` | repository (insert) | repository | I | live, immutable, **F9** |
| `pi_guard_decisions` | repository (insert) | **none** | J | live, immutable, write-only |
| `pi_entity_references`, `pi_knowledge_sources`, `pi_context_packages`, `pi_feedback_events`, `pi_capability_runtime_status` | none | none | — | **no repository** (documented, reasons stated) |

**71 of 222 columns** are never referenced by the persistence layer. Most are legitimate — internal `*_pk` surrogates, and columns of the six tables that intentionally have no repository. The material ones are `pi_learned_preferences.first_observed_at` / `last_observed_at` (**F13**) and all of `pi_memory_tags` (**F12**).

**Write-only tables:** `pi_guard_decisions` and `pi_memory_events` are written and never read by any repository. Correct for an audit trail; worth noting that no read path exists to *use* them.

---

## Idempotency matrix — same operation twice (SCRATCH VERIFIED)

| Operation | Result |
|---|---|
| duplicate memory creation | **REJECTED** (unique external id) |
| duplicate provenance, same id | **REJECTED** |
| duplicate provenance, **same source + timestamp, new id** | **DUPLICATED** — the F8 gap |
| duplicate tombstone | **REJECTED** (unique `memory_record_id`) |
| duplicate guard decision | **REJECTED** |
| duplicate event | **REJECTED** |

Every operation carrying a caller-supplied external id is idempotent by unique constraint. The single non-idempotent write is provenance with a fresh id — exactly what F8 candidate E's index would close. **The distinction F8 depends on holds:** a repeated *request* (same source, same `observed_at`) is duplicable, while a legitimate *later* observation (same source, later `observed_at`) is a distinct row.

---

## Retry matrix

`client.js` retries the whole transaction on `40001`/`40P01` only. Constraint violations are never retried — correct, they are deterministic.

| Replay risk | Assessment |
|---|---|
| duplicate insert | **safe** — rollback precedes retry, and external ids are unique |
| duplicate provenance | **safe under retry**, but see F8 for the concurrent (non-retry) path |
| duplicate audit | **safe** — audit ids are caller-supplied and unique |
| evidence inflation | **safe on retry** (the increment rolls back); unsafe **concurrently** (F8) |
| duplicate supersession | **safe** — idempotent by value |
| **retry under a Pool** | **UNSAFE — F11.** With no real transaction, "rollback then retry" replays writes that already committed |

`retry` and `40001` appear in **0** MPI tests: the retry path has never been executed. **NOT TESTED.**

---

## Invariant matrix

| Invariant | Application | Database | Bypassable? |
|---|---|---|---|
| F1 schema placement | yes (refuses `public`) | via migration | no |
| F2 no cross-schema FK | — | yes | no |
| F3 MPI-2A columns | yes | yes (CHECKs) | no |
| F4 canonical pair | yes (`canonicalPair`) | yes (CHECK) | no |
| F7 append-only | yes (no mutator methods) | yes (triggers + REVOKE) | no — proven via raw SQL |
| state validity | yes (`assertState`) | yes | no |
| temporal validity | — | partial (`valid_to >= valid_from`) | see below |
| `evidence_count >= 1` | — | yes | no |
| **independent-observation rule** | application only | **none** | **YES — F8** |
| **preference reinforcement** | application only | **none** | **YES — F13** |
| supersession direction | application only | none | yes — nothing prevents a wrong-direction write |
| provenance required for memory | lifecycle only | **none** | yes — a direct repository call can create memory with no provenance |
| preference status vocabulary | — | yes (CHECK) | no |
| guard decision vocabulary | — | yes (CHECK) | no |

**Invariants existing only in prose:** independent observation, preference reinforcement, supersession direction, and "every durable memory row gets a provenance row" (§5) — the last is enforced by `createMemoryWithProvenance()` but not by `memory.create()`, which any caller may use directly.

---

## Temporal analysis (SCRATCH VERIFIED)

| Case | Result |
|---|---|
| `valid_from > valid_to` | rejected |
| equal boundaries | accepted |
| NULL boundary | accepted |
| far-future `observed_at` (+100 years) | **accepted** |
| `superseded_at` before observation | **accepted** |
| repeated observation at same timestamp | **accepted** (F8) |
| later observation, same source | accepted — correct per §6.2 |

The last two rows are the F8 distinction, confirmed at the database level. Far-future timestamps and inverted supersession ordering are unconstrained — but **the architecture defines no rule for either**, so these are recorded as *scope*, not drift. Inventing constraints here would be exactly the "invent missing architecture decisions" the order forbids.

---

## Auditability

F7 holds from **both** paths — normal repository (no mutator methods exist) and raw SQL (triggers fire for UPDATE/DELETE, and a separate statement trigger covers TRUNCATE). Previously proven: a regulated `REQUIRE_APPROVAL` decision cannot be flipped to `ALLOW`, and an audit row survives deletion of its subject preference.

**Mutations that can occur without required audit evidence:**

- `memory.create()` called directly creates a memory with **no provenance row** — §5 requires one. Only the lifecycle wrapper enforces it.
- `memory.setState()` writes a state transition with **no audit record at all**. There is no memory-state audit table; only preferences have one.
- `conflicts.resolve()` records `resolved_by_ref` but emits no audit row.

---

## Security / privilege

Roles: `mythos_intelligence_owner` (DDL), `_app` (SELECT/INSERT on immutable tables, no UPDATE/DELETE/TRUNCATE), `_maint` (full DML, gated by trigger + GUC). Previously proven: app role denied by privilege; maint without GUC denied by trigger; GUC without role membership denied by privilege; both together permitted.

Superuser is not covered by privilege — but **is** covered by the triggers, which is why the two-layer design matters.

---

## SQL safety

| Fragment | Classification |
|---|---|
| all repository values | **PARAMETER** (`$n`) |
| `LIMIT` | **PARAMETER** |
| `state = ANY($3)` | **PARAMETER**, validated first by `assertState` |
| `ORDER BY` | **CONSTANT** — no dynamic ordering exists |
| schema in `SET search_path` | **VALIDATED IDENTIFIER** (`/^[a-z_][a-z0-9_]*$/` before interpolation) |
| `TARGET_SCHEMA` / `VERSION_TABLE` in `migrate.js` | **CONSTANT** (module-level) |
| migration file bodies | **CONSTANT** — read from disk, sha256-tracked |

**No UNKNOWN fragments. No user-controlled data becomes SQL syntax.** The psql test driver's literal encoder is the only string-building path, and it is test-only and strict.

---

## Test-quality analysis

| Weakness | Instances |
|---|---|
| bare `catch (_)` passing on **any** error | 11 across the three suites (`mpi-2a` has 4 and **zero** typed assertions) |
| assertions on returned values without re-reading DB state | organisation/user creation, several lifecycle results |
| ordering-dependent assertions | `loadMemoryStore` length/ordering checks |
| **concurrency coverage** | **0** — `concurren*` matches nothing |
| **retry coverage** | **0** — `retry`/`40001` match nothing |
| **Pool-semantics coverage** | **0** — `Pool` matches nothing (this is how F11 survived) |

`expectKind()` in the 2B/2C suites is the strong pattern — it asserts the *specific* SQLSTATE class. The migration-runner suite uses none, so e.g. "apply() aborts rather than migrating the wrong database" would pass if it aborted for an unrelated reason.

---

## Architecture drift

| Requirement | Implementation | Status |
|---|---|---|
| §18.7 memory repository owns tags | no tag methods | **DRIFT — F12** |
| §4 rule 5 reinforcement moves evidence + timestamp | preferences: neither written | **DRIFT — F13** |
| §5 every memory row gets provenance | lifecycle only, not repository | **AMBIGUOUS** |
| §6.2 independent observation | application only, racy | **DRIFT — F8** |
| §10 retrieval defaults | implemented + indexed | MATCH |
| §18.2 no FK on immutable tables | 0 FKs | MATCH |
| §18.5 append-only | triggers + privileges | MATCH |
| §6.2 supersession direction | winner → loser | MATCH |
| §2.2 per-schema migration | `schema_migrations` in-schema | MATCH |
| erasure policy | none stated; FK actions decide | **MISSING — F14** |

---

## Status of prior findings

| | Status after forensics |
|---|---|
| **F8** | unchanged — CONDITIONAL, candidate E stands; idempotency matrix independently confirms the request-vs-later-observation distinction it depends on |
| **F9** | unchanged — CONDITIONAL, one index; the withdrawal of the guard-decisions index is **reinforced**: `pi_guard_decisions` has no reader at all |
| **F10** | unchanged — CONDITIONAL |
| **Observability** | reinforced — F13 is precisely the class of silent failure the missing logging would hide |
