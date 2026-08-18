# ID Auto ↔ Mythos — dependency boundary audit

**Date:** 2026-08-18 · **Type:** audit, now with an implementation record (§0).
**Repository:** `othoth77/mythos-prod`, branch `claude/idauto-source-cleanup-post-publication`
— audited at `adaf55e`, implemented through `IDA-DECOUPLE-2`
**Counterpart:** `othoth77/idauto` @ `bdfec2c` — canonical, clean-clone verified
(13 suites, 601 assertions, 0 failures). **Untouched by any of this work.**

**Why this exists.** The standalone migration audit recorded *"Class A — required external
dependency: **None**"*. That was measured in one direction only — every `require()` **inside**
the migrated tree. The reverse direction was never measured. PR #16 found it is not empty:
Mythos imports ID Auto at runtime, so `projects/idauto/` cannot be deleted. This document
maps every such dependency, classifies ownership, and proposes the smallest safe migration.

---

## 0. Status — what has actually been done

The audit below was written before any change. **Steps 1–3 of §5 are now complete.** The
matrix and the migration table carry per-row status; this section is the summary.

| Stage | Change | Commit | Result |
|---|---|---|---|
| **IDA-DECOUPLE-1** | MPI declares and resolves its own `pg` (D5, D10) | `6e2dfaa` | ✅ **DONE** — all 22 MPI suites 544/0; five had been aborting |
| **IDA-DECOUPLE-2** | `offhost-backup.js` and `s3-compatible.js` moved to `projects/infrastructure/ops/` (D1–D4, D9) | — | ✅ **DONE** — true `git mv`, byte-identical, consumers and path assertions updated |
| **IDA-DECOUPLE-3** | Split the identity-core contract test (D6, D7, D8) | *this stage* | ✅ **DONE** — ID Auto published the three vocabulary artifacts (`protocol/vocabularies/{actor-type,org-role,actor-identifier}.v1.json`, commit `42e8546`, branch `protocol-identity-vocabularies`) with its own conformance suite (`identity-conformance-test.js`, 77/0, 7/7 planted mutations caught). Mythos now consumes pinned, digest-verified copies under `projects/mythos-core/contracts/idauto/` — no read of `projects/idauto/` remains anywhere in this suite. |
| IDA-DECOUPLE-4 | Delete `projects/idauto/**` and its suites and docs (D11, D12) | — | **NOT STARTED** — blocked only on the owner's go-ahead; nothing technical remains |

**The acceptance condition of IDA-DECOUPLE-2 is met: zero Mythos runtime files resolve any
path inside `projects/idauto/`.** Verified by exhaustive search — no `require()` or import of
anything under `projects/idauto/` exists in any `.js` file outside `projects/idauto/` and
outside `tests/`.

**As of IDA-DECOUPLE-3, the last test-time coupling is gone too.** `grep -c "projects/idauto"
tests/mythos-identity-core-0-contract-test.js` is **0**. What remains reaching into
`projects/idauto/` is exclusively the two suites whose whole purpose is to test-that-source, and
they are deletable only together with it:

| | What | Class |
|---|---|---|
| ~~D6 / D7 / D8~~ | ~~`tests/mythos-identity-core-0-contract-test.js` reads `database/schema.sql` and `reference/identity.js`~~ | **RESOLVED** — see §10.6 |
| **D11** | `tests/devx-1-idauto-test-impact-test.js` asserts the ID Auto rules in the impact map | goes with the source |
| **D12** | `tests/ida-*.js`, `tests/idauto-storage-ops-test.js` | ID Auto's own duplicated suites; go with the source |

**`projects/idauto/` deletion (step 5, IDA-DECOUPLE-4) is now blocked only on the owner's
go-ahead — nothing technical stands in the way any more.**

Note `tests/ida-3f-offhost-backup-test.js` is no longer in D12's position: it tests the two
relocated modules, so it now points at `projects/infrastructure/ops/` and is a **Mythos**
suite that happens to retain an `ida-` name. Renaming it is deliberately not done here — the
name is referenced by the impact map, the ledger and the runbooks, and a rename is churn in a
risky diff.

---

## 1. Current dependency graph

```
                    ┌─────────────────────────────────────────┐
                    │  projects/idauto/          (DUPLICATE —  │
                    │                       canonical copy is  │
                    │                       othoth77/idauto)   │
                    │                                          │
   ┌───────────────►│  ops/offhost-backup.js        494 lines  │
   │  require()     │  ops/adapters/s3-compatible.js 264 lines │◄────────┐
   │                │  node_modules/pg                         │◄──────┐ │
   │                │  database/schema.sql                     │◄────┐ │ │
   │                │  reference/identity.js                   │◄──┐ │ │ │
   │                └─────────────────────────────────────────┘   │ │ │ │
   │                                                              │ │ │ │
┌──┴──────────────────────────┐  ┌────────────────────────────────┴─┴─┴─┴──┐
│ projects/automation/        │  │ tests/                                   │
│   backup-operations-        │  │   mythos-identity-core-0-contract-test   │
│   orchestrator.js:41        │  │   inf-backup-auto-0-backup-test:383      │
│                             │  │   mpi-activation-test:90                 │
│ "THIS MODULE OWNS NO BACKUP │  │   devx-1-idauto-test-impact-test (whole) │
│  LOGIC … REQUIRED from here,│  │   ida-*.js (13 suites — ID Auto's own)    │
│  never reimplemented"       │  └──────────────────────────────────────────┘
└─────────────────────────────┘
┌─────────────────────────────┐
│ projects/personal-          │
│ intelligence/cli/           │
│   mpi-ingest-cli.js:46   ───┼──► s3-compatible.js
│   mpi-retrieve-cli.js:37 ───┼──► s3-compatible.js
│   mpi-ingest-cli.js:185  ───┼──► node_modules/pg
│   mpi-retrieve-cli.js:109───┼──► node_modules/pg
│   mpi-runtime-cli.js:90  ───┼──► node_modules/pg
└─────────────────────────────┘
```

