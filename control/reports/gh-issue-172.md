# Report gh-issue-172 — COMPLETED

| Field | Value |
|---|---|
| Completed | 2026-09-05T01:28:31.228Z |
| Executor task | `t-20260905010513-4c5yeh` |
| OTHMODE task | `OTH-2026-00170` |
| Attempt | `gh-issue-172#1` |
| Action | implement (source explicit_current_issue, written "implement") |
| Profile | repo-write |
| Blocker | — |
| Runtime | `0e852103f050` on `main` |
| Model | `claude-fable-5-1` (explicit:fable-5.1 (requested "fable-5.1")) |
| Branch | `mythos/gh/gh-issue-172` |
| Commits on origin | true |
| Git verified | false |

## Summary

MYTHOS AUTO customer WhatsApp/CRM architecture delivered: Chatwoot selected (live-verified) as the inbox/CRM, WaCRM rejected, Evolution kept only as the #170 notification gateway; provider-independent boundary built in projects/automotive/comms (envelope, multi-project config, Chatwoot adapter, router with business-handler boundary, auto_reply default OFF, CLI dry-run that never sends), bridge/notify untouched and separation asserted by test. CRM deployment BLOCKED on host resources (2,729 MiB available, 557 MiB swap free vs Chatwoot 4 GB + 1 GB swap) and not attempted; no WhatsApp message sent, no gateway added.

## Commits

- `601f0cc15e67930bd4c172cd92febee3c67caf3a` feat(automotive): MYTHOS AUTO WhatsApp CRM / business communication architecture (gh-issue-172) (on origin)

## Files changed

- `projects/automotive/comms/README.md`
- `projects/automotive/comms/config/comms.example.json`
- `projects/automotive/comms/bin/mythos-auto-comms`
- `projects/automotive/comms/lib/envelope.js`
- `projects/automotive/comms/lib/projects.js`
- `projects/automotive/comms/lib/router.js`
- `projects/automotive/comms/lib/crm/index.js`
- `projects/automotive/comms/lib/crm/chatwoot.js`
- `tests/mythos-auto-comms-test.js`
- `docs/MYTHOS_AUTO_WHATSAPP_CRM_ARCHITECTURE.md`
- `docs/AI_HANDOVER.md`
- `docs/CHANGELOG.md`
- `projects/command-center/data/open-source-registry.json`

## Tests

- tests/mythos-auto-comms-test.js: 113 passed, 0 failed (new)
- tests/mythos-bridge-whatsapp-notify-test.js: 131 passed, 0 failed (before and after)
- tests/mythos-bridge-whatsapp-resilience-test.js: 101 passed, 0 failed (before and after)
- tests/whatsapp-gateway-verify-test.js: 24 passed, 0 failed (before and after)
- tests/bridge-action-resolution-test.js: 88 passed, 0 failed (before and after)
- git diff --check: clean
- redact.findSecretKinds on all new files: no credential-shaped literal

## Validation

- required checks: [ ] Task was picked up through the normal Bridge/OTHMODE/Governance/Executor path.; [ ] Current repository state was inspected before modification.; [ ] Customer communication is separated from operational notifications.; [ ] WhatsApp provider boundary remains replaceable.; [ ] MYTHOS remains the intelligence/orchestration layer.; [ ] Mature CRM functionality is not unnecessarily duplicated.; [ ] No second uncontrolled WhatsApp gateway was created.; [ ] Official WhatsApp API preference and provider trade-offs are documented.; [ ] VPS resource/permission constraints were verified before deployment.; [ ] No secrets were committed or exposed.; [ ] No governance/security boundary was bypassed.; [ ] Relevant tests pass.; [ ] Existing Bridge/OTHMODE/Governance functionality has no regression.; [ ] `docs/AI_HANDOVER.md` is updated.; [ ] Implementation is committed and pushed through the governed relay.
- remote head: 0e852103f050880921e5ac81669ffee24185a3ca
- report problems: none

## Problems

- none

## Risks

- Chatwoot deployment BLOCKED on host resources (4 GB + 1 GB swap minimum vs 2,729 MiB available, 557 MiB swap free); owner must choose a second VPS / managed Chatwoot behind the private fence or raise RAM and resolve the swap exhaustion
- No HTTP receiver service yet: the Chatwoot webhook path is exercised only by handleWebhook() in tests and the CLI dry-run
- Chatwoot message_created payload shape verified from source at v4.17.1, not from a live instance; the first real (redacted) webhook body must become the fixture
- Automotive business engine not built: every project runs handler=handoff, auto_reply=false
- Evolution notification drop-in (#170 §5-§6) still not installed by the owner; unrelated to this layer
- remote_head is the origin branch at report time (base 0e85210): the governance relay had not yet delivered commit 601f0cc

## Next recommended action

Owner: decide CRM hosting (second VPS / managed Chatwoot reachable over a private address, or RAM increase + swap resolution) and the WhatsApp provider per project (official Meta Cloud API preferred); then open AUTO-COMMS-1 — Chatwoot receiver service (loopback/private bind, calls router.handleWebhook, records evidence, hands the envelope to the governed path) + execution of the owner runbook in docs/MYTHOS_AUTO_WHATSAPP_CRM_ARCHITECTURE.md §9.
