# Mythos OS — Repository Migration Gate (`mythos-prod` → `mythos-os`)

**Stage:** MYTHOS-REPO-MIGRATION-GATE (owner directive recorded — **NOT AUTHORISED FOR EXECUTION**)
**Date:** 2026-08-17
**Status of this document:** Owner directive record and pre-migration audit. **No migration was performed, planned in detail, or authorised by this stage.**
**Baseline verified against:** commit `8c34c5d` on `main`, remote HEAD verified identical.

---

## 0. The directive

Owner instruction, recorded verbatim in substance (2026-08-17):

> **Do NOT migrate or copy the current `mythos-prod` repository into `mythos-os` at this stage.**
>
> The current source of truth is **`othoth77/mythos-prod`**.
>
> When the current development and architecture are sufficiently complete, perform a formal Repository Migration from `othoth77/mythos-prod` → `othoth77/mythos-os`. This must be a **complete repository migration, NOT a file-level copy or selective cherry-pick**.
>
> **Until this migration is explicitly approved and completed, `othoth77/mythos-prod` remains the sole source of truth.**

### 0.1 Current binding rule

```text
SOURCE OF TRUTH (now and until migration completes):
    othoth77/mythos-prod   ·   branch main

FUTURE TARGET (not authorised, not scheduled):
    othoth77/mythos-os     ·   branch main
```

**No agent, session, workflow, or automation may treat `othoth77/mythos-os` as
the source of truth, push to it, read canon from it, or reconfigure any
service toward it, until this gate is closed by explicit owner approval.**

### 0.2 Why this document exists

On 2026-08-17 a session was instructed that `othoth77/mythos-os` was the
intended repository and that delivered commits should be verified there. The
premise was incorrect, and it was caught only because the repository itself
recorded the facts (§1.2). **The identity of the source-of-truth repository
was, until now, nowhere stated as a rule** — it was inferable from
`git remote -v` and one line in a PC-inventory table. This document, and the
repository-identity statement added to `AGENTS.md` §2, close that gap.

---

## 1. Verified facts about both repositories

### 1.1 `othoth77/mythos-prod` — the source of truth

Verified 2026-08-17 by direct anonymous HTTPS query and local inspection:

| Property | Value |
|---|---|
| Reachability | `https://api.github.com/repos/othoth77/mythos-prod` → **HTTP 200** (public read) |
| Remote `main` HEAD | `8c34c5de7828154bd0f5b7be10ec535f05419e48` |
| Local worktree | `/home/deploy/projects/mythos-prod` (root commit `d1a9d19`) |
| Configured remote | `git@github.com:othoth77/mythos-prod.git` (fetch + push) |
| Commits | **417** |
| Tracked files | **544** |
| `docs/*.md` | **111** |
| `tests/*.js` | **105** |
| Local branches | **20** |
| `.git` size | **65 MB** |

### 1.2 `othoth77/mythos-os` — the future target

| Property | Value |
|---|---|
| Reachability | `https://api.github.com/repos/othoth77/mythos-os` → **HTTP 404 anonymous**; `git ls-remote` prompts for credentials |
| Interpretation | **Absent OR private** — an unauthenticated 404 cannot distinguish the two, and no credential for it exists on this host |
| Repository's own record | `docs/AI_HANDOVER.md` PC-inventory table: *"`othoth77/mythos-os` — private, populated, 427 KB, last push 2026-07-29"*, corresponding to the PC working copy `C:\Users\Othman\Desktop\2607 bureau` (225 files) |

**Therefore `mythos-os` is currently understood to be a populated private
repository holding a stale July 2026 working copy — not an empty target.**
Condition §3.5 (target is empty/decommissioned/ready) is **NOT satisfied
today**, and this is the single most important precondition to resolve.

### 1.3 Why a file-level copy would have failed

The MAOL specification alone cross-references **23** canonical documents, and
**23 of 23** were first committed *after* 2026-07-29 — the last push to
`mythos-os`. A selective copy into that repository would produce documents
whose entire dependency graph dangles. This is the concrete reason the owner's
"complete migration, not a file-level copy" requirement is correct.

