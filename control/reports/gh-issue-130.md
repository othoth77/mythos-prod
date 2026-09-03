# Report gh-issue-130 — COMPLETED

| Field | Value |
|---|---|
| Completed | 2026-09-03T15:29:02.689Z |
| Executor task | `t-20260903150655-cny29l` |
| OTHMODE task | `OTH-2026-00059` |
| Attempt | `gh-issue-130#1` |
| Action | implement (source explicit_current_issue, written "implement") |
| Profile | repo-write |
| Blocker | — |
| Runtime | `718741b86da9` on `main` |
| Model | `claude-sonnet-5` (auto:balanced→sonnet score=6 [execution_profile:repo-write+2 task_category:implement+3 complexity_terms(security)+1]) |
| Branch | `mythos/gh/gh-issue-130` |
| Commits on origin | true |
| Git verified | false |

## Summary

Fixed GitHub issue #130 (HOSTOPS-2R): the HOSTOPS-1 Executor->HostOps boundary (sudo -n mythos-hostops, called from inside mythos-ai-executor.service) was silently non-functional in production because NoNewPrivileges=true on that service makes the kernel ignore sudo's setuid bit for its children -- every real /hostops/run call returned HOSTOPS_UNAVAILABLE. Replaced it with a Unix domain socket boundary: a new root daemon (ops/hostops/mythos-hostops-daemon.py, stdlib Python for SO_PEERCRED, which Node lacks without a native addon) started directly by systemd via mythos-hostops.socket + mythos-hostops.service, never a child of the hardened executor, so NoNewPrivileges=true on the executor is completely unaffected. Two independent identity gates: socket file permissions (0660 root:mythos-hostops, new group with deploy+dagu) and the daemon's own SO_PEERCRED check (kernel-reported uid only, never a caller-supplied field). The daemon invokes the unmodified root-owned helper directly (fixed argv, shell=False, SUDO_USER set to the verified caller) -- the helper remains the sole allowlist/class/argument/audit authority, byte-for-byte unchanged. lib/hostops.js preserves the exact governance order (closed fields -> identity -> allowlist -> class READ -> argument validation -> Resource Guard admission, still before the socket is touched) and every existing failure code; invoke() now returns a Promise (a socket call is inherently async) and server.js awaits it the same way it already awaited mcpInvoke.invoke(). The obsolete, never-functional ops/hostops/61-deploy-hostops sudoers fragment is deleted and the installer updated to create the socket group and install the daemon + systemd units instead; dagu's separate manual/owner sudo path (60-dagu-hostops) is untouched since it was never broken by NoNewPrivileges. Wrote a real integration test that runs the actual Python daemon against a temp socket and a stub helper, exercising a genuine SO_PEERCRED round trip with this process's real uid, fixed-argv construction, malformed/injected-request refusal before any subprocess spawns, and end-to-end success/Resource-Guard-ordering through the real (non-injected) lib/hostops.js client -- plus a Python-level unit test of the authorization primitives. Rewrote the adapter test suite for the async boundary. Updated docs/MYTHOS_HOSTOPS_INTERFACE.md (HOSTOPS-2R addendum with full owner activation steps), docs/AI_HANDOVER.md and docs/CHANGELOG.md. No root install was performed from this session (owner-only, per constraints); until the owner runs install-hostops.sh, production behavior is unchanged (still the same tested HOSTOPS_UNAVAILABLE it returns today) -- this change can only improve production behavior, never regress it.

## Commits

- `8c8ab41cb64a5f893b42ea7fecd70066689d8d83` fix(hostops): HOSTOPS-2R — Executor -> HostOps boundary via Unix socket, NoNewPrivileges intact (on origin)

## Files changed

- `.gitignore`
- `docs/AI_HANDOVER.md`
- `docs/CHANGELOG.md`
- `docs/MYTHOS_HOSTOPS_INTERFACE.md`
- `ops/hostops/61-deploy-hostops (deleted)`
- `ops/hostops/install-hostops.sh`
- `ops/hostops/mythos-hostops-daemon.py (new)`
- `ops/hostops/mythos-hostops.js`
- `ops/hostops/mythos-hostops.service (new)`
- `ops/hostops/mythos-hostops.socket (new)`
- `projects/mythos-ai-executor/lib/hostops.js`
- `projects/mythos-ai-executor/server.js`
- `tests/mythos-hostops-daemon-test.js (new)`
- `tests/mythos-hostops-executor-test.js`
- `ops/hostops/61-deploy-hostops`
- `ops/hostops/mythos-hostops-daemon.py`
- `ops/hostops/mythos-hostops.service`
- `ops/hostops/mythos-hostops.socket`
- `tests/mythos-hostops-daemon-test.js`

## Tests

- tests/mythos-hostops-daemon-test.js (new, real Python daemon + real SO_PEERCRED): 14/0
- tests/mythos-hostops-executor-test.js (rewritten, async): 36/0
- tests/mythos-hostops-test.js (helper, unchanged logic): 40/0/1 skip
- tests/dagu-hostops-allowlist-test.js: 7/0
- tests/mythos-ai-executor-test.js: 390/0
- tests/mythos-github-bridge-test.js: 150/0
- tests/bridge-action-resolution-test.js: 88/0
- tests/model-selection-policy-test.js: 81/0
- tests/mythos-governance-invariant-test.js: 111/0
- tests/mythos-unattended-policy-test.js: 53/0
- tests/mcp-ecosystem-test.js: 168/0
- tests/resource-guard-test.js: 91/0

## Validation

- required checks: none
- remote head: 718741b86da955f68b731e8e0aefe1a6846bd50e
- report problems: none

## Problems

- none

## Risks

- The new mythos-hostops.service hardening (ProtectSystem=strict, ReadWritePaths=/var/lib/mythos/hostops, etc.) has never run on the live host -- verified by reasoning and by the test suite's source/logic checks, not by an actual root systemd start. If a directive is too strict the service fails to start, but the failure mode is exactly today's tested HOSTOPS_UNAVAILABLE, not an outage or a fallback to sudo/a shell.
- deploy's new mythos-hostops group membership requires a fresh login/session (or an executor restart under the updated group) to take effect -- called out explicitly in the activation steps; if skipped, the executor will see HOSTOPS_UNAVAILABLE (permission denied connecting) until it restarts under the new group.
- No live root install was performed or attempted from this session (correctly out of scope); the socket boundary is unverified against the real production /usr/local/sbin/mythos-hostops binary and real dagu/deploy uids beyond what the daemon integration test (running as the real deploy uid) already proves.
- 60-dagu-hostops (dagu's manual sudo path) is left installed and untouched by design (not broken, out of scope); it is a second, parallel path to the same helper and should be reviewed for consolidation if/when Dagu becomes an automated caller.

## Next recommended action

Owner: review and merge via the governance relay; then run `sudo bash ops/hostops/install-hostops.sh` from the merged checkout, restart/re-login the deploy session (or `systemctl --user restart mythos-ai-executor`) so the new mythos-hostops group membership takes effect, then verify with the /hostops/run curl check and `journalctl -u mythos-hostops` per docs/MYTHOS_HOSTOPS_INTERFACE.md's HOSTOPS-2R Activation section.
