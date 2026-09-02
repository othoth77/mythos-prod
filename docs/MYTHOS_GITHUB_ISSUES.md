# MYTHOS GitHub Issues → TASK channel

**Status:** implemented and tested 2026-09-02 (MYTHOS-GITHUB-ISSUES-0). Code:
`projects/mythos-ai-executor/bridge/github-issues.js`; tests `tests/mythos-github-issues-test.js`;
CLI `projects/mythos-ai-executor/bin/mythos-github-bridge issues-*`. Protocol underneath: `docs/MYTHOS_GITHUB_BRIDGE.md`
(`mythos-control/1`, unchanged).

GitHub Issues are the official task intake of MYTHOS. An Issue is the **human interface**; the files on the
`mythos/control` branch are the **source of truth** for the TASK and the REPORT. Nothing is ever derived
from a comment.

```text
GitHub Issue (open, label `task`)
   │  intake: parse → validate (bridge rules, secret scan) → control/tasks/gh-issue-<n>.json (PENDING)
   │          one commit on mythos/control + one "created" comment on the Issue (task id, status, scheduled)
   ▼
github-bridge tick (UNCHANGED): claim → OTHMODE Task record → worktree + branch mythos/gh/gh-issue-<n>
   │                            → executor.createTask(...)          ← the ONE executor
   ▼
mythos-ai-executor daemon runs the task (claude -p under the OTHMODE contract, profile-bounded)
   │
github-bridge tick (UNCHANGED): control/reports/gh-issue-<n>.json when terminal
   │
   │  notify: "claimed" comment (executor_task_id, OTHMODE id, branch) → report comment
   ▼          (status, summary, files changed, tests, commit SHAs, problems/risks, next action) → labels
GitHub Issue updated (stays open unless COMPLETED and closing is enabled)
```

Relation kept on the control branch, per task file: `source.issue_number`, `source.issue_url`, `task_id`,
`execution.executor_task_id`, `execution.othmode_task_id`, `execution.report_file`, and
`source.notifications.{created,claimed,report,delivered}` (comment ids). `control/state.json` rows carry the
same `source` summary. `mythos-github-bridge issues-status` prints the whole relation.

## 1. How to write a valid Issue

```text
Title:   TASK: تحديث MYTHOS Status Center
Labels:  task                       (required; optional: action:implement, priority:high, rerun)

Body:
## Objective
One paragraph: what must be true when the task is done.

## Scope
- files / areas the task may touch
- …

## Constraints
- read-only / no production config / do not touch X
- …

## Validation
1. node tests/foo-test.js
2. curl -fsS https://… returns 200

Action: implement          (investigate | review | test | document | implement — default: investigate)
Priority: normal           (low | normal | high)
Depends on: #94, gh-20260902-bridge-smoke-01
Timeout: 3600              (seconds, 60–21600)
Max turns: 60
```

