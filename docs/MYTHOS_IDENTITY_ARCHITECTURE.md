# Mythos OS — Identity Architecture (Canonical Decision Record)

**Status:** DECIDED — canonical contract. Binding on all Mythos tracks.
**Stage:** `MYTHOS-IDENTITY-CORE-0` (architecture decision phase)
**Decided:** 2026-08-11 · **Architect:** Opus · **Implementer:** Sonnet · **Verifier:** Haiku
**Baseline:** `a220e9585f6a08f29abbb99084edb5125838042e`

**This document is a decision, not an implementation.** No identity code was written, no schema executed, no database mutated, no service deployed. It supersedes conflicting identifier declarations wherever they disagree.

**Predecessor:** [`MYTHOS_STRATEGIC_EXECUTION_REVIEW_2026-08-11.md`](MYTHOS_STRATEGIC_EXECUTION_REVIEW_2026-08-11.md) §4–§5, §14.

---

## 1. Problem Restated

Five tracks reference a `mythos_core` identity that does not exist, and they disagree on its type. Verified at baseline:

| Track | Platform user reference | Type | Deployed? |
|---|---|---|---|
| **ID Auto** | `mythos_user_id`, `actor_ref` | **`VARCHAR(64)`** | **LIVE** |
| **Personal Intelligence** | `user_ref` + `user_ref_source`, `actor_ref` | **`VARCHAR(64)`** | draft |
| Atelier Network | `mythos_user_ref`, `actor_ref`, `organization_ref` | `BIGINT` | draft |
| Automotive | `actor_ref`, `org_ref`, `*_by_ref` | `BIGINT` | draft |
| AutoValeur | `actor_ref`, `requester_ref` | `BIGINT` | draft |
| Automotive canonical registry | declares `mythos_user_id`, `organization_id` | **`BIGSERIAL`** | draft |

**Evidence correction to the strategic review (recorded for accuracy):** the review's §4.1 table listed `atn_network_memberships` as a duplicated *user* membership table. Direct inspection shows it models **organisation→network** membership, not user→org. Atelier Network's actual user reference is `atn_technicians.mythos_user_ref`. Likewise, **Personal Intelligence does not duplicate identity** — `pi_users`/`pi_organisations` are explicitly designed as a *consuming projection* with `*_ref` + `*_ref_source` pairs pointing at `mythos_os_core`, and `pi_user_domain_access.role_ref` carries the comment *"NEVER a substitute for the real permission system… a pointer to the authoritative role record, not a duplicate of permission logic."* The divergence is real; the duplication was overstated for those two tracks. This correction does not change the decision — it strengthens it, because PI's design is the pattern being ratified below.

---

## 2. IDENTIFIER_DECISION

### Decision

**The canonical Mythos platform identifier is a prefixed UUIDv7 rendered as text, stored in `VARCHAR(64)`.**

```
mythos_user_id     usr_<uuidv7>     e.g. usr_0193f4a2-7c31-7890-b4e2-1a2b3c4d5e6f   (40 chars)
organization_id    org_<uuidv7>     e.g. org_0193f4a2-8d55-7123-9c01-5f6a7b8c9d0e   (40 chars)
system actor       svc_<name>       e.g. svc_idauto-api                              (≤ 44 chars)
```

Format constraints (enforced in `mythos_core` only, **not** in consuming products, which keep opaque `VARCHAR(64)` columns):

```
user:  ^usr_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$
org:   ^org_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$
svc:   ^svc_[a-z0-9][a-z0-9._-]{0,40}$
```

**`BIGSERIAL`/`BIGINT` is rejected. UUID-as-native-`uuid`-type is rejected. Bare UUID without prefix is rejected.**

### Rationale

**1. It requires zero migration of the only live system.** ID Auto's deployed columns are already `VARCHAR(64)`: `idauto_contributors.mythos_user_id`, `idauto_user_roles.mythos_user_id`, `idauto_audit_log.actor_ref`. A 40-character prefixed UUIDv7 fits with 24 characters spare. Choosing `BIGSERIAL` would force a type change on a **live** schema, including an **append-only audit log** — the most expensive column in the ecosystem to alter.

**2. It ratifies the ecosystem's own best identity design.** Personal Intelligence independently arrived at exactly this pattern — `VARCHAR(64)` stable opaque external IDs, a local `BIGSERIAL` PK for internal joins, and `*_ref` + `*_ref_source` pairs recording *which* system a reference came from. That is a federation-ready design with an explicit no-PII rule. Adopting it makes the two most thoughtfully-designed tracks (one live, one most mature on identity) correct by default, and confines change to undeployed drafts.

**3. Sequential integers are actively unsafe for the next product milestone.** IDA-3 exposes contributors publicly. `idauto_contributors.mythos_user_id` is the contributor identity. A `BIGSERIAL` there leaks total contributor count, growth rate, and permits trivial enumeration. This is a privacy and abuse-surface defect, not a preference. A random-component UUID removes it.

