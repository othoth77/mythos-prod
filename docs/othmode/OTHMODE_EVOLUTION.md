# OTHMODE — Evolution Design

Phase 1 design. **Nothing here is implemented.** The Evolution Engine is built gradually; Evolution Memory exists from the first implementation.
Master document: [OTHMODE_AUDIT_AND_DESIGN.md](OTHMODE_AUDIT_AND_DESIGN.md)

**بالعربية باختصار:** "التطوّر" يعني أن النظام يتعلّم ويتحسّن — لكن بطريقة مُراقَبة تماماً: كل تغيير له سبب مسجَّل، ودليل، ومراجعة، واختبار، وإمكانية تراجع عبر Git. لا يوجد أي "تعديل ذاتي" بدون رقابة. نبدأ بالذاكرة فقط (تسجيل ما يحدث)، والمحرّك يُبنى تدريجياً بعد ذلك.

---

## 1. Principles

- **Observable · Reviewable · Validated · Versioned · Reversible.** No uncontrolled self-modification, ever.
- **Memory before engine.** Phase one only *records* (events, signals, outcomes). Selection and automated proposals come later, on top of real recorded data.
- **Reuse before invention:** Evolver architecture and GEP format are the approved references ([OTHMODE_OPEN_SOURCE.md](OTHMODE_OPEN_SOURCE.md)); adopt GEP's gene/capsule/event format where it fits instead of inventing a proprietary one. **Do not** fork/absorb Evolver wholesale.
- **EvoMap boundary:** no EvoMap Hub, worker pool, evolution network, distributed agents, or EvoMap infrastructure in the first implementation. Everything below runs locally on the existing VPS/repo.
- **Existing seeds to build on:** `mythos-skill-evolution` (reviewed skill lifecycle), `mythos-personal-learning` (observation→candidate→established→rule ladder), status-center append-only reviews, `mythos-governance-approve` (human approval primitive), `mythos-deploy` lastgood rollback.

## 2. Evolution Memory (first implementation)

Append-only store, same engineering pattern as the oth-knowledge store (JSONL + content-addressed evidence objects), living **outside Git** next to the knowledge store (e.g. `/home/deploy/oth-evolution-store`, 0700, fail-closed if absent). Git stores the *code and validated artifacts* (genes/capsules as files); the store records *history*.

Remembered (mandate §10): evolution events, signals, genes, capsules, successful changes, failed changes, reasons, evidence, versions, validation results, rollback points.

Record shape (all records share): `id`, `ts`, `type`, `actor` (human|claude|system), `refs[]`, `evidence[]` (content-addressed), `version`.

## 3. Genes

Small reusable evolution units — deliberately not over-engineered: **a gene is a versioned markdown/JSON file in Git** with a tiny manifest.

```text
projects/othmode/evolution/genes/<gene-id>/
  gene.json   { id, type, version (MAJOR.MINOR), status, origin_event, validation }
  gene.md     the actual content
```

Types (closed list, extend by review): `rule` · `skill-fragment` · `prompt-strategy` · `tool-selection-strategy` · `workflow-pattern` · `validation-rule` · `routing-strategy`.

## 4. Capsules

Reusable **validated** evolution packages: a directory bundling genes + context + instructions + tool references + validation spec + evidence links + version. A capsule is installable only if its validation record is PASS and its review state is APPROVED. Format: follow GEP where suitable.

## 5. Evolution Events

One traceable record per evolution attempt, with explicit stages:

```text
TRIGGER → SIGNAL → CANDIDATE → SELECTION → REVIEW → VALIDATION → RESULT
          (each stage: who/what, ts, evidence refs)      + VERSION + ROLLBACK POINT (git SHA)
```

An event that stops at any stage is still a complete, honest record (e.g. `RESULT: REJECTED_AT_REVIEW`). Failed evolutions are as valuable as successful ones and are never deleted.

## 6. Signal Detection

Sources (future, phased): user feedback · repeated success · repeated failures · tool failures · skill failures · performance changes · project changes · GitHub releases · open-source changes · PyPI/npm changes · MCP changes.

Rules:
- Phase one: signals are **recorded manually or by simple detectors** (e.g. history aggregator notices N failures of the same tool). No automation acts on them.
- **Not every signal produces an evolution.** Signals get a disposition: `NOTED` / `WATCH` / `CANDIDATE`. Only `CANDIDATE` enters the Selector.
- Thresholding and dedup required (one flaky test ≠ a signal).

## 7. Selector

Decision vocabulary: `KEEP · EXTEND · MERGE · REPLACE · DEPRECATE · CREATE`, evaluated **in that order of preference** — improving an existing capability always beats creating a new one. Selector output is a *proposal* attached to the event; it decides nothing by itself. Inputs: the signal, the affected component's health/history, Search First results (an existing solution biases toward REPLACE/EXTEND over CREATE).

## 8. Review

Risk-tiered, mirroring the existing automation approval matrix:

| Tier | Examples | Review |
|---|---|---|
| Low | wording of a prompt-strategy gene, doc-only capsule | AI review + recorded rationale; owner can audit later |
| Medium | tool-selection/routing strategy, new gene type usage | AI review + owner notification; applied only after explicit ACK |
| High | anything touching permissions, providers with execution authority, validation rules, deploy/infra, skills that gate other skills | **Human approval required before validation runs** (governance-approve pattern) |

The AI may propose at any tier; it may never approve its own high-tier change. Tier classification itself is a validation-checked rule (a gene), reviewed at high tier.

## 9. Validation

Explicit **PASS / FAIL**, recorded with evidence. Dimensions: functional correctness · regression (existing suites, 0-new-failures rule) · security (secret gate, permission diff) · compatibility · performance · dependencies (no new deps without review) · scope (change touches only declared paths) · license (for anything imported). FAIL is terminal for that candidate version; a fix is a new version, a new validation.

## 10. Git / Rollback lifecycle

```text
BEFORE (record rollback point = current SHA)
  → CHANGE (branch, never main directly)
  → TEST (validation suite, PASS required)
  → COMMIT (evidence-linked message)
  → OBSERVE (post-merge watching window; health + history)
  → KEEP  or  ROLLBACK (git revert / mythos-deploy rollback to lastgood)
```

Git is the only rollback mechanism. Every applied evolution stores its rollback point in the event; rollback is itself recorded as an event (`RESULT: ROLLED_BACK`, with reason).

## 11. Phasing

1. **E0 (with first OTHMODE release):** Evolution Memory store + event/genes/capsules data model + read-only UI. Manual event recording.
2. **E1:** simple signal detectors from Command History + Health; Selector as a documented checklist the AI fills in.
3. **E2:** review workflow wired to governance-approve; validation runner wired to existing test suites.
4. **E3:** GEP-format capsules; skill-creator integration for genuinely new skills; broader signal sources (releases, registries).