---

## 2. What the migration must preserve

Owner's preservation list, reconciled against what actually exists in the
repository at `8c34c5d`. **Two entries did not survive contact with reality and
are corrected here** — recording them now prevents a future migration from
hunting for paths that do not exist.

| # | Must preserve | Actual location(s) | Verified |
|---|---|---|---|
| 1 | Complete Git history where technically appropriate | 417 commits, 20 local branches, 65 MB `.git` | ✓ |
| 2 | All canonical architecture documents | `docs/` — 111 markdown files | ✓ |
| 3 | `.ai` / AI collaboration infrastructure | **`.ai/` DOES NOT EXIST.** The AI collaboration infrastructure is `AGENTS.md`, `CLAUDE.md`, `.claude/skills/` (**20 skills**), `.opencode/` | ✓ **corrected** |
| 4 | Mythos AI Orchestrator | `projects/mythos-orchestrator/`, `scripts/mythos-orchestrate.js`, `docs/MYTHOS_ORCHESTRATOR_{ARCHITECTURE,RUNBOOK}.md`, `docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md` | ✓ |
| 5 | Mythos AI Executor | `projects/mythos-ai-executor/` (incl. `core/`, `service/`, `deploy/`), `docs/MYTHOS_AI_EXECUTOR_ARCHITECTURE.md`, `docs/MYTHOS_ORCHESTRATION_CORE.md` | ✓ |
| 6 | Mythos AI Operating Layer | `docs/MYTHOS_AI_OPERATING_LAYER.md` (commit `0124868`) | ✓ |
| 7 | Memory and Context architecture | `docs/MYTHOS_{MEMORY_ENGINE,CONTEXT}_ARCHITECTURE.md`, `docs/MYTHOS_USER_MEMORY_POLICY.md`, `projects/personal-intelligence/` | ✓ |
| 8 | n8n integration | Workflow definitions and intake contracts under `projects/mythos-ai-executor/`; **the live n8n instance is host state, NOT in Git** — see §4.3 | ✓ **scoped** |
| 9 | Database and application architecture | `projects/*/database/*.sql` (draft schemas), `docs/MYTHOS_SUPABASE_MIGRATION_DESIGN.md`, `docs/architecture.md`, `docs/module-map.md`, root PHP/JS application | ✓ |
| 10 | Tests and CI/CD | `tests/` — **105 suites. NO CI/CD EXISTS**: `.github/` is absent; there is no workflow, pipeline, or runner in this repository. Tests are run manually | ✓ **corrected** |
| 11 | Security and governance rules | `AGENTS.md`, `docs/AUTOMATION_{APPROVAL_MATRIX,GOVERNANCE,SECURITY_AND_SECRETS}.md`, `docs/MYTHOS_AI_MULTI_TENANCY.md`, `docs/SKILLS_SECURITY.md` | ✓ |
| 12 | AI_HANDOVER and project history | `docs/AI_HANDOVER.md`, `docs/PROJECT_HISTORY.md`, `docs/history/DAILY_HISTORY.md`, `docs/CHANGELOG.md`, `projects/meta/project-ledger.json` | ✓ |
| 13 | All active modules and their dependencies | `projects/` — 14 tracks: atelier-network, automation, automotive, autovaleur, devx, idauto, infrastructure, meta, mythos-ai-executor, mythos-core, mythos-orchestrator, personal-intelligence, research-intelligence, ssangyong-autos | ✓ |
| 14 | All documented architectural decisions | `docs/ROADMAP.md`, per-track roadmaps, ratified owner decisions (O-\*, D1–D5, O-MAOL-1..10), `docs/MYTHOS_AI_OPERATING_LAYER.md` §B | ✓ |
| 15 | All required references and paths | See §4 — the audit of couplings that migration must rewrite | ✓ |

---

## 3. Pre-migration conditions — none may be skipped

Owner's ordered conditions, restated as a checkable gate. **Current status is
recorded honestly; most are simply NOT STARTED because the migration is not
authorised.**