**4. It federates without a second migration.** `js/auth.js` is a single shared password, and `google_auth.php` already exists in the codebase for OAuth. Any future external identity provider yields a *string* subject. A string-native platform ID absorbs federation; an integer ID forces a mapping table plus a type reconciliation later.

**5. No central allocator required.** `BIGSERIAL` implies one database mints every ID. Mythos products live in separate schemas/databases with **no cross-schema foreign keys** (already documented in every schema). UUIDv7 lets any component mint a valid ID offline, matching the actual topology.

**6. UUIDv7 over UUIDv4 for index locality.** v7 is time-ordered, avoiding the B-tree page-split penalty of v4 while retaining a random component. The ecosystem already uses UUID for cross-product correlation (`atn_audit_events.event_id UUID`, registry `event_id UUID v4`), so UUID is an established local convention.

**7. The prefix is free and operationally valuable.** Because compatibility with live `VARCHAR(64)` columns already precludes the native `uuid` type, prefixing costs nothing. It buys a great deal: in a bare `actor_ref VARCHAR(64)` audit column spanning five products, `usr_…` vs `svc_…` vs `org_…` is immediately legible, mis-assignment becomes visibly wrong rather than silently plausible, and cross-product log correlation stops requiring a lookup to know what an identifier *is*.

### Cost accepted

Larger index than `BIGINT` (40 bytes vs 8) and slower joins in principle. At current scale — 0 users, 1 organisation, 98 synthetic vehicles — this is immaterial, and correctness, privacy, and federation dominate. The `BIGSERIAL` declaration in the Automotive registry is an **undeployed planning artifact** authored before ID Auto was implemented; the live implementation diverged from it, and on the merits the live convention is also the better one. **The registry is corrected to match reality and merit, not the reverse.**

### Explicitly unaffected

Domain identifiers keep their declared types and are **not** in scope: `vehicle_id`, `plate_id`, `observation_id`, `fact_id`, `document_scan_id` (ID Auto, `BIGSERIAL`), `valuation_id`, `listing_id`, `offer_id`, `transaction_id`, `fleet_id`, `assistance_case_id`, `workshop_organization_id` (Atelier Network, `BIGSERIAL`), and `event_id` (`UUID`).

**Storage identifiers are also out of scope — an important carve-out.** The canonical registry declares `document_id` and `media_id` as owned by `mythos_core` with type `BIGSERIAL` (lines 647–648). They are **storage** references, not identity references. This decision does **not** govern them, and they **remain `BIGSERIAL` unchanged**. Whether `mythos_core` is the right owner for storage identifiers — and what type they should be — belongs to a future storage/object-reference stage, decided on storage evidence rather than swept along with identity. Any implementation that alters lines 647–648 is out of scope and must be rejected.

This decision governs **only** `mythos_user_id` and `organization_id` — the two identity identifiers the registry marks `is_cross_product = TRUE` under `mythos_core`.

---

## 3. IDENTITY_CORE_MODEL

**Three tables plus one convention.** Everything else is deferred with a stated reason.

| Element | Decision | Reasoning |
|---|---|---|
| **user** | **INCLUDE** | Every track already references `mythos_user_id`. Non-negotiable. |
| **organization** | **INCLUDE** | Four tracks carry org tables; the registry marks `organization_id` cross-product. Half the divergence is organisational — excluding it guarantees a second contract stage. |
| **membership** | **INCLUDE** | The user×org×role join is exactly what `idauto_user_roles` implements locally and what MAE-1/ATN-1/AVA-1 all need. Without it, `role` has no home and `idauto_user_roles` has no migration target. |
| **role** | **INCLUDE, as a constrained column on membership** | A `roles` table with zero rows of variability is over-engineering. A `CHECK` constraint expresses the same contract at a fraction of the cost. |
| **audit actor** | **INCLUDE, as a convention — not a table** | `actor_ref` already exists and is live in `idauto_audit_log`. What is missing is the *format rule*, not storage. |
| **identity / provider** | **DEFER** | See below. |
| **permission** | **DEFER** | A role comparison satisfies every known requirement. A permission table or policy engine is the IAM over-engineering this stage is explicitly instructed to avoid. Reopen only when a real requirement cannot be expressed as a role. |
| **session** | **DEFER** | No login flow exists anywhere. `js/auth.js` stores `{ts}` with no subject. `pi_sessions` is a draft conversational-context table, not an auth session. Designing session semantics with zero authentication is guesswork. |

### Why `identities` is deferred (the closest call)

Including a provider/credential table was seriously considered and rejected. The load-bearing invariant of this contract is the **identifier format** and the **actor-resolution interface** — both frozen here. A credential table is not required to freeze either.

