# Mythos OS — Strategic Execution Review (2026-08-11)

**Type:** Architecture and execution review. Analysis and planning only.
**No major runtime stage was implemented. No deployment. No production mutation. No public endpoint. No Identity implementation. No IDA-3 implementation. No subagents.**

**Baseline:** `c3e9f452a3be4432e8f609d88f9fdf74a7e3ee4f` — branch `main`, worktree clean, local HEAD == `origin/main`, all Git operations run as `deploy`.

**Evidence discipline:** every claim below is marked **FACT** (verified from committed code, live database, or running containers at this baseline), **INFERENCE** (reasoning from those facts), or **PROPOSAL** (recommendation, not yet authorised). Source-code existence is never treated as a deployed service.

---

## 1. Executive Summary

Mythos OS is **not** blocked on effort, quality, or tooling. Engineering quality is high: ID Auto shipped eight sequential stages with 195 live passing assertions, atomic audit boundaries, and a genuinely adversarial self-audit. The DEVX layer (Stage Runner, ledger, risk lanes, test-impact map) works and is enforcing real gates.

It is blocked on **one missing contract**: platform identity.

The evidence is unusually concrete. **Five separate tracks have each independently built their own organisation/user/role/session tables**, and every one of them references a `mythos_core` schema that **does not exist anywhere in the repository**. Worse, they no longer agree on what a Mythos user *is*: the ecosystem's own canonical identifier registry (`projects/automotive/database/control-plane-schema.sql`) formally declares `mythos_user_id` as `BIGSERIAL`, Atelier Network and Automotive conform with `BIGINT` — while **ID Auto, the only track with a live deployed database, implements it as `VARCHAR(64)`**. That is a committed, verified, cross-product contract violation, not a stylistic difference.

This is also the single named blocker in the entire ledger: `IDA-2E` is `BLOCKED` with the reason *"No real Mythos OS identity/auth service exists to integrate with."* It is the only `BLOCKED` stage across all 31 registered stages.

The decisive fact is one of **timing**. Queried directly against the live `idauto-postgres`: `idauto_contributors` has **0 rows**, `idauto_user_roles` has **0 rows**, `idauto_organizations` has **1 row**. There is no real identity data anywhere in the ecosystem yet. The identity contract can be settled today at essentially zero migration cost. The moment IDA-3 opens public/community capture, contributors become real accounts with trust scores and immutable audit attribution — and the same decision becomes a migration against live user data and an append-only audit log.

**The window to fix this for free is open now and closes at IDA-3.**

Accordingly, the recommended next stage is **`MYTHOS-IDENTITY-CORE-0` — a design and contract-freeze stage only**, not an auth-service build. Its job is to decide the canonical identity type, define the minimum viable user/organisation/membership/actor model, and give `IDA-2E-PRE` a stable interface to sit behind. It touches no running service and executes no migration.

Two governance defects were also found that materially distort planning. One — a stale `current-context.json` — is corrected in this review under the explicit authorisation to fix a factual governance inconsistency. The other — a test-safety hole where ID Auto changes would run **zero** targeted tests — is documented and assigned, not silently changed.

---

## 2. Verified Current State

### 2.1 Repository baseline (FACT)

| Item | Value |
|---|---|
| Branch | `main` |
| Local HEAD | `c3e9f452a3be4432e8f609d88f9fdf74a7e3ee4f` |
| `origin/main` | `c3e9f452a3be4432e8f609d88f9fdf74a7e3ee4f` (identical) |
| Worktree | clean |
| Git identity | `deploy` |
| Registered stages | 31 |
| Test files | 63 |
| Installed Mythos Skills | 20 |

### 2.2 Deployment reality (FACT — 25 running containers + host services)

Verified by `docker ps` and host inspection at baseline. **Source-code existence is not deployment.**

| Component | Real state |
|---|---|
| Mythos OS core (Uthina Chess) | **PRODUCTION_DEPLOYED** — host nginx + `php8.5-fpm`, docroot `/var/www/uthinachess` |
| `idauto-postgres` | **LIVE**, healthy, loopback-only, 384 MiB cap |
| ID Auto media dir | **LIVE** — `/home/deploy/deployments/idauto-media`, `deploy:deploy` 750 |
| ID Auto API / UI | **UNDEPLOYED** — no container, no systemd unit, no port-3001 listener, no persistent Node process |
| Personal Intelligence | **UNDEPLOYED** — 5 reference modules + draft schema only |
| Automotive / Atelier / AutoValeur | **UNDEPLOYED** — draft schemas only |
| Automation connectors (OVH, Cloudflare) | **REFERENCE_ONLY** — never invoked with live credentials |
| Research Intelligence | **UNDEPLOYED** — documentation only |
| Non-Mythos production on same host | Dar Hijama, Coolify, n8n, Notre Jour preview, Jellyfin — **untouched by this review** |

### 2.3 Track-by-track verified state (FACT unless noted)

**Mythos Core Runtime** — Stages `3D`, `4AG`, `4Z`, `RUNTIME-DUPLICATE-CLEANUP-0` DONE. Production-deployed. Carries one registered known baseline failure (`memcache-core-failure`) cascading into six suites' subprocess assertions — pinned in `known-baselines.json`, first/last verified commits recorded.

**ID Auto** — the most advanced track by a wide margin. `IDA-0`, `IDA-1`, `IDA-2A`, `IDA-2A-CORRECTION-0`, `IDA-2B`…`IDA-2H`, `IDA-2-PHASE-B-DEEP-AUDIT-0` all DONE. Live 22-table PostgreSQL schema. 195/195 live assertions passing across six suites. Atomic `withAudit()` mutation boundary over six audited operations. Deep audit closed five findings and accepted/deferred the rest with explicit reasoning.
- `IDA-2E` — **BLOCKED**. The only BLOCKED stage in the ledger.
- `IDA-2I` — **DEFERRED** to the IDA-3 exposure gate (documented decision `DEFER_IDA_2I_TO_IDA_3`, with a defined trigger).
- API/UI complete but **undeployed**.

**Personal Intelligence** — `MPI-0` and `MPI-0-FINALIZATION` DONE. Delivers five in-memory reference modules (`context-assembler`, `guard`, `intent-router`, `learning-engine`, `scope`) plus a draft control-plane schema. `MPI-1` **not started**.

**Automotive / Atelier Network / AutoValeur** — `MAE-0`, `ATN-0`, `AVA-0` DONE (foundation documents + draft schemas). `MAE-1` is recorded as *"blocked on IDA-2"*, `ATN-1` as *"after IDA-2"*. **INFERENCE:** IDA-2 Phase B completing has *nominally* released those gates, but not *practically* — see §7.

**Automation / Infrastructure** — `AUT-0`, `INF-OVH-API-0`, `INF-CF-AUTO-0`, `AUT-CONNECTOR-SHARED-HELPERS-0` DONE, all read-only reference connectors. `INF-CF-0/1/2-PREP` DONE; `INF-CF-2` blocked on entry criteria. `INF-DNS-AUTO-1` not started (HIGH_RISK lane — DNS).

**Research Intelligence** — `RES-0` DONE (documentation). `RES-1` not started and **not authorised**.

