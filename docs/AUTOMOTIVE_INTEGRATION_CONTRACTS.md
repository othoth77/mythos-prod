# Mythos Automotive — Integration Contracts

**Stage:** ATN-0 Atelier Network Foundation and Ecosystem Consistency Amendment (amends MAE-0)
**Last updated:** 2026-08-05
**Repository:** othoth77/mythos-prod

---

## 1. Permanent Integration Principles

These rules apply to every integration between products in the Mythos Automotive ecosystem. They cannot be overridden by a product-level decision.

| Rule | Description |
|------|-------------|
| Reference, never duplicate | Cross-product records store stable IDs and point-in-time snapshots, not live copies |
| One writer per noun | Only the owning product writes to its own tables |
| No cross-schema FKs | Referential integrity is enforced at the application layer |
| No cross-schema joins | Cross-product queries go through APIs or controlled read models |
| PII stays in its owner | Owner PII stays in Fixpert; seller PII stays in AutoMarket |
| Every MYTHOS_PRIVATE read is audited | Any access to a `mythos_private` resource must write an audit event |
| Provenance travels with data | Source ID, source type, trust level, and snapshot timestamp travel with every cross-boundary datum |
| Contracts are versioned | Every integration contract carries a version; breaking changes require a new major version |
| External systems: authorised feed only | Marketplace and official data by authorised API or feed — never scraping |
| Idempotency on commands | Every command API requires an idempotency key |
| Source and correlation_id required | Every event envelope includes a source product, correlation_id, and event version |
| Failed events are observable | Failed event delivery goes to a dead-letter state with review tooling |
| Sensitive fields filtered at boundary | A product must not receive fields it is not authorised to hold |

---

## 2. Integration Types

### 2.1 Synchronous APIs

Used for: real-time lookups, commands, and user-facing queries.

Pattern:
- HTTP/REST or GraphQL
- Bearer token (Mythos Core auth)
- Rate-limited at API gateway
- Response filtered by access_scope
- All `mythos_private` calls write audit event before returning

Example: AutoValeur calls ID Auto vehicle lookup API before producing a valuation.

### 2.2 Asynchronous Domain Events

Used for: notifying consumers of state changes in a product domain.

Pattern:
- Event envelope with: `event_id`, `event_name`, `producer`, `version`, `correlation_id`, `source_id`, `payload`, `published_at`, `privacy_class`
- Consumers are declared and authorised
- Failed delivery → dead-letter → observable review
- Consumers must be idempotent on re-delivery
- Payload contains stable IDs and public-scope fields only (no MYTHOS_PRIVATE in events)

Example: ID Auto publishes `vehicle.fact.verified` — AutoValeur consumes and may trigger a valuation refresh.

### 2.3 Controlled Read Models

Used for: reporting, search, and analytics queries that span product domains.

Pattern:
- Maintained by an authorised data pipeline
- Access-scope-filtered on write (no MYTHOS_PRIVATE in shared read models)
- Explicitly documented as derived, not authoritative
- Source version tracked
- Not a substitute for synchronous API for user-facing results

Example: A future analytics warehouse aggregates valuation confidence distribution by vehicle segment (no individual data).

---

## 3. Cross-Product Integration Matrix

All integrations are **disabled** in MAE-0. Activation stages are as documented.

| Consumer | Producer | Data | Direction | Activation |
|----------|----------|------|-----------|-----------|
| AutoValeur | ID Auto | vehicle_id + fact snapshot | Read | AVA-1 (with IDA-2) |
| AutoValeur | Atelier Network | inspection_provider_id, repair_estimate_id, repair line items | Read | AVA-2 (after ATN-1) |
| AutoValeur | Parts Network | parts price snapshot | Read | AVA-2 |
| AutoValeur | Marketplace | listing snapshots, completed sale prices | Read | AVA-5 |
| Atelier Network | ID Auto | vehicle_id for work orders and inspections | Read | ATN-1 |
| ID Auto | Atelier Network workshop | carte grise owner PII (consent-scoped to workshop org) | Consent routing | IDA-3 |
| Atelier Network | Fixpert (first pilot) | EXTERNAL_CONNECTED: inspection results, work order summaries | External connector | ATN-1 |
| AutoMarket | ID Auto | vehicle_id validation for listing | Read | AutoMarket spec stage |
| AutoMarket | AutoValeur | valuation reference for listing | Read | AutoMarket spec stage |
| AutoMarket | Atelier Network | AutoCheck report badge | Read | AutoMarket spec stage |
| Fleet | ID Auto | vehicle_id + fact snapshot | Read | Fleet spec stage |
| Fleet | Atelier Network | maintenance and service history | Read | Fleet spec stage |
| Fleet | AutoValeur | fleet valuation | Read | Fleet spec stage |
| Mythos Core | All products | auth, roles, audit, billing | Platform | Ongoing |