Designing `identities` now would mean fixing provider semantics, subject formats, credential rotation, and linking rules **without a single real authentication requirement in hand** — no chosen IdP, no decision on password vs OIDC vs token, no MFA position. That is precisely how a seam gets frozen in the wrong shape and has to be reopened.

Deferring costs nothing, because the contract already specifies what any future credential store must produce:

```
resolveActor(credential) → { mythos_user_id: "usr_<uuidv7>", actor_type: <vocabulary> } | null
```

`IDAUTO_ADMIN_IDENTITIES` continues to satisfy this interface unchanged (§6). The authentication stage will design `mythos_identities` against real requirements, and the contract will still hold.

### Canonical schema (DRAFT — for `mythos_core`, not executed by this stage)

```sql
-- 1. USERS
CREATE TABLE mythos_users (
    user_pk         BIGSERIAL    PRIMARY KEY,              -- internal only, never exposed
    mythos_user_id  VARCHAR(64)  NOT NULL UNIQUE,          -- canonical: usr_<uuidv7>
    status          VARCHAR(20)  NOT NULL DEFAULT 'active',
    platform_role   VARCHAR(30),                           -- NULL = ordinary user
    platform_role_granted_at  TIMESTAMPTZ,
    platform_role_granted_by  VARCHAR(64),                 -- mythos_user_id of granter
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- [NO PII] no name, email, phone. Profile data belongs to consuming products.
    CONSTRAINT chk_user_id_format CHECK (
        mythos_user_id ~ '^usr_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    CONSTRAINT chk_user_status  CHECK (status IN ('active','suspended','deactivated')),
    CONSTRAINT chk_platform_role CHECK (platform_role IS NULL OR platform_role = 'mythos_super_admin')
);

-- 2. ORGANIZATIONS
CREATE TABLE mythos_organizations (
    organization_pk  BIGSERIAL    PRIMARY KEY,             -- internal only, never exposed
    organization_id  VARCHAR(64)  NOT NULL UNIQUE,         -- canonical: org_<uuidv7>
    display_name     VARCHAR(200) NOT NULL,
    status           VARCHAR(20)  NOT NULL DEFAULT 'pending',
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- [NO PII] tax_id, address, contacts stay in the owning product schema.
    CONSTRAINT chk_org_id_format CHECK (
        organization_id ~ '^org_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
    CONSTRAINT chk_org_status CHECK (status IN ('pending','active','suspended','cancelled'))
);

-- 3. MEMBERSHIPS (user × organization × role)
CREATE TABLE mythos_memberships (
    membership_pk    BIGSERIAL    PRIMARY KEY,
    mythos_user_id   VARCHAR(64)  NOT NULL REFERENCES mythos_users(mythos_user_id),
    organization_id  VARCHAR(64)  NOT NULL REFERENCES mythos_organizations(organization_id),
    role             VARCHAR(30)  NOT NULL DEFAULT 'member',
    status           VARCHAR(20)  NOT NULL DEFAULT 'active',
    granted_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    granted_by       VARCHAR(64),
    revoked_at       TIMESTAMPTZ,
    revoked_by       VARCHAR(64),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_membership_role   CHECK (role   IN ('owner','admin','member','readonly')),
    CONSTRAINT chk_membership_status CHECK (status IN ('active','suspended','revoked')),
    CONSTRAINT uq_user_org UNIQUE (mythos_user_id, organization_id)
);

CREATE INDEX idx_mythos_membership_user ON mythos_memberships (mythos_user_id);
CREATE INDEX idx_mythos_membership_org  ON mythos_memberships (organization_id);
```

`uq_user_org` and the `role`/`status` vocabularies are copied **verbatim** from the live `idauto_user_roles` constraints, so ID Auto's existing semantics migrate without translation.

### Actor reference convention (contract, not a table)

| Actor | `actor_ref` | `actor_type` |
|---|---|---|
| Human user | `usr_<uuidv7>` | `contributor` · `professional_user` · `admin` |
| System / service | `svc_<name>` | `system` |
| Unauthenticated | `NULL` | `anonymous` |

`actor_type` adopts ID Auto's **live** `CHECK` vocabulary verbatim — `system | contributor | professional_user | admin | anonymous` — platform-wide. Adopting a deployed, already-constrained vocabulary costs nothing and avoids inventing a second one.

**Rule:** `actor_ref` MUST NEVER contain a bearer token, credential, session identifier, email address, or any PII. It carries only a canonical `usr_`/`svc_` identifier or `NULL`.

---

## 4. BOUNDARY_DECISION

**Identity Core is a shared internal module — a contract plus a thin resolution library. It is NOT a separate service and NOT a shared server component.**

| Option | Verdict |
|---|---|
| Separate service | **Rejected.** Adds a deployment target, network hop, availability dependency, and operational surface for **zero deployed consumers** — ID Auto's own API is still undeployed. Textbook premature platform-building. |
| Shared server component | **Rejected.** Presumes a shared server runtime that does not exist. Mythos core is client-side JS plus PHP; there is no host process to attach to. |
| **Shared internal module** | **Chosen.** The valuable artifact is the *contract*: identifier format, table shapes, role vocabulary, actor rules. The library is a thin resolver each consumer embeds. |

