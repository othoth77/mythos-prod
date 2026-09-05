# Report gh-issue-173 — COMPLETED

| Field | Value |
|---|---|
| Completed | 2026-09-05T02:14:30.649Z |
| Executor task | `t-20260905014252-3igcmy` |
| OTHMODE task | `OTH-2026-00171` |
| Attempt | `gh-issue-173#1` |
| Action | implement (source explicit_current_issue, written "implement") |
| Profile | repo-write |
| Blocker | — |
| Runtime | `0e852103f050` on `main` |
| Model | `claude-fable-5-1` (explicit:fable-5.1 (requested "fable-5.1")) |
| Branch | `mythos/gh/gh-issue-173` |
| Commits on origin | true |
| Git verified | true |

## Summary

Issue #173: lightweight MYTHOS AUTO WhatsApp auto-reply engine built on #172's comms layer and the existing Evolution gateway (separate customer instance per project, mythos-bridge reserved), no Chatwoot, no second gateway. Deterministic intents, unconnected business-data port (factual questions -> human handoff), template-first generation with opt-in AI behind a fact guard, idempotency/loop-safety ledger, explicit outbound policy gate, loopback-only receiver (not deployed), simulate/classify/readiness CLI. Everything off by default; bridge/notify untouched; host re-verified; no customer message sent. Committed 13dbec2 on mythos/gh/gh-issue-173 (not pushed, not merged). AI_HANDOVER, CHANGELOG and architecture doc updated.

## Commits

- `13dbec2272adbbebca46360c47ea94222da3f7da` feat(automotive): lightweight WhatsApp auto-reply engine on the existing Evolution gateway (gh-issue-173) (on origin)
- `601f0cc15e67930bd4c172cd92febee3c67caf3a` feat(automotive): MYTHOS AUTO WhatsApp CRM / business communication architecture (gh-issue-172) (on origin)

## Files changed

- `projects/automotive/comms/lib/crm/evolution.js`
- `projects/automotive/comms/lib/crm/index.js`
- `projects/automotive/comms/lib/intents.js`
- `projects/automotive/comms/lib/business-data.js`
- `projects/automotive/comms/lib/ai/index.js`
- `projects/automotive/comms/lib/handlers/auto-reply.js`
- `projects/automotive/comms/lib/ledger.js`
- `projects/automotive/comms/lib/policy.js`
- `projects/automotive/comms/lib/engine.js`
- `projects/automotive/comms/lib/router.js`
- `projects/automotive/comms/lib/projects.js`
- `projects/automotive/comms/lib/envelope.js`
- `projects/automotive/comms/bin/mythos-auto-reply-receiver`
- `projects/automotive/comms/bin/mythos-auto-comms`
- `projects/automotive/comms/config/comms.evolution.example.json`
- `projects/automotive/comms/README.md`
- `tests/mythos-auto-reply-test.js`
- `tests/mythos-auto-comms-test.js`
- `docs/MYTHOS_AUTO_WHATSAPP_CRM_ARCHITECTURE.md`
- `docs/CHANGELOG.md`
- `docs/AI_HANDOVER.md`
- `projects/automotive/comms/config/comms.example.json`
- `projects/automotive/comms/lib/crm/chatwoot.js`
- `projects/command-center/data/open-source-registry.json`

## Tests

- tests/mythos-auto-reply-test.js: 169 passed, 0 failed (new)
- tests/mythos-auto-comms-test.js: 113 passed, 0 failed
- tests/mythos-bridge-whatsapp-notify-test.js: 131 passed, 0 failed (before = after)
- tests/mythos-bridge-whatsapp-resilience-test.js: 101 passed, 0 failed (before = after)
- tests/mythos-whatsapp-gateway-verify-test.js: 24 passed, 0 failed (before = after)
- tests/mythos-bridge-action-resolution-test.js: 88 passed, 0 failed (before = after)
- tests/mythos-whatsapp-gateway-boundary-test.js: 37 passed, 0 failed (before = after)
- git diff --check: clean

## Validation

- required checks: [ ] Task picked up through Bridge/OTHMODE/Governance/Executor.; [ ] #172 implementation inspected and reused.; [ ] No Chatwoot deployment.; [ ] No second WhatsApp gateway.; [ ] Customer messaging remains separate from operational notifications.; [ ] Lightweight Auto-Reply path implemented.; [ ] Provider remains replaceable.; [ ] Auto-Reply default remains OFF until governed activation.; [ ] Dry-run works without sending.; [ ] Human handoff exists.; [ ] No invented catalogue/stock/price/vehicle facts.; [ ] Duplicate/loop protection implemented.; [ ] VPS resource constraints verified before deployment.; [ ] No secrets exposed.; [ ] Relevant tests pass.; [ ] Existing Bridge/WhatsApp/OTHMODE functionality has no regression.; [ ] `docs/AI_HANDOVER.md` updated.; [ ] Commit pushed through governed relay.
- remote head: 13dbec2272adbbebca46360c47ea94222da3f7da
- report problems: none

## Problems

- none

## Risks

- Branch depends on #172 commit 601f0cc which is not yet in origin/main; #172 must be merged first (or together) — relay ff-only delivery.
- Live send path validated only against a loopback stub of the Evolution sendText API; first real dry-run against the gateway (owner action) may reveal payload/webhook shape differences in evolution-api v2.3.7.
- Evolution is an unofficial WhatsApp provider; account-ban risk is acknowledged per project via unofficial_acknowledged and remains the owner's decision.
- Business-data port is unconnected: until wired, every part/price/stock/order question is a human handoff with no reply unless send_handoff_ack is enabled.
- Receiver, customer instance, pairing, 0600 token files and webhook registration are Level-3 owner actions; nothing runs in production.

## Next recommended action

Merge #172 then #173; owner provisions a customer Evolution instance + tokens and runs the receiver in --dry-run; next task: connect the business-data port to the ssangyong.autos catalogue (verified facts for part/price/stock intents) and add a handoff surface for REQUIRES_HUMAN conversations.
