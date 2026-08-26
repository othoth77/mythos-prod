# Mythos OS instructions

Read and follow `AGENTS.md` before performing any task in this repository.

Use `docs/AI_HANDOVER.md` and GitHub to determine the current project state. Do not rely on stale conversation summaries.

## OthMode

OTHMODE (`projects/command-center`, served at othmode.mythosprod.xyz) carries an owner-controlled switch. Check it at session start when working on this repository (on the production host: `GET http://127.0.0.1:3021/api/othmode/mode`, or `node projects/command-center/cli/othmode-cli.js mode`; off-host, treat it as OFF).

- **ON** — operate through OTHMODE conventions: consult the command library before inventing commands; consult Memory (`/api/othmode/memory/search`) before re-deriving known facts; apply the `search-first` skill before building anything new; record notable signals/outcomes through the evolution endpoints or CLI; use the `preflight` and `postflight` skills around substantive tasks.
- **OFF** — operate normally. OTHMODE stays readable; nothing is imposed.

This is an instruction contract, not an interceptor: an unreachable OTHMODE reads as OFF and never blocks work. The switch itself is owner-only; never change it on your own initiative.

When instructions conflict, follow this priority:

1. Explicit user instruction for the current task
2. Safety and production-data protection
3. `AGENTS.md`
4. `docs/AI_HANDOVER.md`
5. Stage documentation and roadmap
