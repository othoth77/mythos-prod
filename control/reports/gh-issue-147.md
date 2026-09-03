# Report gh-issue-147 — COMPLETED

| Field | Value |
|---|---|
| Completed | 2026-09-03T21:26:10.562Z |
| Executor task | `t-20260903210503-47r19d` |
| OTHMODE task | `OTH-2026-00071` |
| Attempt | `gh-issue-147#1` |
| Action | implement (source action_label, written "implement") |
| Profile | repo-write |
| Blocker | — |
| Runtime | `5482db8c2dae` on `main` |
| Model | `claude-opus-5` (auto:deep→opus score=7 [execution_profile:repo-write+2 task_category:implement+3 complexity_terms(بنية,أمان)+2]) |
| Branch | `mythos/gh/gh-issue-147` |
| Commits on origin | true |
| Git verified | true |

## Summary

Separated 'WhatsApp is down' into four independent causes and fixed the three that are code. F2: bin/mythos-github-bridge tick took an early branch when MYTHOS_ISSUES_ENABLED=1 — the mode the deploy timer drop-in sets and the mode this task was dispatched through — and that branch never called flushNotifications(), so every terminal task wrote a ledger entry and nothing ever delivered it; both branches now flush with the same ordering guarantee. F3: a dead or hung gateway cost the tick FLUSH_LIMIT x recipients x TIMEOUT_MS every 2 minutes and burned MAX_ATTEMPTS on every queued notification, so a long outage destroyed them (EXHAUSTED) rather than delaying them; added a provider circuit breaker (3 consecutive transport/timeout/5xx failures open it for 5 min doubling to 30 min, a 4xx never counts, zero requests and zero attempts consumed while open, exactly one half-open probe, fails CLOSED on a corrupt state file, kill switch MYTHOS_BRIDGE_WHATSAPP_BREAKER=off, operator reset via notify-breaker-reset) plus a flush wall-clock budget checked between entries and between recipients; a budget cut consumes no attempt and is reported as deferred, and SENT now means every recipient is in delivered_to rather than 'this attempt had no failure' (a latent bug the budget would have made reachable). F4: onReport() required the credential but a REPORT is written once and never revisited, so an unreadable 0600 key file lost the notification permanently; readiness is now split into queue scope (provider, gateway address and the private-network fence, instance, recipients, adapter config — all still refuse to queue) and delivery scope (the credential only, re-read every flush). F1 — no WhatsApp gateway is deployed on this host — is NOT fixed and is reported as not fixed; deploying one is a privileged task and unsafe today (measured 2026-09-03 21:06 UTC: 1781 MiB available, swap 4095/4095 fully consumed). For provider independence, added providers/generic.js: the four things every gateway in this class differs in (URL path, auth header, JSON body field names, message-id location) are now configuration, its defaults reproduce the Evolution URL and body byte for byte (asserted by sending through both adapters to one recorder), and its body template is JSON-parsed BEFORE substitution so untrusted report text cannot inject JSON structure. NO provider was replaced: this run had no outbound research capability (WebSearch/WebFetch not granted, gh and curl not permitted), so wa-evolution — named explicitly in the issue — WAHA, MultiWA and WaSphere remain unverified; under the issue's own decision criterion that forces keeping Evolution API and hardening instead, which is what was done. Nothing was deployed, no service or unit changed, no credential written, no real WhatsApp message sent.

## Commits

- `26d36cf2ae077ea2f0d435b44a0e99b464441815` fix(bridge-notify): deliver WhatsApp in Issues mode, bound provider failure, drop provider lock-in (gh-issue-147) (on origin)

## Files changed

- `projects/mythos-ai-executor/bridge/notify/whatsapp.js`
- `projects/mythos-ai-executor/bridge/notify/providers/generic.js`
- `projects/mythos-ai-executor/bin/mythos-github-bridge`
- `tests/mythos-bridge-whatsapp-resilience-test.js`
- `tests/mythos-bridge-whatsapp-notify-test.js`
- `docs/MYTHOS_WHATSAPP_PROVIDER_STRATEGY.md`
- `docs/MYTHOS_BRIDGE_WHATSAPP_NOTIFY.md`
- `docs/AI_HANDOVER.md`
- `projects/command-center/data/open-source-registry.json`

## Tests

- tests/mythos-bridge-whatsapp-resilience-test.js (new): 95 passed, 0 failed (stable over 3 consecutive runs)
- tests/mythos-bridge-whatsapp-notify-test.js: 131 passed, 0 failed
- tests/mythos-github-bridge-test.js: 150 passed, 0 failed
- tests/mythos-github-issues-test.js: 193 passed, 0 failed
- tests/mythos-ai-executor-test.js: 390 passed, 0 failed
- tests/mythos-governance-invariant-test.js: 111 passed, 0 failed
- tests/bridge-action-resolution-test.js: 88 passed, 0 failed
- tests/mythos-unattended-policy-test.js: 53 passed, 0 failed
- tests/mythos-bridge-push-guard-test.js: 23 passed, 0 failed
- node --check on whatsapp.js, providers/generic.js, bin/mythos-github-bridge: clean
- JSON.parse on projects/command-center/data/open-source-registry.json: valid
- mythos-github-bridge notify-config executed on the changed tree: reports both providers, breaker state, and the new queue_problems split; no credential in output

## Validation

- required checks: none
- remote head: 26d36cf2ae077ea2f0d435b44a0e99b464441815
- report problems: none

## Problems

- none

## Risks

- SCOPE ITEM NOT MET: wa-evolution was not examined at all — WebSearch/WebFetch were not granted and gh/curl were not permitted in this run, so no upstream fact about any candidate could be verified. A networked session is required before any provider claim is made.
- F1 stands: no WhatsApp gateway is deployed, so end-to-end WhatsApp delivery is still unproven on this host. Everything up to the socket is proven against a real local HTTP server; the WhatsApp side is not.
- The F2 fix is guarded at source level only (the Issues path needs a GitHub token and network to run end to end). The guard prevents the branch from silently losing the flush call again, but does not prove a live Issues tick delivers a message.
- Deploying any gateway remains unsafe: swap is 4095/4095 fully consumed with 1781 MiB RAM available. The gh-issue-144 session guard that bounds the identified consumer is written but NOT installed.
- A gateway so slow that a flush can never fit its budget leaves entries PENDING indefinitely rather than failing them — visible in notify-status, but it raises no alarm.
- The breaker adds up to one cooldown of latency to the first notification after an outage, by design.
- The remote branch has not yet been fast-forwarded by the governance relay; remote_head above is the pre-commit base, observed via git ls-remote.

## Next recommended action

Owner review and merge of mythos/gh/gh-issue-147; then install the gh-issue-144 session guard and re-measure swap; then a networked session to live-verify wa-evolution/WAHA per docs/MYTHOS_WHATSAPP_PROVIDER_STRATEGY.md §6; only then deploy a gateway, drive it through providers/generic.js against a local recorder, and run `mythos-github-bridge notify-test --confirm` once. No auto-merge, no automatic production deployment.
