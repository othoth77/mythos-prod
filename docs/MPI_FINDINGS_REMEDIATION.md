# MPI Findings Remediation — F8 / F9 / F10 + Observability

**Date:** 2026-08-14 · **Checkpoint:** `68b0bb6e8fec26913cc217da25b6120df820df32`
**Scope:** DESIGN + SCRATCH VALIDATION ONLY. **No ratified SQL and no application implementation was modified.** Nothing was applied to production.

**Scratch:** PostgreSQL **15.19**, container `mythos-remediation-scratch-pg`, `--network none`, tmpfs `PGDATA`, no volume, no published port, no production credentials. **2 concurrent sessions** used for the race proofs. Removed; 0 scratch resources remain. Production census 26/20/9 identical, 0 restarts, all healthy.

---

## F8 — Concurrent reinforcement double-counts evidence

### Finding

`MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md` §6.2 binds reinforcement to *independent* observations: "a different `source_reference`, **or the same source at a materially later `observed_at`**". `lifecycles.js` wraps the read-then-write in one transaction; under READ COMMITTED that does not serialise the *decision*.

### Reproduction (scratch, 2 concurrent sessions)

| | Observed | Correct |
|---|---|---|
| `evidence_count` | **3** | 2 |
| provenance rows | **3** | 2 |

Both sessions read the provenance set before either wrote, so both judged the observation independent. The row lock serialises the two `UPDATE`s; it does not invalidate a decision already made.

### Alternatives evaluated

| | Mechanism | Correct? | Concurrency | Deadlock | Retry | Preserves §6.2 same-source-later rule | Architecture |
|---|---|---|---|---|---|---|---|
| **A** | `SELECT … FOR UPDATE` on the memory row **before** reading provenance | **Yes — proven** | writers serialise per memory row; readers unaffected | low (single row, consistent order) | none | **Yes** | no change |
| **B** | `SERIALIZABLE` + retry | Yes, in principle | highest isolation, aborts under contention | none | **required** on every write path | Yes | minor — changes isolation for all lifecycles |
| **C** | `UNIQUE (memory_record_id, source_reference)` | **No — proven wrong** | n/a | none | none | **NO — breaks it** | would silently change §6.2 |
| **D** | Advisory lock | Yes | manual namespace | moderate | none | Yes | lock discipline lives outside the schema |
| **E** | **A + `UNIQUE NULLS NOT DISTINCT (memory_record_id, source_reference, observed_at)`** | **Yes — proven** | as A | as A | none | **Yes — proven** | index addition only |

### Scratch evidence — 7/7

| # | Scenario | Result |
|---|---|---|
| 1 | baseline, no remedy | race reproduced: `evidence_count`=3, provenance=3 |
| 2 | **A** — FOR UPDATE before the provenance read | `evidence_count`=2, provenance=2 ✅ |
| 3 | **C** alone — race | stopped: loser rolls back, taking its increment with it |
| 4 | **C** alone — legitimate same-source-**later** observation | **`UNIQUE_VIOLATION` — wrongly rejected** ❌ |
| 5 | **E** — race | `evidence_count`=2, provenance=2 ✅ |
| 6 | **E** — legitimate same-source-later observation | accepted, `evidence_count`=3 ✅ |
| 7 | **E** — exact re-import | counted once ✅ |

### Selected design: **E**

**This corrects the previous audit.** `MPI_PRODUCTION_READINESS.md` proposed `UNIQUE (memory_record_id, source_reference)` — candidate **C** — as the F8 fix. Scenario 4 proves that constraint **forbids the ratified same-source-at-a-later-time reinforcement**, so C alone would have silently narrowed §6.2 through an index. The earlier recommendation is withdrawn.

Rationale for E over A alone: the lock fixes the race, but relies on every future caller taking it in the right order. The unique index is a **structural backstop** that cannot be forgotten, and `NULLS NOT DISTINCT` (PostgreSQL 15+, verified working on 15.19) is required because `observed_at` is nullable — under default `NULLS DISTINCT` two NULL-timestamped duplicates would both be accepted.

Rationale against B: `SERIALIZABLE` would impose retry handling on every write path to fix one read-then-write, and `client.js` already retries only `40001`/`40P01` — workable, but a global isolation change to solve a local problem.

### Proposed DDL (NOT APPLIED)

```sql
-- MPI-2A remediation addendum — requires owner ratification before application.
CREATE UNIQUE INDEX idx_pi_provenance_observation
  ON mythos_intelligence.pi_memory_provenance
     (memory_record_id, source_reference, observed_at) NULLS NOT DISTINCT;
```

Plus, in `repositories.js reinforce()`: take `SELECT … FOR UPDATE` on the memory row **before** reading provenance.

**One gap the fix does not close:** `lifecycles.js reinforceMemory()` inserts provenance only when `input.provenance` is supplied. A caller that reinforces without passing provenance still increments unguarded. The repository should require provenance for a reinforcement, or the index cannot protect it.

---

## F9 — Audit-table reads are unindexed

### Affected query — exactly one exists

`repositories.js:247` — `preferenceAudit.listForPreference()`:
```sql
SELECT * FROM pi_preference_audit WHERE preference_id = $1 ORDER BY preference_audit_pk
```

**Correction to the previous audit.** `MPI_PRODUCTION_READINESS.md` also flagged `pi_guard_decisions WHERE user_id`. Re-examined: `guardDecisions` exposes **`insert` only** — no read query exists anywhere in the repository layer. That half of F9 was measured against a query I wrote for the EXPLAIN, not one the system performs. Proposing an index for it would be speculative optimisation, which the audit rules forbid. **Withdrawn until a read path exists.**