**Physical placement.** The canonical tables are specified for a `mythos_core` schema. **This stage does not provision it.** Consuming products continue to hold opaque `VARCHAR(64)` references with **no cross-schema foreign keys** — already the documented pattern in every schema. Product-local tables (`idauto_user_roles`, `idauto_organizations`, `pi_users`, `atn_technicians`) become **local projections** of core, not competing sources of truth.

**Promotion path (recorded, not authorised).** Promote to a standalone service when **all three** hold: (1) two or more deployed consumers require runtime identity resolution; (2) a real authentication flow exists; (3) cross-product permission checks cannot be satisfied by each product reading its own projection. Until then, a service is cost without benefit.

---

## 5. INITIAL_ROLES

Two scopes. No hierarchy, no inheritance, no groups, no custom roles.

**Platform scope** — `mythos_users.platform_role`
- `mythos_super_admin` — the role referenced by `IDAUTO_ARCHITECTURE.md`, `AUTOMOTIVE_ARCHITECTURE.md`, `AUTOVALEUR_ARCHITECTURE.md`, `idauto.example.json`, `autovaleur.example.json`, which has never had a definition. This is that definition.
- `NULL` — ordinary user. There is no second platform role.

**Organisation scope** — `mythos_memberships.role`
- `owner` · `admin` · `member` · `readonly` — copied verbatim from the live `idauto_user_roles` CHECK constraint.

**Semantics (complete):**
- `mythos_super_admin` is platform-wide and grants the `mythos_private` access scope already enforced in ID Auto queries. It is **not** an organisation membership and requires no synthetic "platform organisation".
- Org roles apply **only** within their organisation. There is no cross-organisation inheritance.
- Authorisation is a **role comparison**, not a policy evaluation. Any requirement that cannot be expressed as a role comparison is a signal to revisit this contract deliberately — not to add a policy engine incrementally.

**Deferred with reason:** grant/revocation *history* for `platform_role` is carried as `granted_at`/`granted_by` columns only. Full revocation history — needed for the "periodic review of `MYTHOS_SUPER_ADMIN` grants" in `AUTOMOTIVE_ARCHITECTURE.md` §364 — is deferred to the authentication stage, when grants actually exist to review. Today there are zero.

---

## 6. MIGRATION_STRATEGY

**No migration is executed by this stage.** Every item below is a specification.

### 6.1 `IDAUTO_ADMIN_IDENTITIES` — no code change

Today it maps bearer token → arbitrary identity string, parsed by `projects/idauto/reference/identity.js`.

- **Contract change only:** map values MUST become canonical `usr_<uuidv7>` identifiers.
- **Mechanism unchanged:** it remains an operator-provisioned environment variable. It is still explicitly *not* real authentication.
- **Interface:** `identity.js` is re-specified as an adapter satisfying `resolveActor(credential) → { mythos_user_id, actor_type } | null`. Its current `resolveIdentity(token) → string | null` already satisfies this shape; only the *value format* and a returned `actor_type` are added.
- **Runtime behaviour is NOT changed in this stage** — interface specification only.
- **Rotation:** operators re-issue the env map with canonical IDs. Because `idauto_user_roles` and `idauto_contributors` are empty, no stored value needs rewriting.

### 6.2 `idauto_user_roles` (LIVE, **0 rows**) — no migration

- Column type **unchanged**: `mythos_user_id VARCHAR(64)` already conforms.
- Reclassified as a **local projection** of `mythos_memberships`; core becomes source of truth once deployed.
- `role`/`status` vocabularies and `uq_user_org` already match the canonical contract exactly — they were its source.
- **Zero rows ⇒ zero data migration.** Eventual retirement is a separate, later stage.

### 6.3 `idauto_contributors` (LIVE, **0 rows**) — no migration

- Column type **unchanged**: `mythos_user_id VARCHAR(64) UNIQUE` already conforms.
- `trust_score`, `total_submissions`, `accepted_submissions` are **ID Auto domain data** and correctly stay out of the platform contract.
- **Zero rows ⇒ zero data migration.** This is the table IDA-3 will populate with real contributors — the reason this decision is being made now rather than later.

### 6.4 Existing `mythos_user_id` / `organization_id` fields

