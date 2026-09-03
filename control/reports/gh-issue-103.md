# Report gh-issue-103 — BLOCKED

| Field | Value |
|---|---|
| Completed | 2026-09-03T00:03:02.287Z |
| Executor task | `t-20260902234133-hwh6xe` |
| OTHMODE task | `OTH-2026-00031` |
| Profile | repo-read |
| Branch | `mythos/gh/gh-issue-103` |
| Commits on origin | null |
| Git verified | null |

## Summary

Read-only investigation of the GitHub Issue → Bridge → TASK rerun path. FINDING 1 — the premise of Issue #103 is wrong: the rerun for #101 did work. origin/mythos/control commit 494bb56 created control/tasks/gh-issue-101-r2.json at 2026-09-02T23:34:59Z with attempt=2, rerun_of=gh-issue-101, requested_action=implement and execution_profile=repo-write; a972b4d claimed it at 23:35:05Z as executor task t-20260902233505-abdgit / OTHMODE OTH-2026-00030 on a new branch mythos/gh/gh-issue-101-r2 (base e0e22d4); 67f8668 shows IN_PROGRESS at 23:37:10Z. The Issue was edited at 23:33:44Z and the bridge timer is 2 minutes, so the new TASK existed 75 s later. Issue #103 was itself converted at 23:41:30Z, six minutes after that. No task id was reused, Action: implement and repo-write were both honoured. FINDING 2 — four real latent defects exist in bridge/github-issues.js, none of which is the reported symptom. (A) LOSS: intake() removes the rerun label at line 752 inside the per-issue loop while the control commit only happens after the loop at line 758, and saveTask runs inside saveAndCommit; a tick killed in between (TimeoutStartSec=600, OOM-prone host) or an exception thrown by a later issue leaves the label consumed and no task file, so the next tick evaluates wantsRerun=false, logs already_converted and drops the rerun request permanently — the comment-marker recovery layer does not cover this because attempt=2 is never computed. (B) DOWNGRADE: pickAction re-derives the action from the current body only and falls back to defaultAction=investigate (repo-read) when the rerun body states none; nothing inherits the previous attempt's requested_action. This is the root cause of the whole #101 sequence — attempt 1 ran repo-read on an explicitly executive Issue. (C) FIELD LOSS: a rerun re-parsed from an edited body drops the structured fields — gh-issue-101-r2 carries scope=[], constraints=[], validation_requirements=[] and objective=title only, against 13 validation items on attempt 1, because the rerun body used markdown headings absent from SECTION_ALIASES so every section landed in _other: and became notes; the executor's instruction consequently read 'Scope: as implied by the objective'. (D) SILENCE: the already_converted path (line 731) and the rerun-deferred-because-still-ACTIVE path post no Issue comment and emit no log line, which is precisely why a rerun that worked looked broken and produced Issue #103. Existing coverage is four happy-path assertions at tests/mythos-github-issues-test.js:357-364; A, B, C and D are untested. BLOCKED: the fix is repo-write work but this task was dispatched requested_action=investigate (defaulted, because #103 states no Action), and the bridge constraint makes investigate read-only — no file edits, no commits. Owner decision required to re-dispatch as implement. No files were changed and no commit was made. No test suite was executed and none is claimed: this non-interactive session denied command approval for `node tests/mythos-github-issues-test.js`; the same denial prevented recording these findings into OTH-2026-00031 via othmode-cli.

## Commits

- none

## Files changed

- none

## Tests

- none executed — read-only action and command approval for test execution was denied in this session; no test result is claimed

## Validation

- required checks: none
- remote head: e0e22d492f6d78d5e39d3e3f68db83b6244512ec
- report problems: none

## Problems

- none

## Risks

- A: rerun request lost if a tick dies between removeLabel (github-issues.js:752) and saveAndCommit (:758) — no file written, label consumed, next tick skips as already_converted. Fix: remove the rerun label only after commitControl reports committed=true, and reconstruct attempt from the Issue's existing `created` comment markers rather than from the label alone.
- B: rerun silently downgraded to investigate/repo-read when the edited body omits Action:. Fix: on attempt>1 with no explicit action, inherit the previous attempt's requested_action instead of cfg.defaultAction, record the inheritance in notes and state it in the created comment; never downgrade an executive task silently.
- C: rerun drops scope/constraints/validation when the new body uses unrecognised headings (proven by gh-issue-101-r2). Fix: on attempt>1, inherit any section the new body leaves empty from the previous attempt, and surface the counts in the created comment so the loss is visible.
- D: no Issue-side feedback on already_converted or on a rerun deferred while the previous attempt is ACTIVE. Fix: one marker-keyed comment per case ('rerun deferred — attempt N still running' / 'no rerun label found'). This alone prevents the class of confusion that produced #103.
- Task-id collision: attempt is derived only from the highest-attempt task file on disk; if the control worktree is rebuilt from origin before the creating commit is delivered, the same -rN id can be recomputed and saveTask will overwrite. Worth an explicit guard plus a test.
- gh-issue-101-r2 (t-20260902233505-abdgit) was still IN_PROGRESS at the time of this investigation and is untouched by it — it is the live Resource Guard implementation run, out of scope here by the Issue's own instruction.

## Next recommended action

Owner decision required: re-dispatch this fix as an executive task — add `Action: implement` (or the label `action:implement`) to Issue #103, then add the `rerun` label so the adapter creates gh-issue-103-r2 with execution_profile=repo-write. That run should fix A–D in projects/mythos-ai-executor/bridge/github-issues.js (label removal after the commit; action inheritance on attempt>1; section inheritance on attempt>1; feedback comments on already_converted and deferred rerun) and add cases to tests/mythos-github-issues-test.js covering: rerun of a COMPLETED task, rerun of a BLOCKED task, new independent task id with no reuse of the previous one, a tick killed between label removal and commit (request must survive), a rerun body with no Action inheriting implement, a rerun body with unrecognised headings keeping the previous scope/validation, and a rerun label added while the previous attempt is still ACTIVE. Note for the record: the rerun mechanism itself is not broken — #101 already reran correctly as gh-issue-101-r2, so the planned real-world #101 experiment has in effect already happened and succeeded.