---

## 4. Domain Event Catalogue

The event catalogue is a design specification. No event bus exists in MAE-0.

Each event will require a formal specification including: event name, owner, producer, permitted consumers, payload version, stable identifiers, privacy classification, retention class, idempotency and correlation fields.

### 4.1 ID Auto Events

| Event | Owner | Privacy class |
|-------|-------|---------------|
| `vehicle.created` | ID Auto | PUBLIC |
| `vehicle.updated` | ID Auto | PUBLIC |
| `vehicle.fact.proposed` | ID Auto | PROFESSIONAL |
| `vehicle.fact.verified` | ID Auto | PUBLIC |
| `vehicle.identity.merged` | ID Auto | PROFESSIONAL |
| `plate.observed` | ID Auto | PROFESSIONAL |
| `document.scan.reviewed` | ID Auto | MYTHOS_PRIVATE |
| `vehicle.movement.detected` | ID Auto | MYTHOS_PRIVATE |
| `review_queue.item.created` | ID Auto | PRODUCT_INTERNAL |

### 4.2 Atelier Network Events

These events are produced by the Atelier Network platform on behalf of any participating workshop.
Fixpert is the first provider producing these events.

| Event | Owner | Privacy class |
|-------|-------|---------------|
| `workshop.registered` | Atelier Network | PROFESSIONAL |
| `workshop.activated` | Atelier Network | PROFESSIONAL |
| `workshop.suspended` | Atelier Network | MYTHOS_PRIVATE |
| `workshop.site.created` | Atelier Network | PROFESSIONAL |
| `inspection_provider.accredited` | Atelier Network | PROFESSIONAL |
| `inspection_provider.revoked` | Atelier Network | PROFESSIONAL |
| `smart_gate.device.registered` | Atelier Network | MYTHOS_PRIVATE |
| `smart_gate.device.activated` | Atelier Network | MYTHOS_PRIVATE |
| `appointment.created` | Atelier Network | ORG_PRIVATE |
| `appointment.confirmed` | Atelier Network | ORG_PRIVATE |
| `vehicle.checked_in` | Atelier Network | ORG_PRIVATE |
| `inspection.started` | Atelier Network | ORG_PRIVATE |
| `inspection.completed` | Atelier Network | ORG_PRIVATE |
| `autocheck.report.issued` | Atelier Network | PROFESSIONAL |
| `work_order.created` | Atelier Network | ORG_PRIVATE |
| `work_order.closed` | Atelier Network | ORG_PRIVATE |
| `repair.estimate.created` | Atelier Network | PROFESSIONAL |
| `intervention.completed` | Atelier Network | ORG_PRIVATE |
| `external_record.received` | Atelier Network | ORG_PRIVATE |

### 4.3 Parts Network Events

| Event | Owner | Privacy class |
|-------|-------|---------------|
| `part.created` | Parts | PUBLIC |
| `fitment.updated` | Parts | PUBLIC |
| `stock.changed` | Parts | PROFESSIONAL |
| `part.price.changed` | Parts | PUBLIC |
| `parts.quote.created` | Parts | ORG_PRIVATE |
| `parts.order.completed` | Parts | ORG_PRIVATE |

### 4.4 AutoValeur Events

| Event | Owner | Privacy class |
|-------|-------|---------------|
| `valuation.requested` | AutoValeur | PRODUCT_INTERNAL |
| `valuation.completed` | AutoValeur | PROFESSIONAL |
| `valuation.revised` | AutoValeur | PROFESSIONAL |
| `opportunity.detected` | AutoValeur | MYTHOS_PRIVATE |
| `deal.reviewed` | AutoValeur | MYTHOS_PRIVATE |
| `model.version.released` | AutoValeur | PROFESSIONAL |

### 4.5 AutoMarket Events

| Event | Owner | Privacy class |
|-------|-------|---------------|
| `listing.published` | AutoMarket | PUBLIC |
| `listing.price.changed` | AutoMarket | PUBLIC |
| `offer.received` | AutoMarket | ORG_PRIVATE |
| `offer.accepted` | AutoMarket | ORG_PRIVATE |
| `sale.completed` | AutoMarket | PROFESSIONAL (aggregate) |
| `listing.withdrawn` | AutoMarket | PUBLIC |

### 4.6 Fleet and Assistance Events