| # | Condition | Status at `8c34c5d` |
|---|---|---|
| **1** | Freeze the migration source at a verified commit | NOT STARTED — no freeze declared; `main` is actively receiving commits from concurrent sessions |
| **2** | Run the required test and architecture checks | NOT STARTED — see §5 for what "required" must mean |
| **3** | Audit internal paths, repository URLs, CI workflows, deployment configuration, documentation references, and secrets | **PARTIAL — the inventory in §4 was produced by this stage.** The remediation plan is not written |
| **4** | Create a migration plan | NOT STARTED — this document is a *gate*, not the plan |
| **5** | Verify `mythos-os` is empty / decommissioned / ready to receive | **NOT SATISFIED** — evidence says it is populated and private (§1.2). **Blocking.** |
| **6** | Never overwrite unrelated work | Binding constraint — carried into §6 |
| **7** | Never force-push without explicit authorisation | Binding constraint — carried into §6 |
| **8** | Verify the migrated repository independently | NOT STARTED |
| **9** | Make `mythos-os` official source of truth only after successful validation | NOT STARTED |
| **10** | Record migration commit, remote HEAD, verification results and final repository identity in `docs/AI_HANDOVER.md` | NOT STARTED |

**Gate verdict: `REPO_MIGRATION: BLOCKED — NOT AUTHORISED`.**

---

## 4. Coupling audit (produced by this stage, read-only)

What a complete migration would have to rewire. These are *facts measured at
`8c34c5d`*, not estimates.

### 4.1 Repository-URL references

| Measure | Count |
|---|---|
| Tracked files mentioning `mythos-prod` | **60** |
| Of which `docs/AI_HANDOVER.md` alone | 6 occurrences |

Spread across `docs/` (architecture, roadmaps, governance), `projects/*/README.md`,
and executable configuration. **Every one is a rename candidate — and each must
be judged individually**, because a historical stage record that says
"pushed to `othoth77/mythos-prod`" is a *statement of what happened* and must
NOT be rewritten; only forward-looking configuration should change.

> **Rule: history is testimony, not configuration.** A migration that
> bulk-rewrites `mythos-prod` → `mythos-os` across `docs/AI_HANDOVER.md` would
> falsify the project's own record. Historical records stay as written; a
> migration note explains the rename once.

### 4.2 Absolute host paths in tracked files

| Path | Files |
|---|---|
| `/var/www` | 19 |
| `/home/deploy/projects/mythos-prod` | 14 |
| `/home/ubuntu/mythos-ai-executor` | 9 |
| `/srv/mythos` | 1 |

The checkout path `/home/deploy/projects/mythos-prod` is embedded in operational
tooling. Renaming the repository does **not** rename the checkout; whether the
worktree directory also moves is a separate decision with its own blast radius.

### 4.3 Live host state that is NOT in Git and will NOT migrate with it

This is the category most likely to break silently.

| Component | Where it lives | Migration impact |
|---|---|---|
| **Push relay** `mythos-git-push.sh` | Installed root-owned at `/usr/local/bin/mythos-git-push`; unit at `/etc/systemd/system/`. Hardcodes `REPO=/home/deploy/projects/mythos-prod`, `BRANCH=main`, and pins `GIT_SSH_COMMAND` to `/home/deploy/.ssh/id_ed25519_github` | **Must be updated by root at cutover.** The committed source in `projects/mythos-ai-executor/service/` is *source*, not the installed copy — editing Git alone changes nothing |
| **Executor service** `mythos-ai-executor` | systemd **user** unit for `ubuntu`, linger enabled; runtime state `/home/ubuntu/mythos-ai-executor/` | Repo rename does not move runtime state; verify no path assumption breaks |
| **n8n workflows** | Live in n8n 2.29.9 (Docker `n8n-n8n-1`), 5 MYTHOS + 3 SSANGYONG | Not in Git. Import deactivates workflows — reactivation is manual |
| **Credentials** | `~/.config/mythos-ai-executor/*.env` (0600), `deploy`'s `~/.ssh/id_ed25519_github` | **Never migrate secrets through Git.** The GitHub key is account-scoped to `othoth77`, so it would authenticate to `mythos-os` too — which is a hazard, not a convenience |
| **Deployed databases** | `idauto-postgres` (`mythos_intelligence` schema applied), `ssangyong_autos` catalog | Untouched by a repository migration; must be explicitly confirmed untouched |