**Scale.** 42 files outside `projects/idauto/` mention `idauto` (225 occurrences). Of those,
**exactly 3 non-test source files** have a hard `require()`, and **5 test files** depend on ID
Auto paths. Everything else — 34 files — is comments, schema-name references
(`-- idauto.vehicles.vehicle_id — no FK`) or portfolio metadata, with **no coupling**.

---

## 2. Dependency matrix

### 2.1 Hard runtime dependencies

**✅ = resolved. Every row in this table is now resolved; see §0.**

| # | Consumer | File · line | Imported component | Kind | Why it is used | Move? | Destination | Risk |
|---|---|---|---|---|---|---|---|---|
| **D1** ✅ | `projects/automation` | `reference/backup-operations-orchestrator.js:41` | `ops/offhost-backup.js` | **RUNTIME** | Orchestrator is a *gate* in front of the backup tooling; its header states it "OWNS NO BACKUP LOGIC … REQUIRED from here, never reimplemented", citing `OFF_HOST_BACKUP_GATE.md` §0: a second mechanism "would create two backup paths with one set of guarantees between them" | **YES** | `projects/infrastructure/ops/offhost-backup.js` | **HIGH** — disaster-recovery path; the off-host gate closed 2026-08-14 on a verified batch |
| **D2** ✅ | `projects/automation` | same file, lines 649 & 667 | the **string** `'projects/idauto/ops/offhost-backup.js'` | **RUNTIME** | `buildBackupPlan()` records `reuses_module`, and a guard *refuses to proceed* unless it equals that literal path | **YES** (with D1) | same | **MEDIUM** — a path literal asserted twice; missing one leaves a guard that always refuses |
| **D3** ✅ | `projects/personal-intelligence` | `cli/mpi-ingest-cli.js:46` | `ops/adapters/s3-compatible.js` | **RUNTIME** | Content-addressed object storage for MPI ingestion | **YES** | `projects/infrastructure/ops/adapters/s3-compatible.js` | **MEDIUM** |
| **D4** ✅ | `projects/personal-intelligence` | `cli/mpi-retrieve-cli.js:37` | `ops/adapters/s3-compatible.js` | **RUNTIME** | Same, retrieval side | **YES** (with D3) | same | **MEDIUM** |
| **D5** ✅ | `projects/personal-intelligence` | `cli/mpi-ingest-cli.js:185`, `mpi-retrieve-cli.js:109`, `mpi-runtime-cli.js:90` | `node_modules/pg` | **RUNTIME** | The CLI composition roots need a `pg` module to inject; ID Auto is the only project that has one installed | **YES** | MPI's own `package.json` → plain `require('pg')` | **LOW** |

### 2.2 Test dependencies

| # | Consumer | Depends on | Kind | Why | Move? | Destination | Risk |
|---|---|---|---|---|---|---|---|
| **D6** | `tests/mythos-identity-core-0-contract-test.js` §8 | `database/schema.sql` — `idauto_audit_log` `actor_type` CHECK | **TEST** | Guards that the core contract's `ACTOR_TYPES` has not drifted from the live vocabulary. **The platform adopted ID Auto's vocabulary verbatim** — ID Auto is the source | **REFRAME** | A versioned shared-vocabulary artefact both sides pin | **MEDIUM** |
| **D7** | same, §12 | `schema.sql` column types | **TEST** | Asserts ID Auto's columns stay `VARCHAR(64)`, `SERIAL`, and that `mythos_org_ref` was not added | **YES — to IDauto** | Already covered by `docs/IDENTITY_ARCHITECTURE.md` §3/§7 there | **LOW** |
| **D8** | same, §12b | `reference/identity.js` | **TEST** | Asserts the identity stub gained no auth (`jwt.sign`, `bcrypt`, `passport`, …) | **YES — to IDauto** | Covered by `docs/IDENTITY_ARCHITECTURE.md` §2/§8 there | **LOW** |
| **D9** ✅ | `tests/inf-backup-auto-0-backup-test.js:383` | the `reuses_module` path literal | **TEST** | Asserts D2's guard value | Follows D1/D2 | — | **LOW** |
| **D10** ✅ | `tests/mpi-activation-test.js:90` | `projects/idauto/node_modules/pg` | **TEST** | Resolves a `pg` to inject | Follows D5 | — | **LOW** |
| **D11** | `tests/devx-1-idauto-test-impact-test.js` | whole file | **TEST** | Regression-tests the ID Auto rules in `test-impact-map.json`; 31 of 34 assertions read ID Auto files | **DELETE with the source** | — | **LOW** |
| **D12** | `tests/ida-*.js`, `tests/idauto-storage-ops-test.js` (13) | ID Auto's own modules | **TEST** | ID Auto's own suites, duplicated here | **DELETE with the source** | Canonical copies at `bdfec2c` | **NONE** |

