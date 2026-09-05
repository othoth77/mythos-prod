# Report gh-issue-180 — COMPLETED

| Field | Value |
|---|---|
| Completed | 2026-09-05T10:22:43.179Z |
| Executor task | `t-20260905100205-tw7xvw` |
| OTHMODE task | `OTH-2026-00179` |
| Attempt | `gh-issue-180#1` |
| Action | implement (source explicit_current_issue, written "implement") |
| Profile | repo-write |
| Blocker | — |
| Runtime | `6541cd81949f` on `main` |
| Model | `claude-sonnet-5` (auto:balanced→sonnet score=5 [execution_profile:repo-write+2 task_category:implement+3 complexity_terms(security)+1 simplicity_terms(بسيط)-1]) |
| Branch | `mythos/gh/gh-issue-180` |
| Commits on origin | true |
| Git verified | false |

## Summary

Extended the existing Telegram Lifecycle Notifications channel (bridge/telegram.js) into a unified sink for GitHub Issue/TASK lifecycle and pull-request lifecycle events by adding bridge/notify/telegram-notify.js (dedup + rate-limited, reuses the same bot) and bridge/github-prs.js (read-only PR poller), wiring them into github-bridge.js finishTask()/flushNotifications() and github-issues.js created/claimed events, with Telegram-originated tasks explicitly excluded to avoid duplicate notifications. Added CLI commands and 69 new offline tests (formatting, dedup, rate limiting, resilience, security/no-leakage, PR lifecycle, and real wiring proof); the full pre-existing suite remains green. Both new sinks are off by default (MYTHOS_TELEGRAM_NOTIFY_ENABLED, MYTHOS_PR_NOTIFY_ENABLED) — nothing was deployed or restarted, no real message was sent. WhatsApp and the existing Telegram intake channel are byte-for-byte unchanged. No governance-protected path was touched and no control/ file was edited.

## Commits

- `cc218b24b8c5002194a41844b0c6f98bd527e1f2` feat(bridge): unify Telegram notifications for GitHub Issue/TASK and PR lifecycle (on origin)

## Files changed

- `docs/AI_HANDOVER.md`
- `projects/mythos-ai-executor/bin/mythos-github-bridge`
- `projects/mythos-ai-executor/bridge/github-bridge.js`
- `projects/mythos-ai-executor/bridge/github-issues.js`
- `projects/mythos-ai-executor/bridge/github-prs.js`
- `projects/mythos-ai-executor/bridge/notify/telegram-notify.js`
- `tests/mythos-github-prs-test.js`
- `tests/mythos-telegram-notify-integration-test.js`
- `tests/mythos-telegram-notify-test.js`

## Tests

- mythos-telegram-notify-test.js: 44/44
- mythos-github-prs-test.js: 20/20
- mythos-telegram-notify-integration-test.js: 5/5
- bridge-action-resolution-test.js: 88/88
- mythos-ai-executor-test.js: 390/390
- mythos-github-bridge-test.js: 150/150
- mythos-github-issues-test.js: 208/208
- mythos-telegram-channel-test.js: 68/68
- mythos-bridge-whatsapp-notify-test.js: 131/131
- mythos-bridge-whatsapp-resilience-test.js: 101/101
- mythos-governance-invariant-test.js: 111/111
- node --check: all changed/added JS files pass

## Validation

- required checks: none
- remote head: 6541cd81949ff2b3055b460efd0db2fb0202b47a
- report problems: none

## Problems

- none

## Risks

- Both new sinks are off by default and never exercised against the real Telegram Bot API or real GitHub API — only against in-process fixtures; a live E2E (like the one done for the original Telegram channel in docs/MYTHOS_TELEGRAM_CHANNEL.md §9) is still owner-authorised follow-up work.
- PR checks decision relies on the check-runs endpoint only (not the legacy commit-status API), so a repository using only classic statuses would see PR_CHECKS never fire; this was a scope decision, not an oversight.
- This branch is not merged; production keeps its current behavior (no Issue/PR/task-lifecycle Telegram notifications) until the owner merges and enables the two new environment flags.

## Next recommended action

Owner review and merge of mythos/gh/gh-issue-180 to main, then owner activation: set MYTHOS_TELEGRAM_NOTIFY_ENABLED=1 and MYTHOS_PR_NOTIFY_ENABLED=1 via the systemd drop-in (same pattern as docs/MYTHOS_TELEGRAM_CHANNEL.md §6/§9.3), then run one live pr-tick / trigger one real Issue lifecycle to verify end-to-end delivery before declaring production-active.
