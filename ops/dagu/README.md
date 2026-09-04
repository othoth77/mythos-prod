# MYTHOS maintenance layer — Dagu DAGs over three shell tools

Stage **EXEC-ARCH-0** (2026-09-04). Decision record: `docs/MYTHOS_EXECUTION_ARCHITECTURE.md`.
Dagu assessment and PoC: `docs/MYTHOS_DAGU_HOST_OPERATIONS.md` (`ops/dagu-poc/`).

```
ops/dagu/
  bin/mythos-git-sync          ff-only sync of a checkout to origin/<branch>   (dry-run unless --apply)
  bin/mythos-drift-check       SOURCE / CODE / EXECUTOR identity report       (read-only)
  bin/mythos-worktree-gc       remove merged, clean, unused task worktrees     (dry-run unless --apply)
  bin/mythos-restart-approval  request / grant / verify / revoke the ONE approval a restart needs
  maintenance/git-sync-main.yaml     every 5 min   guard → sync (marker-gated apply) → drift report
  maintenance/drift-check.yaml       every 15 min  guard → drift
  maintenance/worktree-gc.yaml       every 6 h     guard → gc (marker-gated apply)
  maintenance/executor-restart.yaml  NO schedule   guard → no RUNNING task → drift gate → APPROVAL GATE → approval-verify → restart → verify
```

## Rules (held by `tests/dagu-maintenance-test.js`)

* DAGs are **pinned files in Git**; Dagu runs with `write_dags: false` — nothing authors a DAG at runtime.
* Every DAG's **first step is the Resource Guard admission** (`mythos-resource-guard status` → `admit`), one
  queue `mythos-maintenance`, `max_active_runs: 1`, a `timeout_sec`.
* No `sudo`, `docker`, `--force`, `reset`, `clean`, `rebase`, `stash`, `rm -rf`, `branch -D`, `push`, nginx or
  `user@1001` anywhere. `git merge --ff-only` and `git worktree remove` (no `--force`) + `git branch -d` are the
  only mutations, and both are **dry-run until the owner creates a marker**:
  `~deploy/mythos-ai-executor/maintenance/sync.enabled` / `worktrees.enabled` (`rm` = instant rollback).
* The executor restart is **never timer-driven**. Its DAG pauses on the `plan` step (Dagu step approval, PoC
  test 11) and the `restart` step has no log until a human approves with the required input `approval_ref`.
  It only reaches the gate when `mythos-drift-check --require-restart` says `EXECUTOR_RESTART_REQUIRED`, the
  guard is not `CRITICAL`, and the executor reports zero `RUNNING` tasks. The restart is
  `systemctl --user restart mythos-ai-executor.service` — deploy restarting a deploy user unit, no privilege
  crossed, no hostops allowlist change. Verification polls `/health` until `code_identity.head` equals the
  checkout HEAD (90 s) or fails the run.
* **The Dagu gate is not the authorisation** (GH #161). Dagu's approval identity is the shared basic
  credential and its gate only checks that `approval_ref` was *present* — `APP-FAKE` used to be enough. The
  `approval-verify` step now stands between the gate and `systemctl`: `mythos-restart-approval verify`
  resolves the ref in the **executor policy engine's approval store** (`core/policy-engine.js` /
  `core/store.js` — the same record `lib/mcp-invoke.js` requires for CONTROLLED MCP tools, and the one
  `docs/MYTHOS_DAGU_HOST_OPERATIONS.md` §12 prescribes) and exits `3` unless it is: a well-formed `ap-…` id,
  an existing approval, `action_class` exactly `hostops:executor.restart`, `subject_id` exactly the checkout
  HEAD this restart targets, `GRANTED`, not revoked, decided by a **human** name, decided within 24 h and
  never consumed. `--consume` stamps it, so one approval buys one attempt. An unmeasurable HEAD or an
  unwritable store is exit `1` — fail closed, never an authorisation. No second governance system was
  introduced and no existing gate was relaxed.
* `code_identity` is measured once by the executor at start (`executor.js CODE_IDENTITY`, reported in
  `GET /health`). An executor that does not report it is `EXECUTOR_UNVERIFIED` — never `CURRENT`, never
  restartable through this path.

## Operate

```bash
# without a Dagu service (today): run a DAG once from the PoC binary, as deploy
DAGU_HOME=/home/deploy/dagu-scratch /home/deploy/dagu-poc/bin/dagu dry   ops/dagu/maintenance/git-sync-main.yaml
DAGU_HOME=/home/deploy/dagu-scratch /home/deploy/dagu-poc/bin/dagu start ops/dagu/maintenance/drift-check.yaml

# the tools work without Dagu at all
ops/dagu/bin/mythos-git-sync /home/deploy/projects/mythos-prod            # dry-run
ops/dagu/bin/mythos-drift-check /home/deploy/projects/mythos-prod
ops/dagu/bin/mythos-worktree-gc /home/deploy/projects/mythos-prod         # plan only

# the one approval a restart needs (owner, before starting the DAG)
ops/dagu/bin/mythos-restart-approval request --repo /home/deploy/projects/mythos-prod \
    --reason "executor is 3 commits behind the checkout"                  # prints ap-…
ops/dagu/bin/mythos-restart-approval grant  ap-… --by "Othman Haddad"     # then paste ap-… as approval_ref
ops/dagu/bin/mythos-restart-approval list
ops/dagu/bin/mythos-restart-approval revoke ap-… --by "Othman Haddad"

# tests (offline; the Dagu dry-validation section runs when MYTHOS_DAGU_BIN is set)
MYTHOS_DAGU_BIN=/home/deploy/dagu-poc/bin/dagu node tests/dagu-maintenance-test.js
```

## The one owner step

Install Dagu as a **deploy-user service** with the maintenance DAG directory pinned to this checkout
(`dags: /home/deploy/projects/mythos-prod/ops/dagu/maintenance`, `permissions.write_dags: false`,
`auth.mode: basic`, loopback only, `MemoryMax=256M`, `NoNewPrivileges=true` — the PoC unit
`ops/dagu-poc/dagu-poc.service` and `ops/dagu-poc/config.example.yaml` are the template). Until then nothing
runs on a schedule; the tools and DAGs are exercised by the test suite and by `dagu start` by hand. The
`sync.enabled` / `worktrees.enabled` markers are separate owner decisions (observe first).
