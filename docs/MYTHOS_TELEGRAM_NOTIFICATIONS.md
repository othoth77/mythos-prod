# MYTHOS unified Telegram notifications — GitHub Issue/TASK and PR lifecycle

**Stage:** GH-ISSUE-180 (2026-09-05). **Branch:** `mythos/gh/gh-issue-180` (base `6541cd8`, **not merged**).
**Code:** `projects/mythos-ai-executor/bridge/notify/telegram-notify.js` (sink), `projects/mythos-ai-executor/bridge/github-prs.js`
(read-only PR poller), wiring in `bridge/github-bridge.js`, `bridge/github-issues.js`, `bin/mythos-github-bridge`.
**Tests:** `tests/mythos-telegram-notify-test.js`, `tests/mythos-github-prs-test.js`, `tests/mythos-telegram-notify-integration-test.js`
(offline, fake Bot API / fake GitHub API, no real message sent).
**Production status: NOT ACTIVATED.** Both feature flags are off by default; no systemd drop-in was installed, no unit was
restarted, no real Telegram message has been sent by this code, and no real GitHub event has been observed through it.
This document describes only what the branch contains.

## 1. What it is

The existing Telegram channel (`bridge/telegram.js`, `docs/MYTHOS_TELEGRAM_CHANNEL.md`) replies only inside the private
chat that started a Telegram-originated task. Tasks that arrive through GitHub Issues, and pull requests, produced no
Telegram signal at all. This stage adds a second, outbound-only sink on the **same bot** — no second bot, no second
gateway, no new polling of `getUpdates`, no authority over anything — and a read-only PR poller that feeds it.

```text
producers (enqueue, synchronous, local, never network)          delivery (flush, async, after the tick)
─────────────────────────────────────────────────────           ───────────────────────────────────────
bridge/github-issues.js   created comment  → TASK_CREATED        github-bridge.flushNotifications():
                          claimed comment  → TASK_STARTED          WhatsApp flush  +  telegram-notify.flush()
bridge/github-bridge.js   finishTask()     → TASK_COMPLETED /        └ Bot API sendMessage, paced, retried,
                          (terminal report)  TASK_FAILED /             recorded in a local ledger (outside Git)
                                             TASK_BLOCKED /
                                             HUMAN_APPROVAL
bridge/github-prs.js      pr-tick (poll)   → PR_OPENED / PR_UPDATED / PR_REVIEW / PR_CHECKS / PR_MERGED / PR_CLOSED
```

`enqueue()` writes at most one ledger entry and returns; a Telegram outage can never slow or fail the bridge tick that
reports the event. `flush()` runs after the tick has returned (and on demand via the CLI).

## 2. Events actually produced

| Kind | Producer | When | Message content |
|---|---|---|---|
| `TASK_CREATED` | `github-issues.js` (the "created" comment site) | an Issue is converted to a PENDING task | Issue number, Issue title (≤300 chars) |
| `TASK_STARTED` | `github-issues.js` (the "claimed" comment site) | the bridge claims the task | Issue number, model name |
| `TASK_COMPLETED` / `TASK_FAILED` / `TASK_BLOCKED` | `github-bridge.js` `finishTask()` | a terminal report is written | Issue number (or task id), report summary or blocker reason, model; failed/blocked add "👉 المطلوب: مراجعة/تدخل المالك" |
| `HUMAN_APPROVAL` | `github-bridge.js` `finishTask()` | a BLOCKED report the bridge already classified as needing a human decision | as above |
| `PR_OPENED` | `github-prs.js` | a PR is seen for the first time while open | PR number, title |
| `PR_UPDATED` | `github-prs.js` | an open PR's head commit changed | PR number, title |
| `PR_REVIEW` | `github-prs.js` | the latest decisive review state changed (APPROVED / CHANGES_REQUESTED; comments never override) | PR number, decision |
| `PR_CHECKS` | `github-prs.js` | the check-runs decision changed (success / failure / pending; no checks = no event) | PR number, decision |
| `PR_MERGED` / `PR_CLOSED` | `github-prs.js` | a tracked PR closed (merged or not); a PR first seen already closed also reports once | PR number, title |

Exclusion: a **Telegram-originated task** (`task.source.kind === 'telegram'`) is skipped by the `finishTask()` producer,
because `bridge/telegram.js` already sends its own correlated reply to the chat that created it. Sending both would
notify the owner twice for one event. CANCELLED and non-terminal statuses never notify.

