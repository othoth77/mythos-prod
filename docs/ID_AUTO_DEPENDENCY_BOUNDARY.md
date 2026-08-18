# ID Auto ↔ Mythos — dependency boundary audit

**Date:** 2026-08-18 · **Type:** read-only audit. **No source code was changed.**
**Repository:** `othoth77/mythos-prod` @ `adaf55e` (branch
`claude/idauto-source-cleanup-post-publication`)
**Counterpart:** `othoth77/idauto` @ `bdfec2c` — canonical, clean-clone verified
(13 suites, 601 assertions, 0 failures)

**Why this exists.** The standalone migration audit recorded *"Class A — required external
dependency: **None**"*. That was measured in one direction only — every `require()` **inside**
the migrated tree. The reverse direction was never measured. PR #16 found it is not empty:
Mythos imports ID Auto at runtime, so `projects/idauto/` cannot be deleted. This document
maps every such dependency, classifies ownership, and proposes the smallest safe migration.

**Nothing here is implemented.** No file moved, no import rewritten, no test edited.

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

| # | Consumer | File · line | Imported component | Kind | Why it is used | Move? | Destination | Risk |
|---|---|---|---|---|---|---|---|---|
| **D1** | `projects/automation` | `reference/backup-operations-orchestrator.js:41` | `ops/offhost-backup.js` | **RUNTIME** | Orchestrator is a *gate* in front of the backup tooling; its header states it "OWNS NO BACKUP LOGIC … REQUIRED from here, never reimplemented", citing `OFF_HOST_BACKUP_GATE.md` §0: a second mechanism "would create two backup paths with one set of guarantees between them" | **YES** | `projects/infrastructure/ops/offhost-backup.js` | **HIGH** — disaster-recovery path; the off-host gate closed 2026-08-14 on a verified batch |
| **D2** | `projects/automation` | same file, lines 649 & 667 | the **string** `'projects/idauto/ops/offhost-backup.js'` | **RUNTIME** | `buildBackupPlan()` records `reuses_module`, and a guard *refuses to proceed* unless it equals that literal path | **YES** (with D1) | same | **MEDIUM** — a path literal asserted twice; missing one leaves a guard that always refuses |
| **D3** | `projects/personal-intelligence` | `cli/mpi-ingest-cli.js:46` | `ops/adapters/s3-compatible.js` | **RUNTIME** | Content-addressed object storage for MPI ingestion | **YES** | `projects/infrastructure/ops/adapters/s3-compatible.js` | **MEDIUM** |
| **D4** | `projects/personal-intelligence` | `cli/mpi-retrieve-cli.js:37` | `ops/adapters/s3-compatible.js` | **RUNTIME** | Same, retrieval side | **YES** (with D3) | same | **MEDIUM** |
| **D5** | `projects/personal-intelligence` | `cli/mpi-ingest-cli.js:185`, `mpi-retrieve-cli.js:109`, `mpi-runtime-cli.js:90` | `node_modules/pg` | **RUNTIME** | The CLI composition roots need a `pg` module to inject; ID Auto is the only project that has one installed | **YES** | MPI's own `package.json` → plain `require('pg')` | **LOW** |

### 2.2 Test dependencies

| # | Consumer | Depends on | Kind | Why | Move? | Destination | Risk |
|---|---|---|---|---|---|---|---|
| **D6** | `tests/mythos-identity-core-0-contract-test.js` §8 | `database/schema.sql` — `idauto_audit_log` `actor_type` CHECK | **TEST** | Guards that the core contract's `ACTOR_TYPES` has not drifted from the live vocabulary. **The platform adopted ID Auto's vocabulary verbatim** — ID Auto is the source | **REFRAME** | A versioned shared-vocabulary artefact both sides pin | **MEDIUM** |
| **D7** | same, §12 | `schema.sql` column types | **TEST** | Asserts ID Auto's columns stay `VARCHAR(64)`, `SERIAL`, and that `mythos_org_ref` was not added | **YES — to IDauto** | Already covered by `docs/IDENTITY_ARCHITECTURE.md` §3/§7 there | **LOW** |
| **D8** | same, §12b | `reference/identity.js` | **TEST** | Asserts the identity stub gained no auth (`jwt.sign`, `bcrypt`, `passport`, …) | **YES — to IDauto** | Covered by `docs/IDENTITY_ARCHITECTURE.md` §2/§8 there | **LOW** |
| **D9** | `tests/inf-backup-auto-0-backup-test.js:383` | the `reuses_module` path literal | **TEST** | Asserts D2's guard value | Follows D1/D2 | — | **LOW** |
| **D10** | `tests/mpi-activation-test.js:90` | `projects/idauto/node_modules/pg` | **TEST** | Resolves a `pg` to inject | Follows D5 | — | **LOW** |
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
| **1** | Give `projects/personal-intelligence` a `package.json` declaring `pg`; CLIs `require('pg')` (D5, D10) | 5 MPI suites that **already fail today** | **LOW** — `activation.js` is unchanged; it already takes `pg` by injection and refuses without it | `mpi-activation`, `mpi-2h-cli`, `mpi-3-retrieval-cli`, `mpi-4-*` green |
| **2** | Move `s3-compatible.js` → `projects/infrastructure/ops/adapters/`; update D3, D4 | MPI ↛ ID Auto | **MEDIUM** | `mpi-2h-events` 16/16, `mpi-2h-cli`, `mpi-3-retrieval-cli` |
| **3** | Move `offhost-backup.js` → `projects/infrastructure/ops/`; update D1 **and both path literals** in D2; update D9 | automation ↛ ID Auto | **HIGH** | `inf-backup-auto-0-backup` **245/245**; the `reuses_module` guard must still *refuse* a wrong value |
| **4** | Split the identity-core test: keep §8 against a versioned vocabulary artefact (D6); delete §12/§12b (D7, D8) — already covered in IDauto's `docs/IDENTITY_ARCHITECTURE.md` | mythos-core ↛ ID Auto | **MEDIUM** | `mythos-identity-core-0-contract` **115/124 → 115+** with no ID Auto read |
| **5** | Delete `projects/idauto/**`, `tests/ida-*.js`, `tests/devx-1-idauto-test-impact-test.js`, `docs/IDAUTO_*.md`, `docs/IDA3_*.md`; remove the 15 ID Auto rules from `test-impact-map.json` | The cleanup PR #16 can complete | **MEDIUM** | Full suite; **0 dangling test references** in the impact map |

