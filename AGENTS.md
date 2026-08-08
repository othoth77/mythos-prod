# AGENTS.md — Mythos OS

## 1. Project mission

Mythos OS is an online-first production-management platform owned by Mythos Prod.

The final system must be usable entirely through a web browser. The user's computer must not be required to store the repository, application data, documents, backups, or unfinished work.

Primary objectives:

- Maintain a stable and testable architecture.
- Gradually reduce the legacy `js/app.js`.
- Move responsibilities into core modules, services, and runtime plugins.
- Preserve existing behavior and backward compatibility.
- Prepare a secure and durable production deployment.
- Minimize unnecessary tool calls, repository scans, output, and token usage.

## 2. Source of truth

GitHub is the only source of truth for committed project work.

Before starting any task:

1. Fetch the remote state.
2. Read `docs/AI_HANDOVER.md`.
3. Confirm the current branch, commit, remote HEAD, and worktree status.
4. Read only the roadmap or stage files directly relevant to the task.
5. Never rely exclusively on conversation summaries, `/tmp`, or an earlier session.

If conversation context conflicts with GitHub, GitHub and the latest committed handover take precedence.

Do not claim that a stage is complete unless its validated commit exists on the expected remote branch.

## 3. Online-first storage rules

Do not depend on files stored only on the user's computer.

Use:

- GitHub for source code, tests, documentation, and version history.
- A persistent VPS worktree for implementation.
- Coolify for deployment and environment configuration.
- Persistent database storage for application records.
- Persistent object storage for images, documents, and attachments.
- External storage for backups.
- Environment variables or an approved secret manager for secrets.

Do not store runtime data inside an ephemeral container layer.

Do not commit credentials, API keys, production secrets, sensitive database dumps, user uploads, runtime backups, local environment files, or temporary worktree files.

## 4. Persistent worktrees

Never leave completed or substantial unfinished work only in `/tmp`.

Use persistent stage worktrees such as:

```text
/srv/mythos/worktrees/stage-4b
```

Recommended pattern:

```text
/srv/mythos/repository
/srv/mythos/worktrees/<stage-name>
```

Before creating a worktree:

- Fetch `origin`.
- Confirm the intended base commit.
- Check existing worktrees and branches.
- Reuse a valid existing worktree when appropriate.
- Never overwrite another worktree or unrelated user changes.

Temporary directories may be used only for disposable generated output that can be recreated cheaply.

## 5. Mandatory startup preflight

At the start of every implementation task, perform a concise preflight:

```bash
git fetch origin
git status --short
git branch --show-current
git rev-parse HEAD
git rev-parse origin/main
```

Then inspect only:

- `docs/AI_HANDOVER.md`
- The current stage entry in `docs/ROADMAP.md`
- Files directly involved in the requested task
- Relevant targeted tests

Stop immediately on unexpected divergence, unresolved conflicts, a wrong repository or worktree, a missing prerequisite commit, overlapping unrelated changes, missing required access, or a failing prerequisite test. Report the exact blocker without speculative work.

## 6. Task modes

Determine the requested mode before acting.

### Review or preflight

- Work read-only.
- Do not edit, commit, push, deploy, or migrate production data.
- Report evidence, scope, risks, and the next implementation step.

### Implementation

- Modify only the approved scope.
- Add or update targeted tests.
- Validate the change.
- Update required project documentation.
- Commit and push the validated stage before ending.
- Confirm that the remote branch contains the new commit.

### Deployment

Deployment is a separate task. Deploy only when explicitly requested or required by the approved stage plan.

### Data migration

Production data migration is a separate high-risk task. Never migrate, delete, overwrite, or transform production data without an explicit scope, verified backup, and rollback plan.

## 7. Stage execution lifecycle

Every implementation stage must follow this sequence:

1. Verify the previous stage on `origin/main`.
2. Create or reuse a persistent VPS worktree based on the correct remote commit.
3. Define the exact file and behavior scope.
4. Inspect only required callers and dependencies.
5. Implement the smallest coherent change.
6. Run relevant syntax and static checks.
7. Run targeted tests.
8. Review the final diff and staged file list.
9. Run the full suite once only when required.
10. Update project documentation.
11. Commit with a focused message.
12. Push to the approved remote branch.
13. Verify the remote HEAD.
14. Record the result in `docs/AI_HANDOVER.md`.

A stage is not complete while it exists only in a worktree, stash, temporary branch, patch, or conversation. Do not start the next stage until the current stage is committed, pushed, and verified remotely.

