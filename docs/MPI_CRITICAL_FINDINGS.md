# MPI Critical Findings — F11 and F13

**Date:** 2026-08-14 · **Checkpoint:** `ffe284823be06daa9f355ab153e3ff5717726edf`
**Scope:** investigation, then implementation (2026-08-14, second pass). Nothing applied to production.

**Both findings are now PROVEN and FIXED.** F11 was previously STATIC ONLY; it was demonstrated end-to-end against real PostgreSQL with a control, and is now remediated. See **§ Implementation** at the end of this document for what changed and the verifying evidence.

**Scratch:** PostgreSQL **15.19**, `mythos-critical-scratch-pg`, `--network none`, tmpfs, no volume, no published port, no production credentials. Removed; 0 remain. Production census 26/20/9 identical, 0 restarts, all healthy.

---

# F11 — Transaction driver integrity

**Severity: HIGH · Status: FIXED (2026-08-14) — see § Implementation**

## F11.1 — The actual required contract

`client.js` documents the driver as `driver.query({text, values}) -> {rows}` and states *"a real `pg` Pool/Client satisfies it unchanged."*

Tracing the real requirement:

| Component | What it needs |
|---|---|
| `withTransaction` | `BEGIN`, `SET search_path`, N statements, `COMMIT`/`ROLLBACK` **on one physical connection** |
| `repositories.js` | only `exec.query()` — connection-agnostic |
| `lifecycles.js` | all 9 operations run inside `withTransaction` |
| `adapters.js` | same |
| `psql-driver.js` | **one persistent `psql` session** — inherently connection-affine |
| MPI-2B/2C/2A tests | all three construct `createPsqlDriver` |

**The required abstraction is a session/connection-bound client, not a pool.** Every test used the one driver shape that happens to satisfy it, so the contract's error was never exercised.

## F11.2 — The pool problem, from pg's own source

`pg` **8.23.0** is already vendored at `projects/idauto/node_modules/pg` — no installation needed to establish this.

`pg-pool/index.js` `query()`:

```
this.connect((err, client) => { … client.query(text, values, (err,res) => { … client.release(err) … }) })
```

It acquires a client **per call** and releases it immediately after. And pg's own README states it outright:

> "unless you need to run a transaction (which requires a single client for multiple queries)…" — `pg-pool/README.md:155`

So the library documents precisely what `client.js` claims it does not need. **The contract as written is wrong, by the driver's own documentation.**

## F11.4 — Proof against real PostgreSQL

A pool-shaped driver was built over **three independent real `psql` sessions**, round-robining per `query()` call — modelling pg-pool's connection affinity exactly, while PostgreSQL semantics remain genuine (nothing faked).

**Observed routing of a single `withTransaction`:**

| Statement | Connection |
|---|---|
| `BEGIN` | **A** |
| `SET search_path TO mythos_intelligence` | **B** |
| `INSERT INTO t …` | **C** |
| `COMMIT` | **A** |

**Consequence, measured:**

| Test | Result |
|---|---|
| write inside a transaction that then **fails and rolls back** | **row present — 1 (correct: 0)** |
| identical code over the **single-session** driver | row absent — 0 ✅ |

**The write survived a rollback because no transaction ever existed.** `BEGIN` opened a transaction on connection A and left it there; the `INSERT` executed on connection C in autocommit; `ROLLBACK` returned to A and rolled back nothing.

The control is what makes this conclusive: **the same application code, the same database, opposite outcomes — determined purely by driver shape.**

## F11.3 — Remedies evaluated