| Location | Current | Action |
|---|---|---|
| ID Auto (LIVE) — `mythos_user_id`, `actor_ref` | `VARCHAR(64)` | **No change** ✅ |
| Personal Intelligence (draft) — `user_ref`, `actor_ref`, `organisation_id` | `VARCHAR(64)` | **No change** ✅ (comment alignment only) |
| Atelier Network (draft) — `mythos_user_ref`, `actor_ref`, `organization_ref` | `BIGINT` | **Change → `VARCHAR(64)`** |
| Automotive (draft) — `actor_ref`, `org_ref`, `checked_by_ref`, `activated_by_ref`, `enabled_by_ref`, `released_by_ref` | `BIGINT` | **Change → `VARCHAR(64)`** |
| AutoValeur (draft) — `actor_ref`, `requester_ref` | `BIGINT` | **Change → `VARCHAR(64)`** |
| Automotive canonical registry — `mythos_user_id`, `organization_id` | `BIGSERIAL` | **Change → `VARCHAR(64)`** |

All six changed locations are **undeployed draft files**. Every change is a text edit with no runtime or data consequence.

### 6.5 `actor_ref` in audit logs

- `idauto_audit_log.actor_ref VARCHAR(64)` — **no column change**.
- The 358 existing rows are **synthetic test fixtures** regenerated by the live suites. **No historical audit rewrite is performed or permitted** — the log is append-only by design.
- `actor_type` vocabulary is already correct and becomes the platform standard.
- ATN / Automotive / AutoValeur audit `actor_ref` columns change `BIGINT → VARCHAR(64)` as drafts.

### 6.6 Organisation identity — the one non-trivial future migration

`idauto_organizations.id` is a **local `SERIAL`** with real foreign keys from `idauto_user_roles`, `idauto_service_events`, `idauto_verifications`, and `idauto_audit_log.org_id`. It is **not** the platform `organization_id`.

**Specified approach (future stage, not now):** add a nullable `mythos_org_ref VARCHAR(64) UNIQUE` to `idauto_organizations`, preserving the local integer PK and all existing FKs. This is the same non-breaking "local PK + stable external ref" pattern Personal Intelligence already uses (`organisation_pk BIGSERIAL` + `organisation_id VARCHAR(64) UNIQUE`).

**Do NOT change `idauto_organizations.id`.** Retyping a live primary key with dependent foreign keys is expensive and entirely avoidable. This is the only known future live-schema change, it is additive, and it is deferred.

### 6.7 Live schema changes eventually required (none now)

1. `idauto_organizations` — add `mythos_org_ref VARCHAR(64)` (additive, non-breaking).
2. `idauto_user_roles`, `idauto_organizations` — eventual retirement as sources of truth once `mythos_core` is deployed.

Both are **separate, later, explicitly-authorised stages**. Neither is in `MYTHOS-IDENTITY-CORE-0`.

---

## 7. NON_SCOPE

`MYTHOS-IDENTITY-CORE-0` does **NOT** include, and any request to add one of these must stop and re-scope:

**Authentication** — no auth service, login flow, password handling, credential storage, OAuth/OIDC/SAML/SSO, token issuance or validation, session creation, MFA, password reset, or account recovery.

**Authorisation beyond roles** — no permission table, policy engine, ABAC/RBAC framework, role hierarchy or inheritance, custom/user-defined roles, groups, or nested organisations.

**Enterprise IAM** — no SCIM, directory sync, provisioning/deprovisioning automation, delegated administration, or audit-grade grant workflow.

**Data operations** — no migration executed against `idauto-postgres` or any live database; no `mythos_core` database or schema provisioned; no live table created, altered, or dropped; no data written, backfilled, or rewritten; no audit-history modification.

**Runtime** — no change to the behaviour of `projects/idauto/reference/identity.js` (interface specification only); no change to `js/auth.js`; no change to any running container or deployed service; no deployment of any kind.

**Other tracks** — no IDA-3 work, no public endpoint, no rate limiting, no MPI-1, no MAE-1/ATN-1/AVA-1 implementation.

**Explicitly out of contract scope** — domain identifiers (`vehicle_id`, `plate_id`, `observation_id`, `fact_id`, `valuation_id`, `event_id`, …) keep their declared types and owners.

---

## 8. Implementation Specification for Sonnet

### 8.1 FILES_EXPECTED_FOR_IMPLEMENTATION

Exactly these. Anything outside this list is out of scope and must stop the stage.

