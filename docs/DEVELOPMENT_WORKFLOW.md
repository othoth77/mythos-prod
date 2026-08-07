# Mythos — Development Workflow (Short Command Contract)

**Stage:** DEVX-0 — Development Acceleration MVP

---

## The contract

A normal future stage can begin from a short owner instruction such as:

> "Start INF-OVH-API-0 according to Mythos workflow."

or:

> "Start Stage 3E according to Mythos workflow."

**The owner's short instruction is authorisation and intent. It is not the source of repository facts.** GitHub remains the source of truth. The Stage Runner (`scripts/mythos-stage.js`), `mythos-project-context`, and the other Agent Development Skills derive the detailed execution context from GitHub/Git state — not from the owner repeating rules that already exist in this repository.

## What "according to Mythos workflow" means in practice

1. **Preflight** — `mythos-repo-guardian` confirms a clean worktree, `HEAD == origin/main` (or the declared base), and no unresolved merge/rebase.
2. **Context** — `mythos-project-context` reads `projects/meta/current-context.json` (regenerated via `node scripts/mythos-stage.js context`), `docs/PROJECT_STATUS.md`, and the latest `docs/AI_HANDOVER.md` entry before doing any broader repository scan.
3. **Stage resolution** — `node scripts/mythos-stage.js start <STAGE>` looks up the named stage in `projects/meta/project-ledger.json`, checks the one-major-stage rule, checks dependencies, and resolves a Stage Context: risk lane, relevant skills, relevant files, required tests, known baselines, blockers.
4. **Governance gate** — if the Stage Context reports any blocker (`ANOTHER_MAJOR_STAGE_ACTIVE`, `DEPENDENCY_UNSATISFIED`, `UNKNOWN_STAGE`, `DIRTY_WORKTREE`, `UNEXPECTED_MAIN_STATE`), the workflow stops there and reports the blocker — it does not guess around it.
5. **Implementation** — the smallest coherent change for that stage, per `mythos-safe-change` / `AGENTS.md` §7-§8.
6. **Test selection** — `mythos-test-intelligence` reads `projects/meta/test-impact-map.json` for the changed files and `projects/meta/known-baselines.json` for baseline comparison, rather than re-deriving test scope from scratch each time.
7. **Documentation** — `mythos-doc-sync` and `mythos-project-history` update `docs/AI_HANDOVER.md`, `docs/ROADMAP.md`, and `docs/history/DAILY_HISTORY.md` using the existing tooling from MPI-0-FINALIZATION — DEVX-0 does not duplicate that logic.
8. **Closure** — `node scripts/mythos-stage.js close <STAGE>` reports the changed-file scope, targeted tests, baseline comparison, and risk lane. For FAST/STANDARD lanes only, `close --apply` may commit/push/create-or-update a Draft PR after validation passes. HIGH_RISK lanes are never auto-applied — `HIGH_RISK_POLICY_VIOLATION` is returned instead, and the owner must review and act manually.
9. **PR / merge** — normal PR workflow (Draft → checks → review → Ready → merge). Merge always requires explicit owner authorisation per stage policy — the Stage Runner never merges on its own.

## What the owner never has to repeat

- Git preflight discipline
- Scope-control rules
- Which tests apply to which files
- What counts as a known, pre-existing test failure vs. a real regression
- Risk classification of a given kind of change
- Documentation update requirements
- The one-major-stage rule

All of the above are already encoded in `AGENTS.md`, the existing Agent Development Skills, and DEVX-0's metadata files. The owner's short instruction supplies only what only the owner can supply: **which stage, and permission to start it.**

## Stop conditions (never guessed around)

See `docs/DEVELOPMENT_ACCELERATION_ARCHITECTURE.md` §6 for the security rules and `scripts/mythos-stage.js` for the machine-readable blocker codes: `UNEXPECTED_MAIN_STATE`, `DIRTY_WORKTREE`, `UNKNOWN_STAGE`, `DEPENDENCY_UNSATISFIED`, `ANOTHER_MAJOR_STAGE_ACTIVE`, `OUT_OF_SCOPE_CHANGE`, `SECRET_DETECTED`, `NEW_TEST_REGRESSION`, `MISSING_APPROVAL`, `GITHUB_NOT_AUTHENTICATED`, `HIGH_RISK_POLICY_VIOLATION`. Each is returned as a machine-readable code plus a concise explanation — the workflow stops at the first real blocker rather than working around it.

## Command reference

```
node scripts/mythos-stage.js context
node scripts/mythos-stage.js status
node scripts/mythos-stage.js start <STAGE> [--dry-run|--apply]
node scripts/mythos-stage.js validate <STAGE>
node scripts/mythos-stage.js close <STAGE> [--dry-run|--apply]
```

Potentially mutating commands default to dry-run reporting. In this MVP, `--apply` on `start`/`close` still performs no direct Git mutation itself (branch creation and commit/push remain explicit manual steps per `AGENTS.md` scope control) — it only reports whether mutation *would* be allowed for the resolved risk lane. See `scripts/mythos-stage.js` inline notes.