| | Design | Correctness | Affinity | Rollback | Pool-compatible | Retry | Repos affected | Adapters affected | Architecture |
|---|---|---|---|---|---|---|---|---|---|
| **A** | `client.js` checks out a client for the whole transaction | correct | guaranteed | correct | yes | safe | **none** | **none** | contract narrows |
| **B** | callback receives a dedicated transaction client | correct | guaranteed | correct | yes | safe | none | none | same as A, different shape |
| **C** | `driver.transaction(cb)` delegated to the driver | correct | guaranteed | driver's | yes | driver-dependent | none | none | pushes semantics into every driver |
| **D** | explicit connection-bound driver object per transaction | correct | guaranteed | correct | yes | safe | none | none | caller must manage lifetime |
| **E** | keep `query()` only, forbid Pool in docs | **fragile** | by convention | by convention | no | unsafe | none | none | relies on nobody passing a Pool |

**Recommended: A**, expressed as a two-method driver contract:

```
driver.query({text, values})            // single statement, no transaction
driver.acquire() -> connection          // connection.query(...), connection.release()
```

`withTransaction` calls `acquire()`, runs `BEGIN` → work → `COMMIT`/`ROLLBACK` on that connection, and releases it in a `finally`. A real `pg.Pool` satisfies this via `pool.connect()`; a `pg.Client` satisfies it by returning itself; the psql test driver satisfies it the same way.

**Critically, no repository, lifecycle, or adapter changes** — they only ever see `exec.query()`. The blast radius is `client.js` plus the driver contract.

**E is explicitly rejected:** a rule that says "do not pass a Pool" is exactly the kind of invariant that lives only in prose, which this audit has repeatedly found to be the failure mode.

## Architecture impact

**MINOR ARCHITECTURE CHANGE** — narrows a documented contract and adds one method; changes no schema, no lifecycle, no transaction boundary. §18.7's atomicity requirements are unchanged; this is what makes them true.

## Limitation

Not verified against a real `pg.Pool` over TCP: the scratch container runs `--network none` by the standing isolation rules, so no TCP driver can reach it. Publishing a port to enable that would weaken isolation for no additional certainty, since pg-pool's source and its own README already establish the acquire/release behaviour. Labelled **SCRATCH VERIFIED (real PostgreSQL, pool-shaped driver)** and **STATIC (real pg source)** — not *real pg driver verified*.

---

# F13 — Preference reinforcement is never persisted

**Severity: HIGH · Status: FIXED (2026-08-14) — see § Implementation**

## F13.1 — What the architecture requires

- §4 rule 5: *"Reinforcement is not a write of a new duplicate. It **increments `evidence_count`** and **moves `last_observed_at`** on the existing row."*
- §6.2: repeated low-quality duplicates must not inflate confidence — presupposes a persisted count.
- `MYTHOS_USER_MEMORY_POLICY.md`: the status progression `SESSION_OBSERVATION → CANDIDATE_PREFERENCE → ESTABLISHED_PREFERENCE` is evidence-driven.

Persistence of `evidence_count` and `last_observed_at` is **required**, not optional. The architecture is not weakened to fit the implementation.

## F13.2 — Field matrix (proven)

| Field | Domain writes | INSERT | UPDATE | Reloadable |
|---|---|---|---|---|
| `status` | yes | yes | **yes** | yes |
| `confidence` | yes | yes | **NO** | yes |
| `evidence_count` | yes | yes | **NO** | yes |
| `last_observed_at` | yes | **NO** | **NO** | **no** |
| `first_observed_at` | yes | **NO** | **NO** | **no** |
| `preference_key`, `preference_value_summary`, `source`, `scope`, `supersedes_preference_id` | yes | yes | NO | yes |

`updateStatus()` writes **only** `status` and `updated_at`. Neither timestamp is written by **any** repository method — both keep their `DEFAULT NOW()` from insert permanently.

## F13.4 — Promotion across requests (proven)

Thresholds: `CANDIDATE` at 2, `ESTABLISHED` at 4. Each request rebuilds the in-memory store from the database, as a real request must:

| Request | loaded | domain computed | persisted | status |
|---|---|---|---|---|
| 1 | 1 | 2 | **1** | CANDIDATE_PREFERENCE |
| 2 | 1 | 2 | **1** | CANDIDATE_PREFERENCE |
| 3 | 1 | 2 | **1** | CANDIDATE_PREFERENCE |
| 4 | 1 | 2 | **1** | CANDIDATE_PREFERENCE |