### EXPLAIN ANALYZE evidence (50,000 audit rows over 5,000 preferences)

```
BEFORE                        Seq Scan on pi_preference_audit
                                Rows Removed by Filter: 49990        (to return 10)

AFTER (preference_id)         Bitmap Index Scan on ix1
                                Heap Blocks: exact=10                (10 rows)
```

### Column-order analysis

| Option | Plan | Verdict |
|---|---|---|
| `(preference_id)` | Bitmap Index Scan + Sort | **selected** |
| `(preference_id, preference_audit_pk)` | **identical plan**, index 2008 kB vs table 6904 kB | rejected — a bitmap scan does not preserve order, so the trailing column removes no Sort and only adds size |

Partial index: **not appropriate** — every row is a legitimate lookup target. Write amplification: one extra index on an insert-only table, no updates to propagate.

### Proposed DDL (NOT APPLIED)

```sql
CREATE INDEX idx_pi_preference_audit_subject
  ON mythos_intelligence.pi_preference_audit (preference_id);
```

---

## F10 — Migration preflight enforces one of three gates

### Current gate model

All gates are plain runtime arguments on the `opts` object, compared with `=== true`. Confirmed in scratch: the runner checks `backup_gate_closed` and refuses when it is false, but has **no** `pcGateClosed` and **no** `inventoryReconciled` check — gates F and G of the backup runbook exist only in prose.

### Mechanism evaluated

| | Option | Verdict |
|---|---|---|
| A | explicit runtime arguments | **selected** — matches the existing three assertions exactly |
| B | environment assertions | rejected — an env var set once persists into later runs unnoticed |
| C | signed gate artifact | over-engineered now; revisit if gate evidence must survive between operators |
| D | database state | rejected — these gates are facts *outside* the database (a PC, an off-host bucket) |
| E | operator assertion | **selected**, as the semantic of A: a human asserts, the runner records that it was asserted |
| F | — | — |

**A + E**, matching the existing `operatorAsserted` pattern so the runner keeps one gate model rather than two.

### Proposed contract — 5 gates, strict `=== true`

`diskOk` · `backupGateClosed` · `applicationReady` · **`pcGateClosed`** · **`inventoryReconciled`**

### Scratch test matrix — 14/14

| Case | Result |
|---|---|
| current runner checks backup gate | confirmed |
| current runner does **not** check PC gate | **F10 confirmed** |
| current runner does **not** check inventory | **F10 confirmed** |
| backup gate open → current runner refuses | refuses |
| all five asserted | proceed |
| backup / PC / inventory gate open | **REFUSE** (each) |
| PC gate missing (`undefined`) | **REFUSE** |
| inventory missing | **REFUSE** |
| ambiguous `'true'` (string) | **REFUSE** |
| ambiguous `1` | **REFUSE** |
| `null` | **REFUSE** |
| empty object | **REFUSE** |

Missing evidence is never interpreted as TRUE — proven for `undefined`, `null`, `'true'`, and `1`.

---

## Observability — minimum contract

### What already exists

`preflight()` and `assertSchema()` return structured, machine-readable results (`{ok, checks[]}` / `{ok, results[]}`) with expected-vs-actual per row. `apply()` returns per-migration status. `client.js` maps SQLSTATE to named kinds, so failures are classifiable rather than string-matched. Migration version and checksum are persisted in `schema_migrations`.

### What genuinely does not exist

**No logging of any kind** in the persistence layer — zero `console.*`, no logger, no emitted events. So: a rolled-back transaction is invisible unless a caller catches and reports it; **a failed append-only audit write is invisible**, which matters most because that is the write whose absence must never pass silently; there is no persistence-initialisation result surface and no health/readiness signal.

The wider application has no shared logging facility to inherit — this is a genuine gap, not a wiring omission.

### Minimum contract (design only, not built)

| Requirement | Status |
|---|---|
| structured migration output | **exists** |
| migration version + checksum | **exists** |
| gate status | exists for 3 of 5 gates (F10) |
| schema assertion result | **exists** |
| persistence initialisation result | **missing** |
| transaction failure visibility | **missing** |
| append-only audit write failure visibility | **missing — highest priority** |
| health / readiness signal | **missing** |

Deliberately **not** proposed: metrics backend, tracing, log shipping. The minimum is a small injected logger interface plus a `checkHealth()` returning the `assertSchema()` result — designed separately from F8/F9/F10.

---

## Architecture impact matrix

| Item | Change | Classification |
|---|---|---|
| F8 — `FOR UPDATE` before provenance read | repository ordering | **NO ARCHITECTURE CHANGE** |
| F8 — unique index on provenance observation | ratified schema addition | **REQUIRES OWNER DECISION** |
| F8 — require provenance on reinforcement | repository contract | **MINOR ARCHITECTURE CHANGE** |
| F9 — index on `pi_preference_audit (preference_id)` | ratified schema addition | **REQUIRES OWNER DECISION** |
| F9 — guard-decisions index | withdrawn | **NO CHANGE** |
| F10 — two additional preflight gates | runner contract | **MINOR ARCHITECTURE CHANGE** |
| Observability — logger + health signal | new surface | **REQUIRES OWNER DECISION** |

Nothing classified **REQUIRES OWNER DECISION** was implemented.

---

## Status

| Finding | Status |
|---|---|
| F8 | **CONDITIONAL** — remedy E designed and proven; index needs ratification |
| F9 | **CONDITIONAL** — one index proven; guard-decisions half withdrawn |
| F10 | **CONDITIONAL** — contract proven 14/14; two checks need adding |
| Observability | **CONDITIONAL** — gaps identified, minimum contract defined, nothing built |