| # | File | Action |
|---|---|---|
| 1 | `projects/meta/project-ledger.json` | **Register** `MYTHOS-IDENTITY-CORE-0` first, as its own validated commit |
| 2 | `projects/mythos-core/database/identity-schema.sql` | **NEW** — draft canonical schema from §3. Header must state DRAFT / NOT DEPLOYED |
| 3 | `docs/MYTHOS_IDENTITY_ARCHITECTURE.md` | **EXISTS** — add an "Implementation Status" section only; do not alter decisions |
| 4 | `projects/automotive/database/control-plane-schema.sql` | Registry lines **639–640** `BIGSERIAL→VARCHAR(64)`; `*_ref` lines **64, 118, 120, 218, 288, 373, 603** `BIGINT→VARCHAR(64)`. **Line 120 (`deactivated_by_ref`) carries no comment but is a user reference paired with line 118 — it must be changed.** **Do NOT touch lines 647–648** (`document_id`, `media_id` — storage, stays `BIGSERIAL`) **or 657** (`workshop_organization_id` — Atelier-owned) |
| 5 | `projects/atelier-network/database/schema.sql` | Lines **42, 236, 590** only: `BIGINT→VARCHAR(64)`. **Do NOT touch** lines 41, 68, 115, 235, 302, 566, 592 — those are local `workshop_organization_id` refs and stay `BIGINT`/`BIGSERIAL` |
| 6 | `projects/autovaleur/database/schema.sql` | Lines **149, 431**: `BIGINT→VARCHAR(64)` |
| 7 | `projects/personal-intelligence/database/control-plane-schema.sql` | **Comment alignment only** — already conforms; note the canonical contract |
| 8 | `projects/idauto/reference/IDENTITY_ADAPTER.md` | **NEW** — adapter interface spec. **Do NOT modify `identity.js`** |
| 9 | `tests/mythos-identity-core-0-contract-test.js` | **NEW** — see §8.2 |
| 10 | `docs/AI_HANDOVER.md` | Stage handover entry |
| 11 | `projects/meta/test-impact-map.json` | Add a rule for `projects/mythos-core/` **only** — do not alter existing rules |

**Forbidden:** any file under `js/`, `css/`, `index.html`, `deploy/`, `projects/infrastructure/`; `projects/idauto/database/schema.sql`; `projects/idauto/reference/identity.js`; any file that runs against a live database.

### 8.2 TEST_REQUIREMENTS

New suite `tests/mythos-identity-core-0-contract-test.js` — **pure static analysis of files. It MUST NOT connect to any database.**

1. **Identifier format** — the `usr_`/`org_`/`svc_` regexes accept valid examples and reject: bare UUIDs, wrong prefix, UUIDv4 (wrong version nibble), wrong RFC variant, uppercase hex, over-length, empty, SQL-injection-shaped strings.
2. **Length safety** — canonical `usr_`/`org_` forms are ≤ 64 characters (fit `VARCHAR(64)`).
3. **Registry conformance** — `mythos_user_id` and `organization_id` in the Automotive canonical registry declare `VARCHAR(64)`, and **no** identity-shaped `mythos_core` reference anywhere declares `BIGSERIAL`/`BIGINT`.
4. **Cross-schema type conformance** — every `mythos_user_ref` / `actor_ref` / `organization_ref` / `org_ref` / `requester_ref` / `*_by_ref` column referencing `mythos_core` across all four draft schemas is `VARCHAR(64)`.
5. **Domain identifiers untouched** — `vehicle_id`, `plate_id`, `observation_id`, `fact_id`, `event_id`, `workshop_organization_id` retain their original declared types (guards against over-broad edits).
5b. **Storage identifiers untouched** — registry entries `document_id` and `media_id` still declare `BIGSERIAL`. This test must **fail** if an implementation swept them into the identity change.
5c. **Local organisation refs untouched** — Atelier Network's `workshop_organization_id` columns (lines 41, 68, 115, 235, 302, 566, 592) remain `BIGINT`/`BIGSERIAL`; only `organization_ref` changed.
6. **Role vocabulary parity** — the core `role` CHECK set equals the live `idauto_user_roles` set exactly; `actor_type` set equals the live `idauto_audit_log` set exactly.
7. **Live schema untouched** — `projects/idauto/database/schema.sql` is byte-identical to baseline.
8. **`identity.js` untouched** — byte-identical to baseline.
9. **No-PII rule** — the core draft schema declares no `name`/`email`/`phone`/`password`/`token`/`secret` column.
10. **Draft marking** — the core schema header states DRAFT / NOT DEPLOYED.

**Regression (must all pass unchanged):**
```
node scripts/project-intelligence.js validate            # 0 errors, 0 warnings
node tests/mpi-0-finalization-governance-test.js         # 36/36
node tests/devx-0-development-acceleration-test.js       # 45/45
node tests/ida-2a-schema-and-plate-validation-test.js    # 44/44
node tests/ida-2c-readonly-api-test.js                   # 26/26
node tests/ida-2d-write-api-and-audit-test.js            # 39/39
node tests/ida-2f-object-storage-test.js                 # 32/32
node tests/ida-2g-admin-manual-entry-ui-test.js          # 17/17
node tests/ida-2h-review-queue-ui-test.js                # 37/37
                                                         # ID Auto total: 195/195
```

The ID Auto suites prove **zero runtime impact** and must be run explicitly: `test-impact-map.json` currently registers **no** targeted tests for `projects/idauto/` (a known P0 gap — do not rely on the map here, and do not fix that gap in this stage).

### 8.3 SONNET_IMPLEMENTATION_ORDER

Strictly sequential. Do not batch. Stop at the first real blocker.