## 8. Validation policy

Use the cheapest reliable validation sequence.

First run targeted tests covering the changed module, direct callers, known regression risks, and script loading or compatibility globals when relevant.

Run the full suite only when:

- Finalizing a significant architectural stage.
- Shared core behavior changed.
- Targeted tests reveal broader regression risk.
- The previous full-suite result no longer applies.
- Explicitly requested.

Reuse a previous result only when the tested code, base commit, tests, and relevant environment are unchanged. Never report tests as passing unless executed or clearly labeled as previously verified.

## 9. Token and tool efficiency

- Do not use subagents unless explicitly authorized and genuinely necessary.
- Read only files required for the current task.
- Prefer targeted searches with `rg`.
- Avoid repeated repository-wide scans and rereading unchanged large files.
- Reuse verified dependency maps, analysis, and test results.
- Use diffs and narrow line ranges instead of printing complete files.
- Run independent read-only checks in parallel when safe.
- Run targeted tests before broader tests.
- Run the full suite at most once per required validation point.
- Keep command output and reports concise.
- Stop at the first real blocker.
- Do not investigate unrelated defects unless they block the stage; record them for later.

Do not trade correctness for token reduction.

## 10. Scope control

Before editing, establish the objective, expected changed files, affected functions or modules, compatibility requirements, targeted tests, and explicit exclusions.

Do not make opportunistic refactors. Do not modify `.gitignore`, agent configuration, deployment configuration, production environment configuration, authentication, authorization, database schema, unrelated documentation, or unrelated formatting unless directly required. Preserve existing user changes.

## 11. Architecture rules

Core modules own shared infrastructure such as storage primitives, pending writes, synchronization, routing, API access, and shared lifecycle behavior. Runtime plugins own bounded business features and use approved storage and synchronization interfaces.

Treat `js/app.js` as legacy code being reduced incrementally. For every extraction:

- Preserve behavior before improving it.
- Move one coherent responsibility at a time.
- Map callers and dependencies first.
- Preserve required global names temporarily.
- Verify browser script order.
- Avoid duplicate definitions, listeners, timers, and initialization.
- Avoid circular dependencies.
- Add regression tests before deleting compatibility code.
- Delete old code only after confirming nothing uses it.

Do not combine extraction, redesign, and behavioral changes in one stage unless explicitly approved.

## 12. Storage and synchronization invariants

All application writes must pass through the approved storage/write pipeline. Do not introduce direct writes to `localStorage`, IndexedDB, remote collections, or production database endpoints unless explicitly defined by the architecture.

When modifying storage or synchronization, verify:

- Pending writes survive temporary failures.
- Writes do not silently bypass synchronization.
- Tombstones prevent deleted records from reappearing.
- Server-to-local writes do not create sync loops.
- Duplicate timers and event listeners are not introduced.
- Offline recovery remains functional.
- Browser shutdown and `pagehide` handling remain safe.
- Merge behavior is deterministic.
- Compatibility globals remain available until callers migrate.
- Data survives deployment container recreation.

Handle known raw-storage bypasses in their planned stage; do not expand them.

## 13. Script loading and browser compatibility

- Inspect the actual application entry file and script order.
- Load dependencies before consumers.
- Guard browser-only globals in non-browser tests.
- Avoid executing application behavior merely by loading a module in tests.
- Preserve existing global interfaces where required.
- Handle missing DOM elements safely.
- Ensure initialization occurs exactly once.

Expected dependency direction:

```text
core primitives
→ shared core services
→ application bootstrap
→ runtime plugins
```

Do not introduce reverse dependencies without documentation and tests.

## 14. Security rules

Never expose secrets in source files, Git history, tool output, fixtures, documentation, or commit messages. Do not weaken security controls to pass tests.

Before production work, verify authentication, authorization, input validation, upload restrictions, backup confidentiality, restore permissions, sensitive logging, environment-variable handling, dependencies, and deployment configuration.

## 15. Production and deployment rules

Intended production model:

```text
GitHub
→ Coolify deployment
→ persistent application services
→ persistent database/object storage
→ external backups
```

Before deployment, confirm the commit, required environment variables without printing values, persistent storage, backup/restore paths, smoke tests, and rollback capability. Never deploy from an uncommitted worktree.

After deployment, record the deployed commit, deployment status, smoke-test result, migration status, backup status, and rollback reference.

## 16. Backup and restore

