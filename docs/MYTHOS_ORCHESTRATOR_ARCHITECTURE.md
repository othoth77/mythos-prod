# Mythos Orchestrator — Architecture

**Stage:** `MYTHOS-MULTI-AGENT-ORCHESTRATOR-0`
**Track:** `mythos-devx`
**Status:** implemented

## 1. The model

```text
USER
  ↓
Claude Code                     ← the only interface the user needs
  ↓
Mythos Orchestrator
  ├── Claude   architecture · planning · review · verification
  └── Codex    coding · tests · refactors · implementation
          ↓
       Git / GitHub             ← source of truth
          ↓
Claude verifies the result independently
          ↓
USER receives one consolidated report
```

Claude is the orchestrator. Codex is an implementation worker. Delegating work
transfers **execution**, never **accountability**: Claude decides what to
delegate, and must prove the outcome against the repository before reporting it
as done.

## 2. Provider neutrality

The runtime is not a Claude/Codex bridge. Provider-specific behaviour is
confined to `projects/mythos-orchestrator/providers/`; the task contract, the
result contract, the router, the runner and the verifier never name a vendor
except when selecting an adapter. Adding Gemini, DeepSeek, a local model or a
future agent means adding one adapter file and one enum value.

The `claude` adapter is deliberately different from the others: it does **not**
spawn a process. Judgement work is performed by the orchestrating session
itself, because a detached second Claude would make the orchestrator
unaccountable for its own decisions, and AGENTS.md §9 forbids unauthorised
subagents.

## 3. Contracts

Two strict JSON Schemas, both dependency-free-validated by `lib/schema.js`
(the repository has no `package.json`, so ajv is not available; the validator
fails loudly on any schema keyword it does not implement rather than silently
ignoring it).

### Task (`schemas/task.schema.json`)

Carries identity (`task_id`, `stage`, `repository`), execution context
(`working_directory`, `branch`, `baseline_commit`), intent (`objective`,
`instructions`, `constraints`), obligations (`required_tests`, `delivery`),
and safety metadata (`risk_class`, `execution_level`,
`allow_production_mutation`, `timeout_seconds`).

Structural safety is encoded in the schema itself, not left to convention:

- `task_id` is a strict slug — `..`, `/` and absolute paths cannot be expressed.
- `working_directory` cannot be under `/tmp`.
- `branch` cannot be `main` or `master`.
- `result_path` is a bare filename, so a task cannot redirect its own result.
- A task carrying anything matching a credential pattern is refused outright.

### Result (`schemas/result.schema.json`)

The same file is handed to `codex exec --output-schema`, so it is restricted to
the structured-output subset: every property required, `additionalProperties:
false` throughout, nullability as a type union, no `pattern`/`minLength`.
Sharper semantic checks (SHA shape, commit existence, diff scope) belong to the
verifier, where they can be checked against reality rather than asserted.

Statuses: `completed` · `blocked` · `failed` · `cancelled`.

## 4. Routing

Deterministic table lookup in `router.js` — no classifier, no model call. The
same input always yields the same decision, and the decision is auditable by
reading the file.

| Decision | Work classes |
|---|---|
| `CLAUDE` | ARCHITECTURE · DESIGN · SECURITY_REVIEW · FINAL_REVIEW · PORTFOLIO_DECISION · AMBIGUOUS_REQUIREMENTS · CROSS_PROJECT_DECISION |
| `CODEX` | CODE_IMPLEMENTATION · REFACTOR · TEST_IMPLEMENTATION · BUG_FIX · STATIC_ANALYSIS · MIGRATION_IMPLEMENTATION · CLI_TOOLING · REPETITIVE_CODE_CHANGES |
| `USER_APPROVAL_REQUIRED` | HIGH_RISK_INFRA · PRODUCTION_DEPLOYMENT · AUTH · DNS_MUTATION · DESTRUCTIVE_DB · SECRET_ROTATION |

Routing **fails closed**: an unknown, missing or unroutable class escalates to
user approval rather than guessing. Claude may explicitly override a Codex-class
task and keep it, but an override can only move work toward Claude or toward
approval — never downward into automatic execution.

## 5. Safety levels

| Level | Meaning | Examples |
|---|---|---|
| 1 — AUTO | May run automatically | reads, audits, static analysis, tests, docs, isolated non-destructive implementation |
| 2 — CLAUDE_CONTROLLED | Claude may execute after reviewing the plan | commits, pushes, branch creation, stage metadata, developer tooling |
| 3 — USER_APPROVAL | Never automatic | production deployment, DNS, firewall, destructive DB, data/backup deletion, credential rotation, auth config, repository permissions, Jellyfin, Docker membership, stopping unrelated services |

