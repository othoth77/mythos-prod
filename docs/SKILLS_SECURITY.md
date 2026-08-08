# Mythos — Skills Security

**Stage:** MPI-0 — Personal Intelligence Foundation
**Status:** Mandatory, permanent security requirements. Draft enforcement contracts.
**Date:** 2026-08-06

---

## 1. Hard Requirements

These are non-negotiable for every current and future skill, agent-development or runtime:

- Strict tenant isolation (`docs/MYTHOS_AI_MULTI_TENANCY.md`)
- Strict user scope
- Server/application-layer permission enforcement — **never prompt-only security**
- No AI-granted privileges — learning and personalisation never widen a Guard decision (`docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §6, §11)
- No cross-user or cross-organisation memory leakage
- No secrets in memory, prompts, or logs (`docs/AUTOMATION_SECURITY_AND_SECRETS.md`, inherited unchanged)
- Controlled persistence with correction/deletion mechanisms (`docs/MYTHOS_USER_MEMORY_POLICY.md` §7)
- Minimal context injection (`docs/MYTHOS_CONTEXT_ARCHITECTURE.md` §2)
- Audit for meaningful external actions (`docs/AUTOMATION_ARCHITECTURE.md` §4, reused)
- Safe, bounded, non-self-elevating learning (`docs/MYTHOS_USER_MEMORY_POLICY.md`)
- No provider lock-in (`docs/MODEL_ROUTING_ARCHITECTURE.md`)
- **No arbitrary generic shell skill exposed to product users** — any skill capable of unrestricted command execution is an agent-development skill only, never reachable from an end-user chatbot request.

---

## 2. Guard Evaluation

Every skill invocation from a runtime request passes Guard, evaluating: user, role, organisation, domain, skill, action, resource, automation level, data classification — producing `ALLOW | DENY | REQUIRE_APPROVAL | READ_ONLY | DRY_RUN_ONLY` (`docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §11). This reuses `mythos-skill-guard` and the automation-level/approval-boundary model already established for the Automation platform (`docs/AUTOMATION_APPROVAL_MATRIX.md`) rather than defining a parallel security model for skills.

---

## 3. Agent-Development vs. Runtime Skill Boundary

Agent Development Skills (`docs/SKILLS_ARCHITECTURE.md` §1) operate with the permissions of the Claude Code / Codex session building or operating Mythos — a materially different, and materially more trusted, context than an end-user chatbot request. **No Agent Development Skill is directly reachable from an end-user request path.** A runtime capability that needs equivalent power must be implemented as its own scoped, Guard-evaluated capability, never by routing an end-user request into an agent-development skill.

---

## 4. Learning Cannot Elevate

A learned or explicit user preference may change *how* a permitted action is presented or phrased. It may never change *whether* an action is permitted, and it may never change which automation level (`docs/AUTOMATION_ARCHITECTURE.md` §2) a skill is allowed to run at. This is tested explicitly — see `tests/mpi-0-personal-intelligence-test.js` §"Permission".

---

## 5. Data Classification

Every resource a skill touches carries an implicit or explicit data classification (e.g. public, organisation-internal, personal, financial, regulated). Guard takes `dataClassification` as a direct input and never resolves a regulated/financial classification below `REQUIRE_APPROVAL`, independent of the underlying permission decision (see `projects/personal-intelligence/reference/guard.js`). Automation level is a separate, earlier check — it is validated upstream at `GATE_CHECK` (`docs/AUTOMATION_ARCHITECTURE.md` §3) before Guard is ever invoked, not re-evaluated inside Guard itself.

---

## 6. Status

Mandatory requirements, draft enforcement contracts. `projects/personal-intelligence/reference/guard.js` implements a reference Guard decision function exercised by `tests/mpi-0-personal-intelligence-test.js` §"Permission" and §"Learning". No production Guard integration for runtime Mythos capabilities exists yet.