A backup is valid only after restoration is tested. Production backups must be outside the application container, preferably separate from the primary VPS, timestamped or versioned, private, retained under a documented policy, and periodically restored in a controlled test.

Never delete or replace a production backup without explicit authorization.

## 17. Git rules

Before committing:

```bash
git diff --check
git status --short
git diff --stat
git diff --cached --name-only
```

Confirm only intended files are staged, no secrets or runtime data are included, user changes are preserved, and required tests passed.

Use focused commit messages. Do not force-push, rewrite shared history, amend pushed commits, use destructive reset/checkout on user work, push failing stages to the production branch, or claim success before checking the remote commit unless explicitly authorized.

After pushing:

```bash
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
```

The expected local commit and remote HEAD must match.

## 18. Documentation requirements

For every completed stage, update `docs/AI_HANDOVER.md` with:

- Date and stage name.
- Objective.
- Commit hash and remote HEAD.
- Changed files.
- Targeted test results.
- Full-suite result or reason it was not rerun.
- Known risks or deferred issues.
- Current worktree state.
- Exact next stage.
- Deployment and migration status.

Update `docs/CHANGELOG.md`, `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, or the stage worklog only when relevant.

Documentation must distinguish implemented and pushed, implemented but unpushed, planned, blocked, deployed, and migrated states. Never describe unpushed work as completed.

## 19. Roadmap discipline

Read the current roadmap from the repository. The general sequence is:

1. Complete and verify storage extraction.
2. Extract synchronization.
3. Extract routing.
4. Extract calendar behavior.
5. Extract Dashboard behavior.
6. Move remaining CRUD behavior into runtime plugins.
7. Remove confirmed legacy code.
8. Eliminate direct storage/sync bypasses.
9. Perform integration, offline, large-data, security, backup, and restore tests.
10. Prepare stable production deployment.
11. Migrate required data and files.
12. Enable external backups and monitoring.

Do not skip prerequisites.

## 20. Blocker handling

A blocker report contains only the failed prerequisite or command, exact result, affected stage, whether files changed, and safest next action.

Do not continue through divergence, test failures, missing files, missing access, missing authorization, unexpected production state, or unverified destructive operations. Do not propose subagents as the default answer to missing access.

If a prior worktree is unavailable, check GitHub branches and commits, persistent VPS worktrees, recoverable stashes, and documented patch references. Reimplement from `origin/main` only if no authoritative copy exists.

## 21. Required final report

After implementation, report only:

```text
Stage:
Status:
Commit:
Remote HEAD:
Tests:
Changed files:
Deployment:
Next stage:
Blocker:
```

For a read-only review, report only:

```text
Review status:
Verified commit:
Scope:
Findings:
Required tests:
Risks:
Recommended next action:
```

Clearly label anything not directly verified.

## 22. Prohibited behavior

- Leaving completed work only in `/tmp`.
- Depending on the user's computer for continuity.
- Starting a new stage before pushing the validated current stage.
- Repeated repository scans or full-suite runs without cause.
- Using subagents without explicit authorization.
- Editing unrelated files.
- Hiding failed tests.
- Reporting assumed commands as executed.
- Deploying uncommitted code.
- Storing production data in ephemeral containers.
- Committing secrets, uploads, backups, or runtime databases.
- Migrating or deleting production data without explicit authorization.
- Replacing GitHub evidence with conversation memory.

## 23. Default operating principle

Use the smallest safe action that moves the current stage to a verified, persistent state.

A stage is finished only when its scope is complete, required tests pass, documentation is updated, the commit is pushed, remote HEAD is verified, and the next stage is recorded.

## 24. Agent Skills (`.claude/skills/`)

This repository ships native Agent Skills under `.claude/skills/<name>/SKILL.md`. Every entry there is an **Agent Development Skill** — used by Claude/Codex while building and operating Mythos — never a **Runtime Mythos Capability** reachable from an end-user request. See `docs/SKILLS_ARCHITECTURE.md` for the full distinction, `docs/SKILLS_SOURCES.md` for source classification (upstream/wrapper/original), `docs/SKILLS_EVOLUTION.md` for the per-skill audit and overlap-resolution record, `docs/SKILLS_VERSIONING_POLICY.md` for version semantics, and `projects/personal-intelligence/config/agent-skills-registry.json` for the canonical machine-readable registry.

Skill source must never silently rewrite itself. No end-user or product behaviour may directly edit `.claude/skills/`. A skill change is a reviewed repository change like any other — see `mythos-skill-evolution` for the controlled lifecycle this follows.