### 2.1 Defined but NOT produced

The sink declares three more kinds — `GIT_BLOCKER`, `GOVERNANCE_BLOCKER`, `BRIDGE_FAILURE` — with message templates and
tests for their formatting, but **no code path enqueues them** in this branch. Issue #180 section 3 (git
synchronization / governance blocker / bridge or executor failure / production change events) is therefore **not
implemented**; wiring those producers (the relay's `GOVERNANCE DENY`, `RUNTIME_STALE_CHECKOUT`, tick errors) is a
separate stage.

Also not present: a "production deployment/change" event, and the Issue's "important tests results" event beyond
`PR_CHECKS`.

## 3. Filtering, deduplication, rate limiting

- **Dedup.** The ledger key is `(subject, kind)` (`gh-issue-180__TASK_COMPLETED`, `PR-186__PR_CHECKS`). An entry whose
  message content is unchanged and already `PENDING` or `SENT` is never written again. Changed content for the same key
  (a flipped check state, a different result) replaces the entry — dedup suppresses repetition, never a real state change.
- **Pacing.** `flush()` sends at least `MYTHOS_TELEGRAM_NOTIFY_MIN_GAP_MS` (default 1200 ms) apart and delivers at most
  `MYTHOS_TELEGRAM_NOTIFY_MAX_PER_FLUSH` (default 10) entries per flush; the rest wait for the next tick.
- **Retry.** A failed send backs off exponentially from `MYTHOS_TELEGRAM_NOTIFY_BACKOFF_MS` (default 20 s, cap 15 min)
  up to `MYTHOS_TELEGRAM_NOTIFY_MAX_ATTEMPTS` (default 6), then the entry is marked `EXHAUSTED` and logged. Failure and
  blocker kinds are never dropped by pacing or the per-flush cap; they queue like everything else.
- **Kind filter.** `MYTHOS_TELEGRAM_NOTIFY_EVENTS` (comma-separated kinds) restricts which kinds are enqueued at all.
- **PR API budget.** `github-prs.js` touches at most `MYTHOS_PR_MAX_PER_TICK` (15) PRs per tick and makes review/check-run
  calls only for PRs whose head commit changed, capped by `MYTHOS_PR_MAX_DETAIL_CALLS` (10). A backlog is drained over
  several ticks, never in one burst. Per-recipient delivery is tracked (`delivered_to`), so a partial failure resends
  only to the recipients that did not get the message.

## 4. Security and redaction

- **No token in messages, ledger or logs.** The bot token is read at flush time through `bridge/telegram.js`'s own
  `readToken()` (the existing 0600 file bound by reference) and held in the client closure.
- **No internal identifiers.** `formatMessage()` accepts only: subject label + Issue/PR number or task id, a short
  description/result/reason, an optional model name. Executor task ids, execution ids, OTHMODE numeric ids and host paths
  are never fields; OTHMODE is named only as "نظام حماية/مراقبة MYTHOS". The test suite asserts their absence from every
  delivered message and from the ledger.
- **Shared redaction.** Every message passes `mythos-orchestrator/lib/redact.js` (`redact()`) before it is stored or
  sent; every ledger/log write passes `redactValue()`; every error string is redacted before it is recorded.
- **Recipients are not widened.** Default recipients are exactly `MYTHOS_TELEGRAM_ALLOWED_USER_IDS` (the existing
  allowlist). `MYTHOS_TELEGRAM_NOTIFY_CHAT_IDS` is an explicit owner override, never an expansion made by the code.
- **PR poller is read-only.** `github-prs.js` issues `GET` only (`/pulls`, `/pulls/:n/reviews`, `/commits/:sha/check-runs`)
  with the Issues adapter's token; it never comments, labels, reviews, merges or closes.
- **Local state outside Git.** Ledger and PR state live under the bridge home (`telegram-notify/ledger/`, `prs/state.json`),
  0700 directories, 0600 files, atomic writes. Nothing under `control/` is touched.

## 5. Feature flags and defaults

| Variable | Default | Meaning |
|---|---|---|
| `MYTHOS_TELEGRAM_NOTIFY_ENABLED` | unset (**off**) | `1` enables enqueue + flush of the unified sink |
| `MYTHOS_PR_NOTIFY_ENABLED` | unset (**off**) | `1` makes `tick` run the PR poll after the Issues phase |
| `MYTHOS_TELEGRAM_NOTIFY_EVENTS` | all kinds | restrict to a comma-separated subset |
| `MYTHOS_TELEGRAM_NOTIFY_CHAT_IDS` | empty → allowlist | explicit recipient override (numeric chat ids) |
| `MYTHOS_TELEGRAM_NOTIFY_MIN_GAP_MS` / `_MAX_PER_FLUSH` / `_MAX_ATTEMPTS` / `_BACKOFF_MS` | 1200 / 10 / 6 / 20000 | pacing and retry |
| `MYTHOS_TELEGRAM_NOTIFY_HOME` | `<bridge home>/telegram-notify` | ledger location |
| `MYTHOS_PR_MAX_PER_TICK` / `MYTHOS_PR_MAX_DETAIL_CALLS` / `MYTHOS_PR_HTTP_TIMEOUT_MS` | 15 / 10 / 20000 | PR poll budget |

With both flags unset the branch changes nothing observable: `enqueue()` returns `skipped: telegram notifications
disabled`, `flush()` returns `enabled: false`, and `tick` does not call the PR poller.

## 6. Activation (owner step — NOT done)

Same pattern as `docs/MYTHOS_TELEGRAM_CHANNEL.md` §9.3: a deploy-owned drop-in for the user unit
`mythos-github-bridge.service` (e.g. `~/.config/systemd/user/mythos-github-bridge.service.d/telegram-notify.conf`) adding
`Environment=MYTHOS_TELEGRAM_NOTIFY_ENABLED=1` and, if PR notifications are wanted, `Environment=MYTHOS_PR_NOTIFY_ENABLED=1`,
then `systemctl --user daemon-reload`. Prerequisites: the existing Telegram channel's token file and allowlist
(`telegram.conf`), and the Issues adapter token for the PR poll. The 1-minute timer then runs enqueue during `tick` and
flush at its end. Rollback: remove the drop-in, `daemon-reload`. Nothing else changes; WhatsApp is untouched.

CLI (all read-only except `flush`, which sends due entries): `mythos-github-bridge notify-telegram-config`,
`notify-telegram-status`, `notify-telegram-flush`, `pr-config`, `pr-status`, `pr-tick [--no-detail]`.

## 7. Tests

| Suite | Covers | Result (2026-09-05, run as deploy on `cc218b2`) |
|---|---|---|
| `tests/mythos-telegram-notify-test.js` | flags off = enqueue/flush no-ops and no Bot API request; message formatting per kind (OTHMODE named generically); `kindForReport`/`fieldsFromReport`; dedup (unchanged vs changed content, SENT never resent); pacing gap, per-flush cap and deferred remainder; transient failure → retry, blocker eventually delivered; no token / OTHMODE id / path in messages or ledger; operator surface | 44 / 0 |
| `tests/mythos-github-prs-test.js` | pure review/checks decisions; opened → updated → review → checks → merged sequence against a fake GitHub API; closed-without-merge; unchanged repeat tick queues nothing; never a non-GET request; disabled unless `MYTHOS_PR_NOTIFY_ENABLED=1` | 20 / 0 |
| `tests/mythos-telegram-notify-integration-test.js` | real wiring through the bridge and the Issues adapter with a fake Bot API: a plain task's terminal report is enqueued, a Telegram-originated task is excluded, intake enqueues `TASK_CREATED` with the Issue number in the same tick | 5 / 0 |
| Existing: `mythos-github-bridge` 150/0, `mythos-github-issues` 208/0, `mythos-telegram-channel` 68/0, `mythos-bridge-whatsapp-notify` 131/0, `mythos-bridge-whatsapp-resilience` 101/0, `mythos-governance-invariant` 111/0, `redact-governance-false-positive` 199 checks | regression | all pass |

No live end-to-end test has been run: no message from this code has reached a real Telegram chat.

## 8. Known limitations

- Section 2.1: git/governance/bridge-failure and production-change events are not produced.
- `PR_CHECKS` reads the check-runs API only; repositories using classic commit statuses never trigger it.
- The first `pr-tick` after activation reports every PR it sees (open → `PR_OPENED`; already closed → one
  `PR_MERGED`/`PR_CLOSED`), bounded by the per-tick caps, spread over several ticks.
- Delivery is at-least-once per `(subject, kind, content)`; a crash between a successful send and the ledger write can
  repeat one message on the next flush.
- Not merged, not deployed, not live-verified. Issue #180's Definition of Done items that require events to actually
  reach Telegram and production integration to be verified remain open until an owner activates and observes it.