**DEVX / Project Intelligence** — `DEVX-0` DONE and genuinely working: Stage Runner enforces ledger-driven eligibility, dependency satisfaction, risk lanes, and refuses `close --apply` on HIGH_RISK. It has already caught real metadata blockers (IDA-2G self-dependency, IDA-2H unknown stage, deep-audit unregistered). `DEVX-1` not started.

**Skills** — 20 installed agent skills. Functional at the agent layer; not a deployed runtime surface.

---

## 3. System Map

| # | Component | Classification | Evidence |
|---|---|---|---|
| 1 | Mythos Core Runtime | **PRODUCTION_DEPLOYED** | live nginx/php-fpm docroot; stages 3D/4AG/4Z DONE |
| 2 | Identity / Auth / Roles | **FOUNDATION_ONLY** (effectively absent) | `js/auth.js` = one shared SHA-256 password; session is `{ts}` only; no user/role/org anywhere |
| 3 | Personal Intelligence | **FOUNDATION_ONLY / UNDEPLOYED** | 5 reference modules + draft schema; MPI-1 not started |
| 4 | ID Auto | **PARTIALLY_INTEGRATED** | DB + media live; API/UI complete but UNDEPLOYED |
| 5 | Mythos Automotive | **FOUNDATION_ONLY / UNDEPLOYED** | MAE-0 draft control-plane schema |
| 6 | Atelier Network | **FOUNDATION_ONLY / UNDEPLOYED** | ATN-0 draft schema |
| 7 | AutoValeur | **FOUNDATION_ONLY / UNDEPLOYED** | AVA-0 draft schema |
| 8 | Production / Business | **PRODUCTION_DEPLOYED (non-Mythos)** | Dar Hijama, Notre Jour, Coolify, n8n, Jellyfin — outside Mythos tracks |
| 9 | Automation / Infrastructure | **REFERENCE_ONLY** | connectors never run with live credentials; INF-CF-2 BLOCKED |
| 10 | Research Intelligence | **FOUNDATION_ONLY** | RES-0 docs; RES-1 unauthorised |
| 11 | Skills | **FUNCTIONAL_ISOLATED** | 20 skills installed, agent-layer only |
| 12 | DEVX / Project Intelligence | **INTEGRATED** | Stage Runner + ledger + lanes + impact map actively gating |
| 13 | Storage / Media | **TRACK_SPECIFIC / PARTIALLY_INTEGRATED** | ID Auto filesystem `storage.js` live; no platform storage; media backup gap |
| 14 | Audit / Governance | **PARTIALLY_INTEGRATED** | real audit inside ID Auto (358 rows, atomic); no platform-wide audit |
| 15 | Connectors | **REFERENCE_ONLY** | OVH/Cloudflare read-only reference implementations |

**INFERENCE:** exactly one component is PRODUCTION_DEPLOYED as a Mythos track (core runtime), exactly one is meaningfully mid-integration (ID Auto), and one cross-cutting component that *everything else assumes exists* (identity) is absent. That shape — many foundations, one deep vertical, one missing spine — is the defining characteristic of the current portfolio.

---

## 4. Critical Bottlenecks

### 4.1 The identity contract — quantified (FACT)

Five tracks independently built parallel identity structures:

| Track | Organisation table | User / role / membership table | Session table |
|---|---|---|---|
| ID Auto | `idauto_organizations` | `idauto_user_roles` | — |
| Personal Intelligence | `pi_organisations` | `pi_users`, `pi_user_domain_access` | `pi_sessions` |
| Atelier Network | `atn_workshop_organizations` | `atn_network_memberships` | — |
| Automotive | `mythos_automotive_organizations` | (`org_ref` columns) | — |
| AutoValeur | (references `mythos_core` user/org) | — | — |

Every one of them points at a **`mythos_core` schema that does not exist**. Representative committed comments:
- `projects/idauto/database/schema.sql:25` — `mythos_core — users, roles, permissions, global audit, platform admin`
- `projects/atelier-network/database/schema.sql:42` — `mythos_core.organization_id — no FK across schemas`
- `projects/automotive/.../control-plane-schema.sql:603` — `actor_ref BIGINT — mythos_user_id — no FK`
- `projects/autovaleur/database/schema.sql:150` — `reference to mythos_core user or org`

### 4.2 The contract is already violated (FACT — the central finding)

`projects/automotive/database/control-plane-schema.sql` contains the ecosystem's own **canonical identifier registry**, formally declaring cross-product contracts:

```
('mythos_user_id',  'mythos_core', 'mythos_core', 'BIGSERIAL', TRUE, TRUE, 'Platform identity')
('organization_id', 'mythos_core', 'mythos_core', 'BIGSERIAL', TRUE, TRUE, 'Subscriber organisation')
```

Conformance against that declared contract:

| Track | Declared/implemented type | Conforms? | Deployed? |
|---|---|---|---|
| Automotive canonical registry | `BIGSERIAL` | *(is the contract)* | draft |
| Atelier Network | `BIGINT` | ✅ | draft |
| Automotive control-plane | `BIGINT` | ✅ | draft |
| Personal Intelligence | `VARCHAR(64)` `actor_ref` | ✖ own convention | draft |
| **ID Auto** | **`VARCHAR(64)`** | **✖ violates** | **LIVE** |

Verified against the **live** `idauto-postgres`, not just source:

```
idauto_contributors | mythos_user_id | character varying | 64
idauto_user_roles   | mythos_user_id | character varying | 64
idauto_audit_log    | actor_ref      | character varying | 64
```

**INFERENCE:** the only track that actually runs is the one that diverges from the declared contract. Every further stage shipped against either convention deepens the divergence, and the audit log is append-only by design — meaning late correction is not a schema edit but a historical-attribution problem.

### 4.3 The migration window (FACT — the timing argument)

Live row counts at baseline:

| Table | Rows |
|---|---|
| `idauto_contributors` | **0** |
| `idauto_user_roles` | **0** |
| `idauto_organizations` | **1** |
| `idauto_audit_log` | 358 *(synthetic test fixtures)* |
| `idauto_vehicles` | 98 *(synthetic test fixtures)* |

**INFERENCE:** there is currently **no real identity data anywhere in Mythos**. Settling the identity contract today is a documentation-and-draft-schema exercise. After IDA-3 public/community capture, `idauto_contributors` holds real accounts with trust scores, and `idauto_audit_log` holds immutable real attribution. The same decision then costs a live migration plus an audit-history reconciliation. This is the strongest available argument for sequencing identity **before** IDA-3.

### 4.4 Platform capability audit

Assessed against the question *"is a reusable primitive required now, or is that premature platform-building?"*

