# Report gh-issue-99 — COMPLETED

| Field | Value |
|---|---|
| Completed | 2026-09-02T22:49:32.398Z |
| Executor task | `t-20260902224306-vaqeia` |
| OTHMODE task | `OTH-2026-00027` |
| Profile | repo-read |
| Branch | `mythos/gh/gh-issue-99` |
| Commits on origin | null |
| Git verified | null |

## Summary

Read-only investigation for gh-issue-99 (requested_action=investigate): no files edited, no commits, tree clean at dc45ff1. Measured the host directly: 7746 MiB RAM with 2604 MiB available, swap 4030/4095 MiB (98.4%) across two equal-priority swapfiles, Committed_AS 21.0 GiB against a 7.78 GiB CommitLimit (270% overcommit), cgroup v2 with cpu+memory+pids delegated to user@1001.service, PSI present at /proc/pressure and per-cgroup, and 1323 cumulative OOM kills (+403 in the last ~29h of telemetry). Established that the pressure does NOT come from the MYTHOS stack: user@1001.service holds 0.7-1.0 GB and mythos-ai-executor.service 0.48-0.53 GB, while session-1915.scope (root agent sessions) holds a standing 2.4-2.6 GB and Docker ~0.8 GB. Identified the decisive design trap: swap has been >96% for the entire telemetry history while PSI avg60 reads 0.00, so any swap-percentage threshold would latch CRITICAL permanently, block all AI tasks forever and flood WhatsApp; triggers must use MemAvailable, PSI rate-of-change and oom_kill deltas instead, with swap reported only in the message body. Search First returned EXTEND, not build: mythos-memwatch.service already performs the detection sampling, ops/oom/ already carries the OOMScoreAdjust=0 drop-ins for eight deploy services, executor.js:806 dispatchTask() already implements a capacity gate with dispatch_deferred defer semantics that a pressure predicate slots into, and the WhatsApp notify layer already exists with a two-phase enqueue/flush ledger. Found two blockers: (a) the 2026-09-01 outage fix was never installed - /etc/systemd/system/user@1001.service.d/ does not exist, so user@1001.service still runs at OOMScoreAdjust=100, the exact condition that took all eight production services down on 2026-09-01 and required manual recovery; (b) the WhatsApp layer commit b37491f is not an ancestor of this branch and its KINDS are regex-fenced to COMPLETED/FAILED/BLOCKED/HUMAN_APPROVAL over a REPORT-shaped input, so WARNING/CRITICAL/RECOVERED cannot be emitted without an explicit extension decision. systemd-oomd and earlyoom are both absent from this host. No Resource Guard was implemented and none of the nine required validation tests could be run, since they all validate a running component that investigate scope forbids creating.

## Commits

- none

## Files changed

- none

## Tests

- required validation suite (9 checks): NOT RUN — all nine validate a running Resource Guard, which requested_action=investigate forbids creating; no test is claimed as passed
- host memory/swap/PSI read via /proc/meminfo, /proc/swaps, /proc/pressure/*: verified — swap 4030/4095 MiB, MemAvailable 2604 MiB, PSI present
- cgroup v2 delegation check via cgroup.controllers + cgroup.subtree_control: verified — cpu memory pids delegated to user@1001.service, rootless MemoryHigh/PSI available
- systemd-oomd / earlyoom presence check via filesystem glob: verified absent
- ops/oom drop-in installation check: verified — 8 deploy user-service drop-ins present, /etc/systemd/system/user@1001.service.d/ ABSENT (fix not installed)
- WhatsApp layer ancestry check via git merge-base --is-ancestor b37491f HEAD: verified NOT an ancestor of mythos/gh/gh-issue-99
- worktree cleanliness check via git status --porcelain: verified clean, HEAD == origin == dc45ff1 (no edits, no commits, as required)

## Validation

- required checks: Resource Guard يعمل ويستطيع اكتشاف ضغط RAM/SWAP/PSI.; المهام الجديدة تُؤجل/تُمنع عند الحالة الحرجة.; الخدمات الأساسية محمية.; WhatsApp alert يعمل كقناة تنبيه فقط.; توجد حماية من تكرار الرسائل.; فشل WhatsApp لا يؤثر على Bridge/Executor.; restart/recovery ناجح.; لا توجد secrets في Git/logs/reports.; جميع الاختبارات ذات الصلة ناجحة.
- remote head: dc45ff1d6c5deffda6861e97f4c7d751bdf244bf
- report problems: none

## Problems

- none

## Risks

- CRITICAL/UNRESOLVED: user@1001.service still has OOMScoreAdjust=100 because /etc/systemd/system/user@1001.service.d/oom.conf was never installed; a recurrence of the 2026-09-01 22:16 kernel choice would again SIGKILL all eight production services with Restart=no and require manual recovery. Root/owner action, one file, independent of this task.
- Swap is at 98.4% right now and has never recovered; the host has no reclaim headroom, so any new large allocation goes straight to OOM rather than to swap.
- MYTHOS_MAX_PARALLEL defaults to 5; five concurrent Claude sessions at ~400 MB each would need ~2 GB against 2604 MiB available with swap already full.
- The dominant consumer (session-1915.scope, ~2.5 GB of root agent sessions) is outside the executor's rootless control; a Resource Guard confined to user@1001.service cannot reclaim it and would defer MYTHOS tasks for pressure it did not cause.
- Naive swap-percentage thresholds would latch CRITICAL permanently on this host and, combined with the WhatsApp sink, produce a repeating alert loop — the guard must be simulation-tested against the recorded memwatch history before any enforcing action is enabled.
- WhatsApp integration for WARNING/CRITICAL/RECOVERED requires either extending whatsapp.js KINDS (its regex-fenced ledger key and REPORT-shaped buildMessage both need changes) or a separate guard ledger reusing providers/evolution; that decision is unmade.
- Docker (~0.8 GB across two scopes) was not analysed for reducibility; the executor user has no docker socket access to inspect it.
- systemctl, ps and node were unavailable under the sandbox in this run, so service state was inferred from /proc and /sys/fs/cgroup rather than queried from systemd; OTHMODE record OTH-2026-00027 could not be updated in-flight.

## Next recommended action

Owner: install ops/oom/user@1001.service.d/oom.conf as root (sudo install -m 0644 into /etc/systemd/system/user@1001.service.d/, then systemctl daemon-reload) — this closes the live 2026-09-01 outage path and is independent of the guard. Then open a follow-up GitHub Issue with 'Action: implement' for MYTHOS Resource Guard, scoped to: MemAvailable/PSI-delta/oom_kill-delta triggers (never swap%), hysteresis with distinct enter/exit thresholds plus cooldown, an admission predicate added to executor.js dispatchTask() reusing the existing dispatch_deferred path, MemoryHigh on AI units and MemoryLow on the eight production services (rootless, delegation confirmed), a decision on extending whatsapp.js KINDS vs a separate guard ledger, and a dry-run replay against /opt/mythos-memwatch/memwatch.log before any enforcing action is enabled. Interim zero-code mitigation: set MYTHOS_MAX_PARALLEL=2.