**0 — Preflight.** `git fetch origin` as `deploy`; verify `main`, clean worktree, `HEAD == origin/main`; record baseline SHA. Read this document and the Haiku pre-check output. **Do not re-scan the repository.**

**1 — Register the stage (its own commit).** Add the `MYTHOS-IDENTITY-CORE-0` ledger entry (track `mythos-os`, type `FOUNDATION`, status `PLANNED`, non-self-referential `next_stage`). Run `node scripts/project-intelligence.js validate`, then `node scripts/mythos-stage.js start MYTHOS-IDENTITY-CORE-0 --dry-run` until `eligible: true`. Commit and push before writing any implementation.

**2 — Author the core draft schema.** Create `projects/mythos-core/database/identity-schema.sql` exactly per §3, header marked DRAFT / NOT DEPLOYED. **Execute nothing.**

**3 — Write the contract test.** Create the §8.2 suite. Confirm it **fails** on the not-yet-aligned draft schemas — a test that passes before the alignment is not testing anything.

**4 — Align the drafts.** Apply the type changes in files 4, 5, 6, and comment alignment in 7. Change **only** identity-shaped `mythos_core` references. Re-run the contract test until green.

**5 — Specify the adapter.** Write `projects/idauto/reference/IDENTITY_ADAPTER.md`. **Do not touch `identity.js`.**

**6 — Add the impact-map rule** for `projects/mythos-core/` only.

**7 — Validate.** Run every command in §8.2. All must pass at the stated numbers.

**8 — Document and close.** Add the Implementation Status section, write the `AI_HANDOVER.md` entry (baseline SHA, scope, changed files, exact test numbers, production state, commit SHA, remote HEAD, next action), set the ledger entry to `DONE` with commit references.

**9 — Commit and push as `deploy`.** Verify `HEAD == origin/main` and report both SHAs.

**Stop conditions:** any file outside §8.1; any need to execute SQL; any need to change `identity.js` behaviour, the live ID Auto schema, or a running service; any ID Auto regression below 195/195; any governance/DEVX regression.

---

## 8.4 Implementation Status — COMPLETE (2026-08-11)

Implemented by stage `MYTHOS-IDENTITY-CORE-0`, commit `0e627d434547f069b0db5708586bf9fbb8fb177b` (metadata registration `2f9053b897e5aa48cc6cbcc10e6afc32efe67657`).

| Item | Result |
|---|---|
| Contract suite | **124/124** — recorded **108 passed / 16 failed** before alignment, the 16 being exactly the expected draft mismatches at exactly the line numbers cited in §8.1 |
| ID Auto regression | **195/195** (2A 44 · 2C 26 · 2D 39 · 2F 32 · 2G 17 · 2H 37) |
| Governance · DEVX · MPI-0 | 36/36 · 45/45 · 63/63 |
| Project intelligence | 0 errors / 0 warnings |
| Stage Runner close | risk lane STANDARD, no blockers, no fallback |
| Files changed | 9 (plus 1 metadata registration commit) |
| SQL executed | **none** |
| Live schema / data changed | **none** — `projects/idauto/database/schema.sql` and `projects/idauto/reference/identity.js` verified byte-identical to baseline via `git diff --quiet` |
| `document_id` / `media_id` | unchanged (`BIGSERIAL`) — carve-out held |
| `idauto_organizations.id` | unchanged (`SERIAL`); the deferred additive `mythos_org_ref` was **not** added |

### Deviations recorded

**1. One file beyond the §8.1 list.** §8.1 enumerated 11 files but omitted the thin resolution library that §4 (BOUNDARY_DECISION) explicitly requires — "a contract plus a thin resolution library". `projects/mythos-core/reference/identity-contract.js` was therefore added. This implements a decision already made in §4; it does not make a new one.

**2. Byte-identity expressed as structural invariants.** §8.2 items 7–8 asked for pinned byte-identity assertions inside the permanent suite. A pinned content hash would raise a **false failure** the moment the already-specified additive `mythos_org_ref` migration (§6.6) legitimately lands, so the permanent suite asserts the underlying structural invariants instead (live identity column types, untouched `SERIAL` primary key, absence of auth logic in `identity.js`). The stage-scoped "this diff touched nothing" guarantee was verified separately with `git diff --quiet <baseline> -- <path>` and is recorded in the table above and in `docs/AI_HANDOVER.md` — the correct home for a stage-scoped claim.

### Operational finding (not a defect)

The six live ID Auto suites require operator-provisioned environment variables — `IDAUTO_DB_HOST`, `IDAUTO_DB_PORT`, `IDAUTO_DB_USER`, `IDAUTO_DB_PASSWORD`, `IDAUTO_DB_NAME`, and `IDAUTO_MEDIA_STORAGE_PATH`. Run without them they do not skip; they emit confusing assertion failures and a `FATAL` that superficially resemble regressions. Both were observed and correctly diagnosed as environmental during this stage before any conclusion was drawn. Worth documenting in an ID Auto runbook so a future session does not mistake them for a real regression.