| Capability | Exists? | Required now? | Smallest useful version | Verdict |
|---|---|---|---|---|
| **Identity (user)** | No — 5 conflicting shadows | **YES** | canonical ID type + `users` | **BUILD CONTRACT NOW** |
| **Organisation** | No — 4 parallel org tables | **YES** | `organizations` | **BUILD CONTRACT NOW** |
| **Membership + role** | No — duplicated in 2 tracks | **YES** | `memberships(user, org, role)` | **BUILD CONTRACT NOW** |
| **Audit actor resolution** | Partial (ID Auto only, live) | **YES** | stable `actor_ref` shape | **BUILD CONTRACT NOW** |
| Authentication (login) | No | No | — | DEFER — no deployed consumer |
| Sessions / tokens | No (`pi_sessions` draft) | No | keep IDA-2E-PRE stub behind interface | DEFER |
| Permissions engine | No | No | role check only | DEFER — avoid IAM |
| Unified API conventions | Partial (ID Auto only) | No | — | DEFER |
| Domain events | No | No | — | DEFER |
| Background jobs | No (n8n is separate) | No | — | DEFER |
| Storage | Track-specific (ID Auto) | No | — | TRACK_SPECIFIC (§9) |
| Backup / restore | DB yes, media no | Before public media | documented media backup | TRACK_SPECIFIC |
| Secrets / config | Policy exists, env-var based | No | — | DEFER |
| Notifications | No | No | — | DEFER |
| Connectors | Reference-only | No | — | DEFER |
| Search / entity resolution / provenance / memory graph | MPI reference only | No | — | MPI track, not platform |
| Observability | Minimal | No | — | DEFER |
| Migrations | Ad-hoc | Soon | — | DEFER to first real migration |
| Deployment topology | Manual | **Rising** | ID Auto deploy path | See §11 candidate |

**Explicit non-scope for any near-term platform work:** no IAM product, no SSO/OIDC federation, no policy engine, no service mesh, no event bus, no S3/R2/MinIO migration, no multi-region.

---

## 5. Identity Core Decision

**PROPOSAL: create `MYTHOS-IDENTITY-CORE-0` as a design and contract-freeze stage. Do not build an auth service.**

The blocker is commonly misread as *"we need authentication."* The evidence says otherwise: what is missing is an **agreed contract for what a Mythos user and organisation are**, which five schemas have already guessed at incompatibly. Authentication is a later, separable concern with no deployed consumer today.

### 5.1 Smallest viable model

Each element evaluated on its own merits rather than assumed:

| Element | Include? | Reasoning |
|---|---|---|
| `users` | **YES** | every track already references `mythos_user_id` |
| `organizations` | **YES** | 4 tracks have org tables; registry declares `organization_id` cross-product |
| `memberships` (user × org × role) | **YES** | exactly what `idauto_user_roles` / `atn_network_memberships` duplicate |
| Roles | **YES, minimal** | reuse ID Auto's existing live CHECK set verbatim: `owner \| admin \| member \| readonly`, plus platform-level `MYTHOS_SUPER_ADMIN` |
| Actor resolution for audit | **YES** | already live and load-bearing (`actor_ref`) |
| `identities` (credential/auth methods) | **DEFER** | no login flow exists; one-user-one-credential is sufficient today |
| `sessions` | **DEFER** | keep IDA-2E-PRE's operator token map as implementation |
| Permission engine | **DEFER** | a role comparison is enough; an engine is IAM over-engineering |

### 5.2 Required decisions (the actual architectural content)

**Internal module or service? → Internal module (shared schema + resolution library).** Nothing but ID Auto's database is deployed; a standalone identity *service* would add deployment and operational burden with zero current consumers. Promote to a service only once more than one deployed consumer exists.

**First roles → `MYTHOS_SUPER_ADMIN` (platform scope) + `owner|admin|member|readonly` (org scope).** Reusing ID Auto's already-live constraint set avoids inventing a second role vocabulary that would itself need reconciling.

**Token/session mechanism → unchanged.** `IDA-2E-PRE` stays exactly as it is, re-expressed as an *adapter* behind a stable resolution interface. This keeps runtime risk at zero while removing the "dangling reference" problem.

**Canonical ID type → the one genuinely contested decision, and the reason this stage needs Opus.** Two coherent options:

- **(a) Opaque string (e.g. `VARCHAR(64)`/ULID).** Matches the only *live* implementation (ID Auto), so zero live change. Conflicting consumers (Atelier, Automotive) are **all undeployed drafts** — a text edit. Also more future-proof: external IdP subjects are not integers, so an opaque ID survives later federation without another migration.
- **(b) `BIGSERIAL`/`BIGINT`.** Matches the formally declared canonical registry. Requires changing ID Auto — currently near-free because its identity tables are empty, but it does touch a live schema and the append-only audit column.

**Assessment (PROPOSAL, for Opus to ratify):** option (a) is materially cheaper today and strictly more future-proof; option (b) has the stronger claim to "already declared." Because the registry itself is an undeployed draft while ID Auto is live, (a) is the recommended default — but this must be settled deliberately, in writing, with the registry updated to match whichever is chosen. Shipping either without updating the registry recreates the current defect.

**Migration path from `IDAUTO_ADMIN_IDENTITIES`:** the stub already maps bearer token → stable identity string. Identity Core defines the canonical form of that string; `identity.js` becomes a conforming adapter. Because `idauto_contributors` and `idauto_user_roles` are empty, no data migration is required in either option.

**Compatibility approach:** freeze the contract, update the canonical registry to match, and align the four undeployed draft schemas. Touch no live table in this stage.

### 5.3 What it unblocks

`IDA-2E` (directly — the only BLOCKED stage) · `IDA-3` (contributor identity is a hard prerequisite, §8) · `MAE-1`, `ATN-1`, `AVA-1` (all professional/org-scoped) · `MPI-1` (prevents a sixth convention).

---

## 6. MPI-1 Decision

**Current foundation (FACT):** five in-memory reference modules plus a draft control-plane schema including `pi_users`, `pi_organisations`, `pi_sessions`, `pi_user_domain_access`. Nothing deployed.

**Smallest MPI-1 with real user value (PROPOSAL):** one thin end-to-end vertical slice, single-actor:

`one source type (documents) → ingest → normalize → extract → provenance → entities (people/orgs) → store → retrieve → context assembly → response`

**In scope:** one source type only; people and organisation entities; provenance on every extracted fact; a retrieval path; context assembly wired to the existing `context-assembler` reference module.

**Explicit non-scope for MPI-1:** deduplication, possible-match relationships, entity-matching heuristics, multi-provider abstraction, personal learning, tags, external references, conversations *and* contacts as additional source types. Those are MPI-2+ and each is independently valuable later.

**Dependency on Identity Core:** *partial, not blocking.* MPI-1's value is single-user, so it can proceed without a real identity service. But it must consume the **actor/identity contract shape** rather than inventing a sixth one — which is an argument for the contract landing first, not for MPI-1 waiting on an auth build.

**Is another documentation-only MPI stage needed? No.** MPI-0 and MPI-0-FINALIZATION already provide sufficient specification. MPI-1 should be implementation.

---

## 7. Automotive Dependency Map

**FACT:** the ledger records `MAE-1` as *"blocked on IDA-2"* and `ATN-1` as *"after IDA-2"*. IDA-2 Phase B is now complete.

**INFERENCE — the honest reading:** IDA-2 completion released those gates *on paper only*. Two real dependencies remain:
1. All three are **professional / organisation-facing** products. They require organisations, memberships and roles — i.e. exactly the missing identity contract.
2. **ID Auto's API is undeployed.** "ID Auto is complete" does not yet mean "there is a service to integrate with." A downstream track cannot consume an HTTP API that no process serves.

