# Mythos — Skills Superposer

**Stage:** MPI-0 — Personal Intelligence Foundation
**Status:** Draft architecture extending the existing repository-development Superposer concept to end-user requests.
**Date:** 2026-08-06

---

## 1. Purpose

The Superposer composes a plan from multiple shared skills based on assembled context (`docs/MYTHOS_CONTEXT_ARCHITECTURE.md`), for both repository-development requests (its original scope) and, as of MPI-0, end-user product requests routed through the personal chatbot pipeline (`docs/MYTHOS_CHATBOT_ARCHITECTURE.md` §4).

---

## 2. Composition Contract

```
compose(intent, contextPackage) → SkillPlan {
  steps: [ { capabilityId, requiredContext, guardDecision } ],
  fallback,
  requiresApproval
}
```

Each step in a `SkillPlan` references a capability id from a domain pack (`docs/MYTHOS_DOMAIN_PACKS.md`) — never inline logic. The Superposer's output is a plan, not an execution; Guard evaluates each step before `EXECUTION` proceeds (`docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §11).

---

## 3. Runtime Availability Constraint

**Only capabilities actually available in the runtime are ever composed.** If a capability referenced by an otherwise-correct composition has no runtime implementation (e.g. `assessment.prepare` before MPI-5 ships), the Superposer must fail closed with a clear "not yet available" outcome — never silently substitute a different capability or fabricate a result.

---

## 4. Worked Examples

See `docs/MYTHOS_CHATBOT_ARCHITECTURE.md` §4 for the teacher and workshop composition examples this document shares.

---

## 5. Relationship to Skill Router

The Skill Router (`docs/MYTHOS_CHATBOT_ARCHITECTURE.md` §5) narrows the candidate capability set using domain, role, organisation, permissions, and workflow patterns; the Superposer then composes an ordered plan from that narrowed set. The two are sequential, not interchangeable — routing decides *what's in scope*, superposition decides *how the steps fit together*.

---

## 6. Status

Draft architecture. `projects/personal-intelligence/reference/intent-router.js` implements language-family detection and single-domain resolution only (`normalizeIntent`, `resolveActiveDomain`), exercised by `tests/mpi-0-personal-intelligence-test.js`'s domain-routing and cross-domain test cases. It does **not** implement `compose()` or any multi-step `SkillPlan` construction — no composition code exists in this stage. Full plan composition remains an MPI-3 target.
