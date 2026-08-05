# ID Auto — idauto.tn

**Product:** ID Auto
**Domain:** idauto.tn
**Platform:** Mythos ecosystem
**Repository:** othoth77/mythos-prod (`projects/idauto/`, `docs/IDAUTO_*.md`)
**Current stage:** IDA-1 — Product Vision, Capture, Access and Data Governance Specification (2026-08-05)

---

## Vision

ID Auto is a progressively enriched vehicle intelligence platform for Tunisia. Its long-term objective is to build the most complete, privacy-respecting, and legally sound vehicle database covering vehicles across the Tunisian Republic — achieved through legal and traceable data-acquisition channels.

The product begins with manual and public capture opportunities, then expands to the Fixpert Smart Gate camera, professional partner networks, and authorised official sources.

ID Auto is a product within the Mythos platform ecosystem. Mythos OS provides shared platform services (authentication, billing, audit, notifications, search, document storage).

---

## Privacy Contract (non-negotiable founding constraint)

> **Public records must never expose owner name, address, phone number, national ID, insurance identity, or any other protected personal information.**

This is enforced at the schema level: `idauto_vehicles` and `idauto_plates` contain no owner columns. There is no join path from plate number to owner PII without passing through a separately-gated consent framework.

---

## Three Access Scopes

### PUBLIC
Any caller within rate limits. Returns: plate number, colour, body type, make/model (verified), year/fuel (trusted source), confidence status, governorate.

**Never public:** exact observation time, exact location, original image, plate crop, movement history, contributor identity, OCR output, VIN, carte grise, owner data, Fixpert customer data.

### PROFESSIONAL
Verified professional subscribers (garages, insurers, fleet managers). Access to approved technical data and their own service events. An organisation does not automatically see another organisation's private data.

### MYTHOS_PRIVATE
Mythos Super Admin only. Raw captures, exact timestamps, GPS, OCR, confidence scores, source identity, camera source, correction history, audit events. All access audit-logged.

---

## Observation-First Model

Every capture (scan, upload, manual entry, camera detection) creates an **Observation** first. The system then:

1. Searches for an existing vehicle (by plate, VIN, or evidence)
2. If found: adds the observation, extracts new facts, records conflicts
3. If not found: creates a new vehicle fiche with its first observation
4. **Never silently overwrites an existing fact**

---

## Plate Format Rules

Plate formats are defined as configurable rules in `config/idauto.example.json`. No format is hardcoded.

**Note: Current format patterns are UNVERIFIED DRAFTS.** They have not been confirmed against official Tunisian traffic authority sources.

| Code | Family | Example | Status |
|------|--------|---------|--------|
| `TUN_STD` | Standard passenger (since 2002) | `123 TUN 4567` | Draft/unverified |
| `TUN_OLD` | Legacy passenger (pre-2002) | `1234 TUN 56` | Draft/unverified |
| `TUN_GVT` | Government | `GN 123 456` | Draft/unverified |
| `TUN_DIP` | Diplomatic / CD | `CD 12 345` | Draft/unverified |
| `TUN_MIL` | Military | `ARN 123456` | Draft/unverified |
| `TUN_TMP` | Temporary / transit | `TT 12345 A` | Draft/unverified |
| `TUN_ECO` | Economic / special zones | `ZE 1234 567` | Draft/unverified |

---

## Target Database Architecture

PostgreSQL is the **selected target DBMS**. It is not installed or deployed in IDA-0 or IDA-1.

Logical schemas in the target PostgreSQL cluster:

- `mythos_core` — users, roles, permissions, global audit, platform admin
- `idauto` — vehicles, plates, observations, facts, evidence, documents, captures, sources, review queue
- `fixpert` — Fixpert clients, work orders, interventions, stock, quotations, invoices, payments

Fixpert workshop operations, customers, invoices and accounting belong legally and operationally to Fixpert. ID Auto provides the shared vehicle identity layer.

---

## Fixpert Smart Gate

Fixpert is the first professional pilot. The Smart Gate is an ANPR system using one designated entrance/exit camera at the Fixpert workshop.

- **5 cameras total** at Fixpert premises — only **1** is in Smart Gate scope
- The other 4 cameras are outside ID Auto scope
- Smart Gate events are always MYTHOS_PRIVATE
- **Legal regulatory approval required before activation** (LEGAL-REVIEW-REQUIRED)
- Implementation: IDA-4

---

## Repository Layout

```
projects/idauto/
├── README.md                        ← this file
├── config/
│   └── idauto.example.json          ← configurable rules and feature flags (IDA-1 draft)
└── database/
    └── schema.sql                   ← draft schema specification (PostgreSQL, not deployed)

docs/
├── IDAUTO_PRODUCT_SPEC.md           ← product vision, access model, data ownership
├── IDAUTO_CAPTURE_PIPELINE.md       ← scanner, observation flow, carte grise, review queue
├── IDAUTO_FIXPERT_INTEGRATION.md    ← Smart Gate spec, Fixpert Atelier boundaries
├── IDAUTO_ARCHITECTURE.md           ← architecture decisions, integration contracts
└── IDAUTO_ROADMAP.md                ← ID Auto stage roadmap (IDA-0 through IDA-6)
```

---

## Scope Exclusions — IDA-1

- No pipeline or API code
- No PostgreSQL installation or deployment
- No camera connection
- No OCR or detection model integration
- No real vehicle data
- No public data collection of any kind
- No real carte grise processing
- All capture and Smart Gate feature flags remain `false`

---

## Next Stage

**IDA-2 — PostgreSQL Core, API and Manual Capture MVP**

- Target PostgreSQL cluster structure
- Core vehicle, plate, observation, fact and evidence APIs
- Private / admin manual entry only
- Review queue
- Synthetic and authorised pilot data only
- No uncontrolled public ingestion
