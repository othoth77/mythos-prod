# Mythos — Personal Chatbot Architecture

**Stage:** MPI-0 — Personal Intelligence Foundation
**Status:** Draft pipeline architecture. No chatbot runtime is deployed.
**Date:** 2026-08-06

---

## 1. Request Pipeline

```
MESSAGE
  → AUTHENTICATED USER
  → ORGANISATION
  → ROLE / PERMISSIONS
  → DOMAIN
  → USER INTELLIGENCE
  → RELEVANT MEMORY
  → CURRENT SESSION
  → INTENT NORMALISATION
  → SKILL ROUTER
  → SUPERPOSER
  → GUARD
  → EXECUTION
  → RESPONSE
  → LEARNING SIGNAL
```

Every step is explicit and independently testable. **The chatbot never blindly loads everything about the user** — the Context Assembler (`docs/MYTHOS_CONTEXT_ARCHITECTURE.md`) performs selection between "Relevant Memory" and "Current Session" above, not a bulk load.

---

## 2. Persona ≠ Personal Intelligence

Personalisation must affect substance, not just tone: context selection, skill selection, workflow, defaults, language, output format, relevant history, organisation rules, preferred level of detail, permissions, recurring actions. **A chatbot that only changes its tone of voice per user is not personalised in the sense this architecture requires.** Personality/tone is one optional presentation layer applied late in the pipeline (during `RESPONSE`), never the mechanism that carries personalisation itself.

---

## 3. Response Architecture

Five concerns are kept separate, never merged into one undifferentiated "the model does it all" step:

```
UNDERSTANDING  — intent normalisation, entity resolution
PLANNING        — skill routing, superposition, plan construction
EXECUTION        — Guard-gated skill/tool invocation
RESPONSE GENERATION — formatting, language, tone, detail level
LEARNING          — feedback signal capture (docs/MYTHOS_USER_MEMORY_POLICY.md §8)
```

A response can be personalised (tone, language, detail level) even when no external action is executed at all — a purely informational answer still passes through `RESPONSE GENERATION` with the user's response preferences applied. **An execution, whenever one occurs, passes through Guard regardless of response preferences** — a user's stated preference for terse answers has no bearing on whether an action is permitted.

---

## 4. Superposer for End Users

The Superposer composes domain skills based on assembled context, extended beyond its existing repository-development use to end-user requests.

### Teacher example

"حضّرلي فرض الأسبوع الجاي كيف المعتاد" (prepare next week's homework as usual) — potential composition:

```
user.context
  + education.teacher.context
  + organisation.education.policy
  + calendar.context
  + assessment.prepare
  + content.adapt_difficulty
  + answer_key.generate
  + document.prepare
```

### Workshop example

"السيارة هاذي اعمللها devis بعد التشخيص" (make this car's estimate after the diagnostic) — potential composition:

```
user.context
  + workshop.context
  + vehicle.lookup
  + diagnostic.summary
  + client.resolve
  + estimate.prepare
  + document.prepare
```

`Guard` is not itself a composed step — it evaluates the plan above it, exactly once per step, before `EXECUTION` (see `docs/SKILLS_ARCHITECTURE.md` §5, `docs/SKILLS_SUPERPOSER.md` §2). Folding it into the `SkillPlan` itself would contradict that separation.

**Only capabilities actually available in the runtime are ever composed.** A composition referencing an unimplemented capability contract (see `docs/MYTHOS_DOMAIN_PACKS.md`) fails closed — in the automation-lifecycle vocabulary (`docs/AUTOMATION_ARCHITECTURE.md` §3) this is the `GATE_CHECK` step; in this pipeline's own vocabulary (§1 above) it is the `GUARD` step evaluating an unavailable capability as `DENY`. The two vocabularies describe the same checkpoint from two different documents and are not two different checks.

---

## 5. Personal Skill Router

Routing ranks candidates using more than keyword matching:

- current domain
- user role
- organisation
- enabled capabilities
- permissions
- user workflow patterns
- recent task context

**Routing from keyword matching alone is explicitly insufficient** and must not be the sole mechanism in any future implementation.

---

## 6. Intent Architect (Personal)

Extends `mythos-intent-architect` to understand natural, imperfect, short, non-technical requests in Arabic, Tunisian Arabic, French, English, and mixed Arabic/French — see `docs/SKILLS_ARCHITECTURE.md` and the `.claude/skills/mythos-intent-architect/SKILL.md` definition. For product users (as opposed to repository developers), it must produce the domain-appropriate task representation, not a software-engineering task — a teacher's request never becomes a code change proposal.

**It must not infer unknown facts with false confidence.** Where required context (subject, class, prior artefact) cannot be resolved from available, permitted context, the correct behaviour is to ask or degrade gracefully — never to fabricate a plausible-sounding but unverified fact.

---

## 7. Relationship to Session Context

`SessionContext` (`docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §9) carries the pipeline's working state for one conversation — never an infinite transcript. `currentIntent`, `currentEntities`, and `selectedSkillPlan` are the fields Intent Normalisation, Skill Router, and Superposer respectively populate as the pipeline progresses.

---

## 8. Status

Draft pipeline architecture. `tests/mpi-0-personal-intelligence-test.js` exercises intent normalisation (§6) and domain routing (§5) against the reference implementation in `projects/personal-intelligence/reference/intent-router.js`. No end-user-facing chatbot exists in production as a result of this stage.
