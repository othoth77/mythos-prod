# Report gh-issue-142 — COMPLETED

| Field | Value |
|---|---|
| Completed | 2026-09-03T19:30:00.810Z |
| Executor task | `t-20260903190843-ymczkb` |
| OTHMODE task | `OTH-2026-00066` |
| Attempt | `gh-issue-142#1` |
| Action | implement (source explicit_current_issue, written "implement") |
| Profile | repo-write |
| Blocker | — |
| Runtime | `ff9f71b51e41` on `main` |
| Model | `claude-sonnet-5` (explicit:sonnet (requested "sonnet")) |
| Branch | `mythos/gh/gh-issue-142` |
| Commits on origin | false |
| Git verified | false |

## Summary

gh-issue-128's remaining requirement (one live governed HostOps READ health call, ok:true/class READ/non-empty audit_id) is satisfied by evidence, not by re-implementation. #130 (HOSTOPS-2R) already fixed the sudo/NoNewPrivileges design conflict and is merged into current origin/main (ff9f71b). #132 (HOSTOPS-2R-FIX, gh-issue-132, commit eebb4b1) fixed the remaining production activation gap (systemd --user group-refresh) but is not yet merged to main; however the live host already carries that fix (deploy is in the mythos-hostops group). One live POST /hostops/run {operation:health} call through the running mythos-ai-executor.service confirmed: ok:true, operation host.health.check, class READ, audit_id hostops-mtlx0zuw-284786, hostops_exit 0. No WRITE/RESTART/DEPLOY verb was invoked; class-based refusal of those verbs is structurally enforced and covered by the passing test suites. #128 is evidence-closable. No code change was required; only docs/AI_HANDOVER.md was updated to record this reconciliation, and that change was committed on this task branch for the governance relay to deliver.

## Commits

- `ad67ab60f54f59b20110bb627b959cb29fa56d1b` docs(hostops): reconcile gh-issue-128 against HOSTOPS-2R/2R-FIX — READ path proven live (gh-issue-142) (awaiting relay)

## Files changed

- `docs/AI_HANDOVER.md`

## Tests

- tests/mythos-hostops-executor-test.js: 36 passed, 0 failed
- tests/mythos-hostops-test.js: 39 passed, 0 failed, 2 skipped
- tests/mythos-hostops-daemon-test.js: 14 passed, 0 failed
- tests/dagu-hostops-allowlist-test.js: 7 passed, 0 failed

## Validation

- required checks: none
- remote head: ff9f71b51e419959c8400c1cecbb5684d3ce633a
- report problems: none

## Problems

- none

## Risks

- gh-issue-132's code (group-refresh script + docs) is still stranded on its own unmerged branch even though its effect is already live on the host — an owner should merge it so the repository's main branch matches production reality.
- The live proof depends on the host's current group membership, which is operational state, not code guaranteed by origin/main alone; a future fresh install without the #132 script would reintroduce the activation gap until merged.

## Next recommended action

Owner: merge mythos/gh/gh-issue-132 (HOSTOPS-2R-FIX) to main via normal review so the group-refresh fix that is already active in production is also reflected in the repository's main branch; no further action needed on gh-issue-128 itself.
