# ID Auto — Roadmap

**Product:** ID Auto
**Domain:** idauto.tn
**Platform:** Mythos ecosystem
**Last updated:** 2026-08-05

---

## Stages

### IDA-0 — Foundation ✓ Complete

**Status:** Complete (2026-08-05)

**Deliverables:**
- `projects/idauto/README.md` — product identity, privacy contract, plate format catalogue
- `projects/idauto/config/idauto.example.json` — configurable rules and feature flags
- `projects/idauto/database/schema.sql` — initial data contract draft (11 tables)
- `docs/IDAUTO_ARCHITECTURE.md` — architecture decisions, integration contracts
- `docs/IDAUTO_ROADMAP.md` — this file

**Scope:** No real data, no UI, no deployment, no personal-data exposure.

---

### IDA-1 — Product Vision, Capture, Access and Data Governance Specification ✓ Current

**Status:** Complete (2026-08-05)

**Objective:** Define the product vision, data capture model, access scopes, Fixpert integration boundaries, and governance constraints before any implementation begins.

**Deliverables:**
- `docs/IDAUTO_PRODUCT_SPEC.md` — product vision, user groups, access matrix, data ownership, vehicle fiche lifecycle, contribution model, super-admin role
- `docs/IDAUTO_CAPTURE_PIPELINE.md` — scanner modes, observation-first flow, plate scan, carte grise OCR, confidence and evidence, conflict handling, review queue, media/location privacy
- `docs/IDAUTO_FIXPERT_INTEGRATION.md` — five-camera context, Smart Gate flow, data ownership boundaries, Fixpert Atelier relationship, deployment prerequisites
- Updated `projects/idauto/README.md` — aligned to Mythos ecosystem, observation-first model
- Updated `projects/idauto/config/idauto.example.json` — v0.2.0-ida1-draft, full configuration sections
- Updated `projects/idauto/database/schema.sql` — 22-table observation-first draft specification
- Updated `docs/IDAUTO_ARCHITECTURE.md` — PostgreSQL target, logical schema separation, three access scopes, new ADs
- Updated `docs/IDAUTO_ROADMAP.md` — this file, IDA-0 through IDA-6

**Key decisions:**
- ID Auto is a Mythos ecosystem product, not an isolated platform
- PostgreSQL selected as target DBMS (not yet installed)
- Observation-first data model (AD-8)
- Three access scopes: PUBLIC, PROFESSIONAL, MYTHOS_PRIVATE (AD-9)
- Smart Gate is MYTHOS_PRIVATE by design (AD-10)
- Plate format rules are UNVERIFIED DRAFTS until confirmed against official source
- LEGAL-REVIEW-REQUIRED items explicitly listed

**Scope exclusions confirmed:** no pipeline code, no OCR, no camera connection, no PostgreSQL, no real data, all feature flags remain `false`.

---

### IDA-2 — PostgreSQL Core, API and Manual Capture MVP

**Status:** IN PROGRESS — Phase A complete and corrected (2026-08-10); Phase B slices **IDA-2B (PostgreSQL provisioning)**, **IDA-2C (read-only API)**, **IDA-2D (write API + atomic audit logging)**, and **IDA-2E-PRE (minimal Mythos identity stub)** complete (2026-08-11); **full `IDA-2E` (real Mythos OS auth service integration) is BLOCKED** — no such service exists anywhere in this codebase, see below; remaining Phase B slices (object storage, UIs, rate limiting) not started
**Depends on:** IDA-1 complete

**Phase A — Schema finalization + plate format validation (complete, no live database):**
- `projects/idauto/database/schema.sql` promoted from "IDA-1 draft" to "IDA-2 Phase A, migration-ready" — re-verified structurally (22 tables, all `idauto_`-prefixed, parentheses balanced, no owner-PII column defined on any table). Still **not applied to any database.**
- `projects/idauto/reference/plate-validator.js` — new, pure/offline plate format normalization + matching against the 7 draft formats in `idauto.example.json` (config-driven, not hardcoded, per IDA-0 AD-3). Format loading is cached per config path (added in the correction below) — safe for repeated per-lookup calls in a future Phase B API handler.
- `tests/ida-2a-schema-and-plate-validation-test.js` — new, 44/44 passing (36 original + 8 added by the correction below).
- Implementation commit: see `docs/AI_HANDOVER.md`'s IDA-2 Phase A entry.