Rules the adapter applies (they are the bridge's rules, reused):

| Rule | Effect |
|---|---|
| label `task` **and** state open | anything else is never converted (PRs are ignored even with the label) |
| headings | English or Arabic: Objective/الهدف, Scope/المطلوب/النطاق, Constraints/القيود, Validation/التحقق/التحقق النهائي, Notes/ملاحظات. `## Heading`, `**Heading**` or `Heading:` all work; unknown headings go to `notes` |
| no Objective section | the text before the first heading is the objective; failing that, the title (min 10 chars) |
| `Action` missing | **`investigate` (read-only)** — the created comment says so. Add `Action: implement` (or label `action:implement`) for write tasks |
| `Action: deploy` or any other value | rejected with a comment; nothing runs (the action set is closed, see bridge §4) |
| secret-shaped string anywhere (token, key, password=…, DB URL…) | rejected with a comment that names the kind, never the value; no task file; label `mythos:invalid` |
| `Depends on: #N` | maps to `gh-issue-N`; the bridge does not claim the task until that task is COMPLETED |
| one Issue → one task | `gh-issue-<n>`. To run again after a fix, add the label `rerun` → `gh-issue-<n>-r2` (label is consumed) |
| closing the Issue / removing `task` while active | the task is set CANCELLED (executor task cancelled by the bridge); a CANCELLED comment follows |
| an edited *rejected* Issue | re-evaluated (rejections are keyed by the content hash) |

Task ids, projects, `execution`/`history` blocks, provider/model/paths/tools/credentials: never taken from an Issue.
`requested_action` is the only lever, exactly as in the task protocol.

## 2. What the Issue receives

| Event | When | Content | Label |
|---|---|---|---|
| created | intake | task id, task file link, PENDING/scheduled, action + execution profile, priority, depends_on | `mythos:queued` |
| claimed | first tick after the bridge claimed | executor_task_id, OTHMODE id, profile, branch, base commit | `mythos:in-progress` |
| report | report file exists | status, summary, files changed, tests, commits (SHA, on origin?), problems, risks, next action, report link | `mythos:completed` / `failed` / `blocked` / `human-approval` / `cancelled` |
| delivered | bridge confirmed every commit on origin | commit list | — |

Every comment starts with a hidden marker `<!-- mythos-control task_id=… event=… -->`; the adapter reads the
Issue's comments before posting and adopts an existing marker instead of posting again.

**Issue-facing states:** PENDING, CLAIMED, IN_PROGRESS, COMPLETED, FAILED, BLOCKED, **HUMAN_APPROVAL**, CANCELLED, INVALID.
`HUMAN_APPROVAL` is derived from a BLOCKED report whose text says an owner decision / approval / governance /
protected path / relay DENIED is needed; infrastructure blockers (credit, missing executor record, no
structured report) stay BLOCKED. The control status stays BLOCKED in both cases — the protocol is unchanged.

**Closing policy:** COMPLETED → the Issue stays open unless `MYTHOS_ISSUES_CLOSE_ON_COMPLETED=1` **and** no
commit is still awaiting the relay; FAILED, BLOCKED, HUMAN_APPROVAL always stay open; CANCELLED is whatever the
human did. Merging a task branch to `main` is never automatic (bridge §5).

## 3. Idempotency and recovery

| Situation | Behaviour |
|---|---|
| poll again / restart / timer + manual run | task file exists on the control branch (after `syncControl`) → `already_converted`, nothing posted |
| two adapters at once | the bridge process lock (`bridge/bridge.lock`) serialises them; the loser skips the tick; the file check catches any leftover |
| died after posting the comment, before the commit | next tick finds the marker on the Issue → adopts the comment id, writes the file once |
| control worktree destroyed | `mythos-github-bridge init` rebuilds it from origin; all relations come back from the files |
| bridge cache (`claims.json`) lost | nothing changes (GitHub is the record) |
| Issue edited after conversion | ignored (the task carries the snapshot); use `rerun` for a new attempt |
| GitHub API down / 5xx | the phase returns `ok:false`, nothing is written; retried next tick |

Tested: `tests/mythos-github-issues-test.js` — 102 checks incl. the real #95 payload, concurrent intakes,
restart from origin, crash between comment and commit, FAILED/BLOCKED/HUMAN_APPROVAL/CANCELLED, dependency wait,
rerun, close policy, secret rejection (no secret in any request, comment, tree, history or log), dry-run,
`--only`, wrong user, missing token, shared lock, main byte-for-byte untouched.

## 4. Security

- **No token in Git, logs, comments or child processes.** The PAT is read from the environment
  (`MYTHOS_GITHUB_ISSUES_TOKEN`, preferred, or `MYTHOS_GITHUB_MCP_RW_TOKEN`) or a KEY=VALUE file named by
  `MYTHOS_GITHUB_ISSUES_TOKEN_FILE`; held in a closure; every log line and comment body passes the shared
  `redact` (belt: `safeBody` drops any line the redaction still flags). The systemd drop-in binds the deploy-owned
  0600 file **by reference** (`bridge/systemd/mythos-github-bridge.service.d/issues.conf.example`).
- **Issues never carry credentials:** a secret-shaped title/body is rejected before anything is written.
- **No execution without `task` + open**, no PRs, no closed Issues; `--only` and `MYTHOS_ISSUES_ONLY` restrict a run.
- **Scope:** only `control/` is ever committed (`CONTROL_COMMIT_SCOPE`), explicit paths, never `git add .`;
  the adapter never pushes (root relay), never merges, never touches `main` or the shared checkout; task
  worktrees keep the bridge's no-push guard; profiles/policy/budgets untouched (no protected path in this change).
- **Governance:** unchanged — every control commit and task-branch commit is delivered by the identity-pinned
  relay; the adapter cannot bypass it (it has no push URL to use).
- **User guard:** runs only as the executor user (`BRIDGE_WRONG_USER` otherwise).

## 5. Operate

```bash
# as deploy, from the checkout (token in the environment, see the drop-in example)
node projects/mythos-ai-executor/bin/mythos-github-bridge issues-parse 95            # read-only: what #95 would become
node projects/mythos-ai-executor/bin/mythos-github-bridge issues-tick --dry-run      # read-only: what a tick would do
node projects/mythos-ai-executor/bin/mythos-github-bridge issues-tick --only 96      # one Issue, full pipeline
node projects/mythos-ai-executor/bin/mythos-github-bridge issues-status              # Issue ⇄ task ⇄ executor ⇄ report
```

The deploy timer (`mythos-github-bridge.timer`, every 2 min) runs `tick`; with the drop-in
(`MYTHOS_ISSUES_ENABLED=1` + token file) that same `tick` runs intake → bridge → notify. Without the drop-in the
bridge behaves exactly as before. **Order of deployment matters:** the adapter writes a `source` block that the
bridge's task schema must know (same commit), so enable the drop-in only after `main` carries this change.

## 6. Honest limits

- **Owner step before the write path is live:** the only GitHub credential on the host (`cred_github_gateway`,
  `github-mcp-rw.env`) can read Issues but gets **HTTP 403 on comments and labels** (verified 2026-09-02 on the smoke
  Issue #96; creating #96 worked only because public repositories allow permissionless issue creation). A
  fine-grained PAT with `Issues: Read and write` is required — recommended as a dedicated credential
  `cred_github_issues` in `/home/deploy/deployments/mythos-gateway/github-issues.env`
  (`MYTHOS_GITHUB_ISSUES_TOKEN=…`, 0600, written with `read -s` under `umask 077`, never argv). The read path
  (listing, parsing, dry-run) and the full pipeline offline are verified; the live comment path is not until then.

- The GitHub side is polled (2 min), not webhook-driven; a new Issue waits up to one tick.
- Labels are best-effort cosmetics (a failed label call is logged, the comment is the record).
- Issue #95 as written asks for `implement`-class work but states no `Action`, so it would run read-only
  (`investigate`) and report; the owner adds `Action: implement` (or label `action:implement`) before enabling
  the timer if the write run is intended.
