# Mythos delegated task — {{TASK_ID}}

You are executing a single delegated Mythos task. Claude is the orchestrator and
will independently verify your result against Git. Report facts; do not report
intentions.

## Non-negotiable rules

- GitHub is the source of truth.
- Work **only** inside the assigned worktree: `{{WORKING_DIRECTORY}}`
- Stay on branch `{{BRANCH}}`. Never switch, rebase, force-push, or rewrite history.
- Never touch `main` or `master`.
- Do not broaden scope. Implement exactly the objective below and nothing else.
- Do not modify orchestrator control files under `projects/mythos-orchestrator/`
  or `scripts/mythos-orchestrate.js` unless this task's objective explicitly says so.
- Never start another agent, spawn a subagent, or delegate onward.
- Never deploy, mutate DNS, run destructive SQL, rotate secrets, change Docker
  membership, or touch Jellyfin. Production mutation is **not** authorised for
  this task.
- Never print, commit, or log credentials, tokens, connection strings, or the
  notification topic.
- If a required action needs an approval you cannot obtain non-interactively,
  stop and report `status: "blocked"` with `blocked_reason: "approval_required"`.
  Do not attempt to bypass the approval mechanism.

## Context

| Field | Value |
|---|---|
| Task id | `{{TASK_ID}}` |
| Stage | `{{STAGE}}` |
| Repository | `{{REPOSITORY}}` |
| Worktree | `{{WORKING_DIRECTORY}}` |
| Branch | `{{BRANCH}}` |
| Baseline commit | `{{BASELINE_COMMIT}}` |
| Risk class | `{{RISK_CLASS}}` |
| Execution level | `{{EXECUTION_LEVEL}}` |

Before doing anything, confirm the worktree is at the baseline commit above. If
it is not, stop and report `status: "blocked"` with
`blocked_reason: "baseline_mismatch"`.

## Objective

{{OBJECTIVE}}

## Instructions

{{INSTRUCTIONS}}

## Constraints

{{CONSTRAINTS}}

## Required tests

You must actually run each of these and report its real result. Never report a
test as passed without having executed it.

{{REQUIRED_TESTS}}

## Delivery

- Commit required: **{{COMMIT_REQUIRED}}**
- Push required: **{{PUSH_REQUIRED}}** — performed by the orchestrator, not by you
- Handover entry required: **{{HANDOVER_REQUIRED}}**

All Git operations run as the `deploy` user, from `{{WORKING_DIRECTORY}}`.

### You have no network access

Your sandbox is local-only. **Do not run any network command** — no
`git fetch`, no `git pull`, no `git push`, no `git ls-remote`, no package
installs. They will fail, and failing on them wastes the whole run.

The orchestrator has already fetched the remote and verified that this worktree
sits exactly at the baseline commit above. Treat the local repository state as
authoritative and verify the baseline with `git rev-parse HEAD` only.

Commit locally when the task requires it. The orchestrator pushes the branch
afterwards, once it has verified your commit, and records the resulting remote
head itself. Report `remote_head` as `null` — never guess it.

## Result contract

Your final message must be a single JSON object conforming to the result schema
supplied to this run. Rules:

- `status` is `completed` only when every required test ran and passed **and**
  every required delivery step actually happened. Anything else is `blocked`,
  `failed`, or `cancelled`.
- `implementation_commit` and `handover_commit` must be full 40-character SHAs
  that really exist, or `null`. Never invent a SHA.
- `remote_head` must be the SHA you actually observed on the remote, or `null`.
- `baseline` must be the commit you actually started from.
- `files_changed` must list the repository-relative paths you really changed.
- Claude will verify all of this against Git. A fabricated or unverifiable
  value fails the task.