| Event | Owner | Privacy class |
|-------|-------|---------------|
| `fleet.vehicle.added` | Fleet | ORG_PRIVATE |
| `maintenance.due` | Fleet | ORG_PRIVATE |
| `assistance.case.opened` | Assistance | ORG_PRIVATE |
| `assistance.case.closed` | Assistance | ORG_PRIVATE |

---

## 5. ID Auto Integration Contract (Current)

Active in: IDA-2 for admin; AVA-1 for AutoValeur; IDA-4 for Fixpert Smart Gate.

| Contract point | Detail |
|---|---|
| Vehicle lookup | GET by vehicle_id or plate — returns public or professional tier based on access_scope |
| Required fact fields | make, model, variant, year, fuel_type, category, body_type, confidence_score |
| Optional professional fields | verified VIN, detailed technical facts, service history count |
| MYTHOS_PRIVATE fields | Raw captures, exact location, exact timestamp, OCR results, camera source, movement history |
| Snapshot contract | Consumers store a JSON snapshot of facts used at time of action — labelled as point-in-time |
| Write contract | Consumers **do not write** to any `idauto_` table. Deal Radar discovery → submit ingestion request to ID Auto API → ID Auto creates observation under AD-8 rules |
| Audit on MYTHOS_PRIVATE | Any `mythos_private` read requires a matching audit event |

---

## 6. Atelier Network Integration Contract (ATN-0 corrected)

Active in: ATN-1 (workshop registry + inspection API), AVA-2 (repair estimate → AutoValeur).

| Contract point | Detail |
|---|---|
| AutoValeur reads | Repair estimate from Atelier Network API: `inspection_provider_id`, `repair_estimate_id`, line items |
| AutoValeur stores | `inspection_provider_id` (stable), `repair_estimate_id` (stable), estimate snapshot |
| AutoValeur does not store | Customer name, CIN, contact, invoice amounts, payment details, workshop internal notes |
| Display wording | "Estimation après inspection [Workshop Name]" — not "Expertise légale certifiée" |
| Smart Gate (generalised) | Each participating workshop owns its device and consent obligation; ID Auto owns the observation |
| Customer PII routing | Carte grise owner PII → workshop organisation's own customer table with explicit consent — never to `idauto_` or `atelier_network` platform tables |
| Fixpert as first connector | EXTERNAL_CONNECTED mode; API contract to be specified in ATN-1 |

---

## 7. Parts Network Integration Contract (Current)

Active in: AVA-2 (parts price for repair estimate).

| Contract point | Detail |
|---|---|
| Parts price lookup | Query by part reference + vehicle compatibility |
| AutoValeur stores | Price snapshot at quote time, source, availability, date |
| AutoValeur does not store | Live catalogue, supplier contracts, inventory counts |
| Legal status | LEGAL-REVIEW-REQUIRED per source |
| Current source | ssangyong.autos (external system, not in repository) |

---

## 8. Rate Limiting Specification (Unified)

To resolve the divergence identified between ID Auto (designed model) and AutoValeur (placeholder):

**Unified rules:**
- Rate-limit key: SHA-256 of (IP + User-Agent salt) — same rule as ID Auto AD-5
- Limit tiers: anonymous public / authenticated public / professional subscriber / service account
- Limit granularity: per-minute and per-hour
- Exceeded limit: HTTP 429, Retry-After header
- Rate-limit events: observable in product audit log (without recording raw IP)
- Implementation: deferred to MAE-1 shared platform spec

---

## 9. Audit Envelope Standard

To resolve the divergence between ID Auto `idauto_audit_log` and AutoValeur `autovaleur_audit_events`:

**Common envelope fields (target — MAE-1 spec):**

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | UUID | Stable, unique |
| `event_name` | VARCHAR | e.g. `vehicle.fact.verified` |
| `producer` | VARCHAR | e.g. `idauto` |
| `correlation_id` | UUID | Traces a request across products |
| `actor_ref` | BIGINT | Mythos Core user ID (NULL = anonymous/system) |
| `actor_role` | VARCHAR | Role at time of action |
| `target_product` | VARCHAR | e.g. `idauto` |
| `target_table` | VARCHAR | e.g. `idauto_vehicles` |
| `target_id` | BIGINT | Record affected |
| `action` | VARCHAR | READ / CREATE / UPDATE / AUDIT_WRITE |
| `access_scope` | VARCHAR | public / professional / mythos_private |
| `privacy_class` | VARCHAR | Classification of data accessed |
| `event_metadata` | JSONB | Additional context (no PII) |
| `created_at` | TIMESTAMPTZ | Immutable |

Local product audit tables retain their full detail. The common envelope is published to the ecosystem audit stream.
