# ID Auto — standalone repository migration

**Date:** 2026-08-18
**Status:** standalone repository **PUBLISHED and CLEAN-CLONE VERIFIED**;
source-repository cleanup **prepared as a separate draft PR, NOT MERGED**
**New home:** https://github.com/othoth77/idauto — `main` = `bdfec2c`, 91 files

---

## 1. What happened

ID Auto has been extracted from this repository into a standalone repository and
repositioned as an open vehicle identity and history protocol (IDauto).

**Nothing is removed from `othoth77/mythos-prod` by this branch.** `projects/idauto/`,
`docs/IDAUTO_*.md`, `docs/IDA3_INGESTION_ARCHITECTURE.md` and `tests/ida-*.js` are all still
here. Removing them is the separate draft cleanup PR described in §4.

`migration-staging/idauto-standalone/` on this branch has served its purpose — it existed
only so the validated tree would survive an ephemeral working environment until the
repository existed. The cleanup PR deletes it.

## 1a. Correction applied 2026-08-18 — revision 2

The first pass of this migration reported **IDA-3F as BLOCKED with no off-host copy in
existence**, carried over from the 2026-08-12 stage entries without scanning forward. A
completeness audit corrected it: the off-host gate **closed on 2026-08-14**
(`docs/OFF_HOST_BACKUP_GATE.md` §6), and `docs/AI_HANDOVER.md` had already flagged the stale
statuses this migration then inherited — including that same runbook's header still reading
"PREPARED · BLOCKED" against its own §6.

The audit also recovered four artefacts the first pass missed: five superseding handover
entries, the ID Auto risk register rows, the off-host backup runbook, and the ID Auto
identity-architecture decisions. Details in
`migration-staging/idauto-standalone/docs/STANDALONE_MIGRATION_AUDIT.md` §10.

**This does not resolve the stale statuses in this repository.** They remain as they were —
`projects/meta/project-ledger.json` and the `OFF_HOST_BACKUP_GATE.md` header each still need
their own order, exactly as `docs/AI_HANDOVER.md` records. The correction was applied to the
standalone tree only.

## 2. What was migrated, and what it was validated against

| | |
|---|---|
| Files migrated | 91 |
| Origin baseline | `5e2011b` (`main`) |
| Test result in the new layout | **601 assertions, 0 failures**, 13 suites, live PostgreSQL 16 |
| Schema | 24 tables, applies cleanly; `ida-3a` migration idempotent against it |
| Owner-PII columns introduced | **0** — re-verified against the applied schema |
| Secrets migrated | **None** |
| Real vehicle data migrated | **None** (synthetic seed only) |
| Defects found by the migration | 1, fixed — `ops/` computed the repository root at the old nesting depth, which would have mis-pointed a restore safety guard |

Full inventory, path mapping, and the A/B/C/D dependency classification:
`migration-staging/idauto-standalone/docs/MIGRATION_FROM_MYTHOS_PROD.md`.
Full validation evidence:
`migration-staging/idauto-standalone/docs/STANDALONE_MIGRATION_AUDIT.md`.

## 3. Publication — DONE (2026-08-18)

The owner created `othoth77/idauto` and the audited tree was pushed to it verbatim as the
repository's initial commit. It was then verified from a **clean clone** — deliberately not
from the working tree it was built in.

| | |
|---|---|
| Repository | https://github.com/othoth77/idauto |
| `main` | `bdfec2ce247f479155e920fd8156e8c94d5a6d49` (tree `26b93fb80acf6bfbe09f925fb95862b947dac035`) |
| Files | 91 |
| Clean-clone tests | **13 suites · 601 assertions · 0 failures** |

Clean-clone procedure: fresh `git clone` into an empty directory → `npm install` from the
published lockfile → a **newly created** PostgreSQL 16 database and role → schema +
IDA-3A migration + synthetic seed → all 13 suites live. Commit and tree hashes matched, all
91 files were byte-identical to the audited tree, 45/45 origin file pairs were present,
0 `projects/idauto` and 0 `mythos-prod` references remained in code, 0 external imports
beyond Node built-ins and `pg`, no secrets, and 0 owner-PII columns on any vehicle, plate,
observation, fact, evidence or movement table.

Status record: `othoth77/idauto` PR #1 (draft) and that repository's
`docs/STANDALONE_MIGRATION_AUDIT.md` §11.

**`othoth77/idauto` is now the canonical home of IDauto.** This repository still holds the
duplicated source until the cleanup PR in §4 is merged.

### The earlier blocker, for the record