Steps 1–4 are prerequisites for 5. **Step 5 must not be attempted before them** — measured,
not predicted: doing it now takes `inf-backup-auto-0-backup` (245), `mpi-2h-events` (16) and
`mythos-identity-core-0-contract` (124) from clean to hard error.

---

## 6. Risks

| Risk | Severity | Note |
|---|---|---|
| **`offhost-backup.js` is the disaster-recovery path** | **HIGH** | The off-host gate closed 2026-08-14 on a verified batch (`20260814T161856Z`). Relocation must not disturb restore. Its own history is the warning: the default HTTPS transport had *never worked* while 30 tests passed, because every test injected a mock. **Re-verify against the real path, not the suite alone.** |
| The `reuses_module` guard is a **path literal asserted twice** | MEDIUM | Lines 649 and 667. Updating one and not the other leaves a guard that refuses every plan — fails closed, so loud rather than silent |
| Two copies of the ops modules after relocation | MEDIUM | §4. Mitigated for the signing path by the AWS vector pinned on both sides |
| `identity-core` §8 asserts against a **live** vocabulary | MEDIUM | Replacing it with a frozen fixture converts a drift *detector* into a drift *recorder*. A versioned artefact both sides pin keeps the detection |
| A stub instead of a real fixture makes assertions pass **vacuously** | MEDIUM | Measured: stubbing `idjs = ''` made 9 assertions fail — and **6 more pass vacuously** (`identity.js contains no jwt.sign` is trivially true of an empty string). A fixture must be real content, never empty |
| `projects/infrastructure/` gains its first JavaScript | LOW | Needs a `test-impact-map.json` rule, or changes there fall through to the full-suite fallback |
| Losing DEVX-1 loses one **non**-ID-Auto safeguard | LOW | *"No rule references a nonexistent test path"* — exactly the failure mode step 5 risks. Verified by hand for PR #16 (0 dangling); worth re-adding as a small general test |
| 34 stale comment references after the move | LOW | Cosmetic. Not coupling |

---

## 7. Do not change yet

- **Do not delete `projects/idauto/`** — steps 1–4 first.
- **Do not modify `projects/automation` or `projects/personal-intelligence`** outside their
  own migration steps.
- **Do not touch `othoth77/idauto` `main`** (`bdfec2c`). It is canonical and clean-clone
  verified; the relocation is a Mythos-side change.
- **Do not merge PR #16.** It removes only the staging snapshot and documents this blocker.
- **Do not start IDA-4**, or any Blockchain / VC-DID / AI-Trust / Citizen-Passport work.
- **Do not "fix" the 34 documentation mentions** as part of this — noise in a risky diff.
- **Do not widen `evidence_status`** in `portfolio-registry.json`. It is a closed enum
  (`REPOSITORY_VERIFIED` / `OWNER_DIRECTION` / `FUTURE_CONCEPT`) enforced by the governance
  suite, which already caught one invented value in this work.

---

## 8. Evidence

Read-only. Every number below was executed at `adaf55e`, not inferred.

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
removed. No repository file was modified by this audit.

---

## 9. Next implementation stage

**`IDA-DECOUPLE-1` — MPI dependency ownership.** Step 1 only: give
`projects/personal-intelligence` its own `package.json` declaring `pg`, and change three CLI
composition roots from `require('../../idauto/node_modules/pg')` to `require('pg')`.

Chosen first because it is the smallest, the least risky, touches no ID Auto file, requires no
relocation decision, and **repairs 5 suites that are already failing today** — so it is worth
doing even if the rest of the decoupling is never authorised.

It needs an explicit authorisation. It is not started.
