# ID Auto — standalone repository migration

**Date:** 2026-08-18
**Status:** standalone repository **built and validated**; **publication BLOCKED**;
source-repository cleanup **PREPARED, NOT EXECUTED**
**New home:** `othoth77/idauto` — *does not exist yet, see §3*

---

## 1. What happened

ID Auto has been extracted from this repository into a standalone repository and
repositioned as an open vehicle identity and history protocol (IDauto).

**Nothing has been removed from `othoth77/mythos-prod`.** `projects/idauto/`,
`docs/IDAUTO_*.md`, `docs/IDA3_INGESTION_ARCHITECTURE.md` and `tests/ida-*.js` are all
untouched and remain authoritative until the standalone repository is published and
verified.

The complete standalone content is staged at `migration-staging/idauto-standalone/` on this
branch, purely so the work survives an ephemeral working environment. See
`migration-staging/README.md`.

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

## 3. Why publication is blocked

`othoth77/idauto` does not exist. This session's GitHub integration cannot create it:

```
POST /user/repos → 403 Resource not accessible by integration
```

Repository creation requires an account-administration permission the integration does not
hold. **Owner action required:**

1. Create an **empty** public repository `othoth77/idauto` — no README, no `.gitignore`, no
   licence, so the migrated tree is authoritative.
2. Grant the working session access to it.

Nothing else is outstanding. The content is finished and validated.

## 4. Source-repository cleanup — PREPARED, NOT EXECUTED

This is deliberately a **separate, later** change, and it must not be started before the
standalone repository is published and verified. Until then, deleting from here would leave
the project with one snapshot and no Git history.

### 4.1 To be removed, once and only once `othoth77/idauto` is live

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