| Stage | Business value | Shared primitives needed | Identity dep. | ID Auto dep. | Public/pro access dep. | Technical risk |
|---|---|---|---|---|---|---|
| `MAE-1` | Medium–High | org, membership, roles, product catalog | **Hard** | Deployed API | Professional | Medium |
| `ATN-1` | Medium | org, membership, workshop network | **Hard** | Deployed API | Professional | Medium |
| `AVA-1` | Medium | org, valuation, `MYTHOS_SUPER_ADMIN` gate | **Hard** | Vehicle identity | Restricted | Medium |
| `IDA-3` | High | contributor identity, rate limiting, moderation | **Hard** | Self | **Public** | **High** |

**Belongs at platform level:** identity (user/org/membership/role), audit actor, canonical identifiers, storage/media references, event correlation ID.

**Must stay domain-specific (explicit anti-coupling):** vehicle/plate/observation/fact (ID Auto), valuation models (AutoValeur), workshop and network topology (Atelier Network), product/subscription catalog (Automotive). **PROPOSAL:** none of these should be promoted to `mythos_core` — the canonical registry already correctly assigns `vehicle_id` to ID Auto rather than to core, and that boundary should be preserved.

---

## 8. IDA-3 Design Gate

**No public endpoint is designed or implemented here.** Prerequisites only.

| Prerequisite | Current state | Gate |
|---|---|---|
| Anonymous lookup | Not built | Needs limiter keyed on hashed IP |
| Authenticated lookup | Not possible | **Needs Identity Core** |
| Community capture | Not built | **Needs contributor identity** |
| Contributor identity | `idauto_contributors` exists, **0 rows**, keyed on dangling `mythos_user_id` | **Needs Identity Core** |
| Rate limiting | Deferred (`DEFER_IDA_2I_TO_IDA_3`, trigger recorded) | Design before first public endpoint |
| Abuse controls | None | Needs durable actor keys |
| Privacy / plate-data policy | Documented `mythos_private` scope, query-filtered | Needs legal/retention sign-off |
| `access_scope` | Implemented and enforced at query level | OK |
| Moderation | Review queue built (IDA-2H) | Needs reviewer identity |
| Provenance | Implemented (`observation_id` linkage, fixed in audit) | OK |
| Media validation / EXIF | MIME header trusted, no content sniffing | **Close before public upload** |
| Retention | Not defined | Needed |
| Duplicate detection | Hash-based sharing exists | Partial |
| Audit | Live, atomic, 358 rows | OK |
| Reputation / trust | `trust_score` column exists, unused | **Needs Identity Core** |
| Observability | Minimal | Needed |
| Incident handling | Undefined | Needed |
| Media backup | **Gap (deferred)** | **Close before non-disposable media** |

**Decision: YES — Identity Core must precede public IDA-3.** Three independent reasons, each sufficient on its own:
1. Contributor identity, trust scoring and moderation attribution are all keyed on `mythos_user_id`, which is currently a dangling reference with zero rows.
2. Authenticated rate limiting requires stable identity keys.
3. `idauto_audit_log` is append-only by design. Changing actor identity semantics *after* real public attribution exists converts a cheap decision into a historical-integrity problem.

---

## 9. Storage and Backup Decision

**Evidence (FACT):** PostgreSQL backup exists and was restore-tested. The separate media directory has **no documented external backup/restore coverage** (deep-audit MEDIUM, deferred). All 13 media references matched 13 on-disk objects. Orphan risk on crash-between-write-and-insert is accepted and documented. Only **one** track currently stores media, and it is undeployed with synthetic data only.

**Decision: `TRACK_SPECIFIC` — not a platform stage.**

**Reasoning (INFERENCE):** a platform storage/backup capability built for a single undeployed consumer is textbook premature platform-building — precisely what this review is instructed to avoid. The gap is real but narrow. It should be closed as a small ID-Auto-scoped stage (`IDAUTO-STORAGE-OPS`) bundled into IDA-3 readiness, covering: documented media backup + restore verification, checksum/manifest reconciliation, orphan and missing-object detection, retention, and backup-freshness metadata.

**Explicitly rejected:** migration to S3/R2/MinIO. No evidence justifies it — volume is trivial, there is one consumer, and the filesystem implementation is already audited and correct. Revisit only when a second deployed consumer or genuine scale appears.

---

## 10. Technical Debt

Classified by whether it actually blocks progress. **Cleanup is deliberately not the roadmap** — only the two governance/test-safety items below genuinely obstruct work.

### P0 — blocks accurate planning or test safety

| Item | Evidence | Status |
|---|---|---|
| **Stale `current-context.json`** | `main_head` was `bf95988` (~20 commits behind `c3e9f45`); `last_completed_stage` RES-0 vs actual 2026-08-11 work; **`known_blockers: []` despite `IDA-2E` BLOCKED** | **CORRECTED IN THIS REVIEW** (§16) |
| **`test-impact-map.json` has no targeted tests for `projects/idauto/`** | Rule still reads *"Draft (undeployed) schema only"* with `targeted_tests: []`, yet **195 live assertions across 6 suites** now exist. An ID Auto change would run **zero** targeted tests | **DOCUMENTED — assigned, not silently changed** (policy change, needs stage authorisation) |

### P1 — real, blocks specific next work

- **Identity contract divergence** (`VARCHAR(64)` vs `BIGSERIAL`) — §4.2. Blocks IDA-2E, IDA-3, MAE-1, ATN-1, AVA-1.
- **ID Auto media backup gap** — blocks storing non-disposable media, therefore blocks IDA-3.
- **Manual-entry partial-transaction risk** — sequential multi-request workflow can leave incomplete state; needs a designed composite API, explicitly *not* an audit refactor.
- **ID Auto API undeployed** — no consumable service for downstream tracks.

### P2 — real, not currently blocking

- Synthetic fixture accumulation (98 vehicles / 358 audit rows, ~9.6 MiB) — needs a fixture lifecycle before scale matters.
- MIME content sniffing absent — must close before public ingestion.
- Duplicate source/live FK constraints on `idauto_verifications` — harmless today; removal needs a migration.
- `memcache-core-failure` baseline cascading into six suites — registered and pinned.

### P3 — cosmetic / deferred

- `js/app-fresh.js` — confirmed dead (unreferenced by `index.html`), but **deliberately pinned as dead by two test suites** (`stage4ag`, `runtime-duplicate-cleanup-0`). Removing it requires updating those assertions. Harmless; low value.
- `removePersonRow` caller audit, invoice `addLine` stub, Logs/Sidebar/Sync extraction — pre-existing core-runtime items, no current blast radius.

---

## 11. Model Economy Strategy

Principle: **Opus only where deep reasoning changes correctness; Sonnet by default for implementation; Haiku for everything mechanical and repeatable.** Haiku work is deliberately front-loaded to reduce Sonnet's token cost.

