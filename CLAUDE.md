# Mythos OS instructions

Read and follow `AGENTS.md` before performing any task in this repository.

Use `docs/AI_HANDOVER.md` and GitHub to determine the current project state. Do not rely on stale conversation summaries.

## OTHMODE — per-command activation

OTHMODE (`projects/command-center`, served at othmode.mythosprod.xyz) is **always available**. There is no global switch. Whether it applies is decided **per command**, by the user, with one keyword:

- **The user's message contains the standalone word `othmode`** (case-insensitive: `othmode`, `OTHMODE`, `OthMode`; as its own word — `othmodel`, `myothmode`, `othmode-test` do NOT count) → **that command runs through the OTHMODE control contract**: consult the command library before inventing commands; consult Memory (`/api/othmode/memory/search`) before re-deriving known facts; apply the `search-first` skill (SEARCH → REUSE → ADAPT → CONNECT → BUILD LAST) before building anything new; record qualifying signals/outcomes through the evolution endpoints or CLI; use the `preflight`/`postflight` skills around the work. Only such explicitly activated operations belong in OTHMODE's evolution records.
- **No `othmode` keyword** → **normal Claude.** Do not invoke Search First, consult OTHMODE skills/memory, apply OTHMODE command policies, or record OTHMODE evolution events for that command.

The deterministic rule lives in `projects/command-center/reference/othmode/activation.js` (also: `node projects/command-center/cli/othmode-cli.js activation "<text>"`, or `POST /api/othmode/activation`). This is an instruction contract, not an interceptor: an unreachable OTHMODE never blocks work. The keyword selects a control contract only — it grants no permission of any kind; authentication, roles and every security boundary are evaluated exactly as always.

When instructions conflict, follow this priority:

1. Explicit user instruction for the current task
2. Safety and production-data protection
3. `AGENTS.md`
4. `docs/AI_HANDOVER.md`
5. Stage documentation and roadmap