**Correction — IDA-2A-CORRECTION-0 (same day, 2026-08-10)**, following a read-only audit of Phase A:
- **R-T03 resolved:** the scope column was `visibility_scope`, diverging from AutoValeur's canonical `access_scope` naming (tracked risk, severity H/M). Renamed to `access_scope` in `schema.sql` (2 tables: `idauto_observation_media`, `idauto_vehicle_facts`), `docs/IDAUTO_ARCHITECTURE.md`, and `docs/IDAUTO_PRODUCT_SPEC.md`. Not yet applied to a live database — naming is now consistent at the source level; live-migration verification remains Phase B. See `docs/AUTOMOTIVE_RISK_REGISTER.md` R-T03 (now RESOLVED).
- **Stale status docs reconciled:** `docs/AUTOMOTIVE_ROADMAP.md`, `docs/AUTOMOTIVE_OPERATING_MODEL.md`, `docs/AUTOMATION_GOVERNANCE.md`, `docs/AUTOMATION_ROADMAP.md`, `docs/PROJECT_STATISTICS.md` all still said "IDA-2 is the next authorised implementation stage" after Phase A shipped — corrected to reflect Phase A complete / Phase B pending.
- **Safe caching added:** `plate-validator.js`'s `loadFormats()` now caches compiled formats per config path (`clearFormatCache()` for tests/rare reload), so the single-argument `matchPlateFormat(raw)`/`isValidPlate(raw)` forms no longer re-read and re-parse the config + recompile 7 regexes on every call.
- 8 new tests added (2 R-T03 regression lock-in, 6 caching-behavior) — total 44/44 passing.

**Phase B slice plan (2026-08-10, planning only):** the full Phase B scope was too large for one stage — sliced into `IDA-2B` through `IDA-2I`, each requiring its own explicit authorization; see `docs/AI_HANDOVER.md`'s "PLAN — IDA-2 Phase B Slice Plan" entry for the full breakdown, dependency order, and risk/reversibility table.

**IDA-2B — PostgreSQL Provisioning — ✓ COMPLETE (2026-08-11):**
- `postgres:15-alpine` deployed at `/home/deploy/deployments/idauto-postgres/` (dedicated `docker-compose.yml`, own `idauto` bridge network), container `idauto-postgres`.
- **Memory-capped from first start** (never uncapped, even briefly): `mem_limit=384m`, `mem_reservation=96m` — confirmed live at exactly 402653184/100663296 bytes.
- Bound to `127.0.0.1:5432` only — no public network exposure.
- `schema.sql` applied cleanly (0 errors): 22 tables, all `idauto_`-prefixed; `access_scope` (not `visibility_scope`) confirmed live on both affected tables; zero owner-PII columns confirmed live.
- Seed data only, matching the schema file exactly: 7 plate formats, 24 governorates, 7 capture sources, 1 organization (Fixpert pilot placeholder). No synthetic test-vehicle/observation data loaded yet — deferred to whichever later slice first needs it.
- Backup created (`pg_dump --format=custom`, stored outside the container at `/home/deploy/backups/idauto-postgres-20260810/`, root-only directory, 600 file) and **restore tested** end-to-end into an isolated throwaway container (table count, seed row counts, and the `access_scope` column all verified identical after restore) — satisfies `AGENTS.md` §16 ("a backup is valid only after restoration is tested") before this slice was declared complete.
- Full implementation record, exact redeploy/rollback procedure, and safety verification: see `docs/AI_HANDOVER.md`'s IDA-2B entry.

