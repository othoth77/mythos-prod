# MYTHOS notification presenter (gh-issue-191)

One presentation layer for every outbound owner notification —
`projects/mythos-ai-executor/bridge/notify/presenter.js`. WhatsApp
(`notify/whatsapp.js`), the Telegram unified event notifier
(`notify/telegram-events.js`) and the Telegram channel report reply
(`telegram.js`) all render through it; a channel decides only transport.
Telegram remains **disabled in production** (`MYTHOS_TELEGRAM_ENABLED=0`);
its adapters stay compatible and are covered by offline regression tests only.

## Format (owner decision 2026-09-05)

```
🟢 MYTHOS COMPLETED — gh-issue-123          ← 1. level icon · kind · task id
الحالة: نجاح ✅                              ← state, in plain Arabic
ماذا حدث: <one short line from the report>   ← 2. what happened
الاختبارات: 15 ناجحة (2 مجموعة)              ← counts only, never the list
[السبب: <blocker code — reason>]             ← CRITICAL / IMPORTANT only
[الخطوة التالية: <next step>]                ← CRITICAL / IMPORTANT only

ببساطة: <simple, non-technical Arabic>       ← 3. what it means
المطلوب منك: <action, or "لا شيء حالياً.">   ← 4. always explicit

model claude-sonnet-5 · guard: MYTHOS protection/monitoring active

📄 التفاصيل: control/reports/gh-issue-123.md (فرع mythos/control)   ← 5. reference only
```

| Level | Icon | When |
|---|---|---|
| CRITICAL | 🔴 | FAILED, BLOCKED, `task:failed/blocked`, `pr:checks_failed/conflict`, `git:sync_blocker/governance_blocker/bridge_failure` |
| IMPORTANT | 🟠 | HUMAN_APPROVAL (a human decision is required) |
| INFO / SUCCESS | 🟢 | COMPLETED, created/claimed, PR opened/merged/…, deploy |

Rules: no branch names, file lists, commit shas, executor / OTHMODE / execution
ids, host paths, rate-limit or log detail in a normal message — those stay in
the report, `docs/AI_HANDOVER.md` and the ledgers. The presenter strips
identifiers (`stripInternal`) and runs the governance redactor on every text;
the same input always yields the same text, so channel ledgers can hash it
(WhatsApp `message_sha256`). Nothing is removed from the underlying data —
presentation only.

## API

- `presentReport(report, kind, { model, guard, details_ref: 'path'|'none' })` →
  `{ level, icon, kind, task_id, lines, text }` — kinds COMPLETED / FAILED /
  BLOCKED / HUMAN_APPROVAL / CANCELLED. WhatsApp uses `details_ref: 'path'`;
  the Telegram channel reply uses `'none'` (no report path in a chat).
- `presentEvent({ category, event, id, status, title, result, next_action, model, guard, critical })` →
  `{ level, icon, event, lines, text }` — the unified Telegram event set.
- `stripInternal(text)` — shared identifier/path stripping (re-exported by
  `telegram-events.js` for compatibility).

## Tests

`tests/notification-presenter-test.js` (70/0): the four kinds + CANCELLED,
levels, Arabic explanation and owner action present, length bound, no
id/path/secret/sha/file/branch leak, redaction in summary / next action /
problems, determinism, WhatsApp `buildMessage` = presenter text, WhatsApp
ledger dedup (second identical report not queued), HUMAN_APPROVAL as
IMPORTANT, every Telegram event kind through `formatEvent`, and Telegram
compatibility **without activation** (`notifyEvent` → `disabled`, no ledger).
Channel suites updated to the format: whatsapp-notify 143/0,
telegram-events 54/0, telegram-channel 68/0.
