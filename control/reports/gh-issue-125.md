# Report gh-issue-125 — COMPLETED

| Field | Value |
|---|---|
| Completed | 2026-09-03T12:39:12.494Z |
| Executor task | `t-20260903123345-yjzccr` |
| OTHMODE task | `OTH-2026-00056` |
| Attempt | `gh-issue-125#1` |
| Action | implement (source explicit_current_issue, written "implement") |
| Profile | repo-write |
| Blocker | — |
| Runtime | `d69e0abc34de` on `main` |
| Model | `claude-sonnet-5` (explicit:sonnet (requested "sonnet")) |
| Branch | `mythos/gh/gh-issue-125` |
| Commits on origin | true |
| Git verified | false |

## Summary

Fixed the one remaining PR #124 review note: writeEntry() in projects/mythos-ai-executor/bridge/notify/whatsapp.js was claimed (in a comment in deliverEntry()) to be a 'synchronous fsync-backed rename' but never called fsync anywhere — it was a plain writeFileSync + renameSync. Rather than weaken the claim, I made it true: writeEntry() now opens the tmp file directly, writes and fsyncs its fd before renameSync, then best-effort fsyncs the ledger directory afterward (swallowed on platforms like Windows that don't support directory fsync). The at-least-once + best-effort-deduplication delivery guarantee is unchanged and not strengthened. Added a regression test that spies on fs.fsyncSync to prove writeEntry() actually invokes it, confirms no leftover .tmp-<pid> file survives, and confirms the entry reads back correctly post-rename. Since this worktree's branch (mythos/gh/gh-issue-125) started from d69e0ab and didn't yet contain the WhatsApp bridge code, and PR #124's actual branch tip (mythos/gh/gh-issue-123 @ a308289) is a direct linear descendant of that same d69e0ab base, I fast-forwarded this branch to a308289 first (no push) so the new commit sits cleanly on PR #124's path. Ran the whatsapp-notify, github-bridge, executor, and governance-invariant suites plus bridge-action-resolution — all green. mpi-0-finalization-governance-test.js has 3 pre-existing failures (skills-registry on-disk drift, unrelated to this change) which I confirmed were already present before my change by stashing it and re-running.

## Commits

- `b03d69d6cdc24b4d14f9430022b313795c446ce0` fix(bridge): make writeEntry() actually fsync-backed, matching its own comment (gh-issue-125) (on origin)
- `a3082892814f8b8282d6593481b25a6b29ac09f5` fix(bridge): PR #122 review fixes — WhatsApp notify task_id 64-char ledger key, at-least-once delivery honesty (gh-issue-123) (on origin)
- `d8eb8931cf0adca94e2d4f7746884e3b27664e03` feat(github-bridge): reapply WhatsApp notification layer onto current main (gh-issue-111-r5) (on origin)

## Files changed

- `projects/mythos-ai-executor/bridge/notify/whatsapp.js`
- `tests/mythos-bridge-whatsapp-notify-test.js`
- `docs/AI_HANDOVER.md`
- `docs/MYTHOS_BRIDGE_WHATSAPP_NOTIFY.md`
- `docs/MYTHOS_GITHUB_BRIDGE.md`
- `projects/command-center/data/open-source-registry.json`
- `projects/mythos-ai-executor/bin/mythos-github-bridge`
- `projects/mythos-ai-executor/bridge/github-bridge.js`
- `projects/mythos-ai-executor/bridge/notify/http-json.js`
- `projects/mythos-ai-executor/bridge/notify/providers/evolution.js`

## Tests

- tests/mythos-bridge-whatsapp-notify-test.js: 131 passed, 0 failed
- tests/mythos-github-bridge-test.js: 150 passed, 0 failed
- tests/mythos-ai-executor-test.js: 390 passed, 0 failed
- tests/mythos-governance-invariant-test.js: 111 passed, 0 failed
- tests/bridge-action-resolution-test.js: 88 passed, 0 failed
- tests/mpi-0-finalization-governance-test.js: 33 passed, 3 failed (pre-existing, unrelated skills-registry drift; verified present on pre-fix baseline too)

## Validation

- required checks: none
- remote head: a3082892814f8b8282d6593481b25a6b29ac09f5
- report problems: none

## Problems

- none

## Risks

- Directory fsync is best-effort and silently swallowed on platforms that don't support opening/fsyncing a directory fd (e.g. Windows) — the file's own fsync before rename still guarantees the bytes are on disk in that case, but the rename's own durability is not proven there.
- This worktree's branch was fast-forwarded onto PR #124's branch tip (a308289) rather than started from it; the governance relay / bridge should confirm this lands correctly against the actual PR #124 head before merge.

## Next recommended action

Bridge/governance relay verifies commit b03d69d against PR #124 (mythos/gh/gh-issue-123) and closes OTH-2026-00056; no further action expected from this task unless another review note surfaces.