### 2.3 Documentation-only — no action

34 files. `projects/command-center/reference/{api,auth,db,web/app}.js`,
`projects/ssangyong-autos/reference/{api,db,shop-ui}.js`,
`projects/mythos-os-console/reference/server.js` and
`projects/mythos-core/reference/identity-contract.js` reference ID Auto **only in comments**,
as the convention exemplar ("same no-framework `http` + `pg` shape as
`projects/idauto/reference/api.js`"). `projects/personal-intelligence/persistence/*.js`
likewise — its `activation.js` is *correctly decoupled* and takes `pg` by injection.

Schema and config files reference the **`idauto` PostgreSQL schema name**
(`-- idauto.vehicles.vehicle_id — no FK`) — a deliberate no-FK cross-schema convention, not
a code dependency. `projects/meta/*.json` holds dated historical records.

**None of these blocks anything.** Comments naming a moved file are stale-link debt, not
coupling; correcting them is optional tidying, not migration.

---

## 3. Ownership classification

| Class | Meaning | Members |
|---|---|---|
| **A — IDauto-owned infrastructure** | Belongs to IDauto; Mythos must not depend on it | `reference/**`, `database/schema.sql`, `config/`, `ops/media-ops.js`, `tests/ida-*.js` |
| **B — Mythos-owned infrastructure** | Generic; lives under `projects/idauto/` only by accident of history | **`ops/offhost-backup.js`**, **`ops/adapters/s3-compatible.js`**, and MPI's missing `pg` dependency |
| **C — Shared protocol / interface** | Both sides must agree; needs a versioned artefact | The `actor_type` vocabulary (`system · contributor · professional_user · admin · anonymous`) and the `actor_ref` format (`usr_<uuidv7>` / `svc_<name>`) |
| **D — Test / reference-only** | No runtime coupling | D7, D8, D11, D12, and all 34 documentation mentions |

### Why B is the right class for the two ops modules — measured

| | `offhost-backup.js` | `s3-compatible.js` |
|---|---|---|
| Lines | 494 | 264 |
| Occurrences of "idauto" | **1** | **1** |
| What that occurrence is | `LIVE_MEDIA = '/home/deploy/deployments/idauto-media'` — a default path | `DEFAULT_CONFIG = ~/.config/**mythos**/idauto-offhost.env` — a default path already under a *Mythos* directory |
| Domain concepts (vehicle, plate, observation, fact) | **0** | **0** |
| Imports | `fs`, `path`, `crypto`, `os` only | `fs`, `path`, `os`, `crypto`, `https` only |
| Non-Node dependencies | **none** | **none** |

Neither module knows anything about vehicles. `offhost-backup.js` is a provider-neutral
manifest/stage/push/verify/restore/retention core; `s3-compatible.js` is an AWS SigV4 S3
transport written against Node built-ins. They are **generic backup infrastructure that
happened to be built during IDA-3F**. The canonical IDauto copy already has the one
deployment path removed (env-driven), so it is *more* generic still.

---

## 4. Target architecture

**Today — ID Auto is a hidden dependency inside Mythos:**

```
projects/automation  ──require──►  projects/idauto/ops/offhost-backup.js
projects/personal-…  ──require──►  projects/idauto/ops/adapters/s3-compatible.js
projects/personal-…  ──require──►  projects/idauto/node_modules/pg
tests/identity-core  ──read────►  projects/idauto/{schema.sql, identity.js}
```

**Target — Mythos owns its infrastructure; IDauto consumes an interface:**

```
        projects/infrastructure/ops/          ← Mythos-owned
          offhost-backup.js
          adapters/s3-compatible.js
                    ▲          ▲
        require()   │          │   require()
   projects/automation      projects/personal-intelligence
                                   └─ package.json declares pg → require('pg')

        protocol/identity-vocabulary.json     ← shared, versioned (Class C)
                    ▲          ▲
        pinned by   │          │   pinned by
   mythos-core contract     IDauto

        othoth77/idauto  ← keeps its own copy of the ops modules;
                           no path in mythos-prod points into it
```

The essential property: **no Mythos file resolves a path inside `projects/idauto/`.** Once
that holds, the directory is deletable and the two repositories are independent.

### Destination choice

**Recommended: `projects/infrastructure/ops/`.** The semantic fit is exact, and the module
has *two independent consumers* (automation and personal-intelligence), so neither should own
it. Cost: `projects/infrastructure/` currently holds only Cloudflare/Coolify configuration —
this would be its first JavaScript, needing a `test-impact-map.json` rule and a test owner.

**Alternative: `projects/automation/reference/`.** Cheaper — automation already owns the
backup approval policy, the orchestrator and a test suite. But it makes personal-intelligence
depend on automation, which is a worse boundary than depending on shared infrastructure.

**Not recommended: `projects/mythos-core/`.** That holds shared *contracts*
(`identity-contract.js`, `identity-schema.sql`). Backup tooling is not a contract.

### The duplication this creates — stated plainly

After relocation there are **two copies** of each module: Mythos's and IDauto's. The
orchestrator's own rationale warns against exactly this — *"a second mechanism would create
two backup paths with one set of guarantees between them"*.

That warning was about **one deployment**, and it still holds inside each: Mythos has one
backup path, IDauto has one. What is new is **drift between repositories**.

- **Mitigation available today.** Both test suites pin **AWS's published SigV4 vector**
  (`ida-3f` test 29 reproduces the canonical-request hash and signature exactly). Any drift in
  the signing path is caught on both sides independently. That covers the highest-consequence
  surface — a silently wrong signature.
- **Eventual fix.** Publish the two modules as one small package both repositories depend on.
  Correct, but it needs a registry, a release process and versioning for ~750 lines. Premature
  now; the right target once either side changes them.

---

## 5. Migration order

Strictly ordered. Each step is independently verifiable and independently revertible.

| Step | Change | Unblocks | Risk | Evidence to require |
|---|---|---|---|---|
| **1** ✅ **DONE** (`6e2dfaa`, IDA-DECOUPLE-1) | Give `projects/personal-intelligence` a `package.json` declaring `pg`; CLIs `require('pg')` (D5, D10) | 5 MPI suites that **already fail today** | **LOW** — `activation.js` is unchanged; it already takes `pg` by injection and refuses without it | `mpi-activation`, `mpi-2h-cli`, `mpi-3-retrieval-cli`, `mpi-4-*` green |
| **2** ✅ **DONE** (IDA-DECOUPLE-2) | Move `s3-compatible.js` → `projects/infrastructure/ops/adapters/`; update D3, D4 | MPI ↛ ID Auto | **MEDIUM** | `mpi-2h-events` 16/16, `mpi-2h-cli`, `mpi-3-retrieval-cli` |
| **3** ✅ **DONE** (IDA-DECOUPLE-2, same commit as 2) | Move `offhost-backup.js` → `projects/infrastructure/ops/`; update D1 **and both path literals** in D2; update D9 | automation ↛ ID Auto | **HIGH** | `inf-backup-auto-0-backup` **245/245**; the `reuses_module` guard must still *refuse* a wrong value |
| **4** ✅ **DONE** (IDA-DECOUPLE-3) | Split the identity-core test: §8 now reads a pinned, digest-verified copy of ID Auto's published vocabulary artifacts (D6); §12/§12b deleted — the internal invariants they asserted are IDauto's own business, covered there by `tests/identity-conformance-test.js` (D7, D8) | mythos-core ↛ ID Auto | **MEDIUM** | `mythos-identity-core-0-contract` **125 → 157/0**, zero reads of `projects/idauto/` (`grep -c "projects/idauto"` on the suite is **0**) |
| **5** ⬜ | Delete `projects/idauto/**`, `tests/ida-*.js`, `tests/devx-1-idauto-test-impact-test.js`, `docs/IDAUTO_*.md`, `docs/IDA3_*.md`; remove the 15 ID Auto rules from `test-impact-map.json` | The cleanup PR #16 can complete | **MEDIUM** | Full suite; **0 dangling test references** in the impact map |

Steps 1–4 are prerequisites for 5. **Step 5 must not be attempted before them.** That was
measured before any of this work: deleting `projects/idauto/` then took
`inf-backup-auto-0-backup` (245), `mpi-2h-events` (16) and `mythos-identity-core-0-contract`
(124) from clean to hard error.

**Re-measured after steps 1–3.** Two of those three were free of the coupling —
`inf-backup-auto-0-backup` and `mpi-2h-events` no longer resolved anything under
`projects/idauto/`. `mythos-identity-core-0-contract` was still the one that would break, and
was the *only* suite standing between here and step 5.

**Re-measured again after step 4 (IDA-DECOUPLE-3).** `mythos-identity-core-0-contract` no
longer resolves anything under `projects/idauto/` either — see §10.6. All three suites listed
above are now free of the coupling, and deleting `projects/idauto/` (step 5) is blocked only on
the owner's authorisation, not on any remaining technical dependency.

---

## 6. Risks

| Risk | Severity | Note |
|---|---|---|
| **`offhost-backup.js` is the disaster-recovery path** | **HIGH** | The off-host gate closed 2026-08-14 on a verified batch (`20260814T161856Z`). Relocation must not disturb restore. Its own history is the warning: the default HTTPS transport had *never worked* while 30 tests passed, because every test injected a mock. **Re-verify against the real path, not the suite alone.** |
| The `reuses_module` guard is a **path literal asserted twice** | MEDIUM | Lines 649 and 667. Updating one and not the other leaves a guard that refuses every plan — fails closed, so loud rather than silent |
| Two copies of the ops modules after relocation | MEDIUM | **Now real, as of IDA-DECOUPLE-2.** Mythos's copy is at `projects/infrastructure/ops/`; IDauto's is at `ops/` in `othoth77/idauto`. Mitigated for the signing path by the AWS vector pinned on both sides (`ida-3f` test 29 here, `ida-3f` there). See §4 |
| `identity-core` §8 asserts against a **live** vocabulary | MEDIUM | Replacing it with a frozen fixture converts a drift *detector* into a drift *recorder*. A versioned artefact both sides pin keeps the detection |
| A stub instead of a real fixture makes assertions pass **vacuously** | MEDIUM | Measured: stubbing `idjs = ''` made 9 assertions fail — and **6 more pass vacuously** (`identity.js contains no jwt.sign` is trivially true of an empty string). A fixture must be real content, never empty |
| `projects/infrastructure/` gains its first JavaScript | ~~LOW~~ **DISCHARGED** | A `projects/infrastructure/ops/` rule was added to `test-impact-map.json` in the same commit (track `mythos-automation-operations`, `HIGH_RISK`, 5 targeted suites). DEVX-1 92/92 after |
| Losing DEVX-1 loses one **non**-ID-Auto safeguard | LOW | *"No rule references a nonexistent test path"* — exactly the failure mode step 5 risks. Verified by hand for PR #16 (0 dangling); worth re-adding as a small general test |
| 34 stale comment references after the move | LOW → **partly actioned** | The 11 that name the two moved modules by full path were corrected (`content-store.js`, `ROADMAP.md`, `OFF_HOST_BACKUP_GATE.md`, `AUTOMATION_ROADMAP.md`). The rest are *"follows the convention in `projects/idauto/reference/db.js`"* provenance notes in unrelated projects — accurate, and left alone |

---

## 7. Do not change yet

*(Steps 1–3 are done. This list is updated to what still holds.)*

- **Do not delete `projects/idauto/`** — step 4 first.
- **Do not touch `othoth77/idauto` `main`** (`bdfec2c`). It is canonical and clean-clone
  verified; the relocation was entirely a Mythos-side change.
- **Do not merge PR #16.**
- **Do not start IDA-4**, or any Blockchain / VC-DID / AI-Trust / Citizen-Passport work.
- **Do not rename `tests/ida-3f-offhost-backup-test.js`** as a tidy-up. It is now a Mythos
  suite by content, but its name is referenced by the impact map, `project-ledger.json` and
  the runbooks; renaming is churn for no safety gain. Do it, if at all, with step 5.
- **Do not treat the relocated modules as a shared package** without an explicit decision.
  Publishing them to a registry so both repositories depend on one copy is the eventual fix
  for the duplication (§4), and it is a separate architectural decision — not a refactor.
- **Do not widen `evidence_status`** in `portfolio-registry.json`. It is a closed enum
  (`REPOSITORY_VERIFIED` / `OWNER_DIRECTION` / `FUTURE_CONCEPT`) enforced by the governance
  suite, which already caught one invented value in this work.

### What IDA-DECOUPLE-2 did NOT verify — stated plainly

§6 records, as a **HIGH** risk, that `offhost-backup.js` is the disaster-recovery path and
warns: *"Re-verify against the real path, not the suite alone."* **That live re-verification
was not performed**, and nothing here should be read as claiming it was.

What *was* established instead:

- The move is a true `git mv` and the file contents are **byte-identical** — SHA-256
  `76891147…` for `offhost-backup.js` and `f8ed821f…` for `s3-compatible.js`, unchanged
  before and after.
- The only path-sensitive line in either module is `offhost-backup.js:313`,
  `path.resolve(__dirname, '../../..')` — the guard that refuses to restore inside the git
  repository. `projects/idauto/ops/` and `projects/infrastructure/ops/` are at **identical
  depth**, so it still resolves to the repository root. This was the specific defect the
  standalone migration found when the same file moved to a *different* depth, so it was
  checked first, not last.
- `ida-3f-offhost-backup` 35/35 and `inf-backup-auto-0-backup` 245/245 from the new location.

A live round-trip against real object storage remains an operator action, and is the right
gate before the next real backup runs.

---

## 8. Evidence

**§8.1 is the original read-only audit, executed at `adaf55e`. §8.2 is IDA-DECOUPLE-2's own
evidence.** Every number in both was executed, not inferred.

### 8.1 Audit evidence (at `adaf55e`, before any change)

| Check | Result |
|---|---|
| `grep` for `require(.*idauto)` outside `projects/idauto/` | **3** non-test source files; 13 test files |
| `idauto` mentions in `offhost-backup.js` / `s3-compatible.js` | **1 / 1**, both default paths; **0** domain concepts |
| Imports of those two modules | Node built-ins only |
| `mythos-identity-core-0-contract` intact | **124 passed, 0 failed** |
| Same, with the two ID Auto reads stubbed | **115 passed, 9 failed** — so exactly **9** assertions are ID Auto-dependent (plus 6 that pass vacuously) |
| `inf-backup-auto-0-backup` intact | **245 passed, 0 failed** |
| `mpi-2h-events` intact | **16 passed, 0 failed** |
| `devx-1-idauto-test-impact` intact | **92 passed, 0 failed** |
| `mpi-0-finalization-governance` | **36 passed, 0 failed** |
| `node scripts/project-intelligence.js validate` | **0 errors, 0 warnings** |
| Baseline: same suites with `projects/idauto/` deleted | `inf-backup-auto-0-backup`, `mpi-2h-events`, `mythos-identity-core-0-contract` → **hard error** |
| Pre-existing failures **not** caused by any of this | 5 MPI suites on `idauto/node_modules/pg`; `mcc-1`/`sya-*` on missing `pg`; `core-test`, `stage*-test`; `mythos-orchestration-core` 255/2 |

The probe that produced the 115/9 split ran against a **temporary copy** in `/tmp`, since
removed. No repository file was modified by that audit.

### 8.2 IDA-DECOUPLE-2 evidence

| Check | Result |
|---|---|
| Move method | `git mv` — recorded by git as **2 renames, 0 adds, 0 deletes**. No copy left behind |
| Byte identity | SHA-256 identical before/after: `76891147…` (`offhost-backup.js`), `f8ed821f…` (`s3-compatible.js`) |
| `require()`/import of anything under `projects/idauto/` from any non-test `.js` outside it | **0** — the acceptance condition |
| Consumers repointed | 3 — orchestrator (+ both `reuses_module` path literals), `mpi-ingest-cli.js`, `mpi-retrieve-cli.js` |
| Test path assertions repointed | `inf-backup-auto-0-backup` (3), `ida-3f-offhost-backup` (3) |
| Stale full-path references corrected | **11** across 4 files |
| Stale references remaining anywhere | **0** |
| `ida-3f-offhost-backup` | **35 / 0** — unchanged from baseline |
| `inf-backup-auto-0-backup` | **245 / 0** — unchanged |
| `mpi-2h-events` | **16 / 0** · `mpi-2h-cli` **24 / 0** · `mpi-3-retrieval-cli` **13 / 0** · `mpi-d3-content-store` **27 / 0** |
| `devx-1-idauto-test-impact` | **92 / 0** · `mythos-identity-core-0-contract` **124 / 0** · governance **89 / 0** · `mpi-0-finalization-governance` **36 / 0** |
| `node scripts/project-intelligence.js validate` | **0 errors, 0 warnings** |
| **Full Mythos suite** | 110 suites, **4877 assertions passed, 2 failed** |
| The 2 failures | `mythos-orchestration-core` 255/2 — **pre-existing** |
| Regression check | The 26 suites with non-zero exit were re-run against the pre-move tree via `git stash`. **Identical, one for one, before and after** — every failure reason matches (missing `pg` in uninstalled project `node_modules`, `_memCache`, browser-only `document`, the `stage3*` provider-error suites). **Zero regressions** |

---

## 9. Next implementation stage

**`IDA-DECOUPLE-3` — split the identity-core contract test** (step 4; D6, D7, D8).

`tests/mythos-identity-core-0-contract-test.js` is now the **only** thing standing between
this repository and step 5. It reads `projects/idauto/database/schema.sql` and
`reference/identity.js`.

The three parts are not equivalent and should not be treated as one edit:

- **§12 (D7) and §12b (D8)** assert that ID Auto's columns did not drift and that its identity
  stub gained no authentication. Both are **IDauto's** invariants, and both are already
  covered by `docs/IDENTITY_ARCHITECTURE.md` §2/§3/§7/§8 in `othoth77/idauto`. They can be
  dropped here.
- **§8 (D6) is different and must not simply be deleted.** It guards the core contract's
  `ACTOR_TYPES` against the live `idauto_audit_log` `actor_type` CHECK — the platform adopted
  ID Auto's vocabulary verbatim, so ID Auto is the *source*. Replacing it with a frozen copy
  turns a drift **detector** into a drift **recorder**. The right shape is a small versioned
  vocabulary artefact that both repositories pin.

**Measured constraint for whoever does it:** stubbing both reads leaves **115 passed, 9
failed** — and **6 further assertions pass vacuously** (*"identity.js contains no jwt.sign"*
is trivially true of an empty string). A fixture must be real content, never empty, or the
suite will report green while testing nothing.

Only after that does step 5 — deleting `projects/idauto/**` — become safe.

It needs an explicit authorisation. It is not started.

---

## 10. IDA-DECOUPLE-3 — the identity contract boundary

**Status: BLOCKED on an architectural decision. Reported, not implemented.**
One safe correction was made; the boundary itself was not, and the reason is below.

### 10.1 Measured classification of every IDauto-dependent assertion

Executed, not inferred: both reads stubbed to `''`, then diffed against the intact run
(124 → **115 passed / 9 failed**). Nine fail; **seven more keep passing but only vacuously**.
Sixteen assertions depend on IDauto in total.

| # | Assertion | Reads | Class |
|---|---|---|---|
| 1 | `live idauto_audit_log actor_type CHECK found` | `schema.sql` | **B — cross-product** |
| 2 | `ACTOR_TYPES == live vocabulary` | `schema.sql` | **B — the contract itself** |
| 3 | `idauto_contributors.mythos_user_id remains VARCHAR(64)` | `schema.sql` | **B — federation** |
| 4 | `idauto_user_roles.mythos_user_id remains VARCHAR(64)` | `schema.sql` | **B — federation** |
| 5 | `idauto_audit_log.actor_ref remains VARCHAR(64)` | `schema.sql` | **B — federation** |
| 6 | `live idauto_user_roles role set matches the contract` | `schema.sql` | **B — a SECOND shared vocabulary** |
| 7 | `idauto_organizations.id remains SERIAL` | `schema.sql` | **A — IDauto-internal** |
| 8 | `identity.js still exports resolveIdentity/clearIdentityCache` | `identity.js` | **A — IDauto-internal** |
| 9 | `identity.js still reads IDAUTO_ADMIN_IDENTITIES` | `identity.js` | **A — IDauto-internal** |
| 10 | `deferred mythos_org_ref was NOT added` | `schema.sql` | **A** — and **vacuous** under an empty stub |
| 11–16 | `identity.js contains no createSession / jwt.sign / bcrypt / passport / OAuth / hashPassword` (×6) | `identity.js` | **A** — and **vacuous** |

**The split is 6 cross-product / 3 internal among the failures — not 2 / 7.** Two corrections
to the working assumption this stage started from, both material:

- **`mythos_user_id` and `actor_ref` are not IDauto internals.** They are *Mythos's* identifiers
  living in IDauto's schema. `docs/MYTHOS_IDENTITY_ARCHITECTURE.md` §2 argues the whole
  `VARCHAR(64)` decision **from** those live columns — *"ID Auto's deployed columns are already
  `VARCHAR(64)` … choosing `BIGSERIAL` would force a type change on a live schema, including an
  append-only audit log."* Deleting rows 3–5 would discard the federation contract, not IDauto trivia.
- **There are two shared vocabularies, not one.** Besides `actor_type`, row 6 pins
  `idauto_user_roles.role` (`owner · admin · member · readonly`) against `EXPECTED_ORG_ROLES`.
  `MYTHOS_IDENTITY_ARCHITECTURE.md` §5 records it as copied **verbatim** from that live CHECK.
  Any boundary that covers only `actor_type` leaves half the contract unowned.

**Vacuity is 7, not 6** — the six `identity.js contains no …` plus `deferred mythos_org_ref was
NOT added`, which is trivially true of an empty string. A fixture must be real content.

### 10.2 The proposed boundary

The vocabularies are **IDauto's to define and Mythos's to adopt** — that direction is recorded
in `MYTHOS_IDENTITY_ARCHITECTURE.md` §5 and §12, and it is why a Mythos-owned copy cannot be
the source of truth. The smallest correct boundary is therefore:

```
IDauto  protocol/vocabularies/actor-type.v1.json   ← published, versioned, IDauto-owned
        protocol/vocabularies/org-role.v1.json
             ▲ IDauto's own suite asserts schema.sql CHECK == published artefact
             │
             ▼ Mythos pins {version, sha256}; contract test asserts ACTOR_TYPES == artefact
Mythos  projects/mythos-core/contracts/idauto-vocabularies.pinned.json
```

Drift then fails loudly from **either** direction, which is the requirement:

| Change | What fails |
|---|---|
| IDauto edits `schema.sql` without republishing | **IDauto's** suite — its CHECK no longer matches its own artefact |
| IDauto republishes a new version | Mythos's pinned digest mismatches — a deliberate, reviewable re-pin |
| Mythos edits `ACTOR_TYPES` | Mythos's contract test, immediately |

### 10.3 Why it was not implemented

**Both halves require changing `othoth77/idauto`, which this stage's own instruction says to
stop on rather than do.** Checked, not assumed:

- **IDauto's published protocol does not carry either vocabulary.**
  `protocol/schemas/` publishes `source_type`, verification status, trust levels `T0–T3` and
  access scope — and **no** `actor_type` and **no** org-role enum. The vocabulary exists only in
  `database/schema.sql`, which is precisely the internal file this stage is meant to stop
  reading. Publishing it **adds a new artefact to the IDauto public protocol surface.**
- **IDauto's own suite does not cover the three internal invariants**, nor the seven vacuous
  ones. There is no assertion anywhere in `othoth77/idauto/tests/` that `identity.js` lacks
  `jwt.sign`/`bcrypt`/`passport`, that `idauto_organizations.id` is still `SERIAL`, or that
  `mythos_org_ref` was never added. (`ida-3a` asserts `BIGSERIAL`/`VARCHAR(64)` on the
  *ingestion* tables — a different concern.) Moving rows 7–16 there means **writing new tests in
  the IDauto repository**, not relocating existing ones.

**A Mythos-only artefact was considered and rejected.** Pinning a provenance-stamped copy
inside Mythos would satisfy "no `projects/idauto` read" and would detect Mythos-side drift —
but IDauto-side drift would then be invisible until someone re-pinned by hand. Today the test
reads the live file, so that drift **is** caught. A Mythos-only pin would therefore *weaken*
the contract while appearing to formalise it, which is the false confidence this stage exists
to avoid. It is not offered as a fallback.

### 10.4 The decision the owner has to make

Publish the two vocabularies as versioned artefacts in `othoth77/idauto/protocol/`, and add the
IDauto-side conformance tests. That is a change to IDauto's **public protocol surface**, so it
belongs to whoever owns that surface. Once made, the Mythos side is small and mechanical: pin
the artefacts, repoint §8 and row 6, delete rows 7–16 as IDauto-owned, and
`projects/idauto/` becomes deletable.

Until then `tests/mythos-identity-core-0-contract-test.js` keeps reading the two files and
**`projects/idauto/` cannot be deleted.** That is a smaller blocker than it was — it is one
test, no runtime code — but it is a real one.

### 10.5 What WAS done — a real defect in the contract itself

The `actor_type` CHECK is declared **twice** in `schema.sql`: on `idauto_submissions` (line 383)
and on `idauto_audit_log` (line 910). The test's search was **unscoped**, so it matched
`idauto_submissions` first — *not* the table its own label names, and not the table
`MYTHOS_IDENTITY_ARCHITECTURE.md` §12 names as the source. The two agree today, so it passed;
it simply was not verifying what it claimed, and divergence in `idauto_audit_log` would have
gone unnoticed.

Fixed by scoping the search to the `idauto_audit_log` body, plus one new assertion that **every**
`actor_type` CHECK in the schema declares the same vocabulary — so the "platform-wide verbatim"
claim is now proven rather than assumed.

Proven by mutation, with `schema.sql` restored byte-identical afterwards:

| Mutation | Before the fix | After |
|---|---|---|
| `'root'` added to `idauto_audit_log`'s CHECK only | **silently passed** — wrong table read | **2 failures** |
| `'root'` added to `idauto_submissions`' CHECK only | passed | **1 failure** — the divergence guard |

Suite: **125 passed / 0 failed** (124 before; +1 is the new divergence assertion).

---

### 10.6 Implemented (2026-08-18, `IDA-DECOUPLE-3`)

The boundary described in §10.2 is now built. ID Auto published
`protocol/vocabularies/actor-type.v1.json`, `org-role.v1.json` and `actor-identifier.v1.json`
(branch `protocol-identity-vocabularies`, commit `42e8546`), each guarded by its own
conformance suite (`tests/identity-conformance-test.js`, 77 passed / 0 failed, 7/7 planted
mutations caught). Mythos pins digest-verified copies of the three files under
`projects/mythos-core/contracts/idauto/`, recorded in `PINS.json` (upstream commit, per-file
SHA-256, version, revision). `tests/mythos-identity-core-0-contract-test.js` §8 verifies every
digest before parsing anything, then asserts `ACTOR_TYPES`/`ORG_ROLES` against the pinned
content by sorted-set equality in both directions, with non-empty/unique/lowercase vacuity
guards on each side. §12 and §12b (the IDauto-internal invariants — `idauto_organizations.id`
SERIAL, the `identity.js` stub shape, `IDAUTO_ADMIN_IDENTITIES`) were deleted; those are now
IDauto's own business, asserted in its own conformance suite. A final §14 proves the suite's
own source contains no reference to the extracted `projects/idauto/` tree.

Result: **157 passed, 0 failed** (was 125), and `grep -c "projects/idauto"
tests/mythos-identity-core-0-contract-test.js` is **0**. Full re-pin procedure is documented in
`projects/mythos-core/contracts/idauto/README.md`; there is deliberately no script that
performs it, so a re-pin is always an authored, reviewed commit.

**Two corrections from the final architecture review, both material to §10.1 and §10.3 above.
The original text of both sections is left unedited above; these are appended, not
substituted.**

**Correction to §10.1 — the count was 16, but is actually 17.** §10.5's own divergence
assertion (*"every `actor_type` CHECK in the schema declares the SAME vocabulary"*) also reads
`schema.sql` and was added after the 115/9 stub measurement in §10.1 was taken. Under the same
stub it fails too — `allActorChecks.length > 0` is false against an empty string — so the true
stub-failure count is **10, not 9** (row count in §10.1's table is unaffected; the divergence
assertion simply wasn't in the suite yet when that table was built).

**Correction to §10.3 — the premise that "a Mythos-only pin would weaken a live read" assumed a
live read that, by the time of the final review, no longer matched canonical.** The vendored
copy at (the now-deleted) `projects/idauto/database/schema.sql` had SHA-256 `bb282a75…`, which
had already diverged from the canonical `othoth77/idauto` `database/schema.sql` (`b41c000d…`)
by one line — a documentation-comment line referencing a line number that had shifted, not a
CHECK constraint. The "live" read §10.3 worried about weakening was therefore already stale
relative to canonical at read time. A pin verified against canonical's own published, digest-
stamped artifact — as implemented in §10.6 above — is **strictly stronger** than the status quo
it replaced, not a weakening of it. §10.3's underlying architectural point (do not fabricate a
Mythos-owned vocabulary copy with no upstream conformance backing it) still stands and is why
the implementation waited for ID Auto to publish and conformance-test the artifacts first,
rather than pinning a Mythos-authored guess.
