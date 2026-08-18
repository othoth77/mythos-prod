# ID Auto has moved — and this repository still imports it

**Canonical repository → https://github.com/othoth77/idauto**

ID Auto was extracted on **2026-08-18** and repositioned as **IDauto — an open vehicle
identity and history protocol**. That repository is canonical: `main` = `bdfec2c`, 91 files,
verified from a clean clone (13 suites, 601 assertions, 0 failures). **Develop ID Auto
there, not here.**

> **The duplicated source in `projects/idauto/` has NOT been removed, deliberately.**
> Three Mythos projects `require()` it at runtime. Removing it breaks them. See §3 — that is
> the open decision, and it is the owner's, not this migration's.

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

Everything above still also exists here. The copies here are now **duplicates of a canonical
source elsewhere**, kept only because of §3.

## 3. Why the source cannot be deleted yet — the blocker

The migration audit recorded *"Class A — required external dependency: **None**"*. That was
measured in one direction only: every `require()` **inside** the migrated tree resolves to a
Node built-in, `pg`, or a path within it. **The reverse direction was never measured**, and
it is not empty. Mythos code imports ID Auto:

| Importer | Imports | Kind |
|---|---|---|
| `projects/automation/reference/backup-operations-orchestrator.js:41` | `../../idauto/ops/offhost-backup.js` | **Hard `require()`.** Line 20 states the module is "REQUIRED from here, never" duplicated; lines 649/667 assert `reuses_module === 'projects/idauto/ops/offhost-backup.js'` |
| `projects/personal-intelligence/cli/mpi-ingest-cli.js:46` | `../../idauto/ops/adapters/s3-compatible.js` | **Hard `require()`** |
| `projects/personal-intelligence/cli/mpi-retrieve-cli.js:37` | `../../idauto/ops/adapters/s3-compatible.js` | **Hard `require()`** |
| `projects/personal-intelligence/cli/*.js` (3 files) | `../../idauto/node_modules/pg` | **Hard `require()`** into ID Auto's *installed dependency directory* |
| `tests/mythos-identity-core-0-contract-test.js` | reads `projects/idauto/database/schema.sql` and `reference/identity.js` | Mythos-core's identity contract is validated **against ID Auto as its reference consumer** |
| `tests/inf-backup-auto-0-backup-test.js:383` | asserts the orchestrator's `reuses_module` path | |
| `tests/mpi-activation-test.js:90` | resolves `projects/idauto/node_modules/pg` | |

Measured, not predicted: deleting `projects/idauto/` takes
`inf-backup-auto-0-backup-test` (245 → error), `mpi-2h-events-test` (16 → error) and
`mythos-identity-core-0-contract-test` (124 → error) from clean to failing. Several other
MPI suites already fail on `idauto/node_modules/pg` **before** any deletion — a pre-existing
fragility, not caused by this work, and further evidence that the coupling is real.

Resolving this means choosing one of these, and it is an architectural decision:

1. **Relocate the shared modules.** `offhost-backup.js` and `s3-compatible.js` are generic
   infrastructure that ended up under `projects/idauto/` for historical reasons. Move them to
   a Mythos-owned home (`projects/infrastructure/` or `projects/automation/`), and let IDauto
   keep its own copy. Cleanest; touches two Mythos projects.
2. **Vendor them into each consumer.** Duplicates code the orchestrator explicitly says must
   not be duplicated. Rejected unless (1) is impossible.
3. **Depend on the published package.** IDauto is not published to a registry, and adding a
   cross-repository dependency for two files is disproportionate.
4. **Keep `projects/idauto/` indefinitely as a vendored copy.** Honest but guarantees drift.

Until one is chosen, `projects/idauto/`, `tests/ida-*.js`,
`tests/devx-1-idauto-test-impact-test.js` and `docs/IDAUTO_*.md` all stay. They are coupled:
DEVX-1 reads `docs/IDAUTO_TEST_RUNBOOK.md` and the ID Auto sources, and the impact-map rules
point at the `ida-*` suites, so removing any one of them alone breaks the others.

## 4. What has been removed

Only `migration-staging/` — 92 files. It was a transient snapshot of the standalone tree,
created solely so the validated work would survive an ephemeral environment until the
repository existed. It has served that purpose, nothing references it, and its content now
lives at `bdfec2c` in `othoth77/idauto`.

## 5. What stays, and why

| Kept | Why |
|---|---|
| `projects/idauto/**`, `tests/ida-*.js`, `docs/IDAUTO_*.md` | §3 — Mythos imports them |
| ID Auto entries in `docs/AI_HANDOVER.md` | The record of work done **in this repository**. Their commit hashes resolve only here |
| ID Auto references in `docs/CHANGELOG.md`, `docs/PROJECT_HISTORY.md`, `docs/history/DAILY_HISTORY.md` | History, not duplication |
| ID Auto rows in `docs/AUTOMOTIVE_*.md` | Portfolio-level context; ID Auto is one product in the Automotive track |
| `docs/OFF_HOST_BACKUP_GATE.md` | Covers three production databases, of which `idauto` is one. Mythos infrastructure |
| `projects/meta/project-ledger.json`, `project-statistics.json` ID Auto entries | Dated, commit-stamped records of past stages. History, not live pointers |
| The `id-auto` track in `projects/meta/portfolio-registry.json` | **Updated, not deleted** — other tracks legitimately declare a dependency on the product |

## 6. Integration boundaries

| Integration | Effect of the move |
|---|---|
| `projects/automation` → `idauto/ops/offhost-backup.js` | **BLOCKING — see §3** |
| `projects/personal-intelligence` → `idauto/ops/adapters/`, `idauto/node_modules/pg` | **BLOCKING — see §3** |
| Mythos-core identity contract → ID Auto schema and `identity.js` | **BLOCKING — see §3** |
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
