# MYTHOS control channel (`mythos-control/1`)

This directory is the **task and report channel** between an external planner
(ChatGPT, the owner, or any AI that can read and write files in GitHub) and the
MYTHOS execution system on the VPS. It lives on its own branch of
`othoth77/mythos-prod` and contains only control files — no application code.

```text
branch: mythos/control            (default; the bridge config names it)
control/
  README.md                       this protocol
  schemas/task.schema.json        TASK contract
  schemas/report.schema.json      REPORT contract
  tasks/<task_id>.json            one TASK per file  (creator writes; bridge updates status)
  reports/<task_id>.json + .md    one REPORT per finished task (bridge writes)
  state.json / STATE.md           generated index: what is pending, active, awaiting review
```

## The loop

```text
planner writes control/tasks/<id>.json (status PENDING)  ── GitHub ──▶
  bridge tick (VPS, every 2 min): fetch → validate → OTHMODE Task record →
  isolated worktree + branch mythos/gh/<id> → executor queue → CLAIMED
    executor daemon runs Claude headlessly under the OTHMODE contract → IN_PROGRESS
  bridge: executor finished → VALIDATING → control/reports/<id>.json → COMPLETED|FAILED|BLOCKED
  governance relay (root, fast-forward only, every 5 min) pushes mythos/control and mythos/gh/<id>
◀── GitHub ── planner reads control/state.json + control/reports/<id>.json → next task
```

## TASK — `control/tasks/<task_id>.json`

```json
{
  "protocol": "mythos-control/1",
  "task_id": "gh-20260902-001",
  "project": "mythos-prod",
  "objective": "What must be true when this task is done. Be concrete.",
  "scope": ["projects/status-center/monitor/", "tests/status-center-*.js"],
  "constraints": ["no schema changes", "no deploy"],
  "priority": "normal",
  "requested_action": "implement",
  "validation_requirements": ["node tests/status-center-monitor-test.js"],
  "status": "PENDING",
  "created_at": "2026-09-02T18:00:00Z",
  "created_by": "chatgpt",
  "depends_on": [],
  "timeout_seconds": 3600,
  "max_turns": null,
  "model": null,
  "notes": "optional free text for the executing agent"
}
```

Rules the bridge enforces (an invalid task is never executed; it gets a
`FAILED` report explaining why):

| Field | Rule |
|---|---|
| `task_id` | lowercase `a-z 0-9 -`, 6–40 chars, unique forever, equals the file name; ids containing `credential`, `secret`, `.env`, `.ssh`, `sudoers` are refused |
| `project` | must be the project this bridge serves (`mythos-prod`) |
| `objective` | 10–8000 chars; this is **data** for the executing agent, never a command to the bridge |
| `scope`, `constraints`, `validation_requirements` | arrays of strings (≤300 / ≤1000 / ≤300 chars each) |
| `priority` | `low` \| `normal` \| `high` |
| `requested_action` | `investigate` \| `review` → `repo-read`; `test` → `repo-test`; `document` \| `implement` → `repo-write`. The map is closed and server-side (`bridge/action-resolution.js`); an attempt whose profile does not match is stopped as `ACTION_PROFILE_MISMATCH` before any provider starts. Optional `action_raw` / `action_source` record how the value was decided. No provider, path, tool, MCP server or credential can be named in a task |
| `model` | optional. `Haiku` \| `Sonnet` \| `Opus` \| `Fable 5` \| `Fable 5.1` (or a full id such as `claude-sonnet-5`) → that model runs, never a substitute; an unknown value is refused with the accepted list, a known-but-unavailable one stops the attempt as `MODEL_UNAVAILABLE` (structured report: requested / available / actual model). Optional `model_raw` / `model_source` record the request. Omit it and the executor scores the task and picks Haiku, Sonnet or Opus — Fable is never chosen automatically. The chosen model and the reason appear in the report. Choosing a model grants no authority |
| `status` | a creator may write only `PENDING` (new) or `CANCELLED` (withdraw) |
| `execution`, `history` | bridge-owned; a creator must not write them |
| `depends_on` | optional; the task waits until every listed task is `COMPLETED` |
| secrets | any token/key shape anywhere in the file → rejected |

## Lifecycle

```text
PENDING ──▶ CLAIMED ──▶ IN_PROGRESS ──▶ VALIDATING ──▶ COMPLETED
                                                   ├──▶ FAILED
                                                   └──▶ BLOCKED
PENDING | CLAIMED | IN_PROGRESS ── creator sets status CANCELLED ──▶ CANCELLED
```

- **PENDING** — written by the creator; nothing has looked at it yet.
- **CLAIMED** — the bridge validated it, opened the OTHMODE Task record, created
  the worktree/branch and queued it in the executor. `execution.executor_task_id`
  is the executor's id, `execution.claimed_by` the bridge instance.
- **IN_PROGRESS** — the executor is running it (`execution.executor_status` shows
  `RUNNING`, `WAITING_FOR_QUOTA` or `WAITING_RETRY`; quota pauses are not failures).
