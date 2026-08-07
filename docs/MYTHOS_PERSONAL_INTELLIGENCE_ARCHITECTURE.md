# Mythos Personal Intelligence — Architecture

**Stage:** MPI-0 — Personal Intelligence Foundation
**Status:** Draft architecture and contracts. Not deployed.
**Date:** 2026-08-06

---

## 1. Layer Hierarchy

```
MYTHOS GLOBAL INTELLIGENCE
    ↓
DOMAIN PROFILE
    ↓
ORGANISATION PROFILE
    ↓
USER PROFILE
    ↓
CURRENT SESSION / TASK
    ↓
INTENT ARCHITECT
    ↓
SKILL ROUTER
    ↓
SUPERPOSER
    ↓
GUARD / PERMISSIONS
    ↓
SPECIALISED SKILLS
    ↓
MODEL / AGENT / TOOL
    ↓
VALIDATION
    ↓
LEARNING SIGNALS
```

These layers are not flattened. Each solves a distinct problem and is owned by a distinct contract below. A layer may only be skipped when it has nothing to contribute for a given request (e.g. an anonymous, pre-authentication request has no User Profile) — it is never merged into an adjacent layer's data.

---

## 2. Global Mythos Intelligence

Rules that apply to the whole ecosystem, independent of domain, organisation, or user: security, privacy, audit, skill contracts, intent processing baseline, safe-change discipline, orchestration, permission model, common document handling, common notification concepts, generic search, generic tasks, shared AI behaviour.

**A single user's behaviour must never silently modify global Mythos behaviour.** Global rules are amended only through explicit governance (mirroring `docs/AUTOMATION_GOVERNANCE.md` §5's permanent-boundary amendment process), never through accumulated personalisation.

---

## 3. Domain Profile

```
DomainProfile {
  domainId
  capabilities            // list of capability contract ids this domain exposes
  skills                  // shared skill identifiers implementing those capabilities
  terminology             // domain-baseline vocabulary, overridable per organisation
  requiredContext         // context fields a request in this domain always needs
  optionalContext         // context fields that improve but are not required
  defaultWorkflows        // baseline professional workflow shapes
  policyReferences        // links to domain-level policy documents
}
```

A Domain Profile provides a **baseline**, not an assumption of uniformity — see `docs/MYTHOS_DOMAIN_PACKS.md` for the `education` and `automotive_workshop` domain packs defined in this stage. It must not assume all organisations or users in the domain work identically; that is what Organisation and User layers exist to override.

---

## 4. Organisation Profile

```
OrganisationProfile {
  organisationId
  domainId
  name                    // display reference only, never used as an access key
  enabledCapabilities
  organisationRules
  terminology              // overrides domain terminology where the org differs
  workflows                 // overrides/extends domain default workflows
  businessHours
  serviceCatalogue
  documentPreferences
  communicationRules
  automationPolicies        // organisation-level automation-level ceilings, see §7
  aiConfiguration
  privacyPolicyReferences
  knowledgeSources           // references only, see docs/MYTHOS_CONTEXT_ARCHITECTURE.md §"Personal Knowledge Sources"
  customSkillConfiguration    // configuration overlay, never a code fork — see docs/SKILLS_ARCHITECTURE.md
  createdAt
  updatedAt
}
```

Two organisations in the same domain (Workshop Fixpert vs. any other workshop; École X vs. École Y) reuse the same domain skills while differing entirely in this profile's contents. Organisation Intelligence is intentionally silent on any single user's preferences.

---

## 5. User Profile (User Intelligence)

```
PersonalAIProfile {
  userId
  organisationId
  activeDomains              // domains this user is permitted and configured to use
  roleIds                     // reference only — see §6, User ≠ Role
  locale
  languages                    // preferred languages, ordered
  explicitPreferences           // user-stated rules — see docs/MYTHOS_USER_MEMORY_POLICY.md
  learnedPreferences              // candidate/established preferences — see §8
  workflowPatterns
  skillPreferences
  responsePreferences
  frequentTasks
  recentRelevantContext
  knowledgeReferences
  memoryPolicy                    // user-visible memory on/off and scope controls, see docs/MYTHOS_USER_MEMORY_POLICY.md
  confidenceMetadata
  lastUpdatedAt
}
```

**Data minimisation is structural**: fields prefer references/IDs over embedded raw content, and nothing here is copied verbatim into a model prompt without passing through the Context Assembler's relevance/permission filter (`docs/MYTHOS_CONTEXT_ARCHITECTURE.md`).

---

## 6. User ≠ Role

This distinction is mandatory and permanent:

| Question | Answered by |
|---|---|
| "What is this person allowed to do?" | **Role / Permissions** (existing Mythos access-control model) |
| "How does this particular person prefer and tend to work?" | **User Intelligence** |
| "What professional capabilities exist?" | **Domain** |
| "How does this organisation operate?" | **Organisation** |
| "What is happening right now?" | **Session** |