**After four reinforcements the persisted count is still 1, and `ESTABLISHED_PREFERENCE` is unreachable at any volume of observations.** Confidence remains `LOW` in storage forever.

**A second defect follows from the first:** the row persists `status = CANDIDATE_PREFERENCE` alongside `confidence = LOW`, because `status` is written and `confidence` is not. The stored row is **internally inconsistent** — it claims a promotion its own confidence field contradicts.

## F13.3 — Idempotency

An exact duplicate observation and a legitimate later observation are **storage-indistinguishable**: neither changes the persisted row. F13 therefore *masks* the preference-side analogue of the F8 distinction — it cannot be reasoned about until reinforcement persists at all. Distinct from F8, which concerns `pi_memory_provenance`.

## F13.5 — Minimal remediation

| Layer | Change needed |
|---|---|
| SQL / schema | **none** — every column already exists |
| repository | `updateStatus()` → a `reinforce()` writing `status`, `confidence`, `evidence_count`, `last_observed_at`; `create()` to write both timestamps |
| adapter | route an existing preference to `reinforce()` instead of `updateStatus()`, passing the domain-computed values |
| lifecycle | none — already transactional |
| tests | assertions on persisted `evidence_count` / `last_observed_at` / `confidence`, not just returned objects |

**No new fields.** The smallest correct change is repository + adapter. `memory.reinforce()` already does this correctly for memory rows — the preference path simply never gained the equivalent.

## Architecture impact

**MINOR ARCHITECTURE CHANGE** — makes the implementation match §4 rule 5. No schema change, no new field, no architectural decision required.

---

# Regression blind spots

Both findings survived three prior stages for the same structural reason: **the tests asserted returned values and the one driver shape that hides the defect.**

| Blind spot | Evidence |
|---|---|
| No preference test asserts `evidence_count`, `last_observed_at` or `confidence` | grep across 2B/2C returns none for preferences |
| MPI-2B case 26 asserts `changed.preference.status === 'ESTABLISHED_PREFERENCE'` | passes because that path passes an **explicit** status; reinforcement is untested |
| MPI-2C cases 16–19 assert status, supersession pointer, audit count | all status-level; the dropped fields are invisible |
| All transaction tests construct `createPsqlDriver` | single session — F11 cannot manifest |
| `Pool`, `retry`, `concurren*` | **0 occurrences** across all MPI tests |

The MPI-2C boundary audit found that *"a pure module's return value is not necessarily its whole effect"* and built the adapter to capture an in-place mutation of a **different** row. F13 is the same class of error one level down: the adapter captures the *other* record's mutation but discards the *subject's own*.

---

# Scratch evidence summary

| Test | Result | Level |
|---|---|---|
| pg-pool acquires/releases per `query()` | confirmed in vendored source | STATIC (authoritative) |
| pg documents transactions need a single client | `pg-pool/README.md:155` | STATIC (authoritative) |
| BEGIN/statement/COMMIT split across 3 connections | proven | SCRATCH VERIFIED |
| write survives rollback under pool shape | proven (1 row, correct 0) | SCRATCH VERIFIED |
| single-session control rolls back correctly | proven (0 rows) | SCRATCH VERIFIED |
| F13 promotion never persists over 4 requests | proven | SCRATCH VERIFIED |
| F13 field matrix | proven | SCRATCH VERIFIED |
| real `pg.Pool` over TCP | **NOT TESTED** — blocked by `--network none` | BLOCKED |

**3/3 F11 cases, 6/6 F13 cases.**

---

# Open decisions

| | Decision | Owner? |
|---|---|---|
| F11 | ratify remedy A (two-method driver contract) | ratification only — no architecture decision |
| F13 | ratify repository + adapter reinforcement fix | ratification only — no architecture decision |
| F8, F9, F10, F14, observability | **unchanged this stage** | as previously recorded |

