# ID Auto has moved — and has now been removed from this repository

**Canonical repository → https://github.com/othoth77/idauto**

ID Auto was extracted on **2026-08-18** and repositioned as **IDauto — an open vehicle
identity and history protocol**. That repository is canonical: `main` = `bdfec2c`, 91 files,
verified from a clean clone (13 suites, 601 assertions, 0 failures). Protocol vocabularies
were subsequently published there on branch `protocol-identity-vocabularies` (PR #2). **Develop
ID Auto there, not here.**

> **STATUS: COMPLETE.** The duplicated source in `projects/idauto/`, its own test suites, and
> the eight duplicated `IDAUTO_*.md` docs were **removed from this repository by
> IDA-DECOUPLE-4 on 2026-08-19** (this commit). Mythos consumes the ID Auto identity
> vocabularies via the pinned protocol artifacts at
> `projects/mythos-core/contracts/idauto/`, not the source tree. See §3, §5, and §2 for the
> completed history.

---

## 1. Publication and verification

| | |
|---|---|
| Repository | https://github.com/othoth77/idauto |
| `main` | `bdfec2ce247f479155e920fd8156e8c94d5a6d49` (tree `26b93fb8`) |
| Files | 91 |
| Origin baseline | this repository, `5e2011b` |
| Clean-clone tests | **13 suites · 601 assertions · 0 failures** |

Verified from a fresh clone of the published repository — not from the tree it was built in:
`npm install` from the published lockfile, a newly created PostgreSQL 16 database, schema +
IDA-3A migration + synthetic seed, then every suite live. Commit and tree hashes matched, all
91 files were byte-identical to the audited tree, and 45/45 origin file pairs were present.

Evidence:
[`docs/STANDALONE_MIGRATION_AUDIT.md`](https://github.com/othoth77/idauto/blob/main/docs/STANDALONE_MIGRATION_AUDIT.md).

## 2. Where each file went

| Was here | Is now, in `othoth77/idauto` |
|---|---|
| `projects/idauto/database/` | `database/` |
| `projects/idauto/config/` | `config/` |
| `projects/idauto/reference/` | `reference/` |
| `projects/idauto/ops/` | `ops/` |
| `projects/idauto/{package.json, package-lock.json, .env.example}` | repository root |
| `tests/ida-*.js`, `tests/idauto-storage-ops-test.js` | `tests/` (names unchanged) |
| `docs/IDAUTO_PRODUCT_SPEC.md` | `docs/PRODUCT_SPEC.md` |
| `docs/IDAUTO_ARCHITECTURE.md` | `docs/ARCHITECTURE.md` |
| `docs/IDAUTO_CAPTURE_PIPELINE.md` | `docs/CAPTURE_PIPELINE.md` |
| `docs/IDAUTO_FIXPERT_INTEGRATION.md` | `docs/FIXPERT_INTEGRATION.md` |
| `docs/IDA3_INGESTION_ARCHITECTURE.md` | `docs/INGESTION_ARCHITECTURE.md` |
| `docs/IDAUTO_ROADMAP.md` | `docs/ROADMAP.md` (rewritten, extended to IDA-9) |
| `docs/IDAUTO_STORAGE_RUNBOOK.md` | `ops/runbooks/STORAGE_RUNBOOK.md` |
| `docs/IDAUTO_TEST_RUNBOOK.md` | `ops/runbooks/TEST_RUNBOOK.md` |
| `docs/OFF_HOST_BACKUP_GATE.md` (ID Auto scope) | `ops/runbooks/OFF_HOST_BACKUP_GATE.md` |
| ID Auto rows of `docs/AUTOMOTIVE_RISK_REGISTER.md` | `docs/RISK_REGISTER.md` |
| ID Auto decisions in `docs/MYTHOS_IDENTITY_ARCHITECTURE.md` | `docs/IDENTITY_ARCHITECTURE.md` |
| ID Auto entries of `docs/AI_HANDOVER.md` | `docs/AI_HANDOVER.md` — 30 sections, **verbatim** |

At the time this table was written, everything above still also existed here, as duplicates
of the canonical source, kept only because of the blocker described in §3. That blocker is
now resolved and the duplicated copies have been removed by IDA-DECOUPLE-4 — see §3 and §4.
This table remains as the historical record of where each file went.

## 3. Why the source could not be deleted at first — and how the blocker was cleared

The migration audit recorded *"Class A — required external dependency: **None**"*. That was
measured in one direction only: every `require()` **inside** the migrated tree. **The reverse
direction was never measured**, and it was not empty. Full analysis:
[`docs/ID_AUTO_DEPENDENCY_BOUNDARY.md`](ID_AUTO_DEPENDENCY_BOUNDARY.md).

### Resolved — the runtime coupling is gone

| Was | Resolved by |
|---|---|
| `projects/personal-intelligence/cli/*.js` (3 files) → `../../idauto/node_modules/pg` | **IDA-DECOUPLE-1** (`6e2dfaa`) — MPI has its own `package.json` declaring `pg`; the CLIs `require('pg')` |
| `projects/automation/reference/backup-operations-orchestrator.js:41` → `../../idauto/ops/offhost-backup.js`, plus the `reuses_module` literal at 649/667 | **IDA-DECOUPLE-2** — module moved to `projects/infrastructure/ops/offhost-backup.js`; both literals updated |
| `projects/personal-intelligence/cli/mpi-ingest-cli.js:46` and `mpi-retrieve-cli.js:37` → `../../idauto/ops/adapters/s3-compatible.js` | **IDA-DECOUPLE-2** — module moved to `projects/infrastructure/ops/adapters/s3-compatible.js` |

Both moves were true `git mv` operations with byte-identical contents, not copies. **No
Mythos runtime file resolves any path inside `projects/idauto/` any more.**

### Resolved — the last blocker: the identity contract test

| Blocker | Kind |
|---|---|
| `tests/mythos-identity-core-0-contract-test.js` read `projects/idauto/database/schema.sql` and `reference/identity.js` | **Test.** Mythos-core's identity contract was validated **against ID Auto as its reference consumer** — the platform adopted ID Auto's `actor_type` vocabulary verbatim, so ID Auto was the source, not a copy |

Measured before the decoupling work: deleting `projects/idauto/` took
`inf-backup-auto-0-backup` (245), `mpi-2h-events` (16) and `mythos-identity-core-0-contract`
(124) from clean to hard error. Re-measured after IDA-DECOUPLE-1 and -2, the first two were
already free of the coupling; the third was not. **IDA-DECOUPLE-3 resolved it**: IDauto
publishes three versioned vocabulary artifacts (`actor-type.v1.json`, `org-role.v1.json`,
`actor-identifier.v1.json`), and Mythos consumes digest-pinned copies at
`projects/mythos-core/contracts/idauto/` instead of reading the source tree directly. The
contract suite now resolves nothing under `projects/idauto/` — verified by its own §14
"boundary" assertions — and passes 157/0 against the pinned artifacts alone.

### Removed — IDA-DECOUPLE-4 (2026-08-19, this commit)

With the runtime coupling gone (IDA-DECOUPLE-1/2) and the last test dependency replaced by
pinned artifacts (IDA-DECOUPLE-3), nothing in this repository needed `projects/idauto/` any
more. **IDA-DECOUPLE-4 removed it**, along with its own test suites (`tests/ida-2*.js`,
`tests/ida-3a..3e-*.js`, `tests/idauto-storage-ops-test.js`,
`tests/devx-1-idauto-test-impact-test.js`) and the eight duplicated `docs/IDAUTO_*.md` files.

`tests/ida-3f-offhost-backup-test.js` was **kept** — despite the `ida-` name, it tests the
Mythos-owned infrastructure modules at `projects/infrastructure/ops/` (moved there by
IDA-DECOUPLE-2), not anything under `projects/idauto/`. It contains no reference to
`projects/idauto` and continues to pass 35/0.

DEVX-1's one general (non-IDauto) safeguard — "no test-impact-map rule references a
nonexistent test path" — was preserved as a new standalone suite,
`tests/devx-2-impact-map-integrity-test.js`, so that guarantee did not disappear along with
the 31 IDauto-specific assertions that made up the rest of that suite.

## 4. What has been removed

`migration-staging/` — 92 files. It was a transient snapshot of the standalone tree, created
solely so the validated work would survive an ephemeral environment until the repository
existed. It has served that purpose, nothing references it, and its content now lives at
`bdfec2c` in `othoth77/idauto`.

**As of IDA-DECOUPLE-4 (2026-08-19), also removed:**
`projects/idauto/` in full (source, reference implementation, database schema/migrations,
ops modules, config), its own test suites (`tests/ida-2*.js`, `tests/ida-3a..3e-*.js`,
`tests/idauto-storage-ops-test.js`, `tests/devx-1-idauto-test-impact-test.js`), and the eight
duplicated docs (`docs/IDAUTO_ARCHITECTURE.md`, `docs/IDAUTO_CAPTURE_PIPELINE.md`,
`docs/IDAUTO_FIXPERT_INTEGRATION.md`, `docs/IDAUTO_PRODUCT_SPEC.md`, `docs/IDAUTO_ROADMAP.md`,
`docs/IDAUTO_STORAGE_RUNBOOK.md`, `docs/IDAUTO_TEST_RUNBOOK.md`,
`docs/IDA3_INGESTION_ARCHITECTURE.md`). All of it lives on, unabridged, at `bdfec2c` and later
in `othoth77/idauto`.

## 5. What stays, and why

| Kept | Why |
|---|---|
| `tests/ida-3f-offhost-backup-test.js` | Tests the Mythos-owned infrastructure modules at `projects/infrastructure/ops/` (relocated there by IDA-DECOUPLE-2), not `projects/idauto/`. The `ida-` name is historical; the suite contains no reference to `projects/idauto` and passes 35/0 |
| `tests/devx-2-impact-map-integrity-test.js` | New in IDA-DECOUPLE-4. Preserves DEVX-1's one general, non-IDauto safeguard ("no impact-map rule references a nonexistent test path") as a standalone suite |
| `projects/mythos-core/contracts/idauto/` | The pinned protocol artifacts (IDA-DECOUPLE-3) — the whole point of the boundary. Mythos's identity contract validates against these, not the source tree |
| `docs/IDAUTO_STANDALONE_MIGRATION.md` (this file) | The migration pointer and historical record |
| ID Auto entries in `docs/AI_HANDOVER.md` | The record of work done **in this repository**. Their commit hashes resolve only here |
| ID Auto references in `docs/CHANGELOG.md`, `docs/PROJECT_HISTORY.md`, `docs/history/DAILY_HISTORY.md` | History, not duplication |
| ID Auto rows in `docs/AUTOMOTIVE_*.md` | Portfolio-level context; ID Auto is one product in the Automotive track |
| `docs/OFF_HOST_BACKUP_GATE.md` | Covers three production databases, of which `idauto` is one. Mythos infrastructure |
| `projects/meta/project-ledger.json`, `project-statistics.json` ID Auto entries | Dated, commit-stamped records of past stages. History, not live pointers |
| The `id-auto` track in `projects/meta/portfolio-registry.json` | **Updated to historical, not deleted** — other tracks legitimately declare a dependency on the product, and `projects/idauto/` is now recorded as a former (removed) path pointing at the canonical repository |

## 6. Integration boundaries

| Integration | Effect of the move |
|---|---|
| `projects/automation` → `idauto/ops/offhost-backup.js` | **RESOLVED** — IDA-DECOUPLE-2 |
| `projects/personal-intelligence` → `idauto/ops/adapters/`, `idauto/node_modules/pg` | **RESOLVED** — IDA-DECOUPLE-1 and -2 |
| Mythos-core identity contract → ID Auto schema and `identity.js` | **RESOLVED** — IDA-DECOUPLE-3 (pinned protocol artifacts); source tree removed by IDA-DECOUPLE-4 |
| Atelier Network work-order `vehicle_id` | None — documentation-level; ATN-1 is not implemented |
| Fixpert Smart Gate | None — IDA-6 in the new roadmap, not implemented |
| Live `idauto-postgres` database and media store | **None.** The schema is unchanged, so a deployment repoints at the new repository. No data migration was required and none was performed |

## 7. Status of the product

A canonical repository is not a finished product. As at the move:

- IDA-0 … IDA-3F complete; **IDA-2E (real authentication) BLOCKED**, re-scoped to IDA-7 on
  W3C DID/VC primitives
- IDA-3G / 3H / 3I not started
- 15 **LEGAL-REVIEW-REQUIRED** items open
- `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT`: **NO**
- Nothing deployed; no public ID Auto endpoint exists

Current status is tracked in
[`docs/ROADMAP.md`](https://github.com/othoth77/idauto/blob/main/docs/ROADMAP.md) there, not
here.
