# Report gh-issue-118-r2 — COMPLETED

| Field | Value |
|---|---|
| Completed | 2026-09-03T11:22:12.541Z |
| Executor task | `t-20260903105935-j13m7h` |
| OTHMODE task | `OTH-2026-00052` |
| Attempt | `gh-issue-118-r2#2` |
| Action | implement (source explicit_current_issue, written "implement") |
| Profile | repo-write |
| Blocker | — |
| Runtime | `41823e9ec755` on `main` |
| Model | `claude-fable-5-1` (explicit:fable-5.1 (requested "fable-5.1")) |
| Branch | `mythos/gh/gh-issue-118-r2` |
| Commits on origin | true |
| Git verified | false |

## Summary

gh-issue-118-r2: on top of PR #119, added a durable retry policy (transient/permanent/governance/permission/human classification, exponential backoff with additive jitter, governance/permission never auto-retried, last_failure/retry_backoff/transition_reason recorded and copied into the control report), a runtime gate that refuses new claims on RUNTIME_IDENTITY_UNVERIFIED/MISMATCH by default with a recorded opt-out, once-only lease-expiry observation without re-execution, and a decided-only inheritance rule for reruns; tests, docs (§12e) and handover updated; committed 106d1c7 on mythos/gh/gh-issue-118-r2 over 41823e9; not pushed (governance relay); not merged.

## Commits

- `106d1c732483c0863b14dd478986ca3a40e08c55` fix(bridge): retry policy, runtime gate, lease expiry, decided-only inheritance (gh-issue-118-r2) (on origin)

## Files changed

- `docs/AI_HANDOVER.md`
- `docs/MYTHOS_GITHUB_BRIDGE.md`
- `docs/MYTHOS_GITHUB_ISSUES.md`
- `projects/mythos-ai-executor/bin/mythos-github-bridge`
- `projects/mythos-ai-executor/bridge/action-resolution.js`
- `projects/mythos-ai-executor/bridge/github-bridge.js`
- `projects/mythos-ai-executor/bridge/github-issues.js`
- `projects/mythos-ai-executor/executor.js`
- `projects/mythos-ai-executor/lib/quota.js`
- `projects/mythos-ai-executor/lib/state.js`
- `tests/bridge-action-resolution-test.js`
- `tests/mythos-ai-executor-test.js`
- `tests/mythos-github-bridge-test.js`
- `tests/mythos-github-issues-test.js`

## Tests

- tests/bridge-action-resolution-test.js: 88 passed, 0 failed
- tests/mythos-ai-executor-test.js: 390 passed, 0 failed
- tests/mythos-github-bridge-test.js: 150 passed, 0 failed
- tests/mythos-github-issues-test.js: 193 passed, 0 failed
- tests/model-selection-policy-test.js: 81 passed, 0 failed
- tests/mythos-governance-invariant-test.js: 111 passed, 0 failed
- tests/mythos-unattended-policy-test.js: 53 passed, 0 failed
- node --check on all changed JS: ok
- git diff --check: clean

## Validation

- required checks: none
- remote head: 41823e9ec7556fd7965b9fb544d2b0177e7e3ea5
- report problems: none

## Problems

- none

## Risks

- remote_head is origin/mythos/gh/gh-issue-118-r2 at report time (still the base 41823e9); the governance relay has not yet delivered 106d1c7
- runtime gate default is stricter: a bridge whose module is not inside a git checkout defers every claim until MYTHOS_BRIDGE_ALLOW_UNVERIFIED_RUNTIME=1 is set deliberately — verify `mythos-github-bridge runtime` after deploy
- failure classification is regex-based on provider text; unforeseen wording lands in `permanent` (FAILED, no retry) — visible, never silent
- lease expiry is observed, not enforced; a hung executor run still relies on the executor's own timeout
- behaviour change: a rerun of a previously defaulted attempt is now action_source=default, not inherited
- running services keep old behaviour until merge + restart (owner action)

## Next recommended action

owner review/merge of mythos/gh/gh-issue-118-r2, then restart mythos-ai-executor.service and mythos-github-bridge and check `mythos-github-bridge runtime` gate on the host
