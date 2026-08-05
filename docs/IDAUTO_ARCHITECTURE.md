# ID Auto — Architecture

**Stage:** IDA-0 Foundation  
**Last updated:** 2026-08-05  
**Domain:** idauto.tn  
**Repository:** othoth77/mythos-prod

---

## 1. Product Position

ID Auto is a vehicle-plate lookup and professional subscription platform for Tunisia. It is a **separate product** from Mythos OS, sharing the same repository but operating entirely independent data stores and deployment surface. Mythos OS is the host platform from which shared services (auth, billing, audit, notifications, search) are consumed via defined integration contracts.

---

## 2. Founding Architecture Decisions

### AD-1 — Strict storage namespace separation

**Decision:** All ID Auto tables use the `idauto_` prefix. No cross-table joins or shared tables with Mythos OS `mp_*` tables are permitted at the data layer.

**Why:** Mythos OS holds live production data for one paying client. ID Auto is a new product with its own lifecycle, deployment schedule, and compliance requirements. Mixing namespaces would create migration risk and compliance ambiguity.

**Enforcement:** Database schema (`database/schema.sql`) contains only `idauto_` tables. A future schema migration must never add an `idauto_` table to a database that contains `mp_*` tables without an explicit isolation review.

---

### AD-2 — Privacy-by-design: public search never returns owner PII

**Decision:** The public plate search endpoint returns only vehicle attributes (make, model, year, body type, fuel type, colour, plate status, governorate). Owner name, address, national ID, phone, insurance identity and any other personal information are never returned and are not stored in any table queryable by plate number.

**Why:** Tunisian organic law 63-2004 on personal data protection, and reasonable expectation of privacy for vehicle owners, prohibit exposing owner identity through a public lookup service. This is also the product's core trust proposition.

**Enforcement:**
- `idauto_vehicles` has no owner columns — absence is explicit with `-- [NO PII]` comments.
- `idauto_plates` has no owner columns.
- `config/idauto.example.json` explicitly lists `response_fields_never_public`.
- The data model has no join path from plate number to owner PII without passing through a separately-gated consent/legal-basis check.

---

### AD-3 — Plate formats as configurable rules, not hardcode

**Decision:** Tunisian plate format patterns are defined in `config/idauto.example.json` and seeded into `idauto_plate_formats`. No format regex is hardcoded in application logic.

**Why:** The Tunisian traffic authority introduces new series (government, economic zone, etc.) without advance notice. A configurable catalogue allows format additions without code deployment.

**Enforcement:** `idauto_plate_formats.pattern` column holds the POSIX regex. Application code reads from the catalogue at startup.

---

### AD-4 — Immutable audit log

**Decision:** `idauto_audit_log` is append-only. Rows are never updated or deleted. Corrections are new rows. No raw PII is stored in any column of this table.

**Why:** Regulatory compliance (PDPO, professional liability) requires a tamper-evident record of who looked up what and when. Immutability is the simplest enforcement.

**Enforcement:** Application code path for audit events must use `INSERT` only. A database trigger can optionally enforce this at the DBMS level in IDA-1.

---

### AD-5 — Hashed identifiers for IP and User-Agent

**Decision:** `idauto_verifications` and `idauto_audit_log` store IP addresses and User-Agent strings as SHA-256 hashes, never as raw values.

**Why:** Raw IP addresses are personal data under most privacy frameworks. Hashing allows rate-limiting and abuse detection (compare hashes) while meeting data-minimization obligations.

**Enforcement:** The application layer must hash before writing. The schema enforces column type (`VARCHAR(64)`) but cannot enforce hashing at the DBMS level; this is an application-layer invariant.

---

### AD-6 — Professional service events are org-scoped by default

**Decision:** `idauto_service_events.is_public` defaults to `FALSE`. A service event is visible only to the writing organization unless explicitly set public. Cross-organization reads require `is_public = TRUE` plus professional subscription tier.

**Why:** A garage's service records for a vehicle may contain commercially sensitive or operationally private information. Default-private is the safer baseline.

---

### AD-7 — No real data ingestion in IDA-0 or IDA-1

**Decision:** No real vehicle, plate, or person data is ingested, scraped, or imported until the legal basis and data-processing agreements defined in IDA-1 are signed and reviewed.

**Why:** Ingesting real data without a defined legal basis and PDPO-compliant data-processing agreement is a legal risk.

**Enforcement:** `idauto_sources` has only a `TEST_ONLY` seed row in IDA-0. A production `source_id` row must not be inserted until IDA-2 with legal review complete.

---

## 3. Integration Contracts with Mythos OS Services

ID Auto does not duplicate Mythos OS services. It consumes them through the following contracts. All integrations are **disabled** in IDA-0 and IDA-1; they activate in IDA-2 and IDA-3.

### 3.1 Authentication (`mythos_auth`)

| Contract point | Detail |
|---|---|
| Consumer | ID Auto professional user login and session management |
| Provider | Mythos OS auth service |
| Protocol | Token-based (JWT or opaque ref); exact protocol defined in IDA-1 |
| ID Auto stores | `idauto_user_roles.mythos_user_id` — opaque reference only |
| ID Auto does NOT store | Username, email, phone, password hash, biometric data |
| Fallback | Not applicable until IDA-2 |

