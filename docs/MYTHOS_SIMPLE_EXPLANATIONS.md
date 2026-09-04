# MYTHOS — Simple Explanations

> This page explains the main MYTHOS systems in plain, non-technical language. It is a companion for owners and operators who need to understand **what each part does** without reading implementation details.

| System | Simple explanation |
|---|---|
| **GitHub** | The project's official notebook: it records the real work, decisions, and history. |
| **Bridge** | The messenger: it carries an approved task from GitHub into the MYTHOS execution flow and brings the result back. |
| **OTHMODE** | The guard and manager: it checks what is allowed before work can proceed. |
| **Claude Code** | The worker: it performs the implementation work that OTHMODE allows. |
| **Worktree** | The temporary workshop: a separate working area where a task can be built without disturbing the main project. |
| **Tests** | The monitor: they check that the change behaves as expected and that existing behavior has not been broken. |
| **Pull Request (PR)** | The review request: it presents completed work for inspection before it can enter the main project. |
| **Human Merge** | The final human decision: a person decides whether reviewed work is allowed into `main`. There is no automatic merge. |
| **Dagu** | The scheduler and organizer: it runs approved recurring or operational workflows at the required time. |
| **Resource Guard** | The resource/energy guard: it prevents work from overloading the available machine resources. |
| **Drift Check** | The matching meter: it checks whether the running system and the approved project state still match. |
| **Git Sync** | The synchronization step: it keeps the project's copies aligned with the official GitHub state. |
| **Worktree GC** | The cleanup worker: it removes obsolete temporary work areas according to the approved lifecycle rules. |
| **Executor Restart** | Reloading the worker so newly approved code becomes active. This remains a separate human-approved action; it is not automatic. |
| **Skill Trust** | The tool trust check: it verifies that a Skill is known, scanned, approved, and has not changed since approval before the Executor can use it. |
| **MCP Trust** | The external-door trust check: it verifies whether an external MCP connection is acceptable under the current trust rules. |
| **Lifecycle** | The task life record: it keeps track of where work is in its allowed journey and what state it is currently in. |
| **Status Center** | The dashboard: it gives the owner a simple view of the project's current health, progress, and important status. |
| **Autopilot** | Doing safe, repetitive chores automatically. In MYTHOS this is not a separate robot: the same governed flow (Dagu schedules, OTHMODE checks, a human approves anything risky such as a restart). The earlier stand-alone Autopilot (PR #158) was retired in favour of that flow. |

## How they fit together

In simple terms:

**GitHub records the task → Bridge carries it → OTHMODE checks it → Claude Code does the work → Tests check it → PR asks for review → Human Merge decides → `main` becomes the official result.**

Operational helpers such as Dagu, Autopilot, Resource Guard, Drift Check, Git Sync, Worktree GC, Skill Trust, MCP Trust, Lifecycle, and Status Center support that flow without replacing the human approval points.

## Important rule

A successful task is not the same thing as a closed issue. Work is considered delivered only when the implementation/evidence is complete and the resulting change is accepted through the project's governed GitHub workflow.
