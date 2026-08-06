# Mythos Automation & Operations — Security and Secrets Policy

**Stage:** AUT-0 — Automation-First Master Foundation
**Status:** Permanent policy document. No secret exists in this repository as a result of this stage.
**Date:** 2026-08-06

---

## 1. Purpose

This is the permanent Mythos secret-handling policy for the Automation track and every connector, workflow, and stage built on it. It does not relax or supersede any existing repository rule (`AGENTS.md` §14, `docs/CLOUDFLARE_ARCHITECTURE.md` §4.3/4.10) — it generalises them into the automation platform's own data model.

---

## 2. Allowed Secret Storage

- Environment variables on the VPS
- Coolify secret variables
- An approved secret manager
- Short-lived tokens
- Service accounts
- Secret references in the database (metadata only — see §4)

## 3. Forbidden Secret Storage

Secret values must never appear in:

- the Git repository
- documentation
- configuration example values
- `docs/AI_HANDOVER.md`
- logs
- test output
- screenshots
- database plain-text columns
- browser `localStorage`
- client-side JavaScript
- commit messages

This list is exhaustive of the locations this repository can directly observe or influence, but is not exhaustive of every place a secret could conceivably leak — the general rule is: if it is not one of the five items in §2, it is not an approved place to put a secret value.

---

## 4. Secret Records Store Metadata Only

The `aut_secret_references` table (`projects/automation/database/control-plane-schema.sql`) stores exactly:

`secret_reference_id`, `provider`, `purpose`, `environment`, `owner`, `created_at`, `rotated_at`, `expires_at`, `rotation_policy`, `status`.

### Never stored, anywhere, under any column name, in this or any future table

- token value
- password
- private key
- recovery code
- API secret

This is a **permanent schema rule**, not a stage-specific convention. Any future migration that attempts to add a value-bearing secret column to `aut_secret_references` or any other `aut_*` table violates this policy and must be rejected in review, regardless of the stage proposing it.

---

## 5. Connector Secret Handling

Every connector definition (`aut_connectors`) references a `secret_reference_id` and never a value — see `docs/AUTOMATION_ARCHITECTURE.md` §5. Authentication method is documented per connector (`api_token`, `oauth2`, `service_account`, etc.) but the credential material itself lives only in one of the five approved locations in §2.

---

## 6. Rotation and Exposure

- Every `aut_secret_references` row carries a `rotation_policy` and `rotated_at`/`expires_at` timestamps — secrets are not assumed to live forever.
- **If a secret value is ever accidentally exposed** (committed, logged, screenshotted, or otherwise leaked into a forbidden location per §3), it must be **rotated at the source immediately**. Deleting the exposed copy is not sufficient — the credential itself must be considered compromised the moment it appears in a forbidden location, independent of whether anyone is known to have used it.
- Secret exposure is a permanent `LEVEL_3_APPROVAL_REQUIRED` boundary item (`docs/AUTOMATION_APPROVAL_MATRIX.md` §2, item 9) for any *automated* remediation step — but the rotation itself should happen as fast as a human can act; approval gates guard automated *actions*, not the human decision to rotate a known-exposed credential.

---

## 7. Personal Data

Separate from secrets, but governed by the same discipline: automation identifiers must never carry PII.

- `requested_by`, `approved_by`, `owner`, `actor_ref`, and every similar reference field in `projects/automation/database/control-plane-schema.sql` is an **opaque reference**, never a name, email address, or phone number.
- Error summaries, notification bodies, and audit event summaries must be reviewed for accidental PII inclusion before being written — this is a structural expectation on every future implementation stage, not merely a schema constraint.
- This mirrors the redaction discipline already established for INF-CF-1/INF-CF-2-PREP (`docs/CLOUDFLARE_DOMAIN_INVENTORY.md`, `docs/CLOUDFLARE_AUTHORITATIVE_EXPORT_INTAKE.md`) — WHOIS/RDAP registrant data was redacted there for exactly this reason, and the same standard applies to every automation record going forward.

---

## 8. Status

Permanent policy. No secret, credential, token, or account ID has been created, requested, or stored as part of AUT-0. No connector in `projects/automation/config/automation.example.json` is enabled.