| Work type | Model | Rationale |
|---|---|---|
| Resolve the `VARCHAR` vs `BIGSERIAL` contract | **OPUS** | contradictory committed contracts + live-vs-draft trade-off + migration consequences |
| Identity schema and security design | **OPUS** | schema/security architecture; expensive to get wrong |
| Adversarial review of a HIGH_RISK implementation | **OPUS** | correctness-changing review |
| Implement approved contract + draft schema + adapter | **SONNET** | bounded implementation against an approved spec |
| MPI-1 vertical slice | **SONNET** | feature implementation |
| API / UI / migrations after design approval | **SONNET** | default implementation lane |
| Tests, refactors, docs tied to implementation | **SONNET** | standard |
| Identity-reference inventory across tracks | **HAIKU** | mechanical grep/enumerate |
| Type-conflict enumeration | **HAIKU** | mechanical comparison |
| Ledger ↔ handover consistency check | **HAIKU** | mechanical diff |
| Stale stage-label scan | **HAIKU** | mechanical |
| Route / schema / index inventories | **HAIKU** | mechanical |
| Prescribed test-checklist execution | **HAIKU** | mechanical |
| Expected-vs-actual changed-file verification | **HAIKU** | mechanical |
| Secret-exposure scan | **HAIKU** | mechanical, pattern-based |

**Anti-patterns to avoid:** Opus on documentation formatting, routine test additions, CRUD, or mechanical scans. Haiku on schema design, security policy, migration strategy, or production-deployment decisions.

---

## 12. Candidate Stage Ranking

Score 1–5 (higher = stronger), Cost S/M/L/XL.

| Candidate | Biz value | Platform leverage | Urgency | Risk | Cost | Blocked by | Unlocks |
|---|---|---|---|---|---|---|---|
| **`MYTHOS-IDENTITY-CORE-0`** (design/contract) | 3 | **5** | **5** | **2** | M | — | IDA-2E, IDA-3, MAE-1, ATN-1, AVA-1, MPI-1 alignment |
| `IDAUTO-DEPLOY-0` *(discovered)* | 4 | 3 | 4 | 4 | M | real auth for exposure | makes IDA-2 consumable; downstream integration |
| `MPI-1` (vertical slice) | **5** | 3 | 3 | 3 | L | — (soft: contract) | personal-intelligence value |
| `IDA-3-DESIGN-GATE` | 4 | 3 | 3 | **5** | M | **Identity Core**, storage-ops | public product surface |
| `IDAUTO-STORAGE-OPS` | 2 | 2 | 3 | 2 | S | — | IDA-3 readiness |
| `MAE-1` | 4 | 2 | 2 | 3 | L | Identity Core + deployed ID Auto | automotive commercial track |
| `ATN-1` | 3 | 2 | 2 | 3 | L | Identity Core + deployed ID Auto | workshop network |
| `AVA-1` | 3 | 2 | 2 | 3 | L | Identity Core | valuation product |
| `DEVX-1` | 2 | 4 | 3 | 1 | S | — | governance accuracy, test safety |
| `INF-DNS-AUTO-1` | 2 | 2 | 1 | **5** | M | owner approval (HIGH_RISK/DNS) | DNS automation |
| `RES-1` | 2 | 1 | 1 | 2 | L | **not authorised** | research track |

**Model assignment for the top candidates:**

| Candidate | Implementer | Reviewer | Support |
|---|---|---|---|
| `MYTHOS-IDENTITY-CORE-0` | SONNET | **OPUS** (architect + review) | HAIKU |
| `IDAUTO-DEPLOY-0` | SONNET | OPUS (HIGH_RISK: deployment) | HAIKU |
| `MPI-1` | SONNET | OPUS (only if schema lands) | HAIKU |
| `IDA-3-DESIGN-GATE` | OPUS (design) | OPUS | HAIKU |
| `IDAUTO-STORAGE-OPS` | SONNET | — (STANDARD) | HAIKU |
| `DEVX-1` | SONNET | — (FAST/STANDARD) | HAIKU |

---

## 13. Three Roadmaps

### 13.1 FAST VALUE (maximise visible product soonest)
1. `IDAUTO-STORAGE-OPS` — close the media backup gap (S)
2. `IDAUTO-DEPLOY-0` — deploy the ID Auto admin API/UI privately (M)
3. `MPI-1` — personal-intelligence vertical slice (L)
4. `MYTHOS-IDENTITY-CORE-0` — after the fact (M)
5. `IDA-3` — public surface (L)

**Risk:** steps 1–3 ship against an unresolved identity contract; step 4 then becomes a migration across a deployed API and a live audit log. **Rejected** — it deliberately closes the free migration window.

### 13.2 PLATFORM FIRST (maximise reuse)
1. `MYTHOS-IDENTITY-CORE-0` (M)
2. Identity implementation + real auth service (XL)
3. Platform storage/backup (L)
4. Platform events/observability (L)
5. Domain tracks resume (XL)

**Risk:** months before any user-visible value; builds platform capabilities with zero deployed consumers — the exact over-engineering the mission warns against. **Rejected.**

### 13.3 BALANCED — **RECOMMENDED**

Settle the contract cheaply now, then resume product work at full speed without accruing rework.

---

**Stage 1 — `MYTHOS-IDENTITY-CORE-0` (design + contract freeze)**
- **Objective:** decide and freeze the canonical Mythos identity contract; define the minimum user/organisation/membership/actor model; give `IDA-2E-PRE` a stable interface to implement.
- **Scope:** contract document; draft (undeployed) core schema; canonical-registry correction; alignment of the four undeployed draft schemas; adapter interface spec; tests for the contract/registry consistency.
- **Non-scope:** no auth service, no login, no sessions, no permission engine, no live migration, no deployment, no change to any running service, no IDA-3 work.
- **Entry:** clean `main`; ledger registration; Opus contract decision recorded.
- **Exit:** canonical ID type decided and justified in writing; registry updated to match; four draft schemas aligned; `IDA-2E` blocker either cleared or precisely re-scoped; governance tests green.
- **Tests:** `project-intelligence validate`; governance suite; DEVX suite; contract-consistency test; ID Auto suites re-run unchanged (proving zero runtime impact).
- **Rollback:** documentation and draft-schema revert; nothing live to roll back.
- **Production impact:** **none.**
- **ARCHITECT: OPUS · IMPLEMENTER: SONNET · VERIFIER: HAIKU**

**Stage 2 — `IDAUTO-STORAGE-OPS`**
- **Objective:** close the media backup/restore gap and add reconciliation.
- **Scope:** documented media backup + verified restore; checksum manifest; orphan/missing-object detection; retention; freshness metadata.
- **Non-scope:** no S3/R2/MinIO migration; no schema change; no public endpoint.
- **Entry:** Stage 1 complete. **Exit:** restore proven from backup; reconciliation reports clean.
- **Tests:** ID Auto storage suite + restore drill. **Rollback:** ops scripts revert; no data mutation.
- **Production impact:** low (backup only, additive).
- **ARCHITECT: SONNET · IMPLEMENTER: SONNET · VERIFIER: HAIKU**

**Stage 3 — `MPI-1` (vertical slice)**
- **Objective:** first genuinely useful personal-intelligence path (§6).
- **Scope/Non-scope:** exactly as §6. **Entry:** Stages 1–2; consumes the frozen actor contract.
- **Exit:** end-to-end document → context-assembly path passing with provenance on every extracted fact.
- **Tests:** new MPI-1 suite + existing MPI-0 suite. **Rollback:** revert; nothing deployed.
- **Production impact:** none (undeployed).
- **ARCHITECT: OPUS (schema only) · IMPLEMENTER: SONNET · VERIFIER: HAIKU**

