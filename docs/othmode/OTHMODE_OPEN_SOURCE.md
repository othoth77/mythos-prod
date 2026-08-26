# OTHMODE — Open Source Integration Plan + Registry Design

Phase 1 design. No dependency was installed and nothing was vendored in this phase.
Master document: [OTHMODE_AUDIT_AND_DESIGN.md](OTHMODE_AUDIT_AND_DESIGN.md)

**بالعربية باختصار:** القاعدة: "ابحث أولاً" — قبل بناء أي شيء جديد، نبحث عن حلّ مفتوح المصدر موجود ونعيد استعماله أو نكيّفه، والبناء من الصفر هو آخر خيار. هذه الوثيقة تحدّد المشاريع الخارجية الموافَق عليها وكيف سنسجّلها ونتابعها.

---

## 1. Search First policy (design — not implemented yet)

Order of operations for any new capability: **SEARCH → REUSE → ADAPT → CONNECT → BUILD LAST.**

- **Sources searched, in order of trust:** existing Mythos tools (this repo) → Anthropic Skills → MCP registry → GitHub/open source → PyPI / npm → n8n nodes → external APIs → templates.
- **Procedure (future `search-first` skill):** (1) state the need in one sentence; (2) search each source, recording query + best candidates; (3) score candidates (fit, license, maintenance, security surface, dependency weight); (4) Selector-style verdict — REUSE / ADAPT / CONNECT / BUILD; (5) record the verdict + evidence in the Open Source Registry (§3) and, once Evolution Memory exists, as an evolution event. BUILD requires a written "no suitable existing solution" line.
- **Connection to Selector:** a found solution biases REPLACE/EXTEND over CREATE ([OTHMODE_EVOLUTION.md](OTHMODE_EVOLUTION.md) §7).

## 2. Approved external projects — intended use

None of these exist in `mythos-prod` today (verified). Versions/licenses marked **TO-VERIFY** must be confirmed at integration time — no data is invented here.

| Project | Approved use | Explicit limits |
|---|---|---|
| **Evolver** | Architecture/component reference for Evolution, Genes, Capsules, Events, Signal Detection, Selection, Validation, Git/Rollback | **Do not fork and absorb completely**; take patterns, keep OTHMODE's own minimal store |
| **GEP — Genome Evolution Protocol** | Gene/capsule/event format, instead of a proprietary Evolution format | Adopt only where it fits; deviations documented |
| **Evolver Claude Code Plugin** | Study Claude Code integration patterns (hooks, skills wiring) | Study first; adopt selectively |
| **Graphify** | THE graph/visualization solution (knowledge/project/evolution graphs) | **Do not build a Graphify replacement** |
| **Search-First** (project) | Basis of the Search First capability/policy | Align policy vocabulary with it |
| **Anthropic Skills** | Official SKILL.md structure (already used by all 20 existing skills) + suitable ready-made skills | Existing skills stay authoritative; KEEP→EXTEND→MERGE→REPLACE→DEPRECATE→BUILD |
| **Skill Creator** | Only when a genuinely new/evolved skill is required (last step of the skill rule) | Never the first move |
| **Handoff / Session Handoff** | Identify the strongest existing pattern; compare against the live `docs/AI_HANDOVER.md` discipline, which already works | Replace only if measurably stronger |
| **n8n** | Already integrated; remains the Mythos OS execution/automation layer | **Not** a second OTHMODE workflow engine |

## 3. Open Source Registry (design)

A registry table/file owned by OTHMODE (surfaced in Settings), one record per external project:

```text
name · source (github/pypi/npm/mcp/anthropic/other) · repository/package ·
version (pinned) · license · purpose · integration method
(vendored/dependency/pattern-reference/service) · status
(EVALUATING/APPROVED/INTEGRATED/DEPRECATED/REJECTED) · dependencies ·
maintenance (last release, activity — TO-VERIFY at record time) ·
security (audit note, permission surface) · othmode usage (which module uses it)
```

Rules: a record is created by the Search First procedure, not ad hoc; REJECTED records are kept (they prevent re-evaluating the same dead end); license field is mandatory before status can become INTEGRATED; the registry itself is data, so the secret gate applies to it like everything else.

## 4. Current-repo precedent

The repository already practices restraint that OTHMODE inherits: MCC-1 has exactly one dependency (`pg`); oth-knowledge and the orchestrator have zero. New dependencies remain exceptional and reviewed (validation dimension "dependencies", [OTHMODE_EVOLUTION.md](OTHMODE_EVOLUTION.md) §9).

---

## 5. Final integration state (2026-08-26, OTHMODE-100)

- **Graphify: INTEGRATED.** `graphifyy` 0.9.50 (Apache-2.0, verified from installed package metadata) in an isolated venv on the production VPS (deploy user); vendor Claude skill registered user-scope; first real graph built from `projects/command-center` (299 nodes / 818 edges, deterministic AST, zero LLM/API-key use) and queried via `graphify explain`/`path`. OTHMODE runtime keeps zero dependency on it; Health lists it as an optional capability (file-presence check only — no execution); `graphify-out/` is gitignored. Name collision with the repo policy skill resolved as MERGE (policy vs implementation scopes) in `docs/SKILLS_EVOLUTION.md`.
- **Final Search First re-check** ran over every manually built capability (store, sessions, detectors, export); no maintained project matched the zero-dependency/fail-closed/no-exec/GPL-exclusion constraints better than what was built. Recorded in the registry's `final_review` field. No dependency was added to inflate the registry.

