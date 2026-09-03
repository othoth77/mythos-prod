# Report gh-issue-123 — COMPLETED

| Field | Value |
|---|---|
| Completed | 2026-09-03T12:18:32.536Z |
| Executor task | `t-20260903121045-pdghsy` |
| OTHMODE task | `OTH-2026-00055` |
| Attempt | `gh-issue-123#1` |
| Action | implement (source explicit_current_issue, written "implement") |
| Profile | repo-write |
| Blocker | — |
| Runtime | `d69e0abc34de` on `main` |
| Model | `claude-sonnet-5` (explicit:sonnet (requested "sonnet")) |
| Branch | `mythos/gh/gh-issue-123` |
| Commits on origin | false |
| Git verified | false |

## Summary

Fixed the two review notes on PR #122 (mythos/gh/gh-issue-111-r5, the WhatsApp Bridge notification layer). (1) Task ID compatibility: whatsapp.js's ledger-key regex still capped task_id at 40 chars after github-bridge.js's own TASK_ID_RE was raised to 6-64 chars in 82bea23; any task_id 41-64 chars silently vanished because onReport()'s try/catch swallowed the NOTIFY_KEY_INVALID error with no visible failure anywhere. Raised the ledger key pattern to match. (2) Delivery idempotency/crash safety: deliverEntry() only wrote delivered_to to the ledger once, after every recipient in a batch had settled, leaving a real window where a crash between two recipients' sends could lose a recipient's already-acknowledged success and cause a duplicate on the reclaimed retry — while the docs claimed a crash after success 'cannot produce a duplicate,' which was false. delivered_to (and updated_at) is now written immediately after each recipient's send is acknowledged, shrinking the unavoidable risk window to one synchronous write; since Evolution API's sendText has no idempotency-key parameter, exactly-once cannot be proven, so the docs were corrected to state at-least-once delivery with best-effort de-duplication instead of overclaiming. My task branch (based on d69e0abc, same base as PR #122's branch) fast-forward-merged origin/mythos/gh/gh-issue-111-r5 (d8eb893, PR #122's tip) to get the actual code, then applied the fixes plus 12 new regression checks — a 64-char task_id reaching the ledger and delivering (and a 65-char id still refused), and a crash-window test that holds one recipient's HTTP response open to observe the sibling recipient's success durable on disk mid-attempt, then simulates the crash/reclaim path and confirms the already-recorded recipient is never re-sent. I verified both new tests actually catch the underlying bugs by re-running them against the pre-fix code (the 64-char test failed as expected: NOTIFY_KEY_INVALID) before restoring the fix. No control/ files touched, no provider deployed, no real WhatsApp message sent, no merge to main.

## Commits

- `a3082892814f8b8282d6593481b25a6b29ac09f5` fix(bridge): PR #122 review fixes — WhatsApp notify task_id 64-char ledger key, at-least-once delivery honesty (gh-issue-123) (awaiting relay)
- `d8eb8931cf0adca94e2d4f7746884e3b27664e03` feat(github-bridge): reapply WhatsApp notification layer onto current main (gh-issue-111-r5) (on origin)

## Files changed

- `projects/mythos-ai-executor/bridge/notify/whatsapp.js`
- `tests/mythos-bridge-whatsapp-notify-test.js`
- `docs/MYTHOS_BRIDGE_WHATSAPP_NOTIFY.md`
- `docs/AI_HANDOVER.md`
- `docs/MYTHOS_GITHUB_BRIDGE.md`
- `projects/command-center/data/open-source-registry.json`
- `projects/mythos-ai-executor/bin/mythos-github-bridge`
- `projects/mythos-ai-executor/bridge/github-bridge.js`
- `projects/mythos-ai-executor/bridge/notify/http-json.js`
- `projects/mythos-ai-executor/bridge/notify/providers/evolution.js`

## Tests

- tests/mythos-bridge-whatsapp-notify-test.js: 128 passed, 0 failed (116 existing + 12 new)
- tests/mythos-github-bridge-test.js: 150 passed, 0 failed
- tests/mythos-ai-executor-test.js: 390 passed, 0 failed
- tests/mythos-github-issues-test.js: 193 passed, 0 failed
- tests/bridge-action-resolution-test.js: 88 passed, 0 failed
- tests/mythos-governance-invariant-test.js: 111 passed, 0 failed
- node --check: clean on whatsapp.js and the test file
- regression-test sanity check: new 64-char task_id test fails against pre-fix code (NOTIFY_KEY_INVALID), passes after restoring the fix

## Validation

- required checks: none
- remote head: d8eb8931cf0adca94e2d4f7746884e3b27664e03
- report problems: none

## Problems

- none

## Risks

- Exactly-once delivery is still not achievable with the Evolution API adapter (no idempotency-key parameter); the residual crash window is now a single synchronous ledger write, documented honestly as at-least-once, not eliminated.
- PR #122's branch (mythos/gh/gh-issue-111-r5) was not itself modified — this commit sits on my task branch on top of a fast-forward merge of that branch's tip; the governance relay/bridge is responsible for reconciling this with PR #122 (per the bridge constraint to work only on mythos/gh/gh-issue-123).
- WhatsApp provider (Evolution API) remains undeployed; the layer stays fully inert (MYTHOS_BRIDGE_WHATSAPP_ENABLED unset) as before — unchanged by this task.

## Next recommended action

Governance relay delivers commit a308289 to origin/mythos/gh/gh-issue-123; the bridge verifies it against Git and tests, reconciles it with PR #122, and closes OTHMODE task OTH-2026-00055 with a terminal status.
