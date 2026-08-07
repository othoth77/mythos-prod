# Mythos — User Memory Policy

**Stage:** MPI-0 — Personal Intelligence Foundation
**Status:** Draft policy. Not deployed.
**Date:** 2026-08-06

---

## 1. Memory Types

Memory is separated by purpose — never one giant blob:

| Type | Example |
|---|---|
| **A. Working preferences** | Teacher prefers concise answer keys. |
| **B. Workflow memory** | Workshop user usually creates an estimate immediately after a diagnostic. |
| **C. Domain context** | Teacher teaches mathematics — only if explicitly stored/available in product context, never guessed. |
| **D. Organisation knowledge** | Workshop services/pricing policies. |
| **E. Task history** | Recent relevant actions. |
| **F. Decision memory** | Important explicit choices and their reasons. |
| **G. Ephemeral session memory** | Useful only within the current interaction; never persisted beyond it. |

Each type has its own retention and promotion rules; they are never merged into a single undifferentiated memory record.

---

## 2. Learning Pipeline

```
INTERACTION → OBSERVATION → CLASSIFICATION → CANDIDATE PATTERN
   → CONFIDENCE → CONFLICT CHECK → PERSIST / DISCARD → AUDIT
```

At `CLASSIFICATION`, every observation is assigned exactly one scope class — never mixed:

```
SESSION OBSERVATION
CANDIDATE USER PREFERENCE
ESTABLISHED USER PREFERENCE
EXPLICIT USER RULE
ORGANISATION RULE
DOMAIN RULE
GLOBAL RULE
PROJECT/SYSTEM RULE
```

---

## 3. Learning Scope and Promotion

Default learned scope is **`user`**. A pattern observed for one user is never automatically applied to another user, and a pattern observed inside one organisation is never automatically applied to another organisation.

Promotion to a wider scope (`organisation`, `domain`, `global`) is **not automatic** — it requires explicit governance/authorisation, exactly as `docs/AUTOMATION_GOVERNANCE.md` §5 requires for the permanent approval-boundary list. No automated learning pipeline may itself promote a `user`-scoped preference to `organisation` scope; that action is itself a `LEVEL_3_APPROVAL_REQUIRED`-equivalent decision requiring a human with the appropriate organisation-admin authority.

---

## 4. Confidence Model

```
single observation           → temporary (SESSION_OBSERVATION)
repeated pattern               → CANDIDATE_PREFERENCE
repeated consistent pattern     → ESTABLISHED_PREFERENCE
explicit user instruction        → EXPLICIT_USER_RULE (strongest, no further evidence required)
```

Numeric thresholds are an implementation detail of a given learning-engine version, not a fixed part of this policy — what is fixed is the state progression above and the metadata every learned record must carry: `source`, `evidenceCount`, `confidence`, `firstObservedAt`, `lastObservedAt`, `scope`, `status`, `supersedes`, `expiresAt` (where appropriate).

---

## 5. Memory Retrieval

Retrieval is relevance-driven, never exhaustive:

```
query current task
  → identify domain
  → identify organisation
  → identify user
  → retrieve relevant memory
  → rank
  → filter permissions/privacy
  → inject minimum useful context
```

**`loadAllUserMemory()` is an anti-pattern and must never be implemented.** The architecture supports future semantic/vector retrieval as a ranking strategy, but this stage does not require or force a vector database — see `docs/MYTHOS_CONTEXT_ARCHITECTURE.md` §"Retrieval Interface" for the provider-neutral contract this implies, and `projects/personal-intelligence/reference/context-assembler.js` for an in-memory illustrative implementation of the same interface.

---

## 6. Memory Write Policy

Not every conversation becomes memory. A candidate memory item is persisted only after passing:

`relevance`, `stability`, `scope`, `privacy`, `conflict`, `duplication`, `usefulness`.

### What does NOT become memory automatically

- Trivial greetings
- One-off wording choices
- Accidental statements
- Raw entire chat transcripts
- Sensitive information merely because it was mentioned in passing
- Inferred personal data without justification

A single instance of any of the above is, at most, a `SESSION OBSERVATION` — never immediately a candidate or established preference.

---

## 7. Forget, Correct, Override

The architecture must always support:

- User correction of a learned or explicit preference
- Preference update (superseding an older record, never silently overwriting it — the prior state is retained in the audit trail, not the live profile)
- Forgetting a learned preference entirely
- Invalidating an obsolete rule
- Organisation policy overriding a user preference where the organisation has that authority (§"Precedence Rules" in `docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md`)
- The current turn's explicit instruction overriding a compatible but weaker learned preference for that turn only

**No learned personal preference record is ever immutable.** Every correction and deletion is audited (who, when, what changed) without retaining the deleted sensitive content itself beyond what the audit trail's own retention policy requires.

---

## 8. Feedback Signals

Safe feedback events that may inform a **candidate** (never immediately established) user preference:

`accepted_result`, `edited_result`, `rejected_result`, `repeated_action`, `explicit_preference`, `explicit_correction`, `workflow_completion`.

**Not every edit is treated as a preference automatically** — a single edit is an observation; a preference candidate requires the pipeline in §2 to run its course.

---

## 9. Status

Draft policy. `projects/personal-intelligence/reference/learning-engine.js` provides an illustrative, testable implementation of §2–§4 (observation → candidate → established → explicit rule, with conflict/supersede handling), exercised by `tests/mpi-0-personal-intelligence-test.js`. No production memory store exists yet.