**Stage 4 — `IDAUTO-DEPLOY-0` (private deployment)**
- **Objective:** make ID Auto a real, consumable, private service.
- **Scope:** container/systemd unit, memory caps, loopback binding, health checks, log/observability baseline, documented rollback.
- **Non-scope:** **no public exposure**, no anonymous access, no community capture.
- **Entry:** Stages 1–2. **Exit:** service healthy, resource-capped, private-only, rollback rehearsed.
- **Tests:** full ID Auto suite against the deployed instance.
- **Rollback:** stop unit, restore prior state; DB untouched.
- **Production impact:** **HIGH_RISK lane — deployment. Owner approval required.**
- **ARCHITECT: OPUS · IMPLEMENTER: SONNET · VERIFIER: HAIKU + OPUS review**

**Stage 5 — `IDA-3-DESIGN-GATE` (design only)**
- **Objective:** complete the §8 prerequisite matrix and design the public ingestion + rate-limiting model. **No endpoint is exposed.**
- **Non-scope:** no implementation, no public route, no anonymous traffic.
- **Entry:** Stages 1–4. **Exit:** every §8 gate either satisfied or explicitly deferred with a recorded trigger.
- **Tests:** governance/design consistency only. **Rollback:** documentation revert.
- **Production impact:** none.
- **ARCHITECT: OPUS · IMPLEMENTER: OPUS (design) · VERIFIER: HAIKU**

---

## 14. Chosen Next Stage

### `NEXT_STAGE = MYTHOS-IDENTITY-CORE-0`

> **STATUS UPDATE (2026-08-11):** the architecture decision for this stage has since been made and recorded in [`MYTHOS_IDENTITY_ARCHITECTURE.md`](MYTHOS_IDENTITY_ARCHITECTURE.md) — canonical identifier, minimum model, boundary, roles, migration strategy, non-scope, and the full Sonnet implementation specification. That document is the binding contract; this section remains the reasoning that selected the stage.

**Design and contract-freeze only. No runtime implementation.**

**Why now.** It is the only `BLOCKED` stage in the ledger (`IDA-2E`). Five tracks have already encoded conflicting guesses at the same missing contract. A committed cross-product contract violation already exists between the canonical registry (`BIGSERIAL`) and the only live implementation (`VARCHAR(64)`). And the migration window is verifiably open — 0 contributors, 0 user-role grants — but closes the moment IDA-3 admits real users.

**What it unlocks.** `IDA-2E` directly; `IDA-3` (contributor identity, trust, moderation, authenticated rate limiting); `MAE-1`/`ATN-1`/`AVA-1` (all org-scoped); and it prevents MPI-1 from adding a sixth identity convention.

**Why alternatives wait.** `MPI-1` and `IDAUTO-DEPLOY-0` both deliver more visible value but would ship against an unresolved contract, converting a free decision into a paid migration. `IDA-3` is hard-blocked by this. `IDAUTO-STORAGE-OPS` is smaller, track-scoped and not on the critical path. `MAE-1`/`ATN-1`/`AVA-1` need both this contract *and* a deployed ID Auto API.

**Complexity:** Medium — the difficulty is decision quality, not code volume.
**Risk:** **Low.** Design + draft (undeployed) schema only. Touches no running service, executes no migration. Risk lane STANDARD (draft schema authoring), not HIGH_RISK.
**Type:** **Design-only.**

