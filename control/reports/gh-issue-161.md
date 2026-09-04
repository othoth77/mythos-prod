# Report gh-issue-161 — COMPLETED

| Field | Value |
|---|---|
| Completed | 2026-09-04T18:54:16.137Z |
| Executor task | `t-20260904171254-orwnlt` |
| OTHMODE task | `OTH-2026-00079` |
| Attempt | `gh-issue-161#1` |
| Action | implement (source action_label, written "implementation") |
| Profile | repo-write |
| Blocker | — |
| Runtime | `5b995e9562df` on `main` |
| Model | `claude-opus-5` (auto:deep→opus score=8 [execution_profile:repo-write+2 task_category:implement+3 complexity_terms(architecture,security,redesign)+3]) |
| Branch | `mythos/gh/gh-issue-161` |
| Commits on origin | true |
| Git verified | true |

## Summary

Closed the EXEC-ARCH-0 approval_ref gap. The branch was fast-forwarded from 5b995e9 onto 6b5a94b (PR #159) because the DAG being fixed exists only there, then two commits were added. Added ops/dagu/bin/mythos-restart-approval (request/grant/deny/revoke/verify/list) over the EXISTING executor policy-engine approval entity — the same record lib/mcp-invoke.js requires for CONTROLLED MCP tools and the one docs/MYTHOS_DAGU_HOST_OPERATIONS.md §12 prescribes; the root-issued HMAC governance store was evaluated and rejected for this path (commit-bound, key/store unreadable by the deploy identity the DAGs run as, and service/ is governance-protected). executor-restart.yaml gains an approval-verify step between the Dagu gate and the restart; type: chain means the restart cannot run when it exits non-zero, and the restart step no longer echoes the raw operator input. verify exits 0 only for a well-formed ap-<id> that exists, carries action_class exactly hostops:executor.restart, is bound to the checkout HEAD targeted, is GRANTED, not revoked, decided by a human within 24h and never consumed; --consume stamps it so one approval buys one attempt; an unmeasurable HEAD or unwritable store is exit 1 (fail closed). No governance-protected path was modified and no existing restart gate (Resource Guard, zero RUNNING tasks, drift --require-restart, post-restart --wait-current 90) was weakened. Production was NOT restarted or otherwise mutated: the real systemctl was never invoked — the chain test uses a PATH stub guarded by a command -v assertion — and no service, timer, marker or host file was created, enabled or modified. OTHMODE task OTH-2026-00079 advanced to phase VERIFICATION with full sections/evidence and left non-terminal (status RUNNING) for the bridge to close.

## Commits

- `425fe5275d4a6ed059224f6f3922d776317a673f` docs(handover): GH #161 — approval_ref verification for the Dagu executor restart (7e0278b) (on origin)
- `7e0278bf793bdf0aff00473b127be74f074bd94c` fix(exec-arch): GH #161 — an approval_ref must be a real MYTHOS approval, not a key-shaped string (on origin)
- `6b5a94b64bd462be408857430ceea33a89ffb164` feat(exec-arch): EXEC-ARCH-0 — one execution architecture; PR #158 superseded by Claude Code + OTHMODE + Dagu (on origin)

## Files changed

- `ops/dagu/bin/mythos-restart-approval`
- `ops/dagu/maintenance/executor-restart.yaml`
- `tests/dagu-maintenance-test.js`
- `ops/dagu/README.md`
- `docs/AI_HANDOVER.md`
- `docs/CHANGELOG.md`
- `docs/MYTHOS_EXECUTION_ARCHITECTURE.md`
- `ops/dagu/bin/mythos-drift-check`
- `ops/dagu/bin/mythos-git-sync`
- `ops/dagu/bin/mythos-worktree-gc`
- `ops/dagu/maintenance/drift-check.yaml`
- `ops/dagu/maintenance/git-sync-main.yaml`
- `ops/dagu/maintenance/worktree-gc.yaml`
- `projects/command-center/data/open-source-registry.json`
- `projects/mythos-ai-executor/executor.js`

## Tests

- tests/dagu-maintenance-test.js: 31 passed, 0 failed (was 22/0; re-run on the committed tree at 425fe52 — covers all seven acceptance criteria including the stubbed-systemctl chain proof)
- tests/mythos-governance-invariant-test.js: 111 passed, 0 failed
- tests/mythos-orchestration-core-test.js: 257 passed, 0 failed
- tests/mcp-ecosystem-test.js: 168 passed, 0 failed
- tests/dagu-hostops-allowlist-test.js: 7 passed, 0 failed
- tests/resource-guard-test.js: 91 passed, 0 failed
- tests/devx-2-impact-map-integrity-test.js: 7 passed, 0 failed
- tests/mythos-hostops-test.js: 37 passed, 2 failed, 2 skipped — PRE-EXISTING/ENVIRONMENT (exercises the host-installed /usr/local/sbin/mythos-hostops, /etc/sudoers.d/60-dagu-hostops and the live Resource Guard CRITICAL level; reads none of the files changed here)
- node --check on ops/dagu/bin/mythos-restart-approval and tests/dagu-maintenance-test.js: syntax ok
- git ls-remote origin refs/heads/mythos/gh/gh-issue-161: 425fe5275d4a6ed059224f6f3922d776317a673f (equals local HEAD)

## Validation

- required checks: none
- remote head: 425fe5275d4a6ed059224f6f3922d776317a673f
- report problems: none

## Problems

- none

## Risks

- The executor approval store is owned by `deploy`, the same account the maintenance DAGs run as, so this does not defend against a compromised `deploy` (which could invoke `systemctl --user restart` directly, without any DAG). That is the pre-existing trust boundary of every executor approval and is stated explicitly in the tool header, ops/dagu/README.md and docs/AI_HANDOVER.md rather than papered over. Binding restarts to the root-issued HMAC governance mechanism would require modifying governance-protected paths and granting the DAG identity read access to /etc/mythos/governance.key — both out of scope here and a separate owner decision.
- The branch contains PR #159's commit 6b5a94b as its base (fast-forward, unmodified). PR #159 and this follow-up must be reviewed and merged together; merging this branch alone is not meaningful, and merging #159 alone would ship the gap.
- The Dagu dry-validation section of the suite was skipped: MYTHOS_DAGU_BIN was not set and the PoC binary lives outside this worktree's permitted paths, so the new `approval-verify` step's YAML was validated by the suite's structural assertions but not by the real Dagu parser. Worth one `dagu dry ops/dagu/maintenance/executor-restart.yaml` before installing the service.
- mythos-hostops-test.js's 2 failures are host-environment dependent and were not re-run against an unmodified checkout in this session (creating a second worktree was avoided per the bridge constraints); the classification rests on the fact that the suite reads none of the changed files and on the identical classification recorded for EXEC-ARCH-0.

## Next recommended action

Human review and merge of PR #159 together with this branch (a strict follow-up that includes 6b5a94b) into main. Before the first real restart, grant the approval with `ops/dagu/bin/mythos-restart-approval request --repo /home/deploy/projects/mythos-prod --reason "<why>"` then `grant ap-… --by "<human name>"`, and paste that ap-… id as approval_ref — nothing else is accepted.
