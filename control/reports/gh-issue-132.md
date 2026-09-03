# Report gh-issue-132 — COMPLETED

| Field | Value |
|---|---|
| Completed | 2026-09-03T17:42:59.568Z |
| Executor task | `t-20260903160713-a8bbyt` |
| OTHMODE task | `OTH-2026-00060` |
| Attempt | `gh-issue-132#1` |
| Action | implement (source explicit_current_issue, written "implement") |
| Profile | repo-write |
| Blocker | — |
| Runtime | `85cbf9067f6c` on `main` |
| Model | `claude-sonnet-5` (explicit:sonnet (requested "sonnet")) |
| Branch | `mythos/gh/gh-issue-132` |
| Commits on origin | true |
| Git verified | true |

## Summary

Diagnosed the live HOSTOPS-2R production activation gap: usermod -aG mythos-hostops deploy only edits /etc/group and never refreshes the supplementary groups of deploy's already-running systemd --user manager (user@<uid>.service), so mythos-ai-executor.service kept hitting EACCES on /run/mythos-hostops/hostops.sock even with group membership granted and the executor unit itself restarted. The prior manual SupplementaryGroups=mythos-hostops drop-in failed with status=216/GROUP because that directive is documented (systemd.exec(5)) as having no effect on --user units, whose unprivileged manager lacks CAP_SETGID. Added ops/hostops/refresh-group-membership.sh, wired into install-hostops.sh right after the usermod -aG calls, which restarts user@<uid>.service (a root system unit) only for a user whose manager is already active — idempotent, non-disruptive, no reboot/logout needed. No changes to the socket unit, the root daemon, the helper, or lib/hostops.js; NoNewPrivileges=true on the executor is untouched throughout. Updated docs/MYTHOS_HOSTOPS_INTERFACE.md (HOSTOPS-2R-FIX addendum with revised owner activation steps), docs/AI_HANDOVER.md and docs/CHANGELOG.md. Added tests/mythos-hostops-group-refresh-test.js (10/0) proving the mechanism against a stubbed systemctl/id and asserting SupplementaryGroups= appears nowhere in the tree. Could not perform the actual root install or live socket connection test from this sandboxed execution session (no VPS/root access here, and the bridge constraints forbid manually changing the VPS from this session) — that is the documented owner-only next step.

## Commits

- `eebb4b12db69a3f4ecf68e3357442ea398beaa63` fix(hostops): HOSTOPS-2R-FIX — refresh deploy/dagu systemd --user manager so socket group membership actually activates (on origin)

## Files changed

- `ops/hostops/refresh-group-membership.sh`
- `ops/hostops/install-hostops.sh`
- `tests/mythos-hostops-group-refresh-test.js`
- `docs/MYTHOS_HOSTOPS_INTERFACE.md`
- `docs/AI_HANDOVER.md`
- `docs/CHANGELOG.md`

## Tests

- tests/mythos-hostops-group-refresh-test.js: 10/0 (new)
- tests/mythos-hostops-daemon-test.js: 14/0
- tests/mythos-hostops-executor-test.js: 36/0
- tests/mythos-hostops-test.js: 39/0/2 skip
- tests/dagu-hostops-allowlist-test.js: 7/0
- tests/mythos-ai-executor-test.js: 390/0
- tests/mythos-governance-invariant-test.js: 111/0
- tests/resource-guard-test.js: 91/0
- tests/mythos-github-bridge-test.js: 150/0

## Validation

- required checks: Executor starts normally as a deploy USER service with `NoNewPrivileges=true`.; Executor `/hostops/run` health reaches the Unix socket successfully.; Root daemon is socket-activated and logs an authorized `SO_PEERCRED` connection.; A real READ-only `health` call returns `ok: true` and an audit id.; No sudo is used by the Executor path.; No Docker socket is exposed to Executor or Dagu.; No WRITE/RESTART/DEPLOY capability is introduced.; Existing Resource Guard, Governance, MCP, Model Selection, GitHub Bridge and unrelated project semantics remain unchanged.
- remote head: —
- report problems: none

## Problems

- none

## Risks

- Not verified against the actual live VPS (no root/systemd access from this execution session) — owner must run `sudo bash ops/hostops/install-hostops.sh` and verify per the HOSTOPS-2R-FIX addendum before this is considered production-proven.
- Restarting user@<uid>.service stops and restarts every systemd --user unit deploy currently has running (not just mythos-ai-executor) — expected and necessary, but the owner should be aware of the blast radius when re-running the installer on a host with other deploy user services active.
- The fix assumes deploy's login session uses the standard PID-1-managed user@<uid>.service pattern (true for lingering/systemd-managed sessions on this host per prior HOSTOPS-2R notes); an unusual session-management setup could behave differently.

## Next recommended action

Owner: merge via governance relay, then re-run `sudo bash ops/hostops/install-hostops.sh` on the VPS (idempotent) and verify via the curl/journalctl checks in docs/MYTHOS_HOSTOPS_INTERFACE.md's HOSTOPS-2R-FIX addendum.