### 4.4 CI/CD

**There is none.** `.github/` does not exist; no pipeline, workflow, or runner
is defined in this repository. Condition §3.2's "required test and architecture
checks" therefore has no automated implementation today — it must be executed
manually or built first. **A migration must not silently inherit an assumption
that CI will catch breakage.**

### 4.5 Secrets audit

No credential, key, or token is committed (verified repeatedly across stages;
`.gitignore` and intake secret-shape refusal enforce it). A full-history secret
scan is nevertheless a **mandatory** pre-migration step: publishing 417 commits
into a repository with different visibility settings is exactly when a
historical leak would surface. **This scan has not been run.**

### 4.6 Repository visibility

`mythos-prod` is **publicly readable** (HTTP 200 anonymous). Its evidence trail
depends on that — this repository's own verification procedure uses anonymous
`git ls-remote` to confirm remote HEAD when SSH push authority is unavailable.
`mythos-os` is not anonymously readable. **If the target is private, the
verification procedure recorded throughout `docs/AI_HANDOVER.md` stops working
and must be replaced before cutover, not after.**

---

## 5. What "required test and architecture checks" must mean

Condition §3.2 is undefined until someone defines it. Proposed minimum, for
owner ratification at migration-planning time:

1. Full test sweep on the frozen commit, with the result recorded — including
   the count of known pre-existing legacy failures, so the post-migration run
   can be compared against a real baseline rather than against "green".
2. `node scripts/project-intelligence.js validate` — ledger/statistics/registry
   consistency.
3. Documentation reference integrity: every `docs/…` cross-reference resolves
   (the check applied to `docs/MYTHOS_AI_OPERATING_LAYER.md` at MAOL-0,
   generalised repository-wide).
4. Full-history secret scan (§4.5).
5. Byte-identity verification of the migrated tree against the frozen commit.
6. Independent post-migration verification from a clean clone — **not** from
   the existing worktree, which cannot prove the remote is complete.

---

## 6. Permanent constraints on the migration itself

Binding whenever the migration is eventually authorised:

1. **Complete repository migration, never a file-level copy or cherry-pick.**
2. **Never overwrite unrelated work** in the target. If `mythos-os` holds
   content that exists nowhere else, it is preserved or explicitly and
   knowingly retired by the owner — never silently replaced.
3. **Never force-push without explicit authorisation**, and never rewrite
   shared history.
4. **Never migrate secrets through Git.**
5. **Historical records are not rewritten** (§4.1).
6. **`mythos-prod` remains the source of truth until validation succeeds** —
   there is no interval in which both are authoritative. Cutover is a single
   recorded moment.
7. **`mythos-prod` is not deleted, archived, or made unreachable** as part of
   cutover. It stays intact as the rollback path until the owner separately
   decides otherwise.
8. **The SSANGYONG legacy site stays frozen and untouched** — a repository
   migration is not a licence to touch it.
9. **One major stage at a time.** The migration is a major stage and does not
   run in parallel with another.

---

## 7. Status

**Owner directive recorded. Pre-migration coupling audit complete (§4). No
migration performed, no migration plan written, no target repository contacted,
no configuration changed.**

`REPO_MIGRATION: BLOCKED — NOT AUTHORISED`

### Next step (not authorised, sequenced)

1. Owner resolves the blocking precondition §3.5 — determine what
   `othoth77/mythos-os` currently contains, and whether it is to be emptied,
   decommissioned, or preserved. **This cannot be determined from this host;
   no credential for that repository exists here.**
2. Owner declares "development and architecture sufficiently complete" — the
   trigger stated in the directive.
3. Ratify §5 as the required check set.
4. Write the migration plan (condition §3.4) as its own stage.
5. Execute only under explicit authorisation, then record per §3.10.
