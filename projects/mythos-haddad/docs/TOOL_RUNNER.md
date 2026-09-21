# Mythos Haddad — V1a local tool runner (READ/TEST ONLY)

**Status: built, tested and verified live against the real model — NOT activated.** The final
step (arming the unattended GitHub loop to use it) was refused by this environment's safety
classifier and is left for the owner. See [Activation](#activation-owner-step) and
[What the measurements say](#what-the-measurements-say) before enabling it.

## What it is

`projects/mythos-ai-executor/providers/haddad-agent.js` — the first provider in this repository
that **executes a tool call itself**. Every other execution path builds argv and hands it to a CLI
that owns its own sandbox (`claude-code`, `delegate`). This one runs an OpenAI tool-calling loop
against the local llama-server and performs the calls in-process, so the confinement lives in code
rather than in a flag another program is trusted to honour.

**Three tools, read-only:**

| Tool | Does | Bounded by |
|---|---|---|
| `read_file` | reads one UTF-8 file | 64 KiB, regular files only, no symlinks |
| `list_files` | lists one directory | 400 entries |
| `run_command` | runs one allowed command | argv only, no shell, 120 s, 16 KiB output |

**There is no write tool.** Not disabled — absent. `policy.js` will happily report that
`repo-write` permits writing; the runner implements no such tool, so the answer has nowhere to go.

## Where the permissions come from

`lib/policy.js` gained one function, `toolsForProfile(name)` — a **second renderer of the same
profile fields** that `claudeArgsForProfile` turns into CLI flags. No second permission dictionary
exists, because two would drift and the drift would be silent.

```
repo-read  →  read_file, list_files, run_command(node --version)
repo-test  →  read_file, list_files, run_command(node …, npm test …, npm run test …)
repo-write →  same as repo-test here — the write grant has no tool to land in
```

`Bash(npm test:*)` parses as program `npm` with required argv prefix `['test']`; `Bash(node
--version)` without `:*` is that exact argv and nothing else. A disallowed `Bash()` entry
subtracts, so `repo-test`'s denial of `git commit` survives the translation.

### The code ceiling sits below the policy ceiling

The profile permits `git`, `ls`, `cat`, `rg` and more. **The runner executes none of them.** Its
own `ALLOWED_PROGRAMS` map contains exactly `node` and `npm`, resolved to absolute paths once at
load so `PATH` cannot substitute a different binary later. `sh`, `bash` and `sudo` are absent by
construction — no configuration adds an entry to that map. This is the pattern
`ops/hostops/mythos-hostops.js` uses: *"even if the allowlist file were edited to relax it, v0.1
executes READ verbs only."*

A command must clear **both** ceilings: the map, then the profile.

## Confinement

One primitive does all of it, and it tests the **resolved** path rather than the spelling, so
`../` chains and symlinks pointing outside are the same failure rather than two special cases:

1. resolve against the workspace → 2. `realpath` (walking up to the deepest existing ancestor for
paths that do not exist yet) → 3. require the result to sit inside the realpath'd workspace.

Refused, with tests for each: path traversal · absolute paths outside (`/etc`, `/root`,
`~/.ssh`, the runtime key file) · symlink escape · symlinked directories · null bytes ·
non-string paths. Accepted: an absolute path that genuinely lands **inside** the workspace —
containment is the rule, not a ban on absolute paths.

`run_command` never builds a command string, so there is nothing for an argument to escape out of.
It spawns `(absoluteBinary, argvArray)` with a minimal env (`PATH`, `HOME`, `LANG`, `NO_COLOR`)
and `cwd` set to the workspace.

## Limits (constants, not tunables)

`MAX_ITERATIONS` 12 model turns · `MAX_TOOL_CALLS` 24 · `MAX_TOOL_OUTPUT_BYTES` 16 KiB ·
`MAX_READ_BYTES` 64 KiB · command timeout 120 s · plus the task's own `timeout_seconds`,
whichever expires first. A limit an instruction could raise would not be a limit.

## Fail-closed

Missing or non-absolute `working_directory` → refuse **before the model is contacted**. Invalid or
disabled profile → refuse. Unknown tool, ungranted tool, non-object arguments → refused and the
refusal is returned to the model as the tool result, so it can adapt; it is never executed.

## VPS isolation

- `available()` returns **false** unless an enable marker file exists on the host *and* the local
  runtime key is readable. On the VPS neither holds, so the executor never routes here.
- The bridge keeps two separate gates. `MYTHOS_BRIDGE_WORKER_PROVIDER` remains **advisory-only**
  (`openai-compat`, `free-llm-pool`) — its whole guarantee is "nothing selectable here can act",
  and adding an execution-capable provider would have voided it silently. Execution-capable
  providers get their own variable `MYTHOS_BRIDGE_EXEC_PROVIDER`, their own list, and a refusal if
  both are set at once.
- With neither variable set — the production case — provider selection is byte-identical to before.

## Activation (owner step)

Deliberately not performed here: this environment's safety classifier refused the step that arms
an autonomous, code-executing agent, and that refusal is the right default for exactly this kind
of change. To enable it on Haddad:

```bash
touch ~/.config/mythos-haddad/agent.enabled
# in ~/.config/mythos-haddad/worker.env, replace the advisory line with:
#   MYTHOS_BRIDGE_EXEC_PROVIDER=haddad-agent
#   HADDAD_AGENT_MODEL=<the id from GET /v1/models>
systemctl --user restart mythos-haddad-worker.service
```

Rollback is `rm ~/.config/mythos-haddad/agent.enabled` — `available()` goes false and the executor
stops routing to it immediately.

## What the measurements say

Verified live against the real Qwen and a real task worktree (not mocks):

| | Result |
|---|---|
| Tool loop works | ✅ `list_files` → `read_file` → correct answer derived from real file content, `exit_code 0` |
| Context pressure at 4096 | ✅ **not a bottleneck** — `n_past = 483` after a full tool loop. No runtime or model change needed. |
| **Report-block reliability** | ⚠️ **1 of 3 runs** emitted the required `mythos_report` block; one run errored outright |
| Tool-call counts across runs | 3, 4, 9 — the 9 indicates the model re-trying rather than converging |

**This is the honest limit of V1a.** The plumbing is sound and the security surface is tested, but
a 7B model does not reliably finish the executor's report contract while also driving a tool loop.
`executor.js` treats a run with no structured report as `BLOCKED` — *"a 'successful' run that
produced no usable report is not a clean completion"* — so on today's evidence a fair share of
GitHub tasks would land `BLOCKED` rather than `COMPLETED`, with the work done but unreported.

That is a model-capability finding, not a defect in this code, and it is the thing to weigh before
activation. Raising it is a V1b question (a stricter report contract, a repair turn, or a larger
model) and none of those were in scope here.

## Tests

`tests/mythos-haddad-tool-runner-test.js` — **34 checks**, offline with an injected transport.
Positives (real files, real command execution) and, more to the point, the negatives: traversal,
absolute escape, symlink escape, symlinked directory, null bytes, `sh`/`bash`/`sudo`, arbitrary
executables, the code ceiling refusing what the profile allows, argv injection, profile-bounded
arguments, malformed arguments, missing workspace, invalid profile, unknown tool, ungranted tool,
iteration budget, tool-call budget, deadline, oversized output, and the two VPS-safety gates.