### 3.2 Permissions (`mythos_permissions`)

| Contract point | Detail |
|---|---|
| Consumer | ID Auto feature gates (which tier can call which endpoint) |
| Provider | Mythos OS permission service |
| Protocol | Permission check call with `(user_id, resource, action)` |
| ID Auto local | Subscription tier and `idauto_user_roles.role` provide coarse access control locally; Mythos OS fine-grained check on sensitive paths |

### 3.3 Documents (`mythos_documents`)

| Contract point | Detail |
|---|---|
| Consumer | Professional subscribers attaching PDF inspection reports to service events |
| Provider | Mythos OS document storage (`js/shared/documentation.js` backend) |
| Protocol | Document reference stored as `source_ref` in `idauto_service_events`; actual file stored by Mythos OS |
| Privacy | Document must never contain owner PII visible to other orgs |

### 3.4 Notifications (`mythos_notifications`)

| Contract point | Detail |
|---|---|
| Consumer | Subscription renewal reminders, new service-event alerts for fleet managers |
| Provider | Mythos OS notification service |
| Protocol | Event-push: `{type, recipient_ref, payload}` where `recipient_ref` is `mythos_user_id` |
| Activation | IDA-3 |

### 3.5 Billing (`mythos_billing`)

| Contract point | Detail |
|---|---|
| Consumer | Professional subscription payment and renewal |
| Provider | Mythos OS billing service |
| Protocol | Subscription record keyed by `org_id`; payment events posted by billing, consumed by ID Auto to update `idauto_organizations.status` |
| Activation | IDA-3 |

### 3.6 Search (`mythos_search`)

| Contract point | Detail |
|---|---|
| Consumer | Plate search indexed for Mythos OS search if deployed on the same host |
| Provider | MythosSearch provider registration pattern (per AGENTS.md Stage 3 runtime pattern) |
| Protocol | Register provider with `{name: 'idauto', search: fn}` at module load |
| Privacy | Search index must never include owner PII |
| Activation | IDA-4 |

### 3.7 Audit (`mythos_audit`)

| Contract point | Detail |
|---|---|
| Consumer | ID Auto publishes high-level events to Mythos OS audit stream |
| Provider | Mythos OS audit service |
| Protocol | Event push; ID Auto also maintains its own `idauto_audit_log` as the authoritative record |
| Activation | IDA-2 |

---

## 4. Data Flow — Public Plate Search

```
Caller (anonymous or authenticated)
  │
  ▼
Rate-limit check
  │  fail → 429; insert idauto_verifications(result_status='rate_limited')
  │  pass ↓
Format validation (idauto_plate_formats)
  │  no match → 400; insert idauto_verifications(result_status='invalid_format')
  │  match ↓
Plate lookup (idauto_plates JOIN idauto_vehicles)
  │  not found → 404; insert idauto_verifications(result_status='not_found')
  │  found ↓
Strip PII — response_fields_public filter applied
  │
  ▼
Public JSON response {plate_number, format, governorate, status, make, model, year, …}
  │
  ▼
Insert idauto_verifications(result_status='found', vehicle_id, ip_hash, …)
Insert idauto_audit_log(event_type='plate.lookup', …)
```

Owner PII is not in the data path. There is no join to any owner table because no owner table exists.

---

## 5. Data Flow — Professional Service Event Write

```
Professional user (authenticated, org verified)
  │
  ▼
Auth check → Mythos OS auth service
  │  fail → 401
  │  pass ↓
Permission check (org.status=active, user_role.status=active, tier.can_write_service_events=true)
  │  fail → 403
  │  pass ↓
Consent check (idauto_consent_records for processing_purpose='service_event_write')
  │  no valid consent → 403 with consent prompt
  │  pass ↓
Validate service event payload (vehicle_id or plate_number, event_type, event_date)
  │  invalid → 422
  │  pass ↓
INSERT idauto_service_events
  │
  ▼
INSERT idauto_audit_log(event_type='service_event.create', actor_ref=user_id, org_id, …)
Notify fleet manager if applicable (via mythos_notifications, IDA-3+)
```

---

## 6. Deployment Separation

In IDA-0 and IDA-1, there is no deployed ID Auto service. The schema and configuration live as specification documents in `projects/idauto/`. Deployment target and infrastructure are defined in IDA-1.

**Constraints (permanent):**
- Do not touch `/var/www/uthinachess/0726/Prod/` — Mythos OS production
- Do not restart nginx or PHP
- Do not deploy ID Auto files to any server before IDA-2 with explicit authorization
- Do not ingest real vehicle, plate, or person data before IDA-1 legal review

---

## 7. Technology Considerations (deferred to IDA-1)

The following are not decided in IDA-0 and must be formally specified in IDA-1:

- Target database management system (PostgreSQL, MySQL, MariaDB)
- API framework (PHP, Node.js, or other — must integrate with existing PHP host if co-hosted)
- Hosting model (same VPS as Mythos OS, separate VPS, or managed PaaS)
- TLS certificate management for idauto.tn
- CDN and DDoS protection for public rate-limited search endpoint
- Backup and recovery strategy separate from Mythos OS backups
