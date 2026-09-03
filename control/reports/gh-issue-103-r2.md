# Report gh-issue-103-r2 — COMPLETED

| Field | Value |
|---|---|
| Completed | 2026-09-03T00:20:12.189Z |
| Executor task | `t-20260903000725-ln6pla` |
| OTHMODE task | `OTH-2026-00032` |
| Profile | repo-write |
| Branch | `mythos/gh/gh-issue-103-r2` |
| Commits on origin | true |
| Git verified | false |

## Summary

Fixed the four latent rerun defects confirmed by the read-only #103 investigation, in projects/mythos-ai-executor/bridge/github-issues.js. (A) The rerun label is now consumed only after the control commit that carries the new attempt reports committed=true, so a tick killed between label removal and commit can no longer eat the request; the next tick re-creates the same attempt and adopts the created comment it had already posted. (B) pickAction gained a `previous` argument: on attempt>1 with no explicit Action in the body or an action:<x> label, the previous attempt's requested_action is inherited instead of silently re-defaulting to investigate/repo-read, and the notes plus the created comment say what was inherited and from where. (C) scope, constraints and validation_requirements are inherited from the previous attempt when the edited rerun body leaves them empty or heads them with wordings absent from SECTION_ALIASES — the exact failure that gave gh-issue-101-r2 zero validation items against 13 on attempt 1; the objective is deliberately not inherited. (D) The already-converted and rerun-deferred-while-active paths now both log and both answer on the Issue with marker-keyed comments: rerun_deferred (one per running attempt, states the label was kept and names the task the rerun will become) and stale_edit (one per distinct edit, keyed by the sha256 of the new content). An unedited already-converted Issue stays silent so the steady state is not spammed. source.inherited_from and source.inherited were added to task.schema.json because its source block is additionalProperties:false, and rerun_of now names the actual predecessor instead of assuming contiguous attempt numbers. The test suite grew 38 checks covering every required case, and docs/MYTHOS_GITHUB_ISSUES.md was corrected in the three places that documented the old behaviour. Two caveats reported honestly: the suite previously inherited the host's real MYTHOS_GITHUB_MCP_RW_TOKEN, which made two token-guard cases fail/pass for the wrong reason and put a live token in the test process — the suite now deletes it, taking those two from failing to passing; and the pre-existing two-process concurrency fixture (section 3, untouched by this change) flaked once in five runs, clean in the other four.

## Commits

- `7bc40caa00b6ae469b94a3ae4c4299af462fadda` fix(github-issues): make Issue reruns lossless — label after commit, action/section inheritance, Issue-side feedback (on origin)

## Files changed

- `projects/mythos-ai-executor/bridge/github-issues.js`
- `projects/mythos-ai-executor/bridge/schemas/task.schema.json`
- `tests/mythos-github-issues-test.js`
- `docs/MYTHOS_GITHUB_ISSUES.md`

## Tests

- tests/mythos-github-issues-test.js: 139 passed, 0 failed (baseline before the change: 100 passed, 2 failed — the 2 were the ambient-token artefact)
- tests/mythos-github-bridge-test.js: 97 passed, 0 failed
- tests/mythos-ai-executor-test.js: 265 passed, 0 failed
- tests/mythos-governance-invariant-test.js: 111 passed, 0 failed
- tests/model-selection-policy-test.js: 75 passed, 0 failed
- flake note: tests/mythos-github-issues-test.js section 3 ('concurrent: exactly one created comment') failed in 1 of 5 runs — pre-existing two-process race in the fixture, on a code path this change does not touch

## Validation

- required checks: Add tests covering the four defects, including COMPLETED/BLOCKED reruns, independent task IDs, interrupted tick between label removal and commit, Action inheritance, section preservation, and rerun while previous attempt is active. Run the relevant bridge/executor/governance tests and report exact …
- remote head: e0e22d492f6d78d5e39d3e3f68db83b6244512ec
- report problems: none

## Problems

- none

## Risks

- remote_head is the base commit e0e22d4, not 7bc40ca: the governance relay (mythos-git-push.timer, fast-forward only, every 5 min) had not yet delivered the branch when this report was written. Git completion on origin is unverified by design — pushing is not this task's to do.
- Action inheritance reproduces the previous attempt's own requested_action and is therefore not a privilege escalation, but it does mean a rerun of an `implement` Issue stays repo-write without restating it. This is the intended fix for defect B; an owner who wants a read-only rerun must now state Action explicitly.
- stale_edit posts one comment per distinct edit of a converted Issue. An Issue edited many times in small steps will accumulate one comment per edit. Bounded by user behaviour, not by ticks.
- The pre-existing concurrency-fixture flake in section 3 is unfixed and out of this task's scope; it is a fixture timing race, not adapter behaviour.
- Defect A's fix is verified against a simulated tick death (an exception raised by a later Issue in the same intake pass). A hard SIGKILL mid-HTTP-call cannot be exercised in-process; the ordering guarantee, not the kill signal, is what the test pins.
- The rerun-deferred path was not exercised against a real GitHub API, only the in-process fake — consistent with the rest of this suite.

## Next recommended action

Let the governance relay deliver 7bc40ca to origin/mythos/gh/gh-issue-103-r2, then verify it with `git ls-remote origin refs/heads/mythos/gh/gh-issue-103-r2`. The bridge closes control task gh-issue-103-r2 and OTHMODE OTH-2026-00032 from this report. Merging to main stays a human decision (open a PR from mythos/gh/gh-issue-103-r2). Issue #103 should stay open until that verification; the rerun mechanism itself was never broken, so no further #101 experiment is needed.
