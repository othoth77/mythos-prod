# MYTHOS Autopilot — operations

Safe reconciler for the repetitive owner operations the audit found (see
`docs/MYTHOS_AUTOPILOT.md` for the matrix and the boundary).

```
mythos-autopilot status | tick | drift | sync [--apply] | restart … | watchdog | worktrees [--apply] | tests | evidence | ledger
```

State: `~deploy/mythos-ai-executor/autopilot/` — `state.json` (unified operational
state, also `GET /autopilot` on the executor), `ledger.jsonl` (audit), `locks/`,
`restart/{requests,approvals}/`, enable markers.

## Modes

| Marker (in the state dir) | Enables | Default |
|---|---|---|
| `sync.enabled` | AUTO `git merge --ff-only` of the shared checkout to `origin/main` | off → dry run, decision ledgered |
| `worktrees.enabled` | AUTO removal of merged, delivered, clean, unused **task** worktrees + `branch -d` | off → plan only |
| `restart.auto.enabled` | policy self-approval of an executor restart (all other vetoes still apply) | off → APPROVAL |

Kill switches: `MYTHOS_AUTOPILOT=off` (everything observes), `MYTHOS_AUTOPILOT_SYNC=off`,
`MYTHOS_AUTOPILOT_WORKTREES=off`, `MYTHOS_AUTOPILOT_RESTART=off`. Rollback = `rm` the marker.

## Governed restart

```
mythos-autopilot restart status
mythos-autopilot restart approve <expected-sha> --by "Othman Haddad" --reason "merged PR #NNN"
# the next tick (or `restart apply`) runs pre-checks, restarts, waits for /health,
# verifies code_identity.head == <expected-sha>; one attempt per approval.
```

## Install

```
bash ops/autopilot/install-autopilot.sh      # as deploy — observe mode
```
