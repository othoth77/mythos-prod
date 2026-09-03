# Report gh-issue-128 — BLOCKED

| Field | Value |
|---|---|
| Completed | 2026-09-03T14:44:42.475Z |
| Executor task | `t-20260903144005-klqhhs` |
| OTHMODE task | `OTH-2026-00058` |
| Attempt | `gh-issue-128#1` |
| Action | implement (source explicit_current_issue, written "implement") |
| Profile | repo-write |
| Blocker | `GOVERNANCE_DENIED` Verified the merged HostOps/Dagu READ integration from origin/main 718741b: executor /health and Dagu PoC /api/v1/health are both live and healthy, and Dagu is confirmed by design (docs/MYTHOS_HOSTOPS_INTERFACE.md) to not sit in the READ path, so there was nothing to 'activate' there. The one requir |
| Runtime | `718741b86da9` on `main` |
| Model | `claude-sonnet-5` (explicit:sonnet (requested "sonnet")) |
| Branch | `mythos/gh/gh-issue-128` |
| Commits on origin | null |
| Git verified | false |

## Summary

Verified the merged HostOps/Dagu READ integration from origin/main 718741b: executor /health and Dagu PoC /api/v1/health are both live and healthy, and Dagu is confirmed by design (docs/MYTHOS_HOSTOPS_INTERFACE.md) to not sit in the READ path, so there was nothing to 'activate' there. The one required live READ-only POST /hostops/run health call through the Executor's bearer-gated route failed with HTTP 503 HOSTOPS_UNAVAILABLE: sudo refused because mythos-ai-executor.service sets NoNewPrivileges=true, a load-bearing kernel-level control documented in the unit file itself, which unconditionally blocks any sudo child process the daemon spawns -- independent of the sudoers/allowlist config, which is otherwise correct. This is a structural conflict between HOSTOPS-1's sudo-based adapter design and the executor's own hardening, present since PR #127 merged. All three focused HostOps/Dagu test suites pass (they mock the spawn call and never exercised the real hardened daemon, which is why this wasn't caught before). Fixing it requires relaxing a governance-protected security control, which is out of scope for this READ-only verification task, so per the mission's own safety clause this is reported BLOCKED rather than improvised. No file was edited and no commit was made.

## Commits

- none

## Files changed

- none

## Tests

- tests/mythos-hostops-executor-test.js: 34 passed, 0 failed
- tests/mythos-hostops-test.js: 40 passed, 0 failed, 1 skipped
- tests/dagu-hostops-allowlist-test.js: 7 passed, 0 failed

## Validation

- required checks: none
- remote head: —
- report problems: delivery expected a commit but the report claims none

## Problems

- delivery expected a commit but the report claims none
- GOVERNANCE_DENIED: Verified the merged HostOps/Dagu READ integration from origin/main 718741b: executor /health and Dagu PoC /api/v1/health are both live and healthy, and Dagu is confirmed by design (docs/MYTHOS_HOSTOPS_INTERFACE.md) to not sit in the READ path, so there was nothing to 'activate' there. The one required live READ-only POST /hostops/run health call through the Executor's bearer-gated route failed with HTTP 503 HOSTOPS_UNAVAILABLE: sudo refused because mythos-ai-executor.service sets NoNewPrivileges=true, a load-bearing kernel-level control documented in the unit file itself, which unconditionally blocks any sudo child process the daemon spawns -- independent of the sudoers/allowlist config, which is otherwise correct. This is a structural conflict between HOSTOPS-1's sudo-based adapter design

## Risks

- The Executor->hostops READ path is unusable in production as currently deployed: any live call through the daemon will return HOSTOPS_UNAVAILABLE until NoNewPrivileges is addressed by an owner decision (relax it, or change the escalation mechanism away from sudo).
- This gap is invisible to the existing test suites because they inject/mock the spawn call rather than exercising the real systemd-confined process -- future HostOps work should add a live/integration-style check against the deployed unit, not just mocked adapter tests.

## Next recommended action

Owner decision required: either relax NoNewPrivileges on projects/mythos-ai-executor/service/mythos-ai-executor.service for this one escalation path (a security-boundary change, level 3 / owner approval per AGENTS.md 25.3), or redesign the hostops escalation mechanism to not require sudo from inside the hardened daemon (e.g. a separate unprivileged-to-privileged relay). Either is an architecture/governance decision outside this task's read-only-verification scope.
