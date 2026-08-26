# Mythos — Skills Evolution Audit

**Stage:** MPI-0-FINALIZATION
**Status:** Audit record. Performed by Opus 5 (read-only review) on PR #4 / branch `feat/mythos-personal-intelligence`, implemented by Sonnet 5.
**Date:** 2026-08-06

---

## 1. Purpose

A permanent record of the per-skill audit that produced the current `.claude/skills/` boundary set and the two new skills added in this stage. This is not a one-time document — future skill changes are recorded here going forward, per the lifecycle in `docs/SKILLS_VERSIONING_POLICY.md` and owned by `mythos-skill-evolution`.

## 2. Method

Each of the 18 MPI-0 skills was reviewed for: responsibility, overlap with other skills, inputs/outputs, safety framing, source classification correctness, repository/stage references, whether it belongs to the agent-development layer or is misworded as a runtime capability, whether its description is actionable, and whether it had become stale after MPI-0 (referencing files/concepts that don't exist). A skill was changed only when a genuine defect or gap was found — not to increase activity for its own sake.

## 3. Per-Skill Decisions

| Skill | Decision | Old Version | New Version | Reason |
|---|---|---|---|---|
| `mythos-project-context` | EXTEND | 1.0.0 | 1.1.0 | Now explicitly owns loading `docs/PROJECT_STATUS.md`, `docs/history/DAILY_HISTORY.md`, and `docs/PROJECT_STATISTICS.md` at task start, in addition to `docs/AI_HANDOVER.md`/`docs/ROADMAP.md`. Its git-preflight step is now an explicit delegation to `mythos-repo-guardian` rather than a near-duplicate. |
| `mythos-intent-architect` | EXTEND | 1.0.0 | 1.0.1 | Clarified as the one skill that legitimately spans both the agent-development and product-domain-intent layers; no responsibility change. |
| `mythos-skill-router` | KEEP | 1.0.0 | 1.0.0 | Distinct, correctly bounded, sequential with the superposer. |
| `mythos-superposer` | KEEP | 1.0.0 | 1.0.1 | Governing doc corrected (stale claim about a composition stub that does not exist); skill responsibility itself unchanged. |
| `mythos-skill-guard` | KEEP | 1.0.0 | 1.0.0 | Sole owner of the ALLOW/DENY decision; correctly defers to the existing approval matrix. |
| `mythos-repo-guardian` | EXTEND | 1.0.0 | 1.1.0 | Declared the sole owner of git/worktree preflight; `mythos-project-context` and `mythos-safe-change` now delegate to it explicitly instead of restating it. |
| `mythos-safe-change` | EXTEND | 1.0.0 | 1.1.0 | Step 1-2 converted into an explicit delegation to `mythos-repo-guardian`; step 4 converted into an explicit delegation to `mythos-test-intelligence`. |
| `mythos-test-intelligence` | KEEP | 1.0.0 | 1.0.0 | Genuine distinct concern (test-scope selection). |
| `mythos-change-impact` | KEEP | 1.0.0 | 1.0.1 | Cross-reference to `mythos-migration` added for the shared MAD-4 concern; responsibility unchanged. |
| `mythos-doc-sync` | EXTEND | 1.0.0 | 1.1.0 | Scope extended to `docs/PROJECT_STATE.md`; `docs/CHANGELOG.md` populated (was previously 0 bytes despite being in this skill's stated scope) so the claim is now true. Does **not** absorb daily-history duty — that is `mythos-project-history`'s distinct, differently-triggered responsibility (see §4). |
| `mythos-migration` | KEEP | 1.0.0 | 1.0.0 | Schema-convention authority distinct from `mythos-change-impact`'s pre-change boundary check. |
| `mythos-error-doctor` | EXTEND | 1.0.0 | 1.1.0 | The six baseline-failing suite names are now encoded explicitly (was previously "recall from memory"). |
| `mythos-smart-data-entry` | KEEP | 1.0.0 | 1.0.0 | Narrow, non-overlapping. |
| `mythos-document-intelligence` | KEEP | 1.0.0 | 1.0.0 | Owns `document.prepare`; `mythos-invoice-intelligence` now explicitly delegates formatting to it. |
| `mythos-invoice-intelligence` | EXTEND | 1.0.0 | 1.0.1 | Added explicit delegation of document formatting to `mythos-document-intelligence`, resolving a previously-silent overlap. |
| `mythos-client-360` | KEEP | 1.0.0 | 1.0.0 | Distinct cross-product entity-resolution concern. |
| `mythos-context-assembler` | KEEP | 1.0.0 | 1.0.1 | Clarified against the identically-named MPI-1 runtime component (see `docs/SKILLS_ARCHITECTURE.md` §1) — this skill is the agent-development-layer design counterpart, not the runtime component. |
| `mythos-personal-learning` | KEEP | 1.0.0 | 1.0.1 | Same clarification against the identically-named MPI-2 runtime component. |
| `mythos-skill-evolution` | **NEW** | — | 1.0.0 | See §4. |
| `mythos-project-history` | **NEW** | — | 1.0.0 | See §4. |

No skill was DEPRECATED, MERGED, or SPLIT in this audit — every overlap found was resolvable by declaring an explicit owner/delegator pair rather than by removing a skill.

## 4. New Skills — Rationale

### `mythos-skill-evolution` (CREATE)

Neither `mythos-repo-guardian` (scoped to `AGENTS.md`, which contained zero references to `.claude/skills/` before this stage) nor `mythos-safe-change` (scoped to implementation-stage lifecycle, not meta-artifacts) covered this responsibility. Concrete evidence it was missing: this very audit found a false "no overlap" claim in `docs/SKILLS_SOURCES.md`, a stale reference to a non-existent `mythos-context-compiler` skill cited in four docs, and an identifier collision between two dev-skill names and their future MPI-1/MPI-2 runtime counterparts — none of which any existing skill was positioned to catch. It also carries an explicit self-modification safety framing (§5) that no existing skill states.

### `mythos-project-history` (CREATE)

`mythos-doc-sync` did not cover it, and the repository proves this empirically: `docs/PROJECT_STATE.md` was last substantively updated 2026-07-31 ("Stage 3C"), and `docs/worklogs/` contains 7 files, all dated 2026-07-31, none since — while roughly fifteen further stages completed afterwards. Over that same period, `docs/AI_HANDOVER.md` and `docs/ROADMAP.md` were kept current, proving `mythos-doc-sync`'s stage-completion trigger *was* being discharged correctly while the daily chronological ledger rotted anyway. This is the exact distinction that justifies a separate skill: different trigger (per-development-day vs. per-completed-stage) and different, quieter failure mode ("forgot to log a day" is silent and easy to miss; "ROADMAP says the wrong stage" is loud and caught at the next handover).

## 5. Self-Modification Safety (permanent rule, owned by `mythos-skill-evolution`)

- Skill source must never silently rewrite itself.
- No end-user or product runtime behaviour may directly edit `.claude/skills/`.
- No learned user preference (`docs/MYTHOS_USER_MEMORY_POLICY.md`) may alter a development skill, globally or per-user — user learning and dev-skill evolution are different scopes entirely (see `docs/PERSONAL_INTELLIGENCE` vs. this document, and `docs/MYTHOS_PORTFOLIO_REGISTRY.md`'s "Phase 17" equivalent distinction).
- No AI session may self-promote a skill change without the change being a reviewed, committed, auditable diff — exactly like any other repository change (`AGENTS.md` §7).
- Every skill version bump is recorded in `projects/personal-intelligence/config/agent-skills-registry.json`, never only in the SKILL.md body.

## 6. Overlap Table (the honest replacement for the previous "no overlap" claim)

| Pair | Shared concern | Resolution |
|---|---|---|
| `mythos-project-context` ↔ `mythos-repo-guardian` | git/worktree preflight | `mythos-repo-guardian` is sole owner; `mythos-project-context` delegates. |
| `mythos-repo-guardian` ↔ `mythos-safe-change` | pre-implementation scope definition | `mythos-repo-guardian` owns AGENTS.md-rule enforcement generally; `mythos-safe-change` owns the stage-execution lifecycle steps that consume it. |
| `mythos-safe-change` ↔ `mythos-test-intelligence` | targeted-test-before-broad-test selection | `mythos-test-intelligence` is sole owner; `mythos-safe-change` delegates. |
| `mythos-change-impact` ↔ `mythos-migration` | MAD-4 no-cross-schema-FK enforcement | `mythos-change-impact` owns the pre-change boundary check; `mythos-migration` owns actual migration authoring once approved. |
| `mythos-invoice-intelligence` ↔ `mythos-document-intelligence` | formatted document output | `mythos-document-intelligence` owns formatting; `mythos-invoice-intelligence` delegates and owns only invoice/estimate domain judgement. |

## 7. Status

This audit is complete for the 20 skills that exist as of MPI-0-FINALIZATION. Future changes to any skill must be recorded as a new row/section here, not a silent edit — see `docs/SKILLS_VERSIONING_POLICY.md`.

---

## OTHMODE Phase 2 (2026-08-26) — six skills added, overlap audit

Added: `preflight`, `postflight`, `session-handoff`, `status-sync`,
`search-first`, `graphify` (all v1.0.0). Overlap resolution, following the
established owner/delegator pattern:

- `preflight` DELEGATES the git preflight to `mythos-project-context` and
  rule enforcement to `mythos-repo-guardian` (they stay the owners); it owns
  only the OthMode-flag/health/deploy-preflight consolidation.
- `postflight` DELEGATES doc sync to `mythos-doc-sync` and change discipline
  to `mythos-safe-change`; it owns only the closing checklist ordering and
  the evolution-recording step.
- `session-handoff` owns the AI_HANDOVER entry format; `mythos-doc-sync`
  remains the owner of cross-document consistency.
- `status-sync` owns the one-writer boundary statement; the Status Center
  engine remains the owner of status truth.
- `search-first` owns the search/verdict/registry procedure; the Selector in
  `docs/othmode/OTHMODE_EVOLUTION.md` consumes its evidence.
- `graphify` owns the use-don't-build rule for graphs.

Lifecycle note: these skills were added by reviewed Git change (this branch),
consistent with `mythos-skill-evolution` — skills never self-modify.