Publication was blocked for roughly five hours because this session's GitHub integration
could not create the repository — `POST /user/repos` returned
`403 Resource not accessible by integration`, which needs an account-administration
permission the integration does not hold. It was cleared by the owner creating the empty
repository. Nothing about the migration itself had to change.

## 4. Source-repository cleanup — the separate draft PR

Deliberately a **separate** change, gated on publication and clean-clone verification — both
now done (§3). It is opened as a **draft** and is not merged automatically.

### 4.1 Removed by the cleanup PR

| Path | Files |
|---|---|
| `projects/idauto/**` | 25 |
| `tests/ida-2*.js`, `tests/ida-3*.js`, `tests/idauto-storage-ops-test.js` | 13 |
| `docs/IDAUTO_PRODUCT_SPEC.md`, `IDAUTO_ARCHITECTURE.md`, `IDAUTO_CAPTURE_PIPELINE.md`, `IDAUTO_FIXPERT_INTEGRATION.md`, `IDAUTO_ROADMAP.md`, `IDAUTO_STORAGE_RUNBOOK.md`, `IDAUTO_TEST_RUNBOOK.md`, `IDA3_INGESTION_ARCHITECTURE.md` | 8 |
| `migration-staging/**` | the whole staging directory |

### 4.2 To be kept

| What | Why |
|---|---|
| `docs/IDAUTO_STANDALONE_MIGRATION.md` (this file, reduced to a pointer) | So anyone landing here from a link or a search finds the new home |
| ID Auto entries in `docs/AI_HANDOVER.md` | Historical record of work done in **this** repository. The commit hashes are only resolvable here |
| ID Auto references in `docs/CHANGELOG.md`, `docs/PROJECT_HISTORY.md`, `docs/history/DAILY_HISTORY.md` | Same reason |
| `tests/devx-1-idauto-test-impact-test.js` | Tests **Mythos** test-impact tooling, not ID Auto |
| ID Auto entries in `docs/AUTOMOTIVE_*.md` | Portfolio-level context; ID Auto is one product among several |
| `projects/meta/*.json` registry entries | To be **updated** to point at the new repository, not deleted |

### 4.3 Integrations to check before removing anything

Verified as of this document; re-verify at execution time:

| Integration | Direction | Breaks on removal? |
|---|---|---|
| `projects/meta/test-impact-map.json` → ID Auto suites | Mythos → ID Auto | **Yes** — must be updated in the same change |
| `tests/devx-1-idauto-test-impact-test.js` | Mythos → ID Auto | **Yes** — asserts against the impact map; update together |
| Atelier Network work-order `vehicle_id` references | ATN → ID Auto | No — documentation-level only; ATN-1 is not implemented |
| Fixpert Smart Gate | Fixpert → ID Auto | No — IDA-6, not implemented |
| `mythos_core` identity contract | ID Auto → Mythos | No — never implemented; the standalone answer is IDA-7 |
| Live `idauto-postgres` database and media store | Runtime | **No — unaffected.** The schema is unchanged, so a running deployment simply repoints at the new repository. No data migration is required and none was performed |

### 4.4 Execution order

1. `othoth77/idauto` created and the migrated tree pushed.
2. Standalone PR opened as a draft and reviewed.
3. An independent verification that the standalone repository builds and its suites pass
   from a clean clone.
4. **Only then**: a separate PR here performing §4.1 and §4.2 together, including the
   `projects/meta/` registry updates and the DEVX-1 impact-map change.

## 5. Intended standalone PR

To be opened in `othoth77/idauto` as a **draft**, once the repository exists:

> **Title:** Standalone ID Auto repository + Open Vehicle Identity Protocol

The body is the migration summary, source baseline, strategic evolution, architecture
changes, protocol direction, security and privacy decisions, blockchain position,
open-source strategy, validation results, known blockers, legal-review items, and what
remains planned — drawn from
`migration-staging/idauto-standalone/docs/STANDALONE_MIGRATION_AUDIT.md` and
`.../docs/ROADMAP_EVOLUTION_2026-08-18.md`.

## 6. Status carried forward, unchanged

The migration changed no stage status. As at the origin baseline:

- IDA-0, IDA-1, IDA-2 (with IDA-2E blocked), IDA-3A–3E: complete
- IDA-3F: **EXECUTED and restore-verified 2026-08-14** — batch `20260814T161856Z`; the
  off-host backup gate is **CLOSED**. No schedule exists, and the batch ages daily
- IDA-3G/H/I: not started
- 15 LEGAL-REVIEW-REQUIRED items: open
- `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT`: **NO**
- Nothing deployed; no public ID Auto endpoint exists
