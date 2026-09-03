# Report gh-issue-144 — COMPLETED

| Field | Value |
|---|---|
| Completed | 2026-09-03T20:33:40.650Z |
| Executor task | `t-20260903200643-0oduuq` |
| OTHMODE task | `OTH-2026-00068` |
| Attempt | `gh-issue-144#1` |
| Action | implement (source action_label, written "implement") |
| Profile | repo-write |
| Blocker | — |
| Runtime | `ff9f71b51e41` on `main` |
| Model | `claude-opus-5` (auto:deep→opus score=9 [execution_profile:repo-write+2 task_category:implement+3 complexity_terms(concurrency,أمان,إعادة تصميم)+3 required_tests>=3+1]) |
| Branch | `mythos/gh/gh-issue-144` |
| Commits on origin | true |
| Git verified | true |

## Summary

Implemented the Claude Desktop Remote session lifecycle guard for GitHub Issue #144. Root cause confirmed by direct read-only /proc capture on this VPS, not inferred: 14 root-owned ccd-cli sessions holding 2615 MiB as children of the remote server, which has no idle timeout or concurrency ceiling and is not ours to change. Added lib/session-guard.js (classification with executor-precedence so the MYTHOS executor's own claude -p subprocess can never be signalled; pid:starttime identity with re-verification immediately before each signal; states active/idle/orphaned/terminating from three ORed activity signals; four rules each declaring its own required inactivity; eleven fences; blast radius 3 per run; SIGTERM then SIGKILL after a 120s grace; fail-closed), bin/mythos-session-guard, a strictly read-only GET /session-guard, and ops/session-guard/ (root runner, hardened oneshot unit, 5-minute timer, user-0.slice MemoryHigh=2G soft ceiling with MemoryMax deliberately unset, installer, runbook). Fixed a real gap found mid-build: the idle rule keyed off the state label instead of measured inactivity, which would have made the pressure-lowered threshold unreachable and the memory guard a no-op. Nothing was installed and no session was terminated, as the issue requires; the timer runs in observe mode and enforcement is a separate marker file with rm as rollback. Two limitations stated rather than hidden: the concurrency ceiling cannot be enforced at admission (the remote server exposes no hook, so admission() is flagged advisory:true and the ceiling is enforced by reclamation), and the PR to main could not be opened because gh requires an approval this non-interactive session cannot obtain.

## Commits

- `098389408dea55f6c2ab2c49899311b90175325b` feat(session-guard): bound Claude Desktop Remote session accumulation (gh-issue-144) (on origin)

## Files changed

- `projects/mythos-ai-executor/lib/session-guard.js`
- `projects/mythos-ai-executor/bin/mythos-session-guard`
- `projects/mythos-ai-executor/executor.js`
- `projects/mythos-ai-executor/server.js`
- `ops/session-guard/mythos-session-guard-run.js`
- `ops/session-guard/mythos-session-guard.service`
- `ops/session-guard/mythos-session-guard.timer`
- `ops/session-guard/user-0.slice.d/memory.conf`
- `ops/session-guard/install-session-guard.sh`
- `ops/session-guard/README.md`
- `docs/MYTHOS_SESSION_GUARD.md`
- `docs/AI_HANDOVER.md`
- `tests/session-guard-test.js`
- `tests/fixtures/session-guard/host-20260903.json`

## Tests

- tests/session-guard-test.js: 274 passed, 0 failed (offline, deterministic, no real process signalled)
- tests/mythos-ai-executor-test.js: 390 passed, 0 failed
- tests/resource-guard-test.js: 91 passed, 0 failed
- tests/mythos-github-bridge-test.js: 150 passed, 0 failed
- tests/mythos-governance-invariant-test.js: 111 passed, 0 failed
- tests/mos-1-console-test.js: 1438 passed, 0 failed
- tests/mythos-hostops-test.js: 39 passed, 0 failed, 2 skipped
- live read-only probe: 14 ccd-cli sessions / 2 servers / executor processes classified correctly, 2615 MiB resident, over ceiling by 8, zero actions on first observation

## Validation

- required checks: لا تبقى جلسات Claude الخاملة إلى أجل غير محدود.; توجد آلية lifecycle/cleanup قابلة للإثبات والاختبار.; توجد حماية concurrency واضحة.; توجد حماية من memory pressure قبل الوصول إلى OOM.; لا يتم الخلط بين جلسات Desktop Remote وClaude subprocesses الخاصة بـExecutor.; كل تغيير موثق في `docs/AI_HANDOVER.md`.; Commit + push عبر المسار المعتمد، مع تسجيل commit hash وremote HEAD ونتائج الاختبارات.; بعد التنفيذ: فتح PR طبيعي إلى `main`؛ لا auto-merge.
- remote head: 098389408dea55f6c2ab2c49899311b90175325b
- report problems: none

## Problems

- none

## Risks

- The concurrency ceiling is enforced by reclamation, not admission: the closed Desktop Remote server exposes no admission hook, so nothing can refuse its fork. A breach that cannot be resolved without touching a working session is reported as unreclaimable and left alone.
- Idle detection is CPU/RSS/transcript-based. A session genuinely blocked on network I/O for over an hour with no transcript growth would read as idle; min_age, single_observation, has_child_processes and the SIGTERM-first escalation are the mitigations, and the observe-mode rollout exists to catch this on real traffic before enforcement.
- The transcript activity signal requires root; running the CLI as deploy silently loses it (degrades to null, never to a wrong answer), so a deploy-side plan is strictly more conservative than the root unit's.
- The executor protection class is deliberately over-inclusive: any argv mentioning mythos-ai-executor is protected. A ccd-cli session whose argv happened to contain that string would never be reclaimed - a false negative, chosen over the alternative.
- The installed copy under /usr/local/lib is a snapshot; a merged change to lib/session-guard.js or the runner does nothing until the installer is re-run. Documented in three places.
- user-0.slice MemoryHigh=2G is a throttle on all root login sessions, not just Claude ones, and will slow root interactive work under pressure. It is a separate, clearly-labelled owner decision, not part of the default install.

## Next recommended action

Open a normal PR from mythos/gh/gh-issue-144 to main with no auto-merge (not done here: gh requires an approval this non-interactive session cannot obtain). After merge, the owner runs `sudo bash ops/session-guard/install-session-guard.sh`, watches `journalctl -u mythos-session-guard.service -f` and /var/lib/mythos-session-guard/session-guard.jsonl in observe mode for several hours to confirm the planned targets and veto reasons are right for this host, then `touch /var/lib/mythos-session-guard/session-guard.enabled`. The user-0.slice memory ceiling is a separate later decision. The executor's `Failed at step GROUP` note is unrelated to this lifecycle problem and needs its own issue.