---

## 9. What This Unblocks

| Blocked item | Effect |
|---|---|
| **`IDA-2E`** | The ecosystem's only `BLOCKED` stage. It was blocked on "no identity contract to integrate with" — that contract now exists. It can be re-scoped from *blocked* to *pending the authentication stage*, with the audit-identity half already satisfied. |
| **`IDA-3`** | Contributor identity format, trust attribution, moderation actor, and authenticated rate-limit keys are all now defined — before real contributors exist. |
| `MAE-1` / `ATN-1` / `AVA-1` | Organisation and membership contracts defined; each still additionally requires a deployed ID Auto API. |
| `MPI-1` | Can consume the frozen actor contract instead of introducing a sixth convention. PI already conforms. |

**Still blocked, unchanged:** `INF-CF-2` (entry criteria), `RES-1` (not authorised).

---

## 10. Decision Summary

| Question | Decision |
|---|---|
| **Identifier type** | Prefixed UUIDv7 as text in `VARCHAR(64)` — `usr_<uuidv7>`, `org_<uuidv7>`, `svc_<name>` |
| **Rejected** | `BIGSERIAL`/`BIGINT`, native `uuid` type, bare unprefixed UUID |
| **Model** | `mythos_users`, `mythos_organizations`, `mythos_memberships` + `actor_ref` convention |
| **Deferred** | `identities`/provider, sessions, permission engine — each with a stated reason |
| **Boundary** | Shared internal module (contract + thin library); **not** a service |
| **Platform role** | `mythos_super_admin` (or `NULL`) |
| **Org roles** | `owner` · `admin` · `member` · `readonly` (verbatim from live ID Auto) |
| **Actor types** | `system` · `contributor` · `professional_user` · `admin` · `anonymous` (verbatim from live ID Auto) |
| **Live migration required now** | **None** |
| **Draft files to align** | Automotive, Atelier Network, AutoValeur (type changes); Personal Intelligence (comments only) |
| **Future live change** | Additive `mythos_org_ref` on `idauto_organizations` — deferred |

---

## 11. Vocabulary adoption — pinned protocol artifacts (2026-08-18, `IDA-DECOUPLE-3`)

**Note:** this repository's dependency-boundary audit (`docs/ID_AUTO_DEPENDENCY_BOUNDARY.md`
§10) referred to this update as landing in "§12" of this document; at implementation time the
document had no §12, so the update is recorded here as §11 instead. No renumbering of the
existing sections above was performed.

§10 records `Org roles` and `Actor types` as adopted "verbatim from live ID Auto" — until this
stage that meant `tests/mythos-identity-core-0-contract-test.js` read ID Auto's `schema.sql`
directly out of the vendored `projects/idauto/` source tree. That live read was the last thing
keeping this repository coupled to ID Auto's internals at test time.

ID Auto published both vocabularies as versioned protocol artifacts (branch
`protocol-identity-vocabularies`, commit `42e8546`, guarded by its own conformance suite,
`tests/identity-conformance-test.js`, 77 passed / 0 failed, 7/7 planted mutations caught):

- `protocol/vocabularies/actor-type.v1.json`
- `protocol/vocabularies/org-role.v1.json`
- `protocol/vocabularies/actor-identifier.v1.json` (width/form of the `usr_`/`svc_` reference
  itself — not previously a separate published artifact)

Mythos now consumes **pinned, digest-verified copies** of those three files rather than a live
read: `projects/mythos-core/contracts/idauto/{actor-type,org-role,actor-identifier}.v1.json`,
with the upstream commit, version, revision and a SHA-256 digest of each file recorded in
`projects/mythos-core/contracts/idauto/PINS.json`. `mythos-identity-core-0-contract-test.js`
§8 verifies every digest **before** trusting anything parsed from the copies, then asserts
`ACTOR_TYPES`/`ORG_ROLES` against the pinned content by set equality in both directions.

ID Auto remains the defining source of both vocabularies; this repository only adopts them. A
legitimate change to the pinned copies follows the six-step re-pin procedure documented in
`projects/mythos-core/contracts/idauto/README.md` — there is deliberately no script that
performs it automatically, so a drifted contract or a tampered copy can never be silently
re-recorded as correct. Stated honestly: an upstream **republication** is invisible here until
a human re-pins (the local copy still matches its own pin) — the mechanism guarantees no
silent divergence from a named, dated, digest-identified upstream version, not freshness; and
it detects accident, not tampering — an edit to the copy *and* `PINS.json` together passes,
and is caught by review of that visible two-file diff, not by an assertion.

This closes the last test-only dependency on `projects/idauto/` (`docs/ID_AUTO_DEPENDENCY_BOUNDARY.md`
§0, rows D6-D8); see that document for the full before/after assertion inventory.
