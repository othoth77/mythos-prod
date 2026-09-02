# Report gh-issue-101-r2 — COMPLETED

| Field | Value |
|---|---|
| Completed | 2026-09-02T23:56:32.121Z |
| Executor task | `t-20260902233505-abdgit` |
| OTHMODE task | `OTH-2026-00030` |
| Profile | repo-write |
| Branch | `mythos/gh/gh-issue-101-r2` |
| Commits on origin | true |
| Git verified | true |

## Summary

Implemented the MYTHOS Resource Guard on top of the gh-issue-101 investigation rather than re-investigating. New lib/resource-guard.js reads MemAvailable (/proc/meminfo), PSI memory some avg60 (/proc/pressure/memory) and the oom_kill delta (/proc/vmstat) and runs a NORMAL/WARNING/CRITICAL machine with RECOVERED as the one-shot alert on the degraded->NORMAL edge; swap is carried in every sample for display and read by no threshold. Thresholds are exactly those the investigation derived (CRITICAL enter <=700M || psi60>=30 || kill delta>0, exit >=1100M && <=10 && no kills; WARNING enter <=1200M || >=5, exit >=1600M && <=2), with 2-sample escalation, 5-sample de-escalation and a 30-min per-kind alert cooldown; an oom_kill delta escalates on the first sample because a kill is a confirmed event, and leaving CRITICAL still costs the full 5 samples. Enforcement is admission only — nothing is killed and no status was invented: the gate is in executor.js tick() step 4 (the admission path requested_by='github-bridge' actually uses, which the investigation found ungated), in dispatchTask() before the capacity check, and inside drainQueue() per iteration; tick() steps 1-3 stay exempt so in-flight work remains resumable, and a refused task stays QUEUED with one dispatch_deferred/reason=resource_pressure event per 10 minutes. drainQueue() is now also called once per daemon step, fixing the edge-trigger-only defect so the queue re-drains after recovery without a manual re-queue. Everything fails open (unreadable /proc, corrupt state, unwritable store admit; 5 blind samples release a degraded level) and MYTHOS_RESOURCE_GUARD=off disables the layer. Added GET /resource-guard, bin/mythos-resource-guard (status|sample|replay) and docs/MYTHOS_RESOURCE_GUARD.md. Validation ran the production decision function over 911 real /opt/mythos-memwatch samples: CRITICAL from 2026-09-01 21:03 through the 22:16-22:18 mass kill until 2026-09-02 02:16, admission already closed before every kill burst, and NORMAL across the healthy remainder at 96-100% swap. WhatsApp alerting was deliberately not wired (its module lives on the sibling branch b37491f whose merge is an owner decision); alerts go through the existing notify.sh and are durably appended to resource-guard-alerts.jsonl. No governance-protected path was touched and no push was performed.

## Commits

- `dad5385a2acb1532178e51e9c11c0b3629c51975` docs(resource-guard): handover for gh-issue-101 — Resource Guard live in 19e3d8a (on origin)
- `19e3d8ac14146b8a15599aa554b43b22adcedec0` feat(executor): MYTHOS Resource Guard — memory-pressure admission control (on origin)

## Files changed

- `projects/mythos-ai-executor/lib/resource-guard.js`
- `projects/mythos-ai-executor/bin/mythos-resource-guard`
- `projects/mythos-ai-executor/executor.js`
- `projects/mythos-ai-executor/server.js`
- `tests/resource-guard-test.js`
- `tests/fixtures/resource-guard/memwatch-outage.txt`
- `tests/fixtures/resource-guard/memwatch-healthy.txt`
- `tests/mythos-ai-executor-test.js`
- `tests/mythos-github-bridge-test.js`
- `docs/MYTHOS_RESOURCE_GUARD.md`
- `docs/AI_HANDOVER.md`

## Tests

- tests/resource-guard-test.js (new): 91 passed, 0 failed
- tests/mythos-ai-executor-test.js: 265 passed, 0 failed
- tests/mythos-github-bridge-test.js: 97 passed, 0 failed
- tests/mythos-github-issues-test.js: 102 passed, 0 failed with the ambient MYTHOS_GITHUB_MCP_RW_TOKEN removed; 100 passed, 2 failed with it present (pre-existing environment failure recorded under gh-issue-100, unrelated to this change)
- tests/model-selection-policy-test.js: 75 passed, 0 failed
- tests/mos-1-console-test.js: 1438 passed, 0 failed
- tests/mos-v2-regression-test.js: PASS (4 suites, 20/20 areas, 0 new failures)
- node --check on lib/resource-guard.js, executor.js, server.js, bin/mythos-resource-guard: clean
- historical replay of /opt/mythos-memwatch/memwatch.log (911 samples) through the production evaluate(): 10 transitions, CRITICAL 2026-09-01T21:03 -> 2026-09-02T02:16 covering the mass kill, NORMAL for the healthy remainder
- live host smoke via bin/mythos-resource-guard sample/status (isolated store): NORMAL, avail 2416 MiB, psi60 0.00, swap 96.2%

## Validation

- required checks: none
- remote head: dad5385a2acb1532178e51e9c11c0b3629c51975
- report problems: none

## Problems

- none

## Risks

- Not deployed: the running mythos-ai-executor.service keeps its previous behaviour until this branch is merged and the service restarts. Both commits are local to the task branch; origin/mythos/gh/gh-issue-101-r2 is still at the base commit e0e22d4 pending the governance relay (fast-forward only, every 5 min).
- OWNER DECISION — WhatsApp: bridge/notify/whatsapp.js exists only on sibling branch b37491f, whose tree also deletes bridge/github-issues.js. Until that merge is decided there is no WhatsApp delivery; alerts are durable in resource-guard-alerts.jsonl so nothing is lost, but its KINDS/KEY_RE fence would also need widening for WARNING/CRITICAL/RECOVERED.
- OWNER APPROVAL — essential-service protection (MemoryLow= on production units, MemoryHigh= on AI units) is under projects/mythos-ai-executor/service/ (governance-protected) and ~deploy/.config/systemd/user/; no agent may install it. The guard therefore stops MYTHOS from adding pressure but cannot decide who loses memory first.
- The dominant consumer is outside MYTHOS control (root agent session scopes at 2-2.5 GB vs the executor's ~0.5-0.7 GB), so MYTHOS work can be deferred for pressure MYTHOS did not cause — the replay contains one such ~5h CRITICAL stretch on 2026-09-01.
- Thresholds were tuned against ~30h of telemetry containing one severe episode; they are now exercised by the committed fixtures, but a second episode may justify re-tuning.
- tests/mythos-ai-executor-test.js and tests/mythos-github-bridge-test.js now set MYTHOS_RESOURCE_GUARD=off so their dispatch assertions do not depend on the host's live memory; guard behaviour on those same paths is covered deterministically in tests/resource-guard-test.js.

## Next recommended action

Let the governance relay deliver 19e3d8a + dad5385 to origin/mythos/gh/gh-issue-101-r2, then the owner merges to main and restarts mythos-ai-executor.service to activate the guard on the running host; separately decide the b37491f WhatsApp branch integration and install the systemd MemoryLow=/MemoryHigh= protection.