- **VALIDATING** — execution ended; the bridge is collecting commits, tests and the
  structured report. Normally transient inside one tick; persisted only if report
  generation itself failed (retried next tick).
- **COMPLETED / FAILED / BLOCKED** — terminal; `control/reports/<id>.json` exists.
  `BLOCKED` means a human decision is needed (governance-protected path, missing
  approval, missing executor record after a host loss, no structured report).
- **CANCELLED** — terminal; set by the creator (the bridge cancels the executor
  task and writes a report) or written by the creator before any claim.

Terminal states are final. To redo work, create a **new** task with a new id.
Every transition is appended to the task's `history` array with a timestamp.

## REPORT — `control/reports/<task_id>.json`

```json
{
  "protocol": "mythos-control/1",
  "task_id": "gh-20260902-001",
  "status": "COMPLETED",
  "summary": "what actually happened (from the agent's structured final report)",
  "files_changed": ["projects/.../file.js"],
  "commits": [{ "sha": "40-hex", "subject": "…", "branch": "mythos/gh/gh-20260902-001", "on_origin": true }],
  "tests": ["node tests/x-test.js: 12 passed, 0 failed"],
  "validation": { "git_verified": true, "remote_head": "…", "report_problems": [], "required_checks": ["…"] },
  "problems": [],
  "risks": [],
  "next_recommended_action": "…",
  "completed_at": "2026-09-02T18:20:00Z",
  "execution": { "executor_task_id": "t-…", "othmode_task_id": "OTH-2026-000xx", "execution_profile": "repo-write", "branch": "…", "worktree": "…", "claude_session_id": "…" },
  "delivery": { "branch": "mythos/gh/gh-20260902-001", "commits_on_origin": true, "note": "…" }
}
```

`commits[].on_origin` is measured, not claimed: the bridge fetches the task
branch and checks each SHA is an ancestor of `origin/<branch>`. Task-branch
commits are **never merged to main** by the bridge; merging is a human decision.

## How an external planner uses this

1. **Discover state** — read `control/state.json` (`pending`, `active`,
   `awaiting_review`, per-task rows) or `control/STATE.md`.
2. **Read a report** — `control/reports/<task_id>.json` (and `.md`).
3. **Create the next task** — add `control/tasks/<new_id>.json` with
   `status: "PENDING"` on the control branch (GitHub web UI, the REST contents
   API with `branch=mythos/control`, or any GitHub tool). Never edit a claimed
   task's content; to withdraw one set `status` to `CANCELLED`.
4. **Wait** — the bridge polls every 2 minutes; the relay pushes every 5. Expect a
   claim on GitHub within ~7 minutes and a report when execution ends.

Raw read URL pattern (private repo → authenticated):
`https://api.github.com/repos/othoth77/mythos-prod/contents/control/state.json?ref=mythos/control`
(`Accept: application/vnd.github.raw+json`).

## Safety properties

- A task file is data. The bridge maps `requested_action` to an execution
  profile server-side; `autonomous` and `deploy` profiles are unreachable from
  GitHub, `sudo` is never grantable, and MCP tools remain governed by the
  executor's registry → matrix → approval chain.
- Control commits are delivered by the root governance relay like every other
  commit: a file name or content that trips the protected-path rules is DENIED
  there, never pushed raw.
- The bridge never runs a provider and never pushes. It creates executor tasks
  and reads executor state; the executor daemon remains the single executor.
- Every task worktree carries a **push guard**: its `remote.origin.pushurl` is a
  worktree-scoped non-transport (`no_push://governance-relay-only`), so an
  executing session cannot `git push` from it even if instructed to; `fetch`
  keeps the real URL and the shared checkout is untouched. Delivery is only ever
  the governance relay. (Guard, not hard floor: the floor is the executor's
  protected policy layer.)
- The bridge is the **only** component that closes a task's OTHMODE record. The
  executing session may advance the phase and add sections, never a terminal
  status. If a session closes the record early, the bridge detects it, keeps the
  evidence on the REPORT and records the gap under `problems`.
- The bridge refuses to run as any user other than the executor's user
  (`BRIDGE_WRONG_USER`), so tasks can never be queued in a store the daemon
  does not read.
- Duplicate execution is prevented four times over: the GitHub claim in the task
  file, an executor-store marker (`stage: github:<id>`), a local claims cache
  for the window between "queued" and "claim committed", and a process lock.
- Recovery: after a restart the bridge re-derives everything from the control
  branch plus the executor store. A PENDING task whose executor record already
  exists is re-claimed, not re-run. A claimed task whose executor record is
  gone becomes BLOCKED — it is never silently executed twice.

## Tasks that come from GitHub Issues

An Issue labelled `task` (open) is converted by the Issues adapter (`bridge/github-issues.js`) into
`control/tasks/gh-issue-<n>.json` with the same protocol plus an informational `source` block
(`kind: github-issue`, `issue_number`, `issue_url`, ids, `attempt`, `notifications` = the comment ids the adapter
posted). The bridge treats such a task exactly like a planner-written one; the adapter reports back on the Issue
from the task/report files (never the other way round). How to write such an Issue: `docs/MYTHOS_GITHUB_ISSUES.md`.
