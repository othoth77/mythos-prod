# Report gh-20260902-wa-bridge-notify-01 — COMPLETED

| Field | Value |
|---|---|
| Completed | 2026-09-02T20:15:40.457Z |
| Executor task | `t-20260902195620-d89com` |
| OTHMODE task | `OTH-2026-00024` |
| Profile | repo-write |
| Branch | `mythos/gh/gh-20260902-wa-bridge-notify-01` |
| Commits on origin | false |
| Git verified | false |

## Summary

Implemented a WhatsApp notification layer for the existing MYTHOS GitHub Bridge, disabled by default and behind a provider adapter. Design is two-phase: finishTask() only appends a durable ledger entry (local, synchronous, never network) after the REPORT is written, and delivery happens in flushNotifications() after tick() has already returned — so a gateway outage cannot slow, fail or alter a tick, and leaves the TASK and REPORT byte-identical with no control commit (asserted). Notifies on COMPLETED, FAILED, BLOCKED and HUMAN_APPROVAL only; CANCELLED and every non-terminal state notify nothing. HUMAN_APPROVAL is a notification kind attached to the bridge's existing blocked-for-a-human condition (claim exists, executor record gone) — mythos-control/1 and the control status set are unchanged. Idempotency uses a durable ledger keyed <task_id>__<KIND> under $MYTHOS_BRIDGE_HOME/notify/ledger (the existing executor store convention; no database added) with an O_EXCL lock per key: duplicate polling, four parallel in-process flushes, four concurrent OS processes and restart-after-crash all yield exactly one message per recipient, and a delivered recipient is recorded and never re-sent. Failed delivery is retryable with exponential backoff, bounded by MAX_ATTEMPTS then EXHAUSTED, and never alters task status. Evolution API is the default adapter (sendText only — no instance lifecycle, QR, media, groups or webhooks); Node core only, no npm dependency. The credential is read at send time from a 0600 file, never stored, logged, echoed or placed on a command line; the gateway must be on a private network unless explicitly overridden. Not done: the provider is NOT deployed and the one controlled real smoke test is NOT performed (no gateway on the host, no Docker access for deploy, swap fully consumed) — both are the first steps of the separate deployment task. The provider choice is PROVISIONAL because this run had no outbound network to live-verify the four candidates.

## Commits

- `b37491f9b839a29e2706632ddf07c0f804985702` feat(github-bridge): WhatsApp notification layer behind a provider adapter (awaiting relay)

## Files changed

- `projects/mythos-ai-executor/bridge/notify/whatsapp.js`
- `projects/mythos-ai-executor/bridge/notify/http-json.js`
- `projects/mythos-ai-executor/bridge/notify/providers/evolution.js`
- `projects/mythos-ai-executor/bridge/github-bridge.js`
- `projects/mythos-ai-executor/bin/mythos-github-bridge`
- `tests/mythos-bridge-whatsapp-notify-test.js`
- `docs/MYTHOS_BRIDGE_WHATSAPP_NOTIFY.md`
- `docs/MYTHOS_GITHUB_BRIDGE.md`
- `docs/AI_HANDOVER.md`
- `projects/command-center/data/open-source-registry.json`

## Tests

- tests/mythos-bridge-whatsapp-notify-test.js (new): 116 passed, 0 failed — disabled-by-default, readiness/private-network rule, the four kinds delivered, non-terminal and CANCELLED notify nothing, duplicate polling, parallel in-process flushes, concurrent OS processes, retry/backoff/exhaustion, partial multi-recipient delivery, crash reclaim + restart recovery, real bridge tick end-to-end for COMPLETED and HUMAN_APPROVAL, gateway-500 isolation, secret absence, adapter contract
- tests/mythos-github-bridge-test.js: 97 passed, 0 failed
- tests/mythos-ai-executor-test.js: 265 passed, 0 failed
- tests/mythos-governance-invariant-test.js: 111 passed, 0 failed
- tests/othmode-3-tasks-test.js: 94 passed, 0 failed
- tests/othmode-2-platform-test.js: 141 passed, 0 failed (http section skipped: pg module unavailable on this host)
- tests/mcc-1-command-center-test.js: NOT RUN — pre-existing MODULE_NOT_FOUND 'pg' at projects/command-center/reference/db.js:31 (file untouched by this change; same host limitation othmode-2 skips for)
- node --check on all six changed/added JS files: pass
- controlled real WhatsApp smoke test: NOT PERFORMED — no provider deployed, no Docker access for the deploy user, swap fully consumed (documented procedure in docs/MYTHOS_BRIDGE_WHATSAPP_NOTIFY.md section 7.1)

## Validation

- required checks: Validate the provider choice and document why it is appropriate.; Test COMPLETED, FAILED, BLOCKED and HUMAN_APPROVAL notifications.; Verify PENDING and non-terminal states do not trigger notifications.; Verify duplicate polling and concurrent ticks result in at most one successful notification.; Verify failed delivery is retryable and does not alter task status.; Verify restart/recovery does not duplicate successful delivery.; Verify secrets are absent from Git, logs, reports and test output.; Run the relevant existing Bridge, OTHMODE, Executor and governance tests plus the new notification tests.; Perform one controlled real WhatsApp smoke test only after automated tests pass.; Verify deployment/restart recovery and create the normal GitHub REPORT with commit SHA, tests, risks and delivery status.
- remote head: ccedcbc508505f351e59306941fbf61a3218cbbf
- report problems: none

## Problems

- none

## Risks

- remote_head is the branch's origin head BEFORE relay delivery: commit b37491f is committed locally on mythos/gh/gh-20260902-wa-bridge-notify-01 but not yet on origin. No push was run (governance relay mythos-git-push.timer, fast-forward only, delivers it within ~5 min); the bridge re-measures on_origin after delivery.
- Provider choice is PROVISIONAL: no outbound network in this run, so licence, maintenance status and real memory footprint for Evolution API / WAHA / MultiWA / WaSphere are TO-VERIFY. A networked session must verify them and re-open the choice if the footprint does not fit this VPS.
- The WhatsApp path is unproven beyond the socket: the real send has never happened. Everything up to the HTTP request is tested against a real local server with the real adapter.
- Deploying any provider on this host is currently risky: swap measured 4095/4095 MiB used with ~425 MiB RAM free. The deployment task must address memory pressure first.
- MultiWA and WaSphere could not be identified as maintained projects without network access, so they were excluded as defaults rather than evaluated on merit.
- Deleting a SENT ledger entry is the only way to cause a duplicate message; SENT entries are deliberately never pruned.
- The notification ledger lives outside Git in the executor store, so notification history is host-local and not part of the GitHub record (by design — the REPORT remains the record of the task).

## Next recommended action

Separate deployment task: address the VPS swap pressure, live-verify the chosen provider (licence, maintenance, real footprint) and re-open the choice if it does not fit, deploy the gateway on a private/loopback network, install the systemd drop-in per docs/MYTHOS_BRIDGE_WHATSAPP_NOTIFY.md section 4.1 (credential in a 0600 file, never in a unit in Git), then run `mythos-github-bridge notify-config` (problems must be empty) followed by the single `mythos-github-bridge notify-test --confirm` smoke test.
