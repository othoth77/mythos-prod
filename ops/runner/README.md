# Runner workspace repair (`ops/runner/`)

**Created 2026-08-21** for the Step-0 blocker of the production-closure
mission: the VPS Final Gate fails at `actions/checkout` with
`insufficient permission for adding an object to repository database
.git/objects` in `/opt/mythos-gh-runner/_work/mythos-prod/mythos-prod`.

**Evidence:** run 32482633989 (attempts 1+2, 12:35/12:37 UTC) and fresh
run 32485711727 (13:13 UTC) — identical EACCES ×3 per attempt;
deterministic, on-host, not caused by any commit (the checkout never
completes; run 32476546112 passed at 11:17 UTC on the same workflow, so
the fault window is 11:18–13:13 UTC on the host). The smoke/security job
passes on every attempt — the runner's least-privilege boundary is intact,
which is also *why* it cannot heal its own workspace.

## Operator procedure (root, over the sanctioned admin path)

```bash
cd /home/deploy/projects/mythos-prod        # or any checkout containing this commit
sudo bash ops/runner/inspect-and-repair-workspace.sh            # 1. read-only diagnosis
sudo bash ops/runner/inspect-and-repair-workspace.sh repair     # 2. minimal fix: chown ONLY the foreign-owned entries it listed
# — or, if the diagnosis shows the workspace is unsalvageable —
sudo bash ops/runner/inspect-and-repair-workspace.sh reset      # 2'. remove the disposable workspace; runner recreates it
```

Then re-dispatch **VPS Final Gate** (Actions → workflow_dispatch) and
require: checkout SUCCESS · smoke/security PASS · gate job PASS
(governance 99/0 on-host, knowledge-config report, e2e host-refusal PASS).

The script never touches the runner service configuration, sudoers,
NoNewPrivileges, governance controls, or anything outside
`_work/mythos-prod`; `repair` refuses to run when it finds nothing
foreign-owned (no blind chown, ever). It also prints disk/inode headroom
to rule out ENOSPC masquerading, and ACL/immutable attributes when the
tools exist.
