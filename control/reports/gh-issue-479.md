# Report gh-issue-479 — BLOCKED

| Field | Value |
|---|---|
| Completed | 2026-09-26T07:10:05.232Z |
| Executor task | `t-20260926070231-xpoxzx` |
| OTHMODE task | `OTH-2026-01916` |
| Attempt | `gh-issue-479#1` |
| Action | investigate (source default, written "investigate") |
| Profile | repo-read |
| Blocker | `HUMAN_APPROVAL` requested_action resolved to investigate (execution profile repo-read), so per the non-negotiable bridge constraint this run performed read-only code analysis only, no edits/commits/privileged execution. Root cause identified in ops/hostops/mythos-hostops.js worker(): the root daemon (mythos-hostops |
| Runtime | `b2487ee1a5ba` on `main` |
| Model | `claude-sonnet-5` (auto:balanced→sonnet score=3 [complexity_terms(architectural,security)+2 required_tests>=3+1]) |
| Branch | `mythos/gh/gh-issue-479` |
| Commits on origin | null |
| Git verified | null |

## Summary

requested_action resolved to investigate (execution profile repo-read), so per the non-negotiable bridge constraint this run performed read-only code analysis only, no edits/commits/privileged execution. Root cause identified in ops/hostops/mythos-hostops.js worker(): the root daemon (mythos-hostops.service, ProtectSystem=strict, a private static mount namespace) drops to deploy's uid via a bare setuid()/setgid() and connects to a hardcoded /run/user/1001/bus, but that path is a live per-session mount created by pam_systemd/logind with non-shared propagation by design, so the sandboxed daemon's view of it is stale/absent, producing ENOTCONN ("Transport endpoint is not connected") and, on the sibling code path, EPERM. Direct deploy-shell execution works because it isn't namespaced away. Recommended smallest safe fix: reach deploy's user manager via systemd's machine transport (systemd-run --user --machine=deploy@.host ...) over the system bus, which needs no setuid drop and no relaxed sandboxing, keeping every v0.2 CONTROLLED-tier safeguard (audit, backup, CAS, verification, rollback, lock, rate limits, kill switch, HIGHLY_SENSITIVE owner-only) untouched. Could not implement or run the live self-test under this profile; could not update OTH-2026-01916 (node invocation needs interactive approval unavailable in this run) so this message is the full record.

## Commits

- none

## Files changed

- none

## Tests

- sudo node ops/hostops/live-selftest.js --mode socket: not run (repo-read profile forbids privileged execution)

## Validation

- required checks: `sudo node ops/hostops/live-selftest.js --mode socket` reports **9 passed, 0 failed**.; Controlled operations no longer fail with `HOSTOPS_EXEC_FAILED`, `EPERM`, or `Transport endpoint is not connected`.; Rollback test passes.; No weakening of `mythos-hostops.service` sandboxing is required.; No new broad privilege is granted to `deploy`, `dagu`, or the HostOps daemon.; Existing F1/F2/F3/F5 findings are not silently reclassified as resolved.; #477 remains blocked until this task is complete and the 9/9 live self-test passes.
- remote head: b2487ee1a5ba6b22c834f3ba2f0ce49fed2732de
- report problems: none

## Problems

- HUMAN_APPROVAL: requested_action resolved to investigate (execution profile repo-read), so per the non-negotiable bridge constraint this run performed read-only code analysis only, no edits/commits/privileged execution. Root cause identified in ops/hostops/mythos-hostops.js worker(): the root daemon (mythos-hostops.service, ProtectSystem=strict, a private static mount namespace) drops to deploy's uid via a bare setuid()/setgid() and connects to a hardcoded /run/user/1001/bus, but that path is a live per-session mount created by pam_systemd/logind with non-shared propagation by design, so the sandboxed daemon's view of it is stale/absent, producing ENOTCONN ("Transport endpoint is not connected") and, on the sibling code path, EPERM. Direct deploy-shell execution works because it isn't namespaced away. Rec

## Risks

- Root cause is a well-supported code-level hypothesis, not live-verified on the VPS
- F1 (deploy in docker group), F2, F3, F5 (docs/MYTHOS_PERMISSION_MODEL.md) remain open and are unaffected by this investigation
- #477 remains blocked pending a real 9/9 live self-test, which this task did not run
- OTH-2026-01916 could not be updated from this session; findings exist only in this report

## Next recommended action

dispatch a follow-up gh-issue-479 task with requested_action=implement to change worker() in ops/hostops/mythos-hostops.js to use the --machine=deploy@.host transport, add a regression test for the exact EPERM/ENOTCONN failure mode, then requested_action=test to run sudo node ops/hostops/live-selftest.js --mode socket on the VPS and confirm 9/9