Committing or pushing raises a task to level 2 even inside an isolated branch,
because it changes shared remote state. Level 3 is enforced in three
independent places — the router escalates it, `validateTask` refuses it, and
`execute` never dispatches it — so no single mistake can let it through.

This mirrors `projects/meta/development-lanes.json` (developer-workflow risk)
and defers to `docs/AUTOMATION_APPROVAL_MATRIX.md` wherever they overlap.

## 6. Concurrency and worktree isolation

The orchestrator assumes other agents are working at the same time. Before any
provider is launched, `lib/git.js` `preflight()` requires all of:

- the working directory is a real Git worktree, and is not under `/tmp`;
- the branch is not `main`/`master` and matches the task;
- the worktree is clean — a dirty worktree means another task owns it;
- the declared baseline exists **and** is the current HEAD;
- the branch is not already checked out in another worktree.

Any failure blocks dispatch. Nothing is force-unlocked, reset or overwritten.

Branch naming for delegated work: `agent/<stage-lowercase>/<task-id-short>`.

### Sandbox scope for linked worktrees

A linked worktree keeps its `HEAD`, index, `FETCH_HEAD`, objects and refs in
the **main** repository's Git directory, not inside the worktree. A worker
sandboxed to the worktree alone therefore cannot `git fetch` or `git commit` at
all — the first end-to-end run failed exactly this way, and correctly reported
`blocked` / `approval_required` rather than pretending to succeed.

The runner now grants that shared Git directory via `codex exec --add-dir`,
**only** when the task's delivery actually requires committing or pushing. This
is the access any commit from a linked worktree inherently needs; it is not a
sandbox escape hatch. `danger-full-access` and
`--dangerously-bypass-approvals-and-sandbox` are never used, and the branch,
baseline, diff-scope and prohibited-path checks remain the guard against a
worker touching anything outside its task.

If `main` advances while a worker runs, the worker still finishes on its own
branch; reconciliation is a Claude decision afterwards, never an automatic
merge. The orchestrator never force-pushes and never rewrites history.

## 7. Verification

The worker's report is a **claim**. `verifier.js` turns claims into evidence by
re-deriving each one from Git:

- declared commits exist (a fabricated SHA fails here);
- the declared baseline really is an ancestor of the implementation commit;
- the branch exists locally, and on `origin` when a push was required;
- the claimed remote head matches what `origin` actually reports;
- `files_changed` matches the real diff;
- every required test is present and passed;
- no prohibited path was touched;
- the real diff contains no secret.

A task reaches `completed` only when the runner accepted a schema-valid result
**and** every verification check passed. Anything else surfaces as
`verification_failed`.

## 8. Crash recovery

Each task's `status.json` records provider, branch, baseline, pid, timestamps,
exit code and duration. State is derived, not assumed: a task claiming
`running` whose process is gone is reported `orphaned`, not `failed`. A missing
terminal is never itself treated as failure.

Cancellation is cooperative — `SIGTERM` only. The orchestrator never force-kills,
because a `SIGKILL` mid-commit can leave a worktree another agent then inherits.

## 9. Notifications

`notify.sh` emits `task_started` · `task_completed` · `task_failed` ·
`approval_required` · `orchestrator_error`.

It always exits 0. An ntfy outage, a missing config or a non-executable script
degrades to a warning and cannot alter a task's status. The destination URL is
a capability secret — possessing the topic is enough to publish to it — so it
lives in user-local config (`~/.config/mythos-orchestrator/notify.env`, mode
600), never in Git, and is never printed or logged.

## 10. Secret handling

Tasks carry no credentials; providers use their own user-local auth. Everything
persisted or printed passes through `lib/redact.js`, which masks provider
tokens, cloud keys, JWTs, private-key blocks, credentialed connection strings,
`*_SECRET`/`*_TOKEN`-style assignments and ntfy capability URLs. A task whose
text matches a credential pattern is refused before dispatch, and the refusal
names the *kind* of secret without echoing it.

## 11. Deliberate non-goals

No Redis, no database, no message queue, no container, no n8n, no daemon. v0 is
filesystem plus Git, which is sufficient, inspectable and survives reboot
without a supervisor. A systemd user service was considered and rejected as
unnecessary for a runtime that is invoked per task rather than continuously.
