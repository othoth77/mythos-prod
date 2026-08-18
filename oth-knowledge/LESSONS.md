# LESSONS.md — Reusable Technical Knowledge

Durable lessons that save real time. Only knowledge that stays true and actionable belongs here — no trivia.

## Template for new entries

```text
Lesson:
Project(s):
Context:

What we learned:

Recommended approach:

What to avoid:

Related files / folders / repositories:
```

## Index

- [Documentation staleness is a proven failure mode here — verify project state from Git, not status docs](#documentation-staleness-is-a-proven-failure-mode-here-verify-project-state-from-)
- [Repository identity is a guarded invariant: othoth77/mythos-prod main is the sole source of truth — verify with git remote -v](#repository-identity-is-a-guarded-invariant-othoth77mythos-prod-main-is-the-sole-)
- [Script loading order in index.html is a hard architectural constraint — how to add a module safely](#script-loading-order-in-indexhtml-is-a-hard-architectural-constraint-how-to-add-)
- [Legacy extraction from js/app.js: preserve globals until callers migrate, one responsibility per stage](#legacy-extraction-from-jsappjs-preserve-globals-until-callers-migrate-one-respon)
- [Tests are browser-free Node scripts using vm sandboxes — stub browser globals, never boot the app](#tests-are-browser-free-node-scripts-using-vm-sandboxes-stub-browser-globals-neve)
- [Six suites fail on origin/main by baseline (_memCache cascade) — check known-baselines.json before calling anything a regression](#six-suites-fail-on-originmain-by-baseline-memcache-cascade-check-known-baselines)
- [Test scope is data-driven: projects/meta/test-impact-map.json maps changed paths to targeted tests and a risk lane](#test-scope-is-data-driven-projectsmetatest-impact-mapjson-maps-changed-paths-to-)
- [A stage exists only when committed, pushed, and remote-verified — never leave work in /tmp or a worktree alone](#a-stage-exists-only-when-committed-pushed-and-remote-verified-never-leave-work-i)
- [Storage/sync invariants: all writes go through the _storeSave pipeline; sendBeacon flush must stay synchronous; migration guards stay](#storagesync-invariants-all-writes-go-through-the-storesave-pipeline-sendbeacon-f)
- [Production hygiene: prod webroot and Git live in separate directories; a fixed never-commit list; api.php has no auth](#production-hygiene-prod-webroot-and-git-live-in-separate-directories-a-fixed-nev)
- [Skill-registry governance: resolve overlaps by declaring an owner/delegator pair, version every change in the registry, and skills never self-modify](#skill-registry-governance-resolve-overlaps-by-declaring-an-ownerdelegator-pair-v)
- [Decision records carry evidence class and authority provenance — never resolve an unknown by inference, never supersede silently, and spec approval is not implementation authorization](#decision-records-carry-evidence-class-and-authority-provenance-never-resolve-an-)
- [External-reviewer findings must be reproduced against the repo (failing test first) before any fix — and non-reproducing findings get no speculative change](#external-reviewer-findings-must-be-reproduced-against-the-repo-failing-test-firs)
- [css/main.css is the live production stylesheet, drift-guarded by a test — do not edit shared root CSS without full-application regression capability](#cssmaincss-is-the-live-production-stylesheet-drift-guarded-by-a-test-do-not-edit)
- [The short-command workflow: the owner's instruction supplies only which stage and permission — everything else is derived from repo state and stops on machine-readable blockers](#the-short-command-workflow-the-owners-instruction-supplies-only-which-stage-and-)

---

### Documentation staleness is a proven failure mode here — verify project state from Git, not status docs

- **Project(s):** mythos-prod

**Context:** The repo's status docs (docs/ROADMAP.md, docs/PROJECT_STATUS.md, docs/history/DAILY_HISTORY.md) claimed 'Stage 3E is next' for weeks while Stages 3E-3G, 3H, and 33 Stage-4 sub-stages were already merged to main. Every subsequent AI session correctly trusted the docs and carried the stale claim forward unchallenged, until CHECKPOINT-RECOVERY-0 and a dedicated MYTHOS-STAGE-RECONCILIATION-0 stage (2026-08-10) reconstructed the true boundary from git log / merge-base ancestry. Root cause confirmed in the handover itself: stages were committed without updating the handover, then later entries copied the stale boilerplate.

**What we learned:** In this repository, docs describing 'current stage' can be systemically wrong even when each individual stage was documented somewhere. Reconciliation stages exist because of this. Git evidence (commit ancestry via `git merge-base --is-ancestor`, `git log --diff-filter=A -- 'tests/stage*-test.js'`) is the only reliable way to determine what is actually complete. When correcting docs, the house style is to annotate stale statements in place with an inline correction note (append-only for DAILY_HISTORY.md), never silently rewrite historical entries.

**Recommended approach:** Before any task: fetch origin, read docs/AI_HANDOVER.md's newest entry, and confirm claims against git (`git rev-parse HEAD` vs `origin/main`; stage-completion claims against commit ancestry). Treat commit-message test counts as 'cited, not re-executed' unless you ran them. When you complete a stage, update docs/AI_HANDOVER.md in the same delivery (a stage is not complete without it, per AGENTS.md §18), and never mark a stage complete unless its validated commit exists on the remote branch.

**What to avoid:** Relying on conversation summaries, /tmp state, or a status doc's 'next stage' claim without Git corroboration; silently rewriting historical doc entries when reconciling; copying forward boilerplate status sentences from earlier handover entries into new ones.

**Related files / folders / repositories:**

- `docs/AI_HANDOVER.md`
- `docs/ROADMAP.md`
- `docs/PROJECT_STATUS.md`
- `docs/history/DAILY_HISTORY.md`
- `AGENTS.md`

*Evidence:* docs/AI_HANDOVER.md sections 'RECONCILIATION — MYTHOS-STAGE-RECONCILIATION-0 (2026-08-10)' and 'CHECKPOINT — CHECKPOINT-RECOVERY-0 (2026-08-10)' (approx. lines 9032-9140); AGENTS.md §2, §18

---

### Repository identity is a guarded invariant: othoth77/mythos-prod main is the sole source of truth — verify with git remote -v

- **Project(s):** mythos-prod

**Context:** A second private repository, othoth77/mythos-os, exists and holds a stale 2026-07-29 working copy. AGENTS.md records a formal migration to it as NOT AUTHORISED and NOT STARTED. A design-recovery audit also found multiple stale local clones (e.g. one 69 commits behind) and loop worktrees on the VPS.

**What we learned:** Multiple plausible-looking repos and checkouts of this project exist, and drawing conclusions from the wrong one has been a real risk documented in the repo. The rules explicitly require verifying repository identity before trusting where work was delivered, and forbid treating mythos-os as a mirror or using it to verify mythos-prod commits.

**Recommended approach:** Run `git remote -v` before drawing conclusions about where work landed. Treat othoth77/mythos-prod branch main as the only canon until docs/MYTHOS_REPOSITORY_MIGRATION.md's gate is explicitly closed by the owner. If a prior worktree is missing, check GitHub branches, persistent VPS worktrees, and documented patch references before reimplementing from origin/main.

**What to avoid:** Pushing to, reading canon from, or reconfiguring services toward any other repository; assuming a stale local clone reflects main; starting the mythos-os migration on your own initiative.

**Related files / folders / repositories:**

- `AGENTS.md`
- `docs/MYTHOS_REPOSITORY_MIGRATION.md`
- `docs/MYTHOS_DESIGN_RECOVERY.md`

*Evidence:* AGENTS.md §2.1; docs/MYTHOS_DESIGN_RECOVERY.md §2 (table of stale clones and worktrees)

---

### Script loading order in index.html is a hard architectural constraint — how to add a module safely

- **Project(s):** mythos-prod

**Context:** The app is vanilla JS with no build step, no bundler, and no import/export (an explicit constraint in docs/refactoring-plan.md). All wiring is blocking <script> tags in index.html (~lines 2174-2227) in a fixed dependency order: js/utils.js → js/core/* (events, storage, sync, router, api, platform, shell) → js/core/services/* → js/core/plugin-sdk.js → js/plugins/*.runtime.js → js/logger.js → js/auth.js → js/app.js → js/shared/* (data modules before consumers, e.g. accounting-reports.js after accounting-purchases.js but before accounting-overview.js) → js/taches.js. Each tag carries a `?v=YYYYMMDD` cache-busting query string.

**What we learned:** Dependency direction is core primitives → shared core services → application bootstrap → runtime plugins, and the order is enforced by tests: stage tests assert relative script positions by comparing indexOf() of script paths in index.html (see tests/stage4t-test.js §6). Plugins survive missing dependencies via `typeof X !== 'undefined'` guards, so misordering fails silently at runtime — only the tests catch it.

**Recommended approach:** When adding a module: insert its <script> tag after everything it reads and before everything that calls it; bump/add the ?v= version stamp; add a script-order assertion in the stage test (indexOf comparison pattern); keep late-binding guards (`typeof STORE === 'undefined'`) for globals defined later in the load order.

**What to avoid:** Introducing import/export, a bundler, or a framework (explicitly out of scope); introducing reverse dependencies (plugin → core is fine, core → plugin is not) without documentation and tests; assuming load order from file layout instead of reading index.html.

**Related files / folders / repositories:**

- `index.html`
- `docs/refactoring-plan.md`
- `docs/runtime-consolidation.md`
- `docs/plugin-sdk.md`
- `tests/stage4t-test.js`
- `AGENTS.md`

*Evidence:* index.html script block (lines 2174-2227, confirmed by grep); docs/runtime-consolidation.md 'Startup Sequence'; docs/refactoring-plan.md header constraint; AGENTS.md §13; tests/stage4t-test.js §6

---

### Legacy extraction from js/app.js: preserve globals until callers migrate, one responsibility per stage

- **Project(s):** mythos-prod

**Context:** js/app.js started at ~9,948 lines and is being reduced incrementally into js/shared/* modules and runtime plugins. HTML onclick attributes call functions by global name, duplicate early function stubs exist (last declaration wins), and runtime plugins late-bind to app.js globals (STORE, renderCalendrier, getTaches) at call time.

**What we learned:** The extraction discipline that has worked across ~40 stages: preserve behavior before improving it, move one coherent responsibility per commit, map callers (including index.html onclick attributes) first, keep required global names available temporarily, and delete old code only after regression tests confirm nothing uses it. Stage tests enforce completion by asserting `app.indexOf('function name(') < 0` for extracted functions and that the new global still exists. Duplicate early stubs (documented at docs/refactoring-plan.md Phase 0.1) must not be removed until all HTML onclick callers are verified against the later implementation.

**Recommended approach:** Follow the per-domain procedure in docs/refactoring-plan.md Phase 5: identify the domain's functions and the globals it reads, create the target file in js/shared/, add the script tag in dependency position, verify onclick callers, then remove from app.js with a test asserting the removal. Keep extractions behavior-identical — even known bugs are preserved and noted (e.g. stage 4T preserved a return-before-DOM reconciliation quirk and empty-data NaN% output rather than fixing them mid-extraction).

**What to avoid:** Combining extraction, redesign, and behavior changes in one stage; renaming functions that HTML onclick attributes reference; removing STORE or other compatibility globals while runtime plugins still late-bind to them (documented as a deliberate Stage 4 concern in docs/runtime-consolidation.md 'Legacy Dependencies').

**Related files / folders / repositories:**

- `js/app.js`
- `js/shared/`
- `docs/refactoring-plan.md`
- `docs/runtime-consolidation.md`
- `tests/stage4t-test.js`
- `AGENTS.md`

*Evidence:* AGENTS.md §11; docs/refactoring-plan.md Phases 0-6; docs/runtime-consolidation.md 'Legacy Dependencies' and 'Compatibility Matrix'; tests/stage4t-test.js integration section; docs/production-safety.md 'Known risks' #2

---

### Tests are browser-free Node scripts using vm sandboxes — stub browser globals, never boot the app

- **Project(s):** mythos-prod

**Context:** There are ~110 test files in tests/ (49 stage*-test.js plus per-track suites), all plain Node scripts with a custom ok()/section() harness and no test framework. Browser-facing modules are loaded via `vm.runInContext` into a hand-built sandbox that stubs exactly what the module needs: a fake `document.getElementById`, a fake `STORE` with canned collections, stub utilities (todayStr, num, fmtMoney), and a silenced console (see tests/stage4t-test.js sandbox()).

**What we learned:** The test convention is: build a minimal vm context per suite, read the module source with fs and run it in the context, then assert on the globals it defines and the strings it renders. Suites also do source-level assertions (reading index.html and js/app.js as text). Modules must therefore guard browser-only globals and must not execute application behavior merely by being loaded (AGENTS.md §13) — a module with load-time side effects breaks this harness.

**Recommended approach:** For a new module, copy the sandbox pattern from an existing stage test: stub only the globals the module touches, seed deterministic data, and exit(1) on failure count. Keep new modules side-effect-free at load time so vm loading stays cheap. Run a suite with `node tests/<name>-test.js`.

**What to avoid:** Adding jest/mocha or any framework dependency; writing modules that touch document/localStorage/fetch at top level unguarded; tests that depend on a real browser or network.

**Related files / folders / repositories:**

- `tests/stage4t-test.js`
- `tests/stage3d-test.js`
- `tests/core-test.js`
- `.claude/skills/mythos-test-intelligence/SKILL.md`
- `AGENTS.md`

*Evidence:* tests/stage4t-test.js (vm.createContext sandbox read directly); .claude/skills/mythos-test-intelligence/SKILL.md; AGENTS.md §13

---

### Six suites fail on origin/main by baseline (_memCache cascade) — check known-baselines.json before calling anything a regression

- **Project(s):** mythos-prod

**Context:** A pre-existing core failure involving `_memCache` (the in-memory cache in js/core/storage.js) cascades into six suites that fail identically on origin/main and every unrelated branch: stage3c, stage3b, stage3a5 (partial) and stage3a, stage2d, stage1c-part1 (subprocess error). tests/stage3d-test.js §9 runs all six as child processes and scores each pass/fail, so the canonical baseline signature is stage3d reporting 104/110.

**What we learned:** A failure that exactly matches a recorded baseline is KNOWN_BASELINE_FAILURE, not a regression — and the repo maintains this knowledge in two places that must stay in agreement: the human-readable list in .claude/skills/mythos-error-doctor/SKILL.md and the machine-readable projects/meta/known-baselines.json. The verification method is an isolated `git worktree add` comparison against the base commit, never assumption. Baselines are promoted only via a reviewed Git change to the JSON file, never auto-written at runtime.

**Recommended approach:** On unexpected test failures, first compare the failure count/signature against projects/meta/known-baselines.json; if it matches exactly, verify with a base-commit worktree run and classify as known. If you verify a NEW baseline, add it to both the JSON and the error-doctor SKILL.md in the same reviewed change.

**What to avoid:** Attempting an unscoped fix of the _memCache cascade while working an unrelated stage (scope control, AGENTS.md §10); letting a new regression become a baseline automatically; updating only one of the two baseline records.

**Related files / folders / repositories:**

- `.claude/skills/mythos-error-doctor/SKILL.md`
- `projects/meta/known-baselines.json`
- `tests/stage3d-test.js`
- `js/core/storage.js`

*Evidence:* .claude/skills/mythos-error-doctor/SKILL.md; projects/meta/known-baselines.json (baseline stage3d-known-failures, expected 104/110, read directly); js/core/storage.js _memCache definition

---

### Test scope is data-driven: projects/meta/test-impact-map.json maps changed paths to targeted tests and a risk lane

- **Project(s):** mythos-prod

**Context:** DEVX-0 encoded test selection as data: test-impact-map.json holds ordered rules (first path_prefix match wins per file; specific rules must stay above general ones), each naming targeted_tests and a risk_lane (FAST/STANDARD/HIGH_RISK). A changed file matching no rule falls back to full-suite + HIGH_RISK rather than silently running nothing. `node scripts/mythos-stage.js close <STAGE>` derives this automatically from the diff against origin/main.

**What we learned:** Targeted tests first, full suite only when justified (finalizing an architectural stage, shared core changed, targeted tests reveal broader risk, or explicit request) is the standing validation policy — and the repo has tooling so you never re-derive scope from scratch. Multi-prefix changes take the union of tests and the highest matched risk lane. HIGH_RISK lanes are never auto-applied by the stage runner (HIGH_RISK_POLICY_VIOLATION is returned instead).

**Recommended approach:** Map your changed files through test-impact-map.json (or run `node scripts/mythos-stage.js close <STAGE> --dry-run`) to pick tests. When adding a new project area, add a rule for it — and keep specific-path rules above general ones since matching is first-match-wins. Run the full suite at most once per validation point.

**What to avoid:** Repeated full-suite runs without cause; guessing a narrow blast radius for unmapped paths (the fallback deliberately assumes the opposite); reporting tests as passing that were not executed.

**Related files / folders / repositories:**

- `projects/meta/test-impact-map.json`
- `scripts/mythos-stage.js`
- `docs/DEVELOPMENT_WORKFLOW.md`
- `.claude/skills/mythos-test-intelligence/SKILL.md`
- `AGENTS.md`

*Evidence:* projects/meta/test-impact-map.json notes field (read directly); docs/DEVELOPMENT_WORKFLOW.md steps 6 and 8; AGENTS.md §8

---

### A stage exists only when committed, pushed, and remote-verified — never leave work in /tmp or a worktree alone

- **Project(s):** mythos-prod

**Context:** The project runs on an online-first rule: the owner's computer and ephemeral containers must never be required for continuity. AGENTS.md defines a 14-step stage lifecycle ending with push, remote-HEAD verification, and a handover entry; §22 lists 'leaving completed work only in /tmp' and 'starting a new stage before pushing the current one' as prohibited behavior. Implementation happens in persistent VPS worktrees (pattern /srv/mythos/worktrees/<stage-name>).

**What we learned:** Completion is defined by remote evidence, not local state: 'a stage is not complete while it exists only in a worktree, stash, temporary branch, patch, or conversation.' The documented finishing sequence is: review diff and staged files (git diff --check / --stat / --cached --name-only), commit focused, push, then `git fetch origin && git rev-parse HEAD && git rev-parse origin/main` and confirm they match. The handover doc is updated in a separate commit after validation, never before (mythos-safe-change step 7). One major stage runs at a time unless the owner authorizes parallel work.

**Recommended approach:** Preflight every task with the five-command sequence in AGENTS.md §5; stop at the first real blocker and report it exactly (blocker codes exist: DIRTY_WORKTREE, UNEXPECTED_MAIN_STATE, DEPENDENCY_UNSATISFIED, etc.). Finish every stage through push + remote verification + handover entry before touching the next.

**What to avoid:** Claiming success before checking the remote commit; force-pushing or amending pushed commits; starting the next stage on top of unpushed work; treating temporary directories as durable storage for anything not cheaply recreatable.

**Related files / folders / repositories:**

- `AGENTS.md`
- `.claude/skills/mythos-safe-change/SKILL.md`
- `docs/DEVELOPMENT_WORKFLOW.md`
- `scripts/mythos-stage.js`

*Evidence:* AGENTS.md §4, §5, §7, §17, §22; .claude/skills/mythos-safe-change/SKILL.md; docs/DEVELOPMENT_WORKFLOW.md 'Stop conditions'

---

### Storage/sync invariants: all writes go through the _storeSave pipeline; sendBeacon flush must stay synchronous; migration guards stay

- **Project(s):** mythos-prod

**Context:** The app's data-integrity backbone is a small set of load-bearing functions (docs/production-safety.md table): syncFromServer, _storeSave, _storeGet, _flushPendingBeacon, _pushCollection, AUTH.logout/handleLogin, bootstrapStableApp. Two documented traps exist: the STORE v2 block writes raw localStorage and bypasses the sync queue (data lost if the tab closes before the next sync), and _flushPendingBeacon uses sendBeacon, which is fire-and-forget by design.

**What we learned:** Three specific, non-obvious rules: (1) never add `await` to _flushPendingBeacon — making it async abandons the last-chance save on page unload; (2) never use the STORE v2 raw-localStorage pattern for new writes — use the _storeSave pipeline so writes enter the sync queue; (3) never delete the one-time restore guards (restoreBackup20260516Once / forceRestoreBackup20260516 with their RESTORE_20260516_* localStorage flags) — there is no way to confirm remotely that every production browser has the flag set. Any storage/sync change must also preserve tombstones, avoid sync loops, avoid duplicate timers/listeners, and keep pagehide handling safe (AGENTS.md §12).

**Recommended approach:** Route every new application write through the approved storage pipeline; when touching sync code, walk the AGENTS.md §12 checklist explicitly; handle the known raw-storage bypasses only in their own planned stage.

**What to avoid:** Direct localStorage/IndexedDB/remote-collection writes outside the architecture; 'improving' beacon-based teardown paths with async/await; expanding existing bypasses; removing migration guards without production confirmation.

**Related files / folders / repositories:**

- `docs/production-safety.md`
- `js/app.js`
- `js/core/storage.js`
- `js/core/sync.js`
- `AGENTS.md`
- `docs/refactoring-plan.md`

*Evidence:* docs/production-safety.md 'High-risk functions', 'Migration guards', 'Known risks' §3; AGENTS.md §12; docs/refactoring-plan.md Phase 3

---

### Production hygiene: prod webroot and Git live in separate directories; a fixed never-commit list; api.php has no auth

- **Project(s):** mythos-prod

**Context:** The production server directory (/var/www/uthinachess/0726/Prod/) and the Git checkout (/home/deploy/projects/mythos-prod/) are deliberately separate — Git is never initialized inside /var/www. Deployment is an rsync of source files only, excluding appdata/, documents/, google_config.php, ACCES.txt, data/restore-*.js and .git/. appdata/ on the server is owned by www-data and is never overwritten by deploys, which is also what makes source rollback safe for data.

**What we learned:** The never-commit list is concrete and enforced by .gitignore plus a pre-deploy grep check: google_config.php (real OAuth secrets), ACCES.txt (plaintext PIN), appdata/ (live client data), documents/ (uploads), data/restore-*.js (production snapshots). Separately, api.php has no authentication by design (acceptable only because of nginx layout and non-public listing) — any change that exposes it publicly requires adding a shared-secret header check or moving appdata/ out of the web root first. Google OAuth deliberately uses access_type=online (1-hour tokens, no refresh) — do not switch to offline without implementing refresh-token storage.

**Recommended approach:** Before any deploy, run the verification greps in docs/production-safety.md and the post-deploy smoke checklist (login, save/reload an invoice, api.php?action=health, logout save spinner). Verify backups exist in appdata/backups/ (auto-backup, max 10 files, debounced 3s).

**What to avoid:** Committing anything on the never-commit list; rsyncing without the exclude set; initializing git in /var/www; hardening 'fixes' that change api.php auth or OAuth access_type outside an authorized stage.

**Related files / folders / repositories:**

- `docs/production-safety.md`
- `AGENTS.md`

*Evidence:* docs/production-safety.md (golden rule, never-commit table, deploy rsync, known risks §4-5, backup verification)

---

### Skill-registry governance: resolve overlaps by declaring an owner/delegator pair, version every change in the registry, and skills never self-modify

- **Project(s):** mythos-prod

**Context:** The MPI-0-FINALIZATION audit reviewed all 18 agent-development skills in .claude/skills/ and found real defects: a false 'no overlap' claim, a stale reference to a non-existent skill (mythos-context-compiler) cited in four docs, and name collisions with future runtime components. Every overlap found (preflight, test selection, doc formatting, schema checks) was resolved by naming a sole owner and converting the other skill's step into an explicit delegation — no skill was deprecated, merged, or split.

**What we learned:** Two durable mechanisms: (1) the owner/delegator pattern beats deletion for overlapping responsibilities (e.g. mythos-repo-guardian solely owns git preflight; mythos-project-context and mythos-safe-change delegate to it; mythos-test-intelligence solely owns test-scope selection). (2) Skill changes follow a reviewed lifecycle: every version bump is recorded in projects/personal-intelligence/config/agent-skills-registry.json and as a row in docs/SKILLS_EVOLUTION.md — never only in the SKILL.md body — and no runtime/product behavior or learned user preference may edit .claude/skills/. The audit also distinguished trigger granularity as a reason for a separate skill: per-stage doc-sync was being discharged correctly while the per-day history ledger silently rotted, so per-day logging got its own skill (mythos-project-history).

**Recommended approach:** When two skills (or docs) share a concern, declare one owner and make the other delegate explicitly rather than duplicating or deleting. Record any skill change in both the registry JSON and SKILLS_EVOLUTION.md as a reviewed diff.

**What to avoid:** Silent skill edits; restating another skill's steps instead of delegating; claiming 'no overlap' without an audit; letting a quieter, differently-triggered duty ride on a louder skill's trigger.

**Related files / folders / repositories:**

- `docs/SKILLS_EVOLUTION.md`
- `.claude/skills/`
- `projects/personal-intelligence/config/agent-skills-registry.json`
- `docs/SKILLS_VERSIONING_POLICY.md`
- `docs/SKILLS_ARCHITECTURE.md`
- `AGENTS.md`

*Evidence:* docs/SKILLS_EVOLUTION.md §3-§6; AGENTS.md §24; .claude/skills/mythos-safe-change/SKILL.md (delegation wording)

---

### Decision records carry evidence class and authority provenance — never resolve an unknown by inference, never supersede silently, and spec approval is not implementation authorization

- **Project(s):** mythos-prod

**Context:** The design recovery/decision registers classify every claim as VERIFIED / INFERRED / UNKNOWN and every decision by authority: OWNER-APPROVED (A-*), delegated-autonomous (AUTO-*, explicitly 'NOT owner-approved'), CONFIRMED/OPEN/SUPERSEDED/CONFLICTING. When the owner reversed an earlier instruction (A-008 'leave the gold open' → A-013 'gold is #D9A441'), the original text was left unaltered with a recorded supersession note. Multiple approvals state explicitly that approving a specification authorizes no code, CSS, or asset change (A-009, A-013 'Not actioned', MIG-1–4 tracked separately).

**What we learned:** This repo's documentation discipline treats provenance as data: what is known, how it is known, and who decided it are recorded separately, and unknowns (e.g. why the legacy gold #c9a84c was chosen) stay UNKNOWN rather than being back-filled with plausible stories. Reversible-by-design is a precondition for autonomous decisions. This is why the record survived multiple sessions and an autonomous mandate without corrupting history.

**Recommended approach:** When recording any decision or finding in this repo: state its evidence class, cite the file/commit, mark anything not directly verified, keep historical entries immutable (append corrections), and separate 'the spec is approved' from 'implementation is authorized' — implementation needs its own stage and authorization.

**What to avoid:** Promoting inference to decision; silently upgrading a PROPOSED/AUTO status to approved; rewriting an entry a later decision contradicts; acting on an approval as if it authorized code changes.

**Related files / folders / repositories:**

- `docs/MYTHOS_DESIGN_DECISIONS.md`
- `docs/MYTHOS_DESIGN_RECOVERY.md`
- `docs/design/`
- `docs/AI_HANDOVER.md`

*Evidence:* docs/MYTHOS_DESIGN_DECISIONS.md §0, §0.5 (A-008/A-013 supersession, AUTO-* six rules); docs/MYTHOS_DESIGN_RECOVERY.md header and §16

---

### External-reviewer findings must be reproduced against the repo (failing test first) before any fix — and non-reproducing findings get no speculative change

- **Project(s):** mythos-prod

**Context:** The Core Wiring stage ran independent multi-model reviews (via an existing gateway, no invented credentials). One architecture reviewer traced a real cancellation race: the executor task id was registered only in .then() of the bridge promise, so cancellation during RUNNING found nothing to cancel. The team verified it against the code, reproduced it with a failing test, and fixed it (commit 64c8e4c) — and reproducing it surfaced three further real defects (self-SIGTERM, supersession of stale executor tasks, daemon/core dispatch race, fixed in 64c8e4c and 00026a5), each with its own regression test. Eight adversarial attack classes were checked by two models; no adversarial finding required a change, and none was made 'on a reviewer's say-so'. Failed review calls (empty upstream response) were recorded, not hidden.

**What we learned:** The working protocol for third-party (or AI) review findings in this repo: verify the claim against source, write the failing test that proves it, fix, keep the regression test — and expect the reproduction process itself to surface adjacent defects. Symmetrically, a finding that does not reproduce results in no change. Review infrastructure facts are recorded honestly (which model actually served, which calls failed).

**Recommended approach:** Treat any bug report — human, AI reviewer, or log — as a hypothesis requiring a reproducing test before code changes. When one race is proven, examine the surrounding lifecycle for siblings (registration timing, self-reference, stale-record supersession, competing dispatchers).

**What to avoid:** Fixing on assertion alone; hiding failed review/tool runs; registering resources for cleanup only after an async operation resolves (the exact bug class found here — register synchronously before the run starts).

**Related files / folders / repositories:**

- `docs/MYTHOS_CORE_WIRING_REVIEW.md`
- `docs/AI_HANDOVER.md`

*Evidence:* docs/MYTHOS_CORE_WIRING_REVIEW.md (defect table, commits 64c8e4c and 00026a5, adversarial table)

---

### css/main.css is the live production stylesheet, drift-guarded by a test — do not edit shared root CSS without full-application regression capability

- **Project(s):** mythos-prod

**Context:** During the autonomous design mandate, a session edited gold values in the console's mythos.css and 3 of 322 assertions in tests/mos-1-console-test.js failed — because that suite deliberately reads --gold live from css/main.css at test time and asserts the console extraction matches it verbatim, precisely to catch silent drift between the extracted design system and the real application. The session recognized css/main.css as the production app's stylesheet, found that the project's only visual-verification tool (projects/mythos-os-console/tools/visual-verify.js) is scoped by design to the isolated console reference and cannot reach the real app, reverted before committing, and recorded the gap (AUTO-2) instead of pushing through.

**What we learned:** Two durable facts: (1) the mos-1 test's live-read-and-match pattern is an intentional drift guard — value changes to the token system must land in css/main.css and the extraction together, or the suite fails by design; (2) the repo's own convention treats full-application visual regression as a named, currently-missing prerequisite (readiness audit) blocking migrations MIG-1–4 — a change you cannot verify at the right scope gets reverted and documented, not committed. The verified gold mapping itself (#c9a84c → #D9A441 etc.) is recorded in the register, ready for when the capability exists.

**Recommended approach:** Before touching css/main.css or the token values it defines, confirm you have (or build) a verification loop that exercises the real consuming application, and expect tests/mos-1-console-test.js to enforce main.css ↔ mythos.css agreement. Read MYTHOS_DESIGN_DECISIONS.md AUTO-2 first — the analysis and safe mapping are already done.

**What to avoid:** Treating css/main.css as a sandbox or reference file; changing token values in only one of the two synchronized files; committing visual changes verified only against the isolated console shell.

**Related files / folders / repositories:**

- `css/main.css`
- `projects/mythos-os-console/reference/web/mythos.css`
- `tests/mos-1-console-test.js`
- `projects/mythos-os-console/tools/visual-verify.js`
- `docs/MYTHOS_DESIGN_DECISIONS.md`
- `docs/design/IMPLEMENTATION_READINESS_AUDIT.md`

*Evidence:* docs/MYTHOS_DESIGN_DECISIONS.md §0.5 AUTO-2 (attempt, test failure, revert, capability-gap reasoning); docs/AI_HANDOVER.md newest entry (readiness-audit prerequisites)

---

### The short-command workflow: the owner's instruction supplies only which stage and permission — everything else is derived from repo state and stops on machine-readable blockers

- **Project(s):** mythos-prod

**Context:** DEVX-0 established a contract where 'Start <STAGE> according to Mythos workflow' is sufficient authorization. The Stage Runner (scripts/mythos-stage.js: context/status/start/validate/close) resolves the stage from projects/meta/project-ledger.json, checks the one-major-stage rule and dependencies, and returns a Stage Context (risk lane, relevant files, required tests, baselines, blockers). Any blocker is a machine-readable code (ANOTHER_MAJOR_STAGE_ACTIVE, DEPENDENCY_UNSATISFIED, UNKNOWN_STAGE, DIRTY_WORKTREE, UNEXPECTED_MAIN_STATE, SECRET_DETECTED, NEW_TEST_REGRESSION, MISSING_APPROVAL, HIGH_RISK_POLICY_VIOLATION, ...) and the workflow stops there rather than guessing around it.

**What we learned:** The owner's message is authorization and intent, never the source of repository facts — GitHub is. Encoded rules (preflight discipline, scope control, test mapping, risk classification, doc requirements) never need restating by the owner. Mutating commands default to dry-run; even close --apply only commits/pushes for FAST/STANDARD lanes after validation, and merge always requires explicit owner authorization — the runner never merges on its own.

**Recommended approach:** On a short stage instruction, run `node scripts/mythos-stage.js context` then `start <STAGE> --dry-run`, act on the resolved Stage Context, and stop-and-report on any blocker code verbatim. Extend the metadata files (project-ledger, test-impact-map, known-baselines) when adding new tracks so the runner keeps working for future stages.

**What to avoid:** Asking the owner to repeat rules already encoded in the repo; guessing around a blocker code; auto-applying HIGH_RISK work; treating the owner's phrasing as evidence of repository state.

**Related files / folders / repositories:**

- `docs/DEVELOPMENT_WORKFLOW.md`
- `scripts/mythos-stage.js`
- `projects/meta/project-ledger.json`
- `projects/meta/current-context.json`
- `docs/DEVELOPMENT_ACCELERATION_ARCHITECTURE.md`

*Evidence:* docs/DEVELOPMENT_WORKFLOW.md (entire contract, stop-condition list, command reference)

---