Neither fix requires an architecture decision; both require explicit ratification before implementation.


---

# Implementation (2026-08-14)

Remedy **A** for F11 and the repository+adapter fix for F13 were implemented. **No schema change was required or made — 0 SQL files touched.**

## F11 — what changed

`client.js` gained `acquire()` and now runs a transaction on **one** connection:

| Before | After |
|---|---|
| `query('BEGIN')` → `query(...)` → `query('COMMIT')`, each a separate driver call | `acquire()` once; `BEGIN`, `SET search_path`, the work, `COMMIT`/`ROLLBACK` all via that connection; `release()` in `finally` |
| a query-only driver was silently assumed session-affine | a query-only driver is **refused** for transactions with an explicit F11 message |
| a `pg.Pool` would have split the transaction | a Pool is **adapted** through `connect()` → dedicated client → `release()` |
| `read()` issued `SET search_path` and the read as two separate calls | `read()` also acquires one connection for both |

`read()` had the same defect and is fixed with it — the `search_path` would otherwise have applied to a different connection than the read.

The psql test driver gained `acquire()` returning a facade over its single session, so **no repository, lifecycle, or adapter signature changed**; they only ever see `exec.query()`.

## F13 — what changed

| Before | After |
|---|---|
| `updateStatus()` wrote only `status` + `updated_at` | new `reinforce()` writes `status`, `confidence`, `evidence_count`, `last_observed_at` |
| `create()` never wrote either timestamp | `create()` writes `first_observed_at` and `last_observed_at` |
| adapter routed an existing preference to `updateStatus()`, discarding the mutation | adapter routes it to `reinforce()` with the full domain result |

`observe()` returns the very object it mutated, so the adapter already held every value — the fix stops discarding them rather than recomputing them. **The threshold logic was deliberately not duplicated in the repository**: the domain remains authoritative, and duplicating it would create two places to disagree about when a preference is established. `updateStatus()` is retained for explicit governance-driven transitions.

A redundant write was also removed: when the mutated record *is* the returned one, only `reinforce()` writes it — the audit row is still emitted.

## Verifying evidence — 25 cases, 0 failures

**F11 (`tests/mpi-2d-f11-f13-test.js`)** — query-only driver refused · Pool-shaped driver adapted, `BEGIN…COMMIT` on one client · released once on success · error propagates with mapped kind · released once on failure · successful transaction commits · **every statement on ONE connection (was 3)** · **rollback after multiple writes leaves nothing** · acquired == released across both paths · connection reuse across sequential transactions · single-session driver still compatible.

**F11 adversarial** — exception during `COMMIT` propagates and still releases, with `ROLLBACK` attempted on the same connection · exception during `ROLLBACK` does not swallow the original error and still releases · nested `withTransaction` opens a **separate** transaction (2 × `BEGIN`) and releases both.

> Nested calls are independent transactions, **not savepoints**. Recorded, not changed — savepoint semantics are not specified by the architecture.

**F13** — reinforcement 1: `evidence_count` 1→2 **persisted** · `last_observed_at` moved T1→T2 · reinforcement 2 after reload: 2→3 · reinforcement 3 after reload: 3→4 · **promotion to `ESTABLISHED_PREFERENCE` survives reload** at the domain's own threshold of 4 · `confidence` now `HIGH`, no longer stuck at `LOW` · exactly one audit row per reinforcement.

Promotion is asserted against `learning.ESTABLISHED_THRESHOLD`, never a hard-coded state.

## Regression — 254 passed, 0 failed

MPI-0 63 · MPI-0-governance 36 · MPI-1 50 · MPI-2B 38 · MPI-2C 26 · MPI-2A runner 23 · MPI-2D 18. **No suite required modification**, and no assertion was weakened.

## Still open

F8 was encountered during testing and **left unchanged** as instructed: provenance with a fresh id and identical `(source_reference, observed_at)` remains insertable. F9, F10, F14 and observability are untouched.