**AI learning must never grant permissions.** A learned or explicit user preference is consulted only after the Guard layer (§9) has already produced an `ALLOW` (or narrower) decision using the existing role/permission model — never instead of it, never to widen it.

---

## 7. Precedence Rules

For execution behaviour, precedence is:

1. System / security / legal constraints
2. Current authorised organisation policy
3. Current role / permissions
4. Current explicit user instruction (this message, this turn)
5. Explicit persistent user rule
6. Verified organisation workflow
7. Established user preference
8. Domain default
9. Generic Mythos default

**A user preference never bypasses permissions or security.** This mirrors `docs/AUTOMATION_APPROVAL_MATRIX.md`'s permanent-boundary model exactly: personalisation operates strictly downstream of, and can never override, the constraints above it in this list.

---

## 8. Learning Scope and Confidence

### Scope

Every learned item carries an explicit scope: `session`, `user`, `organisation`, `domain`, `global`. **Default learned scope is `user`.** A preference learned from one user never automatically affects another user, and a workflow learned in one organisation never automatically affects another organisation. Promotion to `organisation` or wider scope requires explicit governance/authorisation — it is never automatic. See `docs/MYTHOS_USER_MEMORY_POLICY.md` §"Learning Pipeline and Scope Promotion".

### Confidence

Learned items progress through states rather than a bare numeric threshold:

```
single observation        → SESSION_OBSERVATION (temporary)
repeated pattern           → CANDIDATE_PREFERENCE
repeated consistent pattern → ESTABLISHED_PREFERENCE
explicit user instruction   → EXPLICIT_USER_RULE (strongest)
```

Every learned preference record supports metadata: `source`, `evidenceCount`, `confidence`, `firstObservedAt`, `lastObservedAt`, `scope`, `status`, `supersedes`, `expiresAt` (where appropriate). See `docs/MYTHOS_USER_MEMORY_POLICY.md` for the full pipeline (`INTERACTION → OBSERVATION → CLASSIFICATION → CANDIDATE PATTERN → CONFIDENCE → CONFLICT CHECK → PERSIST / DISCARD → AUDIT`).

---

## 9. Session Context

```
SessionContext {
  sessionId
  userId
  organisationId
  activeDomain
  currentIntent
  currentEntities
  temporaryContext          // this-turn-only instructions; see §7 precedence item 4
  recentActions
  pendingApprovals
  selectedSkillPlan
}
```

A session never stores an infinite transcript as runtime state. A temporary, session-scoped instruction ("just this once, answer in French") does not, by itself, become a persistent user preference — see the learning pipeline's `CLASSIFICATION` step and `docs/MYTHOS_USER_MEMORY_POLICY.md` §"What Does Not Become Memory".

---

## 10. Entity Context

```
EntityReference {
  type                // e.g. teacher, student_group, vehicle, client, invoice, work_order, event, document
  id
  source
  organisationScope
  permissionScope
}
```

Entities are referenced, not embedded. The AI context layer resolves an `EntityReference` to authorised entity information only when a specific step needs it, and only within the scopes it carries — see `docs/MYTHOS_CONTEXT_ARCHITECTURE.md` §"Entity Resolution".

---

## 11. Guard / Permission Decision Model

Runtime execution evaluates: user, role, organisation, domain, skill, action, resource, automation level, data classification — reusing and extending `mythos-skill-guard` and the automation-level model already established in `docs/AUTOMATION_ARCHITECTURE.md` §2 and `docs/AUTOMATION_APPROVAL_MATRIX.md`. Result is one of:

```
ALLOW | DENY | REQUIRE_APPROVAL | READ_ONLY | DRY_RUN_ONLY
```

**Learning and personalisation may never alter this decision upward.** A learned preference can request a friendlier phrasing of a `DENY`; it can never turn a `DENY` into an `ALLOW`.

---

## 12. Relationship to Existing Mythos Architecture

- **Product-schema alignment** (MAD-1, `docs/AUTOMOTIVE_ARCHITECTURE.md`) applies identically: a future `mythos_intelligence` logical schema, no cross-schema foreign keys — see `projects/personal-intelligence/database/control-plane-schema.sql`.
- **Automation levels and approval boundaries** are reused, not reinvented — see §7 and §11 above, and `docs/AUTOMATION_APPROVAL_MATRIX.md`.
- **Domain packs integrate with, and do not duplicate, existing product domains** — the `automotive_workshop` domain pack maps onto ID Auto and Atelier Network capabilities; see `docs/MYTHOS_DOMAIN_PACKS.md` §"Automotive Workshop".
- **Secrets and audit policy** follow `docs/AUTOMATION_SECURITY_AND_SECRETS.md` unchanged: no credential or raw sensitive content in any profile, memory record, or audit entry beyond what that document already permits.

---

## 13. Status

Draft architecture and contracts. See `projects/personal-intelligence/` for the illustrative reference implementation and draft (undeployed) database schema, and `tests/mpi-0-personal-intelligence-test.js` for the fixtures validating the isolation and precedence rules documented above.