**Model assignment**
- **ARCHITECT / decision owner: OPUS** — the `VARCHAR(64)` vs `BIGSERIAL` resolution is a genuine architecture decision with migration consequences and two defensible answers.
- **IMPLEMENTER: SONNET** — author contract doc, draft schema, registry correction, draft-schema alignment, adapter interface, tests, after the Opus decision is recorded.
- **VERIFIER: HAIKU** — mechanical post-checks.
- **Support: HAIKU** — identity-reference inventory, type-conflict enumeration, ledger/handover consistency, test-impact-map gap list (all before Sonnet starts, to cut Sonnet's token cost).

**Ledger status:** `MYTHOS-IDENTITY-CORE-0` is **not currently registered**. Proposed canonical metadata (**PROPOSAL — not registered by this review**):

```
track:        mythos-os
stage_id:     MYTHOS-IDENTITY-CORE-0
title:        Mythos Identity Core — contract freeze and minimum model
status:       PLANNED
type:         FOUNDATION
blockers:     []
next_stage:   IDAUTO-STORAGE-OPS
evidence_paths:
  - docs/MYTHOS_STRATEGIC_EXECUTION_REVIEW_2026-08-11.md
  - projects/idauto/database/schema.sql
  - projects/automotive/database/control-plane-schema.sql
  - projects/atelier-network/database/schema.sql
  - projects/personal-intelligence/database/control-plane-schema.sql
```

---

## 15. Recommended Workflow

```
OPUS (architect)      → decides the identity contract; records the decision + rationale
        ↓
HAIKU (pre-check)     → cheap bounded inventory; cuts Sonnet's discovery cost
        ↓
SONNET (implement)    → contract doc, draft schema, registry fix, adapter spec, tests
        ↓
HAIKU (post-check)    → mechanical verification: files, tests, docs, ledger, scope, secrets
        ↓
OPUS (review)         → ONLY if HIGH_RISK or architecture/security-sensitive
```

**Opus review is required** for: schema/security design, migrations, deployment stages, auth/permission changes, anything in the HIGH_RISK lane.
**Opus review is NOT required** for: documentation stages, routine test additions, mechanical refactors, FAST-lane governance metadata.

For `MYTHOS-IDENTITY-CORE-0` specifically: Opus is required at the **architect** step (the contract decision) and again at **review** (it defines a cross-product contract, even though the stage itself is design-only).

---

## 16. Governance Correction Applied

Under the explicit authorisation to correct a factual governance inconsistency that directly prevents accurate planning, **exactly one** correction was made.

**`projects/meta/current-context.json` — regenerated** via `node scripts/mythos-stage.js context` (the file's own generator; not hand-edited).

| Field | Before | After |
|---|---|---|
| `source_commit` / `main_head` | `bf95988…` (~20 commits stale) | `c3e9f452…` (correct) |
| `generated_at` | 2026-08-08 | 2026-08-11 |
| `last_completed_stage` | RES-0 (2026-08-08) | id-auto, 2026-08-11 |
| **`known_blockers`** | **`[]`** | **`["IDA-2E: No real Mythos OS identity/auth service exists to integrate with"]`** |

The empty `known_blockers` array was the material defect: it hid the ecosystem's only blocker from every downstream planning consumer. The generator was correct all along — the file was simply stale.

**Observation (not corrected):** `last_completed_stage` resolves to `IDA-2B` because several stages share the completion date `2026-08-11` and the generator breaks ties arbitrarily. This is a minor generator imprecision, **not** a data error, and fixing it would be a code change outside this review's scope. Recorded for `DEVX-1`.

**Deliberately NOT changed:** the `test-impact-map.json` gap (§10 P0). Adding targeted tests for `projects/idauto/` changes Stage Runner *behaviour* (which tests gate which changes) and is a policy decision requiring its own authorised stage — not a factual correction. It is documented and assigned instead.

---

## 17. Ready-to-Run Prompts

### 17.1 `PROMPT_OPUS_REVIEW`

```
MYTHOS OS — OPUS ARCHITECTURE REVIEW: MYTHOS-IDENTITY-CORE-0

NO SUBAGENTS. Review only — do not implement.

GitHub is the source of truth. Repository: othoth77/mythos-prod
Persistent VPS worktree: /home/deploy/projects/mythos-prod
All Git operations run as deploy. Do not change repo ownership or copy credentials.

PREFLIGHT
- git fetch origin as deploy; verify branch main, clean worktree, HEAD == origin/main. Record the baseline SHA.
- Read: docs/MYTHOS_STRATEGIC_EXECUTION_REVIEW_2026-08-11.md (§4, §5, §14), docs/AI_HANDOVER.md (top entry), AGENTS.md.

DECISION TO MAKE (the reason this is Opus)
Resolve the canonical Mythos identity type conflict:
  - projects/automotive/database/control-plane-schema.sql canonical registry declares
    mythos_user_id and organization_id as BIGSERIAL, cross-product, "Platform identity".
  - projects/atelier-network + projects/automotive implement BIGINT (conform, UNDEPLOYED drafts).
  - projects/idauto implements VARCHAR(64) — and is the ONLY LIVE deployed schema.
  - projects/personal-intelligence uses VARCHAR(64) actor_ref (own convention).
Verified live row counts: idauto_contributors=0, idauto_user_roles=0, idauto_organizations=1.

Decide and record, in writing, with rationale:
1. Canonical identity type (opaque string vs BIGSERIAL) and why.
2. Minimum viable model: which of users / organizations / memberships / roles / actor-resolution
   are IN, and which of identities / sessions / permission-engine are DEFERRED. Justify each.
3. Internal module vs separate service (default recommendation: internal module).
4. First role vocabulary (default: MYTHOS_SUPER_ADMIN + owner|admin|member|readonly, reusing
   ID Auto's existing live CHECK set rather than inventing a second vocabulary).
5. Migration path from IDAUTO_ADMIN_IDENTITIES / identity.js to the frozen contract.
6. Whether the canonical registry must be corrected to match the decision (it must, either way).

NON-SCOPE (hard)
No auth service. No login flow. No sessions. No permission engine. No IAM/SSO/OIDC.
No live migration. No deployment. No IDA-3 work. No code implementation of any kind.

STOP CONDITIONS
Stop at the first real blocker. Do not invent stage state. Separate FACT / INFERENCE / PROPOSAL.
Source-code existence does not mean deployed service.

OUTPUT
Record the decision in docs/ (architecture decision record) and update docs/AI_HANDOVER.md with:
baseline SHA, decision summary, rationale, commit SHA, remote HEAD, exact next action.

VALIDATION before commit
- git diff --check
- node scripts/project-intelligence.js validate
- node tests/mpi-0-finalization-governance-test.js   (governance — docs/meta touched)
- secret scan on changed files
- confirm no runtime/production change

GIT
Commit docs only. Push as deploy. Verify HEAD == origin/main and report both SHAs.
```

### 17.2 `PROMPT_SONNET_IMPLEMENTATION`

```
MYTHOS OS — IMPLEMENT MYTHOS-IDENTITY-CORE-0 (design + contract freeze)

NO SUBAGENTS.

GitHub is the source of truth. Repository: othoth77/mythos-prod
Persistent VPS worktree: /home/deploy/projects/mythos-prod
All Git operations run as deploy. Do not change repo ownership or copy credentials.

PREFLIGHT (mandatory)
- git fetch origin as deploy; verify branch main, clean worktree, HEAD == origin/main. Record baseline SHA.
- Read: docs/AI_HANDOVER.md (top), the Opus decision record, and
  docs/MYTHOS_STRATEGIC_EXECUTION_REVIEW_2026-08-11.md §5 and §14.
- Read the Haiku pre-check output instead of re-scanning the repository.
- Stage Runner: node scripts/mythos-stage.js start MYTHOS-IDENTITY-CORE-0 --dry-run
  If UNKNOWN_STAGE, register the ledger entry FIRST as its own validated commit
  (canonical metadata is proposed in the strategic review §14), then re-run until eligible.

SCOPE (exactly this — nothing more)
1. Identity contract document under docs/ — canonical ID type, user/organisation/membership/role
   model, actor-resolution rules, explicit deferrals.
2. Draft (UNDEPLOYED) core identity schema under projects/ — must not be executed anywhere.
3. Correct the canonical identifier registry in
   projects/automotive/database/control-plane-schema.sql to match the decided type.
4. Align the UNDEPLOYED draft schemas (idauto / atelier-network / automotive /
   personal-intelligence) to the frozen contract — comments and column types in DRAFT files only.
5. Specify the adapter interface that projects/idauto/reference/identity.js will implement
   (interface/spec only — do NOT rewrite the live stub's behaviour).
6. Tests proving contract/registry consistency.
7. Update docs/AI_HANDOVER.md and the ledger entry.

NON-SCOPE (hard — refuse and stop if asked to cross)
No auth service, login, sessions, tokens, or permission engine.
No migration executed against idauto-postgres or any live database.
No change to any running container or deployed service.
No deployment. No public endpoint. No IDA-3. No MPI-1.
Do not modify the live behaviour of identity.js in this stage.
Do not touch Jellyfin or any unrelated production service.

TESTS
- node scripts/project-intelligence.js validate
- node tests/mpi-0-finalization-governance-test.js
- node tests/devx-0-development-acceleration-test.js
- the new contract-consistency test
- Re-run the ID Auto suites to prove ZERO runtime impact:
  tests/ida-2a-*, ida-2c-*, ida-2d-*, ida-2f-*, ida-2g-*, ida-2h-*  (expected: 195/195)
Use projects/meta/test-impact-map.json for targeting. NOTE: that map currently has no targeted
tests registered for projects/idauto/ — run the ID Auto suites explicitly anyway.

GIT RULES
Commit only intended files. Focused commit message. No force-push, no history rewrite,
no amending pushed commits. Push as deploy, then verify HEAD == origin/main.

AI_HANDOVER REQUIREMENTS
Record: baseline SHA, scope, changed files, decisions applied, test results (exact numbers),
production state (unchanged), blockers, implementation commit SHA, remote HEAD, exact next action.

STOP CONDITIONS
Stop at the first real blocker. Never invent stage state. Never claim a stage complete without a
pushed, verified commit. Separate FACT / INFERENCE / PROPOSAL.
```

### 17.3 `PROMPT_HAIKU_PRECHECK`

```
MYTHOS OS — HAIKU PRE-CHECK for MYTHOS-IDENTITY-CORE-0

NO SUBAGENTS. READ-ONLY. Make no changes, no commits, no pushes.

Repository: othoth77/mythos-prod  Worktree: /home/deploy/projects/mythos-prod
Run all Git commands as deploy. GitHub is the source of truth.

PREFLIGHT
- git fetch origin as deploy; report branch, HEAD, origin/main, clean/dirty. Do not modify anything.

BOUNDED TASKS — produce inventories only. Do NOT interpret, redesign, or recommend architecture.

1. IDENTITY REFERENCE INVENTORY
   List every occurrence, with file:line, of: mythos_user_id, mythos_user_ref, organization_id,
   organization_ref, org_id, org_ref, actor_ref, user_role_id, MYTHOS_SUPER_ADMIN
   across projects/**/*.sql, projects/**/*.js, projects/**/*.json, docs/**/*.md.

2. TYPE CONFLICT TABLE
   For each identity-shaped column found in projects/**/*.sql, output:
   file | table | column | declared type. Group by declared type. Flag disagreements.

3. IDENTITY-SHAPED TABLE LIST
   Every CREATE TABLE whose name contains: user, org, role, member, identit, actor, session, tenant.

4. LIVE VS DRAFT
   For each schema file, state whether it is deployed. Only projects/idauto/database/schema.sql is
   live (in idauto-postgres). Confirm by listing live tables:
   docker exec idauto-postgres — read-only query, identifier columns only, never print secrets.

5. LEDGER vs HANDOVER CONSISTENCY
   Compare projects/meta/project-ledger.json against docs/AI_HANDOVER.md. Report only factual
   mismatches: status, next_stage, blockers, commit SHAs. Do not fix them.

6. STALE STAGE-LABEL SCAN
   Find docs claiming a stage is "next"/"blocked"/"not started" that the ledger contradicts.

7. TEST INVENTORY
   List tests/ida-*.js and their assertion counts if declared. Report whether
   projects/meta/test-impact-map.json registers targeted tests for projects/idauto/.

OUTPUT
One structured report. Facts only — file:line evidence for every claim. No architecture opinions,
no schema proposals, no recommendations. If something is ambiguous, say UNKNOWN rather than guessing.

HARD LIMITS
Do NOT make platform architecture, schema, security-policy, migration, or deployment decisions.
Do NOT modify any file. Do NOT commit or push. Do NOT print secrets, tokens, passwords, or env values.
Do NOT touch production services or Jellyfin. Stop at the first real blocker.
```

### 17.4 `PROMPT_HAIKU_POSTCHECK`

```
MYTHOS OS — HAIKU POST-CHECK for MYTHOS-IDENTITY-CORE-0

NO SUBAGENTS. READ-ONLY VERIFICATION. Make no fixes — report only.

Repository: othoth77/mythos-prod  Worktree: /home/deploy/projects/mythos-prod
Run all Git commands as deploy. GitHub is the source of truth.

INPUT: the baseline SHA and the implementation commit SHA from docs/AI_HANDOVER.md.

MECHANICAL CHECKS — each must be PASS or FAIL with evidence.

1. EXPECTED FILES
   git diff --name-only <baseline>..HEAD
   Every changed file must fall within the stage's declared scope (identity contract doc,
   draft core schema, canonical registry correction, draft-schema alignment, adapter spec,
   new test, docs/AI_HANDOVER.md, projects/meta/project-ledger.json). FAIL on anything else.

2. NO UNEXPECTED SCOPE
   FAIL if the diff touches: any running service config, deployment files, js/ runtime,
   index.html, live migrations, projects/idauto/reference/identity.js behaviour,
   or any file under deploy/ or projects/infrastructure/.

3. TESTS — run and report exact numbers:
   node scripts/project-intelligence.js validate      (expect 0 errors / 0 warnings)
   node tests/mpi-0-finalization-governance-test.js   (expect 36/36)
   node tests/devx-0-development-acceleration-test.js (expect 45/45)
   node scripts/mythos-stage.js validate              (all registered stages)
   the new contract-consistency test
   ID Auto regression: tests/ida-2a-*, 2c-*, 2d-*, 2f-*, 2g-*, 2h-*  (expect 195/195 — proves zero runtime impact)

4. DOCS
   docs/AI_HANDOVER.md must record: baseline SHA, scope, changed files, test results,
   commit SHA, remote HEAD, exact next action. FAIL if any is missing.

5. LEDGER
   MYTHOS-IDENTITY-CORE-0 must exist with a non-self-referential next_stage, correct status,
   and populated commit fields. Verify with node scripts/project-intelligence.js validate.

6. NO STALE LABELS
   No doc may still describe the identity contract as undecided, or MYTHOS-IDENTITY-CORE-0 as
   PLANNED, after completion.

7. NO SECRET EXPOSURE
   Scan the diff for password/token/api_key/private_key/BEGIN * PRIVATE KEY/bearer patterns.
   Report placeholders separately from real values. FAIL on any real value.

8. PRODUCTION UNCHANGED
   Confirm container count and that idauto-postgres is healthy with an unchanged memory cap.
   Confirm Jellyfin and all unrelated services are untouched. Confirm no new deployment exists.

9. REGRESSION CHECKLIST
   git diff --check; confirm HEAD == origin/main; confirm the commit is pushed and remote-verified.

OUTPUT
A PASS/FAIL table with evidence per row, then an overall verdict. Report failures precisely — do not
fix them, do not redesign, do not comment on architecture.

HARD LIMITS
Do NOT make architecture, schema, security, migration, or deployment decisions.
Do NOT modify files, commit, or push. Do NOT print secrets. Do NOT touch production or Jellyfin.
Stop at the first real blocker.
```

---

## 18. Risks, Blockers, Deferred

**Active blockers (FACT)**
- `IDA-2E` — BLOCKED: no real Mythos identity/auth service exists. The ecosystem's only registered blocker; addressed by the chosen next stage.
- `INF-CF-2` — blocked on entry criteria (unchanged).
- `RES-1` — not authorised (unchanged).

**Key risks**
- **Contract divergence compounds silently.** Every stage shipped before the contract is frozen widens the `VARCHAR(64)` / `BIGSERIAL` gap. *Mitigation:* the chosen next stage.
- **The free migration window closes at IDA-3.** *Mitigation:* explicit gate in §8.
- **Test-safety hole.** ID Auto changes currently run zero targeted tests via the impact map. *Mitigation:* documented P0, assigned to `DEVX-1`; the Sonnet prompt compensates by naming the ID Auto suites explicitly.
- **ID Auto is complete but unconsumable.** Downstream tracks cannot integrate with an undeployed API. *Mitigation:* `IDAUTO-DEPLOY-0` at Stage 4.
- **Over-platforming.** Guarded by explicit deferral lists in §4.4 and §5.1.

**Deferred (unchanged, with recorded triggers)**
- `IDA-2I` rate limiting → IDA-3 exposure gate.
- ID Auto media backup → before non-disposable media.
- Manual-entry composite transaction → needs designed composite API.
- Fixture lifecycle, MIME sniffing, duplicate FK constraints, `memcache-core-failure` baseline.

---

## 19. Git Evidence

| Item | Value |
|---|---|
| Baseline (review start) | `c3e9f452a3be4432e8f609d88f9fdf74a7e3ee4f` |
| Branch | `main` |
| Worktree at start | clean |
| Git identity | `deploy` |
| Live DB verified | `idauto-postgres` (read-only queries, identifier columns only) |
| Containers at review | 25 running |
| Production mutations | **none** |
| Deployments | **none** |
| Subagents used | **none** |

**Changed by this review:** `docs/MYTHOS_STRATEGIC_EXECUTION_REVIEW_2026-08-11.md` (new), `projects/meta/current-context.json` (regenerated — §16), `docs/AI_HANDOVER.md` (separate handover commit).
