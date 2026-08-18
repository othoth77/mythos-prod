# Mythos AI Operating Layer — running it

How to operate the MVP: submit work, watch it, answer an approval, stop it.

Everything below goes through the executor API on `127.0.0.1:8130` (also
reachable from the n8n container on `172.18.0.1:8130`). Every endpoint except
`/health` needs the bearer token in
`~/.config/mythos-ai-executor/executor.env` — never print or commit it.

## The operating model

```
one goal  →  campaign  →  roadmap picks the capability  →  mission DAG
          →  isolated worktree  →  Claude implements  →  tests IN THAT TREE
          →  independent review (different model)  →  bounded repair
          →  validation  →  commit  →  GitHub relay  →  memory  →  roadmap
          →  next mission  →  …
```

No step needs a human to carry a message to the next one. A human is needed
for exactly four things: approvals, credentials, real spending, and genuine
external blockers.

## Submit a goal

```bash
curl -s -X POST http://127.0.0.1:8130/campaigns -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"objective":"Develop the remaining safe capabilities."}'
```

If a live campaign already exists for the project you get **that** campaign
back with `created: false`. This is deliberate: a retried webhook, a
duplicated n8n execution or an impatient second submission must never fork the
work into two campaigns racing over the same repository.

Only `objective`, `project` and `requested_by` are read. Provider, execution
profile, permission mode, repository path and capability are **not** accepted
from callers — they are configuration and policy.

## Watch it

```bash
curl -s http://127.0.0.1:8130/campaigns/<id> -H "Authorization: Bearer $TOKEN"
```

`state`, `running`, `continuable`, `needs_human`, the current mission and each
task's status and worktree. For a running feed, page the event log by
sequence number (`after_seq` is lossless; `since` is for a first poll only):

```bash
curl -s "http://127.0.0.1:8130/events?after_seq=1200&limit=100" -H "Authorization: Bearer $TOKEN"
```

## Continue it

```bash
curl -s -X POST http://127.0.0.1:8130/campaigns/<id>/continue -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"max_steps":2}'
```

Normally you never run this by hand — **MYTHOS — Campaign Autopilot** in n8n
does it every 10 minutes. It is refused with `409 NEEDS_HUMAN` when the
campaign is `WAITING_FOR_APPROVAL` or `BLOCKED`, and with `409 ALREADY_RUNNING`
when a continuation is already in flight. `WAITING_FOR_QUOTA` is resumable —
that is the recovery path, not a bypass.

## Answer an approval

When a mission's real diff touches the governance cage, or repair runs out, the
campaign parks in `WAITING_FOR_APPROVAL` and stops. Read the reason:

```bash
curl -s http://127.0.0.1:8130/campaigns/<id>/report -H "Authorization: Bearer $TOKEN"
```

Inspect the mission's branch (`git log -p <branch>`), then record a decision.
A decision needs a human identity and an explicit grant/deny:

```bash
node -e "require('./projects/mythos-ai-executor/core/campaign').resolveApproval('<campaign-id>', { capability_key: '<KEY>', granted: false, decided_by: 'your-name', note: 'why' })"
```

Denying is the conservative direction: the branch is preserved unmerged, the
capability is recorded `OWNER_DENIED` in the roadmap so the loop stops
proposing it, and the campaign returns to `READY` to pick other work.
`OWNER_DENIED` never means "implemented" — a human can re-open it any time by
recording a different status.

Nothing in the autonomous loop calls `resolveApproval`. It cannot approve
itself.

## Stop it

```bash
sudo docker exec n8n-n8n-1 n8n update:workflow --id=MythosCampAuto1 --active=false
sudo docker restart n8n-n8n-1
```

That stops new continuations. To stop the executor entirely:

```bash
XDG_RUNTIME_DIR=/run/user/1000 systemctl --user stop mythos-ai-executor
```

Work in flight is durable either way — state is on disk, not in the process,
so stopping loses nothing and a restart resumes from the last checkpoint.

## What n8n is and is not

Two workflows, both committed as JSON under
`projects/mythos-ai-executor/n8n/`:

- **MYTHOS — Goal Intake (Campaign)** — webhook → objective only → Core.
- **MYTHOS — Campaign Autopilot** — every 10 minutes: read the campaign, route
  on the decision Core already made, then continue / record needs-human / idle.

n8n is an automation and event layer. It does not evaluate policy, does not
decide whether a campaign may continue, and cannot grant tools or permissions.
Its autopilot branches on `continuable` and `needs_human` — both computed
inside `core/campaign-service.js`. If a future change has n8n deciding those
for itself, the bridge has become a second policy engine and the property this
design depends on is gone.

The three SSANGYONG workflows are frozen and untouched by any of this.

## Where state lives

| What | Where |
|---|---|
| Campaigns | `/home/ubuntu/mythos-ai-executor/orchestration/campaigns/` |
| Entities + event log | `/home/ubuntu/mythos-ai-executor/orchestration/` |
| Mission worktrees | `/home/ubuntu/mythos-ai-executor/worktrees/<mission>/<task>/` |
| Phase 1 task state | `/home/ubuntu/mythos-ai-executor/tasks/<id>/` |
| Roadmap state | `projects/mythos-ai-executor/config/roadmap-state.json` (in Git) |

GitHub remains the source of truth for code. Mission commits land on
`mythos/<mission>/<task>` branches and are **never** auto-merged to `main`.
