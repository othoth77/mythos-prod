# Mythos — AI Multi-Tenancy and Privacy

**Stage:** MPI-0 — Personal Intelligence Foundation
**Status:** Mandatory, permanent security requirement. Draft enforcement contracts; not deployed.
**Date:** 2026-08-06

---

## 1. The Requirement

No cross-user or cross-organisation memory leakage, ever. Every persistent personal or organisation intelligence record is scoped, and every query against it enforces that scope. **Application/data-layer enforcement is mandatory — prompts are never the isolation boundary.**

This is not a target to reach eventually; it is a hard requirement for every future implementation stage building on MPI-0, exactly as `docs/AUTOMATION_APPROVAL_MATRIX.md`'s permanent boundaries are hard requirements for the Automation platform.

---

## 2. Enforcement Points

Every retrieval and write against personal or organisation intelligence enforces, in this order:

1. **User scope** — a query for user data always includes the requesting `userId`; there is no "query all users" path in the personal-intelligence data layer.
2. **Organisation scope** — a query for organisation data always includes the requesting `organisationId`.
3. **Permission scope** — even within the correct user/organisation scope, the Guard layer's decision (`docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §11) still applies before any record is surfaced.

An identifier guessed, inferred, or hallucinated by a model must never grant access on its own — every `EntityReference` resolution (`docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §10) is re-validated against actual scope and permission at resolution time, not trusted because it appeared in a request.

---

## 3. What Must Never Happen

- Teacher A's data becoming available to Teacher B without explicit authorisation.
- Workshop A's data becoming available to Workshop B.
- A user gaining access to a record because the AI guessed a plausible-looking identifier.
- A learned preference or memory item written under one `organisationId` being retrievable under a different `organisationId`.
- Global or domain-scope promotion of a `user`-scoped learned preference happening automatically (see `docs/MYTHOS_USER_MEMORY_POLICY.md` §3).

---

## 4. Relationship to Existing Isolation Precedent

This is a generalisation of isolation discipline already present elsewhere in the repository:

- Product-schema alignment and no-cross-schema-FK (MAD-1/MAD-4, `docs/AUTOMOTIVE_ARCHITECTURE.md`) — the same discipline applies to a future `mythos_intelligence` schema.
- Atelier Network's multi-tenant hierarchy (`workshop_organization_id → workshop_id → workshop_site_id`, `docs/ATELIER_NETWORK_ARCHITECTURE.md`) is the direct precedent for organisation-scoped enforcement in this document.
- The Automation platform's `organization_id`/`environment_id` scoping on every `aut_*` table (`projects/automation/database/control-plane-schema.sql`) is the direct precedent for how `projects/personal-intelligence/database/control-plane-schema.sql` scopes its own tables.

---

## 5. Required Tests

At minimum, every implementation stage building on MPI-0 must include tests for:

- **User isolation** — Teacher A's preference does not affect, or become visible to, Teacher B.
- **Organisation isolation** — Workshop A's knowledge does not leak to Workshop B.
- **Permission-guessing resistance** — a user cannot gain access to a record by an AI-guessed identifier alone.

See `tests/mpi-0-personal-intelligence-test.js` for the MPI-0 reference-implementation version of these tests.

---

## 6. Secrets and Personal Data

No secret, credential, or account identifier is ever stored in a personal or organisation intelligence record — this document inherits `docs/AUTOMATION_SECURITY_AND_SECRETS.md` unchanged. Personal identifiers used in memory/context records are opaque references, not names, emails, or phone numbers — the same redaction discipline already applied to WHOIS/RDAP data in `docs/CLOUDFLARE_DOMAIN_INVENTORY.md` and `docs/CLOUDFLARE_AUTHORITATIVE_EXPORT_INTAKE.md` generalises directly to this document.

---

## 7. Status

Mandatory requirement, draft enforcement contracts. `projects/personal-intelligence/reference/scope.js` implements the scope-enforcement helpers used by `tests/mpi-0-personal-intelligence-test.js`. No production personal-intelligence data store exists yet, so no real cross-tenant leak is possible today — this document governs every stage that will eventually create one.
