# Report gh-issue-156 — BLOCKED

| Field | Value |
|---|---|
| Completed | 2026-09-04T12:40:51.622Z |
| Executor task | `t-20260904123013-2yu4v5` |
| OTHMODE task | `OTH-2026-00075` |
| Attempt | `gh-issue-156#1` |
| Action | implement (source action_label, written "implementation") |
| Profile | repo-write |
| Blocker | `HUMAN_APPROVAL` Verified the merged trust gate at 5b995e9: both ledgers present, scanners resolve, skill-trust-cli verify → VERIFY OK (31/31 ACCEPT), offline suite 130/0 plus othmode-2 147/0, othmode-3 94/0, mcp-ecosystem 168/0, executor 390/0, gate enforcement demonstrated offline with the real ledger, baseline 4/ |
| Runtime | `4ffb8d203f37` on `main` **RUNTIME_STALE_CHECKOUT** |
| Model | `claude-fable-5-1` (explicit:fable-5.1 (requested "fable-5.1")) |
| Branch | `mythos/gh/gh-issue-156` |
| Commits on origin | true |
| Git verified | false |

## Summary

Verified the merged trust gate at 5b995e9: both ledgers present, scanners resolve, skill-trust-cli verify → VERIFY OK (31/31 ACCEPT), offline suite 130/0 plus othmode-2 147/0, othmode-3 94/0, mcp-ecosystem 168/0, executor 390/0, gate enforcement demonstrated offline with the real ledger, baseline 4/4 re-checked, no MYTHOS_SKILL_TRUST bypass in any production env. Production activation itself could not be executed: the runtime checkout /home/deploy/projects/mythos-prod is stale at 4ffb8d2 and can only be fast-forwarded by the root-only `sudo mythos-deploy deploy othmode` (the bridge also forbids this session from touching that checkout), and every `systemctl --user` call (restart/status) was refused as requiring approval. Live probes confirm pre-gate code is running (/api/othmode/trust → 404; executor and command-center healthy). No service was restarted, no unrelated service or WhatsApp gateway touched, Semgrep/policy/baseline unchanged. Evidence and the exact owner runbook recorded in docs/AI_HANDOVER.md, committed as 8d4faf5 (relay delivery pending); OTHMODE task OTH-2026-00075 advanced to VERIFICATION with full sections, terminal status left to the bridge.

## Commits

- `8d4faf5daf8bffc2493bd0d88d19029bd464b684` docs(handover): gh-issue-156 — Skill Trust Gate production activation BLOCKED: offline verify/suites/gate proven, runtime checkout stale (4ffb8d2), restarts need root/approval (on origin)

## Files changed

- `docs/AI_HANDOVER.md`

## Tests

- skill-trust-cli.js verify: VERIFY OK (31/31 ACCEPT, exit 0)
- tests/skill-trust-test.js: 130 passed, 0 failed
- tests/othmode-2-platform-test.js: 147 passed, 0 failed
- tests/othmode-3-tasks-test.js: 94 passed, 0 failed
- tests/mcp-ecosystem-test.js: 168 passed, 0 failed
- tests/mythos-ai-executor-test.js: 390 passed, 0 failed
- runtime checkout at 5b995e9 or descendant: FAILED (4ffb8d2, stale)
- services restarted and healthy: NOT PERFORMED (systemctl refused)
- GET /api/othmode/trust live: FAILED (404, pre-gate code)
- executor gate enforced in production: NOT CONFIRMED (proven offline only)
- no production bypass: PASSED (MYTHOS_SKILL_TRUST absent from all env files)
- no unrelated service / no WhatsApp deployment: PASSED
- docs/AI_HANDOVER.md activation evidence: committed

## Validation

- required checks: [ ] Runtime is deployed at merge commit `5b995e9562df5cbf1603a571eb3bdb891460fca3` or an exact descendant on `main`.; [ ] Both trust ledgers exist and verify successfully.; [ ] Offline trust and relevant regression suites pass.; [ ] `mythos-ai-executor` is active/healthy after restart.; [ ] `mythos-command-center.service` is active/healthy after restart.; [ ] `/api/othmode/trust` is live and returns expected trust data.; [ ] Executor trust enforcement is confirmed in production.; [ ] No production trust bypass is enabled.; [ ] No unrelated services were restarted.; [ ] No WhatsApp gateway deployment occurred.; [ ] `docs/AI_HANDOVER.md` contains production activation evidence.; [ ] Verification changes are committed and pushed through the normal governance relay.
- remote head: 5b995e9562df5cbf1603a571eb3bdb891460fca3
- report problems: none

## Problems

- HUMAN_APPROVAL: Verified the merged trust gate at 5b995e9: both ledgers present, scanners resolve, skill-trust-cli verify → VERIFY OK (31/31 ACCEPT), offline suite 130/0 plus othmode-2 147/0, othmode-3 94/0, mcp-ecosystem 168/0, executor 390/0, gate enforcement demonstrated offline with the real ledger, baseline 4/4 re-checked, no MYTHOS_SKILL_TRUST bypass in any production env. Production activation itself could not be executed: the runtime checkout /home/deploy/projects/mythos-prod is stale at 4ffb8d2 and can only be fast-forwarded by the root-only `sudo mythos-deploy deploy othmode` (the bridge also forbids this session from touching that checkout), and every `systemctl --user` call (restart/status) was refused as requiring approval. Live probes confirm pre-gate code is running (/api/othmode/trust → 40

## Risks

- Production still runs pre-gate code: executor skills are selected without trust verification until the owner deploys and restarts
- SkillSpector baseline (4 false-positive fingerprints) still awaits owner sign-off
- Commit 8d4faf5 is on the local mission branch until mythos-git-push.timer delivers it

## Next recommended action

Owner: `sudo mythos-deploy deploy othmode` (ff runtime checkout to 5b995e9), then as deploy `systemctl --user restart mythos-ai-executor mythos-command-center.service`, verify `GET 127.0.0.1:3021/api/othmode/trust` → 200 and journal free of UNTRUSTED/bypass lines, then re-run the #156 acceptance checks