**IDA-2C — Read-only API — ✓ COMPLETE (2026-08-11):**
- `projects/idauto/package.json` + `pg` (node-postgres) — this repository's first real runtime dependency; `node_modules/`/`.env` gitignored, `package-lock.json` committed.
- `projects/idauto/reference/db.js` — thin `pg.Pool` wrapper, all connection parameters from environment variables, parameterized queries only (no raw-SQL escape hatch in the module).
- `projects/idauto/reference/api-read.js` — GET-only HTTP server (Node's built-in `http`, no Express): `/health`, `/api/vehicles/:internal_ref`, `/api/vehicles/:internal_ref/facts`, `/api/plates/:plate_number`, `/api/observations/:id`, `/api/facts/:fact_id/evidence`. Every non-GET request on a matched route returns 405; unmatched routes return 404.
- **Placeholder admin gate**: static bearer token (`IDAUTO_ADMIN_PLACEHOLDER_TOKEN`) required on every route including `/health` — explicitly not real auth. *(As written at IDA-2C completion, this said "replaced by IDA-2E" — actually replaced by `IDA-2E-PRE`'s minimal identity stub, since full `IDA-2E` turned out to be blocked; see below.)*
- **`mythos_private`-scope enforcement**: because no audit-writing path exists yet (that's `IDA-2D`), and the schema's own AD-9 rule requires `mythos_private` access to be audit-logged, this API deliberately excludes all `mythos_private`-scope data — `idauto_vehicle_facts` rows are filtered by `access_scope != 'mythos_private'` at the query level, and `idauto_observations` responses omit every field documented as always-`MYTHOS_PRIVATE` (`capture_time`, `plate_candidate`, `ocr_confidence`, `ip_hash`, `camera_source_id`, `contributor_id`, `capture_session_id`). Verified by test, not just by inspection — the private VIN fact's value never appears anywhere in a response.
- `projects/idauto/database/seed-synthetic-test-data.sql` — one synthetic vehicle/plate/observation/two-facts/evidence row, explicitly marked TEST/SYNTHETIC, applied to the live `idauto-postgres` database (IDA-2B's own entry noted this was deliberately deferred to whichever slice first needed it — this is that slice).
- `tests/ida-2c-readonly-api-test.js` — **24/24 passing**, run live against `idauto-postgres` (not mocked, unlike the Phase A suite) via a server started on an ephemeral port for the test run only; no persistent listening process was left running on the VPS.
- Full implementation record, safety verification, and exact env-var contract: see `docs/AI_HANDOVER.md`'s IDA-2C entry.

**IDA-2D — Write API + Atomic Audit Logging — ✓ COMPLETE (2026-08-11):**
- `projects/idauto/reference/api-read.js` renamed to `api.js` (`git mv`, history preserved) — no longer accurately called "read-only" once write routes existed. IDA-2C's read routes are unchanged; the placeholder admin gate is unchanged and still guards every route, read or write.
- `projects/idauto/reference/writes.js` — new. One shared `withAudit(auditMeta, work)` helper: `BEGIN` → caller's data statement(s) on a shared client → one `INSERT INTO idauto_audit_log` → `COMMIT`, or a single `ROLLBACK` if any part fails. Every write endpoint funnels through this — there is exactly one place transaction atomicity is implemented, not one per endpoint.
- New routes: `POST /api/vehicles`, `POST /api/plates`, `POST /api/observations` (capture_method hardcoded to `manual_admin` — not caller-controlled, since this endpoint *is* the "Admin manual entry" deliverable, not a general ingestion path), `POST /api/vehicles/:internal_ref/facts` (optionally creates its evidence row in the same transaction).
- **Actor identity**: no real user identity exists yet at this point in the sequence — every audit row uses a fixed, non-secret placeholder label (`actor_ref = 'ida-2d-placeholder-admin-gate'`), never the bearer token itself. *(Superseded by `IDA-2E-PRE` below, which replaces this fixed label with a real per-admin identity string.)*
- **`mythos_private` writes now allowed** (a deliberate change from IDA-2C's read-side restriction): since AD-9 requires audit-logging on `mythos_private` access and every write here now gets one, a fact can be created with `access_scope: 'mythos_private'`. **Reads remain restricted** — `GET .../facts` still excludes it, since no audit-on-*read* path exists yet. Verified by test that a mythos_private fact is written+audited but still invisible via GET.
- `db.js` gained `getClientForTransaction()` (a dedicated connection for `BEGIN`/`COMMIT`/`ROLLBACK`), additive to the existing pool-level `query()`.
- Safe error mapping: Postgres `unique_violation`→409, `foreign_key_violation`/`check_violation`/`invalid_text_representation`→400, everything else→generic 500 — the raw driver error message is never echoed to a caller.
- `tests/ida-2d-write-api-and-audit-test.js` — new, **30/30 passing**, live against `idauto-postgres`. Proves atomicity in **both directions**: (1) a data-insert failure (nonexistent vehicle FK, duplicate plate) leaves the audit-log row count unchanged — no phantom audit records for failed attempts; (2) a direct unit-level test deliberately makes the *audit* insert itself fail (an invalid `actor_type`, violating `idauto_audit_log`'s own `CHECK` constraint) after the data insert already ran, and confirms the data insert was rolled back too — not reachable through any HTTP input, since `actor_type` is never caller-controlled, so tested directly against the shared transaction helper.
- `tests/ida-2c-readonly-api-test.js` updated only mechanically for the rename (require path) plus one assertion's wording corrected to no longer claim the file is "read-only" (it verifies the narrower, still-true claim that `api.js` has no *inline* write SQL — all mutation SQL lives in `writes.js`) — all 24 original assertions unchanged and still passing.
- Full implementation record, exact synthetic records created, and safety verification: see `docs/AI_HANDOVER.md`'s IDA-2D entry.

**`IDA-2E` — BLOCKED (2026-08-11), found before any code was written:**
Requested scope was "real Mythos OS auth/identity integration," replacing the placeholder gate, with audit records using the authenticated identity. Researched what that would concretely mean in this codebase (`js/auth.js`, `google_auth.php`/`google_callback.php`, every PHP file, `docs/IDAUTO_ARCHITECTURE.md` §4.1's `mythos_auth` contract) and found: **there is no real Mythos OS auth service anywhere in this repository.** The main "Uthina Chess" app's only auth is a single shared password (SHA-256, client-side-compared, `js/auth.js`) with zero per-user identity. The Google OAuth flow is a one-off contacts-import feature, not login. `MYTHOS_SUPER_ADMIN` is referenced across multiple architecture docs but has no concrete definition anywhere. §4.1 itself says the JWT/opaque-ref protocol was "defined in IDA-1 spec" — but IDA-1 never actually specified one. Building a real multi-user Mythos identity service would be a new platform-wide capability, far outside this slice's stated bounds ("No UI, object storage, or rate limiting" signals a narrow integration, not a ground-up build). No code was written for full `IDA-2E`; it remains blocked until a real identity service exists somewhere to integrate with. Full finding: see `docs/AI_HANDOVER.md`'s IDA-2E blocker entry.

**`IDA-2E-PRE` — Minimal Mythos Identity Stub — ✓ COMPLETE (2026-08-11), scoped in response to the blocker above:**
- `projects/idauto/reference/identity.js` — new. **Not** the `mythos_auth` integration contract (no JWT, no login flow, no session, no user table) — a small, explicit, operator-provisioned map (`IDAUTO_ADMIN_IDENTITIES`, JSON `{token: identity}`) of admin bearer tokens to stable identity strings. Replaces IDA-2C/2D's single undifferentiated `IDAUTO_ADMIN_PLACEHOLDER_TOKEN`.
- `api.js`'s `requireAuth()` now resolves a real identity per request (`req.mythosIdentity`) instead of a boolean match against one shared token.
- `writes.js`'s `withAudit()` now takes the real identity and writes it as `actor_ref` — **fails closed** (throws `401` before opening a transaction) if identity is missing, so there is no code path that writes data with an unattributed audit record.
- All existing read/write behavior and the atomic audit guarantee are unchanged — this stage touched only *how the actor is identified*, not what happens once it is.
- `mythos_private` reads remain restricted, unchanged (per this stage's own explicit instruction: keep them restricted unless full authorization + audit-on-read requirements are satisfied — they are not, in this minimal stub).
- Proven by test, not just implemented: two distinct admin tokens produce two distinct `actor_ref` values in the audit log (not just a relabeled shared secret), and calling a write function with no identity throws before any transaction opens.
- Full implementation record and exact scope boundary versus real `IDA-2E`: see `docs/AI_HANDOVER.md`'s IDA-2E-PRE entry.

**Remaining Phase B slices — not started, each requires separate explicit authorization:**
- `IDA-2E` full (real Mythos OS auth service integration) — **BLOCKED**, see above; would require a separate, much larger stage to first build a real Mythos identity service, which is out of ID Auto's own scope
- `IDA-2F` — Object storage wiring (original image references)
- `IDA-2G` — Admin manual entry UI
- `IDA-2H` — Review queue UI
- `IDA-2I` — Rate limiting backed by `idauto_verifications` (lowest urgency — no public endpoint exists yet in Phase B; may be better scoped into IDA-3 instead, per the slice plan's open question)
- Remaining automated tests toward the 50+ total (44 delivered in Phase A + correction; each slice above adds its own tests, not a separate catch-up stage)

**Objective:** Deploy the PostgreSQL database, implement the core API, and enable admin manual entry for the first test vehicles.

**Deliverables:**
- Target PostgreSQL cluster deployed with `idauto` schema
- Core API: vehicle, plate, observation, fact and evidence endpoints
- Admin manual entry (private, no public ingestion)
- Review queue UI (admin)
- Plate format validation
- Audit logging
- Object storage wiring (original image references)
- Mythos OS auth integration
- Mythos OS audit integration
- Rate limiting backed by `idauto_verifications`
- Synthetic and authorised pilot data only
- 50+ automated tests

**Exclusions:** no public capture, no carte grise OCR, no Smart Gate, no professional subscriptions.

---

### IDA-3 — Public Smart Scanner and Carte Grise Workflow

**Status:** Planned
**Depends on:** IDA-2 API deployed; LEGAL-REVIEW-REQUIRED items resolved for: public image contribution, precise GPS collection, public plate lookup, carte grise OCR, contributor consent

**Objective:** Open the public capture surface — Scanner button, plate/vehicle scan, carte grise OCR — with full privacy controls and the review queue.

**Deliverables:**
- "Scanner un véhicule" button and scanner modes (plate, vehicle, carte grise, import)
- Image quality check, object detection, plate OCR, colour and category detection
- Carte grise OCR with mandatory confirmation form and consent flow
- Owner PII handling (route to Fixpert or discard; never store in idauto schema)
- Contributor accounts, trust score, rate limiting
- Public contribution privacy notice (Arabic + French)
- Deduplication (image hash + plate + time window)
- Review queue populated from public submissions
- Mythos OS notifications integration (review alerts)
- 50+ automated tests

---

### IDA-4 — Fixpert Smart Gate and Atelier Integration

**Status:** Planned
**Depends on:** IDA-3; ATN-1 complete (Atelier Network workshop registry and integration connector — Fixpert must be registered as an ATN workshop before formal Smart Gate integration); LEGAL-REVIEW-REQUIRED resolved for: ANPR regulatory approval, camera disclosure, video retention

**Objective:** Activate the Fixpert Smart Gate on the single designated entrance/exit camera.

**Deliverables:**
- RTSP stream integration (single camera, Fixpert)
- ANPR model integration and calibration
- Entry/exit deduplication (configurable window)
- Direction inference
- `idauto_vehicle_movements` population (MYTHOS_PRIVATE)
- Fixpert Atelier work order link (optional, vehicle_id reference)
- Camera source credential management
- Mythos OS documents integration (carte grise protected storage)
- Mythos OS search integration (ID Auto plates as searchable entities)
- Fixpert professional subscriber onboarding
- 50+ automated tests

**Scope:** One camera only. No other Fixpert cameras. No public movement data.

---

### IDA-5 — Professional Partner Network

**Status:** Planned
**Depends on:** IDA-4

**Objective:** Expand professional access beyond Fixpert to a broader partner network.

**Deliverables:**
- Garage / insurer / fleet / field-team subscription tiers
- Partner onboarding and verification workflow
- Professional field team data collection (authorised capture sources)
- Source quality scoring updated from submission outcomes
- Regional coverage dashboards (by governorate — aggregate only)
- Partner APIs for service event write
- Mythos OS billing integration (subscription plans, renewal)
- Data-source scoring
- 50+ automated tests

---

### IDA-6 — National Enrichment and Public/Professional Launch

**Status:** Future
**Depends on:** IDA-5; legal framework complete; data-source agreement signed with authorised official source (ATTT or equivalent)

**Objective:** Populate the plate and vehicle catalogue from authorised public registry sources and launch idauto.tn publicly.

**Deliverables:**
- Official source data ingestion pipeline
- Deduplication and conflict-resolution rules for imported data
- Public search UI at idauto.tn
- Mobile-optimised search (QR code scan to plate lookup)
- Professional subscription portal (public onboarding)
- Analytics dashboard (aggregate, never individual-level PII)
- SLA and uptime monitoring
- Nationwide partner coverage campaigns
- Public launch

**Exclusions (permanent):** Public tracking of individual vehicles or persons. Individual movement history exposure.

---

## Strategic Growth Milestones

These are strategic targets, not guaranteed forecasts. Each depends on legal approvals and partner agreements.

| Milestone | Target vehicles | Method |
|---|---|---|
| Pilot | 1,000 | Admin manual entry, synthetic test data, correction cycle |
| Early growth | 10,000 | Fixpert Smart Gate + first professional partners |
| Network scale | 100,000 | Professional field network, partner contributions |
| National scale | 500,000+ | Authorised official source ingestion + nationwide partnerships |

---

## Cross-Product Dependency Map

```
Mythos OS (existing, production)
    │
    ├── Auth service        ─────────────────► ID Auto IDA-2+
    ├── Billing service     ─────────────────► ID Auto IDA-3+
    ├── Documents service   ─────────────────► ID Auto IDA-4+
    ├── Notifications       ─────────────────► ID Auto IDA-3+
    ├── Search (MythosSearch) ───────────────► ID Auto IDA-4+
    └── Audit service       ─────────────────► ID Auto IDA-2+

Atelier Network (ATN-0+)
    └── atn_work_orders.vehicle_id ──────────► idauto.vehicles.id (ATN-1+)

Fixpert (first workshop pilot, via Atelier Network)
    └── work_orders.vehicle_id ──────────────► idauto.vehicles.id (IDA-4+, requires ATN-1)
```

ID Auto does not modify Mythos OS `mp_*` tables. Fixpert business data stays in the `fixpert` schema. The Atelier Network registers workshops and work orders with `vehicle_id` references to ID Auto. The dependency is service-consumption only via defined contracts.

---

## LEGAL-REVIEW-REQUIRED (open items before IDA-3/IDA-4 activation)

| Item | Blocking stage |
|---|---|
| Public image contribution — legal basis in Tunisia | IDA-3 |
| Precise GPS collection — consent and notice requirements | IDA-3 |
| Public plate lookup service — legal basis | IDA-3 |
| Carte grise OCR — processing basis and consent flow | IDA-3 |
| Contributor consent design — formal mechanism | IDA-3 |
| ANPR cameras — INPDP notification or approval | IDA-4 |
| Camera disclosure to visitors / employees | IDA-4 |
| Video retention periods under Tunisian law | IDA-4 |
| Official data-source agreement (ATTT or equivalent) | IDA-6 |
| Data retention final periods (all categories) | IDA-2 (interim) |
| Data correction / deletion rights (individuals) | IDA-3 |
| Professional data sharing legal basis | IDA-2 |
| Mythos Super Admin access governance policy | IDA-2 |
